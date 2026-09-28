# Design

## Context

Motivación en proposal.md (Why). Estado actual relevante, verificado en el código del working tree (incluye lo que dejó `toma-exclusiva-servicio-gestor`, todavía sin commitear):

- `backend/app/routers/ordenes.py::confirmar_servicios` (línea ~321): `POST /api/ordenes/{id}/confirmar`, roles `admin` y `veterinario` (fila 9 de la matriz), **sin cuerpo**. Delega en `backend/app/services/orden_service.py::confirmar_servicios(db, orden, current_user)` (línea ~152), que recorre los `SOLICITADO` de la orden: con `area_id` → `ASIGNADO` + `asignado_at` + `notificacion_service.notificar_asignacion(db, servicio)`; sin área → `EJECUTADO` + consumo. Es el ÚNICO punto que escribe `ASIGNADO` desde `SOLICITADO` (el otro `"ASIGNADO"` escrito está en `liberar_servicio`).
- `backend/app/services/notificacion_service.py::notificar_asignacion` (línea ~26): fan-out `SERVICIO_ASIGNADO` a cada `Usuario` con `GestorArea` en el área e `is_active`; si no hay ninguno, `SERVICIO_SIN_GESTOR` a los admins y devuelve una advertencia. No commitea. No existe `crear_notificacion`: el módulo tiene una función por evento.
- `backend/app/routers/servicios.py`:
  - `tomar_servicio` (línea ~476): chequeo de área con `_es_gestor_del_area` (línea ~73, solo mira `GestorArea`, no `is_active`), luego `UPDATE ... WHERE id=? AND estado='ASIGNADO' AND asignado_a_id IS NULL` → `EN_PROCESO` + `asignado_a_id`; 0 filas → 409.
  - `liberar_servicio` (línea ~536): `UPDATE ... WHERE id=? AND estado='EN_PROCESO' [AND asignado_a_id=? si no es admin]` → `ASIGNADO`, `asignado_a_id=NULL`, `liberado_at`, `liberado_por_id`.
  - `listar_bandeja` (línea ~680): servicios `ASIGNADO`/`EN_PROCESO` de las áreas del usuario, filtrados por `asignado_a_id IS NULL OR asignado_a_id = gestor_objetivo`; admin sin `usuario_id` ve todo.
  - `_validar_permiso_ejecutar` (línea ~108) y el gate de `actualizar_servicio_impl` (línea ~196): ejecutar exige `EN_PROCESO`, así que "trabajar" un servicio pasa siempre por tomarlo.
- `backend/app/models/models.py::ServicioConsulta` (línea ~343): `asignado_a_id` = "quién lo TOMÓ" (comentario explícito, línea ~429). Lo usan con ese significado `estado_toma`, `listar_realizados`, el gate de ejecución, los adjuntos (`routers/adjuntos.py`) y las comisiones (`comisiones-servicio`: el encargado es `asignado_a_id`).
- `backend/app/schemas/schemas.py::ServicioConsultaResponse` (línea ~214): expone `asignado_a_id`, `asignado_a_nombre` (resuelto en un `model_validator(mode='before')` con `username`), `liberado_at` y el `computed_field` `estado_toma` (`disponible | tomada | completada | liberada`).
- `backend/app/routers/areas.py::listar_gestores` (línea ~100): `GET /api/areas/{id}/gestores` es **solo admin** y devuelve también inactivos.
- Front: `static/js/sections/orden-abierta.js::confirmarServicios` (línea ~234) hace `POST` sin cuerpo; `pintarServicios` (línea ~126) pinta la última columna con `ESTADO_TOMA_PILL` / `estadoTomaLabel` de `static/js/core/format.js` (línea ~34), que también usa `hoy.js` (fila expandible, línea ~186). `bandeja-gestor.js::pintarQueue` (línea ~190) pinta el pill por `s.estado`, no por `estado_toma`.
- Alembic: head actual `d3e4f5a6b7c8` (`liberacion_servicio_gestor`).

## Goals / Non-Goals

**Goals:**
- Modelar la asignación directa sin cambiar lo que hoy significa `asignado_a_id`.
- Mantener la toma race-safe con un único `UPDATE` condicional, igual que hoy.
- Confirmación atómica: o se valida todo el cuerpo y se despacha, o no cambia nada.

**Non-Goals:**
- Reasignar después del despacho (el admin solo puede tomar/liberar, como hoy).
- Tocar `_validar_permiso_ejecutar` ni el gate de adjuntos: siguen resolviendo por `asignado_a_id`, que solo se llena al tomar.
- Tocar `GET /api/areas/{id}/gestores` (pantalla de admin) ni los roles de ningún endpoint existente.

