# Proposal

## Why

- Actualmente, al anexar un servicio con `tipo_servicio='CONSULTA'` vía `POST /api/ordenes/{id}/servicios`, el endpoint lo rechaza con 400 (línea 289-296 de `routers/ordenes.py`), obligando a usar `POST /api/consultas/` que crea la consulta y su línea honorario en una transacción atómica.
- Sin embargo, hay casos de uso donde el veterinario ya tiene la consulta creada (o la crea por fuera) y solo quiere anexar el honorario a la orden existente sin pasar por el flujo completo de `POST /api/consultas/`.
- La lógica de "atajo sin despacho" (decision 4) ya existe en `crear_linea_consulta` (línea 474-508 de `orden_service.py`): la línea CONSULTA entra directo en `EJECUTADO` con `area_id=NULL`. Pero `crear_servicio_en_orden` (línea 306-371) siempre pone `estado="SOLICITADO"` y deja que `confirmar_servicios` decida el atajo.
- No hay forma de especificar un `veterinario_id` distinto al de la orden al anexar un servicio directo, y el response no expone `veterinario_nombre` ni `area_nombre` para consultas directas.

## What Changes

- **`crear_servicio_en_orden`**: detectar `tipo_servicio == 'CONSULTA'` y aplicar atajo sin despacho inmediato:
  - `asignado_a_id = orden.veterinario_id` (el veterinario de la orden)
  - `area_id = NULL` (sin despacho a área)
  - `estado = "EJECUTADO"` directo (sin pasar por SOLICITADO/ASIGNADO/EN_PROCESO)
  - `ejecutado_at = now()`
  - Disparar `consumo_service.consumir_para_servicio` si corresponde (aunque CONSULTA no tiene receta)
- **Schema `OrdenServicioAnexarServicio`**: agregar campo opcional `veterinario_id: Optional[int]`. Si no se provee, hereda de `orden.veterinario_id`. Validar que el veterinario exista y tenga rol veterinario.
- **Response `ServicioConsultaResponse`**: agregar campos computados:
  - `veterinario_nombre: Optional[str]` — username del `asignado_a` (para CONSULTA, el vet que la ejecutó)
  - `area_nombre: Optional[str]` — nombre del área o `"NINGUNO"` cuando `area_id IS NULL` (atajo sin despacho)
- Mantener la restricción: `tipo_servicio='CONSULTA'` sigue reservado a una sola línea viva por orden (índice `uq_orden_una_consulta`).

## Capabilities

### Modified Capabilities
- `orden-servicio-carrito`: anexar servicio CONSULTA directo con atajo sin despacho, herencia de veterinario, y response enriquecido.
- `comisiones-servicio`: la CONSULTA anexada directo (sin consulta clínica) se atribuye al veterinario que la ejecutó (`asignado_a_id`).

## Impact

- Backend: `orden_service.py` (`crear_servicio_en_orden`), `schemas.py` (`OrdenServicioAnexarServicio`, `ServicioConsultaResponse`), `routers/ordenes.py` (validación de veterinario_id en anexar)
- Frontend: `orden-abierta.js` (mostrar `veterinario_nombre` y `area_nombre` en líneas de servicio)
- Tests: `e2e/orden-servicio-carrito.spec.js` (nuevos escenarios de anexar CONSULTA directa)