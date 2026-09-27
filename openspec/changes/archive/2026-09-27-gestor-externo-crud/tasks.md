# Tasks

## 1. Migración Alembic

- [x] 1.1 Generar migración: `cd backend && alembic revision -m "add gestor_externo and gestor_area_externo tables"`
- [x] 1.2 Editar upgrade(): crear tabla `gestores_externos` con columnas (incluye `nombre`), CHECK metodo_pago, índices
- [x] 1.3 Editar upgrade(): crear tabla `gestor_area_externo` con FKs CASCADE, UniqueConstraint, índices
- [x] 1.4 Editar downgrade(): revertir cambios en `notificaciones` y DROP TABLE en orden correcto
- [x] 1.5 Ejecutar migración: `alembic upgrade head` y verificar en DB — corrida contra el stack Docker local (`veterinaria_db`/`veterinaria_backend`, DB real, no mock): `alembic upgrade head` aplicó `e4f5a6b7c8d9 -> b4e04370dc32`, se verificaron ambas tablas nuevas y la columna/constraint de `notificaciones` con `psql \d`, y se probó el ciclo `alembic downgrade -1` + `alembic upgrade head` para confirmar que el downgrade revierte limpio.

## 2. Modelos (backend/app/models/models.py)

- [x] 2.1 Agregar clase `GestorExterno` con todos los campos, constraints, relaciones
- [x] 2.2 Agregar clase `GestorAreaExterno` tabla pivote con FKs, UniqueConstraint
- [x] 2.3 Agregar relación inversa en `AreaServicio`: `gestores_externos = relationship("GestorAreaExterno", back_populates="area")`
- [x] 2.4 Verificar imports: `text` de sqlalchemy para server_default (ya estaba importado)

## 3. Schemas (backend/app/schemas/schemas.py)

- [x] 3.1 Agregar `GestorExternoBase` con campos comunes y validador RIF uppercase
- [x] 3.2 Agregar `GestorExternoCreate` heredando de Base
- [x] 3.3 Agregar `GestorExternoUpdate` (campos opcionales, incluye `nombre` y `rif` normalizado)
- [x] 3.4 Agregar `GestorExternoResponse` con `id`, `created_at`, `areas`, `usuario_nombre` y model_validator — implementado con un `model_validator(mode="before")` que arma un dict nuevo en vez de mutar los atributos del objeto ORM in-place (el pseudocódigo de design.md reasignaba `data.areas` con `AreaServicio` sobre una relación tipada a `GestorAreaExterno`, lo que habría corrompido la colección de SQLAlchemy en cualquier GET). Ver Learned en el reporte de apply.
- [x] 3.5 Agregar import `Literal` si no existe (ya estaba importado)

## 4. Router CRUD (nuevo archivo backend/app/routers/gestores_externos.py)

- [x] 4.1 Crear router con `prefix="/api/gestores-externos"`, `tags=["Gestores Externos"]`
- [x] 4.2 `GET /` — lista paginada con query params: `skip`, `limit`, `activo`, `area_id`; eager load `areas.area`
- [x] 4.3 `GET /{id}` — detalle con eager load `areas.area`, `usuario`
- [x] 4.4 `POST /` — crear: validar RIF único (409), usuario_id existe si se manda (404), commit, return Response
- [x] 4.5 `PATCH /{id}` — actualizar: `rif` solo si no tiene áreas (422 si tiene, 409 si colisiona), validar usuario_id si cambia, `activo=false` = soft delete
- [x] 4.6 `DELETE /{id}` — si `gestor.areas` vacía → hard delete; sino → 409 "Desactive el gestor en su lugar"
- [x] 4.10 `DELETE /{id}` — 409 "El gestor tiene historial de notificaciones, desactívelo en su lugar" si existe alguna notificación con su `gestor_externo_id` — chequeo EXISTS/limit-1 en `routers/gestores_externos.py`, más un catch de `IntegrityError` sobre la FK `notificaciones_gestor_externo_id_fkey` (verificado el nombre real vía `pg_constraint`) como red de seguridad ante carreras.
- [x] 4.7 Sub-router asignaciones:
  - `GET /{id}/areas/` — lista áreas asignadas (AreaServicioResponse)
  - `POST /{id}/areas/` — body `{area_id}`, validar area existe, gestor activo, crear pivote (409 si duplicado)
  - `DELETE /{id}/areas/{area_id}` — borrar pivote (404 si no existe)
- [x] 4.8 Registrar router en `main.py` (include_router)
- [x] 4.9 Tests unitarios: crear, listar, actualizar, RIF inmutable con áreas, soft delete, hard delete bloqueado, asignar/desasignar área, duplicados — no hay suite de pytest en el backend (`backend/tests` no existe); cobertura equivalente vía Playwright request-fixture en `e2e/gestor-externo-crud.spec.js` (describe "API"), mismo criterio que el resto del repo (ver `e2e/asignacion-directa-servicio-gestor.spec.js`).

## 5. Integración Notificaciones (backend/app/services/notificacion_service.py + orden_service.py)