## Decisions

1. **Columna separada `asignado_directo_a_id`** (FK `usuarios.id`, nullable, indexada) en `servicios_consulta`, con relación `asignado_directo_a`. Significa "a quién se despachó el servicio" y se llena solo en `confirmar_servicios`. `asignado_a_id` sigue significando "quién lo tomó" y sigue naciendo NULL.
   - *Alternativa descartada A — prellenar `asignado_a_id` en el despacho + flag booleano*: rompe el invariante "ASIGNADO ⇒ `asignado_a_id` NULL" en el que se apoyan `tomar_servicio` (`asignado_a_id IS NULL`), `estado_toma` (disponible/liberada), el gate de adjuntos (un gestor con `asignado_a_id == él` podría subir adjuntos antes de tomar) y `asignado_a_nombre` (mostraría "Tomada por" algo que nadie tomó). Obliga a reauditar cada lector de `asignado_a_id`.
   - *Alternativa descartada B — solo un flag `asignacion_directa` sin columna*: no dice A QUIÉN se asignó mientras nadie lo tomó; no alcanza.
   - *Trade-off aceptado*: una columna más y una condición más en la bandeja y en la toma. A cambio, cero cambios en ejecución, adjuntos, realizados y comisiones, y el dato de origen ("se lo asignaron" vs "lo agarró") queda para mostrarlo aún en `EN_PROCESO`.
   - `asignado_directo_a_id` **no se limpia al tomar** (se usa para el badge "Asignado a" en proceso) y **sí se limpia al liberar** (vuelve al área). Como el despacho ocurre una sola vez (`SOLICITADO` → `ASIGNADO`), un servicio liberado nunca vuelve a tener asignación directa.

2. **Contrato de confirmar**: cuerpo opcional `ConfirmarServiciosRequest { asignaciones: List[{servicio_id: int>0, gestor_id: int>0}] = [] }` en `schemas.py`; el router lo recibe como `Optional[...] = Body(None)` para que el `POST` sin cuerpo (front actual, `e2e/helpers.js::confirmarServiciosOrden`) siga valiendo. El router pasa a `orden_service.confirmar_servicios(db, orden, current_user, asignaciones={servicio_id: gestor_id})`.
   - Validación en `confirmar_servicios`, **antes de mutar nada** (después de `asegurar_recibe_trabajo` y de la query de `solicitados`): 422 si hay `servicio_id` repetido, si un `servicio_id` no está entre los `solicitados` con `area_id`, o si `gestor_id` no tiene `GestorArea(area_id del servicio)` con `Usuario.is_active`. Una sola query por lote (`GestorArea` join `Usuario` filtrada por los pares pedidos), no una por servicio.
   - 422 (no 409/403): es un cuerpo semánticamente inválido, mismo criterio que el resto del repo para datos inválidos (`listar_realizados` usa 422 para rango inválido).
   - En el loop: si hay entrada, `servicio.asignado_directo_a_id = gestor_id`.

3. **Notificación dirigida**: `notificar_asignacion(db, servicio)` pasa a leer `servicio.asignado_directo_a_id`: si está seteado, crea un solo `SERVICIO_ASIGNADO` para ese usuario (cuerpo "Se te asignó '<título>'.") y devuelve `None`; si no, el fan-out actual sin cambios. Se lee del servicio (no un parámetro nuevo) para que la firma no cambie y el llamador no pueda desincronizarse. Como el gestor ya se validó activo, la rama `SERVICIO_SIN_GESTOR` no aplica a un despacho directo.

4. **Toma exclusiva**: en `tomar_servicio`, para no-admin, el `UPDATE` condicional suma `AND (asignado_directo_a_id IS NULL OR asignado_directo_a_id = :yo)`. Con 0 filas se relee el servicio (mismo patrón que `liberar_servicio`) para dar el 409 correcto: "Este servicio está asignado a otro gestor." si `asignado_directo_a_id` es de otro y sigue sin tomar; si no, el mensaje actual "ya fue tomado por otro gestor". El admin no suma la condición. Se mantiene el 409 (y no 403) porque es un conflicto de estado del recurso, coherente con los 409 de toma/liberación vigentes.

5. **Liberar vuelve al área**: `liberar_servicio` agrega `"asignado_directo_a_id": None` al `UPDATE`. Nada más cambia (roles, 409s, `notificar_liberacion`, auditoría).

