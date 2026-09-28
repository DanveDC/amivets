# Tasks

> Tests: no hay pytest en el repo. Toda la cobertura (API vía el fixture `request` + `e2e/helpers.js`, y UI) va en `e2e/asignacion-directa-servicio-gestor.spec.js`, mismo criterio que `e2e/toma-exclusiva-servicio-gestor.spec.js`. Cada grupo agrega sus casos a ese spec y los corre con `npx playwright test e2e/asignacion-directa-servicio-gestor.spec.js`.

## 1. Modelo y migración

- [x] 1.1 Agregar `asignado_directo_a_id` (Integer, FK `usuarios.id`, nullable, `index=True`) y la relación `asignado_directo_a` (`foreign_keys=[asignado_directo_a_id]`) a `ServicioConsulta` en `backend/app/models/models.py`, con comentario que explique "a quién se despachó" vs `asignado_a_id` "quién lo tomó" (design.md decisión 1). Verificar: `python -c "import app.models.models"` desde `backend/` sin errores de mapeo (tres FK a `usuarios` en la tabla)
- [x] 1.2 Crear migración Alembic en `backend/alembic/versions/` con `down_revision = 'd3e4f5a6b7c8'`: `add_column` + FK + índice; downgrade inverso. Verificar: `alembic upgrade head` contra la base local (docker `veterinaria_db`) y `\d servicios_consulta` muestra la columna, la FK y el índice; `alembic downgrade -1` y `upgrade head` otra vez sin error

## 2. Esquemas de respuesta y de confirmar

- [x] 2.1 En `ServicioConsultaResponse` (`backend/app/schemas/schemas.py`): sumar `asignado_directo_a_id` y `asignado_directo_a_nombre`, resolviendo el nombre (`username`) en el mismo `model_validator` que `asignado_a_nombre`; en `estado_toma` agregar `"asignada"` (`ASIGNADO` + `asignado_a_id` NULL + `asignado_directo_a_id` no NULL) evaluado antes de `liberada`/`disponible`. Verificar con el caso e2e 5.3 (`estado_toma == "asignada"` y nombre presente en `GET /api/ordenes/{id}`)
- [x] 2.2 Agregar `AsignacionServicioGestor { servicio_id: int (gt=0), gestor_id: int (gt=0) }` y `ConfirmarServiciosRequest { asignaciones: List[AsignacionServicioGestor] = [] }` en `schemas.py`. Verificar: un `servicio_id` 0 devuelve 422 de validación en el caso e2e 3.5

## 3. Confirmar con gestor elegido

- [x] 3.1 `routers/ordenes.py::confirmar_servicios`: aceptar `payload: Optional[ConfirmarServiciosRequest] = Body(None)` y pasar `asignaciones={a.servicio_id: a.gestor_id}` a `orden_service.confirmar_servicios`; sin cambios de roles (`admin`, `veterinario`). Verificar: `e2e/despacho.spec.js` y `e2e/ordenes.spec.js` siguen pasando (POST sin cuerpo)
- [x] 3.2 `orden_service.confirmar_servicios(db, orden, current_user, asignaciones=None)`: antes de mutar, validar (422) `servicio_id` repetido, `servicio_id` fuera de los `SOLICITADO` con `area_id` de la orden, y gestor sin `GestorArea` en el área del servicio o con `Usuario.is_active` falso (una query por lote); en el loop setear `servicio.asignado_directo_a_id`. Actualizar el docstring. Verificar con los casos e2e 3.5
- [x] 3.3 `notificacion_service.notificar_asignacion`: si `servicio.asignado_directo_a_id` está seteado, un solo `SERVICIO_ASIGNADO` a ese usuario (cuerpo "Se te asignó '<título>'.") y devolver `None`; si no, fan-out actual intacto. Actualizar docstring. Verificar con el caso e2e 3.5 (solo A recibe la notificación)
- [x] 3.4 Endpoint `GET /api/areas/{area_id}/gestores-activos` en `routers/areas.py` (roles `admin`, `veterinario`; solo activos; `[{usuario_id, username}]` por `username`; 404 si no existe el área). Verificar con el caso e2e 3.5
- [x] 3.5 Casos e2e (API) en el spec nuevo: confirmar sin cuerpo mantiene el fan-out a todo el área; confirmar con A → `asignado_directo_a_id == A`, `estado_toma == "asignada"`, solo A tiene `SERVICIO_ASIGNADO` (vía `listarNotificaciones`); mezcla directo + área en la misma orden; 422 por gestor de otra área, por gestor inactivo (`PUT /api/usuarios/{id}` con `is_active: false`), por `servicio_id` ajeno/no `SOLICITADO` y por repetido, y en todos la orden y los servicios quedan sin cambios; 403 al confirmar como recepcionista/gestor; `gestores-activos` excluye inactivos y da 403 a gestor/recepcionista