- [x] 5.1 En la misma migración: `notificaciones.destinatario_id` nullable + columna `gestor_externo_id` nullable (FK, índice)
- [x] 5.6 Cambiar FK `notificaciones.gestor_externo_id` a ON DELETE RESTRICT (modelo + migración b4e04370dc32, aún sin commitear) — editada la migración in place (no se creó revisión nueva). Verificado contra el stack Docker local: `alembic downgrade -1` con el código previo (CASCADE, coincidía con el schema aplicado), rebuild de `amivets-backend` con el archivo editado, `alembic upgrade head`, `psql \d notificaciones` confirmó `ON DELETE RESTRICT` (`pg_constraint.confdeltype = 'r'`), y se repitió el ciclo `downgrade -1` / `upgrade head` una vez más para probar el round-trip. El pivote `gestor_area_externo` sigue CASCADE (`confdeltype = 'c'`), sin tocar.
- [x] 5.2 Agregar `CheckConstraint` en notificaciones: `(destinatario_id IS NOT NULL) != (gestor_externo_id IS NOT NULL)` (XOR)
- [x] 5.3 En `notificar_asignacion` (rama sin asignación directa): tras notificar internos, query gestores externos activos del área y crear notificación para cada uno; mantener `SERVICIO_SIN_GESTOR` a admins si no hay internos activos
- [x] 5.4 Función `crear_notificacion_externa(db, gestor_externo, servicio)` que crea notificación con `destinatario_id=NULL`, `gestor_externo_id=ge.id`, `tipo="SERVICIO_ASIGNADO_EXTERNO"`, `canal="APP"`
- [x] 5.5 Test: confirmar orden con área que tiene gestor externo → notificación creada; asignación directa → sin notificación externa — cubierto en `e2e/gestor-externo-crud.spec.js` (describe "Integración con notificaciones"). Un gestor externo no tiene login/bandeja propia (design.md, Non-Goals), así que no hay endpoint de API para leer "su" notificación; se verifica con una consulta SQL de solo lectura vía `docker exec veterinaria_db psql` (helper `queryDb` en el propio spec, documentado en su cabecera) contra el stack Docker local. Confirmado también a mano en esta sesión: al confirmar un servicio en un área con SOLO gestor externo se creó `SERVICIO_ASIGNADO_EXTERNO` (destinatario_id NULL, gestor_externo_id seteado) Y se mantuvo `SERVICIO_SIN_GESTOR` para el admin.

## 6. Frontend (areas-gestores.js)

- [x] 6.1 Agregar pestaña/tab "Gestores Externos" en pantalla Áreas y Gestores
- [x] 6.2 Tabla listado: RIF, Nombre/Teléfono, Método pago, Áreas asignadas, Activo, Acciones
- [x] 6.3 Modal crear/editar: campos del schema (incluye `nombre`; RIF deshabilitado si tiene áreas), select método_pago (dropdown), checkbox es_movil, select usuario_id (opcional, busca usuarios)
- [x] 6.4 En fila: botón "Áreas" → modal con checklist de áreas (cargar de `/api/areas/`) para asignar/desasignar
- [x] 6.5 Botón desactivar (PATCH activo=false) / activar / eliminar (solo si sin áreas)
- [x] 6.6 Validación frontend: nombre, RIF y teléfono requeridos; RIF único lo valida el backend (mostrar 409)

## 7. Tests E2E

- [x] 7.1 Crear `e2e/gestor-externo-crud.spec.js`:
  - Admin crea gestor externo completo → 201, aparece en lista
  - Admin intenta RIF duplicado → 409
  - Admin asigna gestor a área "LABORATORIO" → ok
  - Admin desasigna área → ok
  - Admin desactiva gestor con áreas → soft delete (activo=false)
  - Admin intenta borrar gestor con áreas → 409
  - Admin borra gestor sin áreas → 204
  - Confirmar orden con área que tiene gestor externo → notificación creada en BD
  - Frontend: crear, editar, asignar áreas, desactivar via UI

  11/11 tests passing. Regresión corrida también: `e2e/areas-y-gestores.spec.js` (3/3) y
  `e2e/asignacion-directa-servicio-gestor.spec.js` (19/19), sin roturas.
- [x] 7.2 E2E: gestor sin áreas pero con notificación `SERVICIO_ASIGNADO_EXTERNO` → DELETE 409 y la notificación sigue en BD; frontend muestra el mensaje del 409 — nuevo test en `e2e/gestor-externo-crud.spec.js` (describe "Integración con notificaciones"): confirma un servicio en un área con gestor externo asignado, desasigna el área, intenta DELETE (409, `detail` verificado), confirma vía `queryDb()` que la fila de `notificaciones` y el gestor siguen intactos, y repite el intento desde la UI (`data-ge-eliminar` + diálogo `confirm()` aceptado) verificando el toast `.notification-toast` con el mismo mensaje. `fetchAPI`/`confirmarEliminarGestorExterno` ya mostraban `err.message` desde el `detail` del backend — no hizo falta tocar el frontend. También se corrigió el `afterAll` de ese mismo describe: el `gestorExterno` que recibe una notificación en el primer test ya no puede hard-deletearse en la limpieza (ahora da 409), así que pasa a desactivarse (`PATCH activo=false`) en vez de `DELETE`. 14/14 tests del spec, sin roturas en `areas-y-gestores.spec.js` (3/3) ni `asignacion-directa-servicio-gestor.spec.js` (19/19).