6. **Bandeja**: con `gestor_objetivo`, el filtro pasa a `(asignado_a_id IS NULL AND (asignado_directo_a_id IS NULL OR asignado_directo_a_id = g)) OR asignado_a_id = g`. Admin sin `usuario_id` sigue viendo todo (sin filtro). Admin con `usuario_id` ve lo que vería ese gestor.

7. **Candidatos**: nuevo `GET /api/areas/{area_id}/gestores-activos` en `routers/areas.py`, roles `admin` y `veterinario` (los que confirman), respuesta `[{usuario_id, username}]` solo activos, orden por `username`, 404 si el área no existe. Se prefiere un endpoint nuevo a abrir `listar_gestores` al veterinario: aquel devuelve inactivos y `role` para la pantalla de admin, y abrirlo cambiaría el contrato de otra pantalla.

8. **Respuesta y `estado_toma`**: `ServicioConsultaResponse` suma `asignado_directo_a_id` y `asignado_directo_a_nombre` (resuelto en el mismo `model_validator` que `asignado_a_nombre`, con `username`). `estado_toma` suma `"asignada"` = `ASIGNADO` + `asignado_a_id` NULL + `asignado_directo_a_id` no NULL, evaluado antes de `liberada`/`disponible`. `EN_PROCESO` sigue siendo `"tomada"` (no se multiplica el enum): la distinción en proceso la hace el front comparando ids.

9. **Front**:
   - `core/format.js`: `ESTADO_TOMA_PILL.asignada = 'av-pill--info'`; `estadoTomaLabel`: `asignada` → `Asignado a <asignado_directo_a_nombre>`; `tomada` con `asignado_directo_a_id === asignado_a_id` → `Asignado a <nombre> · en proceso`; `tomada` en otro caso → `Tomada por <asignado_a_nombre>` (cubre al admin que toma uno asignado a otro). `hoy.js` y `orden-abierta.js` lo heredan sin cambios propios de badge.
   - `orden-abierta.js`: en `pintarServicios`, si `getRole()` es `admin` o `veterinario`, las líneas `SOLICITADO` con `area_id` muestran en la última columna un `<select data-asignar-servicio>` con "Cualquier gestor del área" (valor vacío) + los gestores de `GET /areas/{area_id}/gestores-activos` (una request por área distinta, cacheada durante el pintado). `confirmarServicios` junta los selects con valor y envía `{asignaciones}`; sin ninguno, envía el `POST` como hoy. Texto con `escapeHtml`.
   - `bandeja-gestor.js`: en `pintarQueue`, si `s.asignado_directo_a_id` está seteado, debajo del nombre (junto a `bg-svc-area`) un pill `Asignado a <nombre>` (con "vos" si es `getUserId()`), escapado. No hay acción nueva: "Tomar" y "Liberar" ya existen.

10. **Migración**: nueva revisión Alembic con `down_revision = 'd3e4f5a6b7c8'`, `add_column` + FK + índice sobre `servicios_consulta.asignado_directo_a_id`; downgrade los quita. Columna también declarada en el modelo (convención del repo: `create_all` debe reproducirla).

## Risks / Trade-offs

- [Gestor asignado se desactiva o se quita del área antes de tomarlo] → el servicio queda solo visible para el admin (bandeja con filtro directo). Mitigación: el admin lo toma y lo libera, lo que borra la asignación directa y lo devuelve al área. Se documenta; reasignar queda fuera de alcance.
- [Carrera entre validar el gestor y el commit (lo desactivan en el medio)] → ventana de milisegundos, mismo caso que arriba; no se agrega lock.
- [Veterinario con `GestorArea` puede ejecutar un `EN_PROCESO` ajeno vía `PATCH` (gate de `_validar_permiso_ejecutar` preexistente)] → no lo introduce este change ni lo empeora: tomar sigue exclusivo. Se deja anotado, no se toca.
- [`estado_toma` gana un valor nuevo] → clientes que hagan `switch` exhaustivo caen al default; los únicos consumidores (`format.js`) se actualizan en el mismo change.
- [Una request extra por área al pintar la orden abierta] → solo para admin/veterinario y solo si hay `SOLICITADO` con área; áreas por orden son pocas.

## Migration Plan

1. `alembic upgrade head` (columna nullable, sin backfill: todo lo existente queda "al área", que es el comportamiento actual).
2. Deploy backend + front juntos (el front nuevo usa campos nuevos; el backend nuevo acepta el front viejo).
3. Rollback: `alembic downgrade d3e4f5a6b7c8` y revertir código; los servicios con asignación directa pendiente pasan a ser visibles para toda el área (degradación segura).
