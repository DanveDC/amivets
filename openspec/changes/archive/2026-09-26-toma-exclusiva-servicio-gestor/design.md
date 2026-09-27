# Design

## Context

- `servicios.py::tomar_servicio` (lines 475-531) ya implementa la toma exclusiva mediante `UPDATE` condicional: `WHERE estado='ASIGNADO' AND asignado_a_id IS NULL`. Si `filas == 0` devuelve 409 "ya fue tomado por otro gestor".
- `servicios.py::listar_bandeja` (lines 606-660) filtra servicios `ASIGNADO` y `EN_PROCESO` por áreas del gestor logueado; admin puede filtrar por `area_id` y `usuario_id`.
- `ordenes.py::obtener_orden` (line 215) devuelve `OrdenServicioDetalleResponse` con `servicios[]` que incluyen `ServicioConsultaResponse` (schema en `schemas.py`).
- `orden_service.py` contiene `confirmar_servicios` que crea notificaciones `SERVICIO_ASIGNADO` a gestores del área (fan-out en escritura).
- `notificacion_service.py` tiene `notificar_ejecucion` y `crear_notificacion`; canal por defecto `APP`.
- `ServicioConsulta` model (lines 343-451) tiene: `estado` (SOLICITADO, ASIGNADO, EN_PROCESO, EJECUTADO, FACTURADO, CANCELADO), `asignado_a_id`, `asignado_at`, `ejecutado_at`, `area_id`, `orden_id`, `veterinario_id` (vía `orden.veterinario_id`).
- No existe campo `liberado` ni transición `CANCELADA` específica para liberación; `CANCELADO` se usa en soft-delete (`eliminar_servicio_impl` línea 295).

## Goals / Non-Goals

**Goals:**
1. Endpoint `POST /api/servicios/{id}/liberar` que resetea a `ASIGNADO` + `asignado_a_id=NULL`.
2. Campo `estado_toma` calculado en respuesta de órdenes (`disponible` | `tomada` | `completada` | `liberada`).
3. Notificación al veterinario asignado cuando un gestor toma un servicio de su orden.
4. Auditoría de liberación: timestamp + usuario (nuevo campo `liberado_at` + `liberado_por_id` o reutilizar `CANCELADA` con metadata).

**Non-Goals:**
- Cambiar la lógica de toma exclusiva (ya funciona con UPDATE condicional).
- Notificaciones push/email/WS (solo canal `APP` en tabla `notificaciones`).
- Cambiar permisos de roles.

## Decisions

1. **Endpoint de liberación**: `POST /api/servicios/{id}/liberar` en `servicios.py`. Permisos: gestor que tomó (verifica `asignado_a_id == current_user.id`) O admin. Valida que `estado == 'EN_PROCESO'`. Hace `UPDATE` a `estado='ASIGNADO', asignado_a_id=NULL, liberado_at=now(), liberado_por_id=current_user.id`. Devuelve `ServicioConsultaResponse`.

2. **Campo `estado_toma` en esquemas**: Agregar property computada en `ServicioConsultaResponse` (schema) que mapea:
   - `ASIGNADO` + `asignado_a_id IS NULL` → `"disponible"`
   - `EN_PROCESO` + `asignado_a_id NOT NULL` → `"tomada"`
   - `EJECUTADO` / `FACTURADO` → `"completada"`
   - `ASIGNADO` + `asignado_a_id IS NULL` + `liberado_at IS NOT NULL` → `"liberada"`
   Se incluye en `OrdenServicioDetalleResponse.servicios[]` automáticamente (usada por `GET /api/ordenes/{id}`). El listado `GET /api/ordenes/` usa `OrdenServicioResponse`, que no tiene `servicios[]` -- decisión explícita: el listado se mantiene liviano (solo cabeceras) y no expone `estado_toma`; el Panel del día pide el detalle por orden cuando necesita mostrarlo.

3. **Notificación al veterinario**: En `tomar_servicio` (tras commit exitoso), si `servicio.orden.veterinario_id` existe y es distinto del `current_user.id`, crear notificación `SERVICIO_TOMADO` con `orden_id`, `servicio_id`, título "Servicio tomado", cuerpo con paciente/tutor/motivo/servicios. Canal `APP`.

4. **Auditoría de liberación**: Agregar columnas a `ServicioConsulta`:
   - `liberado_at` (DateTime, nullable)
   - `liberado_por_id` (FK a usuarios, nullable)
   No se usa estado `CANCELADA` porque ese estado ya significa "cancelado/borrado lógico" (línea 295). La liberación es volver a disponible, no cancelar.

5. **Migración BD**: Alembic para agregar `liberado_at`, `liberado_por_id` a `servicios_consulta`. Índice en `liberado_at` si se necesitan reportes.

6. **Panel del día con detalle expandible (tarea 6.1, corrección post-apply)**: `hoy.js` solo listaba cabeceras de orden (no líneas de servicio), así que la tarea original ("badge por servicio en hoy.js") no tenía dónde pintarse. Se resolvió agregando una fila expandible por orden (toggle con `aria-expanded`/`aria-controls`) que reusa el detalle de orden que `hoy.js` ya pedía por N+1 para calcular el total -- sin request nuevo. Cada línea muestra el nombre del servicio y su `estado_toma` (`"Tomada por <asignado_a_nombre>"` cuando corresponde). `asignado_a_nombre` se agregó a `ServicioConsultaResponse` (mismo criterio que `veterinario_nombre` en `OrdenServicioResponse`: `Usuario` no tiene nombre/apellido, se usa `username`).

   **Fuera de alcance, explícito**: asignar un servicio a un gestor específico (en vez de que "el primero que lo toma se lo apropia", decisión de diseño ya vigente desde la etapa 5 de despacho) es una funcionalidad distinta -- cambiaría quién puede tomar qué, no solo cómo se muestra. Si se necesita, es un change de OpenSpec separado.

## Risks / Trade-offs

- **Race condition en liberación**: Mismo patrón que toma — `UPDATE WHERE id=? AND estado='EN_PROCESO' AND asignado_a_id=current_user.id` para evitar que liberen entre SELECT y UPDATE.
- **Notificación duplicada**: Si el gestor toma y libera rápido, el veterinario recibe dos notificaciones (tomado + liberado). Aceptable: la liberación genera notificación `SERVICIO_LIBERADO` solo si hay veterinario asignado.
- **Frontend**: `hoy.js` y `orden-abierta.js` deben leer `estado_toma` para mostrar badges. `consultorio.js` (panel veterinario) debe reaccionar a notificación `SERVICIO_TOMADO`.