## 4. Bandeja, toma y liberación

- [x] 4.1 `routers/servicios.py::listar_bandeja`: con `gestor_objetivo`, filtro `(asignado_a_id IS NULL AND (asignado_directo_a_id IS NULL OR asignado_directo_a_id = g)) OR asignado_a_id = g`; admin sin `usuario_id` sin cambios. Verificar con el caso e2e 4.4
- [x] 4.2 `tomar_servicio`: para no-admin sumar al `UPDATE` condicional `(asignado_directo_a_id IS NULL OR asignado_directo_a_id = current_user.id)`; con 0 filas releer el servicio y responder 409 "Este servicio está asignado a otro gestor." o el 409 actual según corresponda. Actualizar docstring. Verificar con el caso e2e 4.4
- [x] 4.3 `liberar_servicio`: sumar `"asignado_directo_a_id": None` al `UPDATE`; resto intacto. Verificar con el caso e2e 4.4
- [x] 4.4 Casos e2e (API): servicio directo a A aparece en `listarBandeja` de A y no en la de B (mismo área); B `tomar` → 409 con el mensaje nuevo y el servicio sigue `ASIGNADO` sin tomar; dos `tomar` concurrentes de A y B (`Promise.all`) → solo A gana; A toma → `EN_PROCESO`, `asignado_a_id == A`, `asignado_directo_a_id == A` y puede ejecutar; admin ve el servicio en su bandeja y puede tomarlo; A libera → `asignado_directo_a_id` null, `estado_toma == "liberada"`, `liberado_por_id` == A, aparece en la bandeja de B y B lo toma; servicio despachado al área sin elegir sigue visible para A y B

## 5. Frontend

- [x] 5.1 `static/js/core/format.js`: `ESTADO_TOMA_PILL.asignada = 'av-pill--info'` y `estadoTomaLabel` con `asignada` → "Asignado a <asignado_directo_a_nombre>", `tomada` por el mismo asignado → "Asignado a <nombre> · en proceso", `tomada` en otro caso → "Tomada por <asignado_a_nombre>". Actualizar el comentario del bloque. Verificar con los casos UI de 5.4 (orden abierta y Panel del día heredan el helper)
- [x] 5.2 `static/js/sections/orden-abierta.js`: en `pintarServicios`, para `admin`/`veterinario` (`getRole()`), las líneas `SOLICITADO` con `area_id` muestran un `<select data-asignar-servicio="<id>">` con "Cualquier gestor del área" + los de `GET /areas/{area_id}/gestores-activos` (una request por área, cacheada en el pintado; nombres con `escapeHtml`); `confirmarServicios` envía `{asignaciones}` solo con los selects elegidos, y el POST sin cuerpo si no hay ninguno. Verificar con el caso UI de 5.4
- [x] 5.3 `static/js/sections/bandeja-gestor.js::pintarQueue`: si `s.asignado_directo_a_id`, pill "Asignado a vos" (o "Asignado a <nombre>" en la vista de admin) junto a `bg-svc-area`, escapado. Verificar con el caso UI de 5.4
- [x] 5.4 Casos e2e (UI) en el spec nuevo: como veterinario/admin, abrir la orden, elegir el gestor A en el selector de la línea, "Confirmar servicios" → la línea muestra "Asignado a A"; en el Panel del día, expandir la orden muestra "Asignado a A"; logueado como A, la bandeja muestra el servicio con "Asignado a vos"; logueado como B, no aparece; un servicio tomado libremente sigue mostrando "Tomada por <gestor>"

## 6. Integración

- [x] 6.1 Correr `npx playwright test e2e/asignacion-directa-servicio-gestor.spec.js e2e/toma-exclusiva-servicio-gestor.spec.js e2e/despacho.spec.js e2e/ordenes.spec.js e2e/areas-y-gestores.spec.js e2e/pantalla-encargado.spec.js e2e/comisiones.spec.js` y verificar que todo pasa sin regresiones
- [x] 6.2 `openspec validate asignacion-directa-servicio-gestor` sin errores (archivar antes `toma-exclusiva-servicio-gestor` si el archivo de este change lo requiere)
