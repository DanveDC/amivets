# orden-servicio-carrito Specification (Delta)

## MODIFIED Requirements

### Requirement: Agregar servicios al carrito

The system SHALL add every service posted to `POST /api/ordenes/{id}/servicios` in state `SOLICITADO`, with or without an area, and MUST NOT change the order state, execute the service, or consume inventory at that moment. The only exception is the consultation-fee line (`tipo_servicio='CONSULTA'`), which follows the no-dispatch shortcut described in "Atajo sin despacho al anexar CONSULTA directa". Adding services MUST be rejected on orders in `CERRADA`, `FACTURADA` or `ANULADA`.

#### Scenario: Servicio sin área queda solicitado
- **WHEN** se agrega a una orden `ABIERTA` un servicio cuyo catálogo no tiene área
- **THEN** el servicio queda en estado `SOLICITADO`
- **AND** la orden sigue en estado `ABIERTA`

#### Scenario: Servicio con área queda solicitado sin despacho
- **WHEN** se agrega a una orden `ABIERTA` un servicio cuyo catálogo tiene área
- **THEN** el servicio queda en estado `SOLICITADO`
- **AND** no se crea ninguna notificación a los gestores de esa área
- **AND** el servicio no aparece en la bandeja de los gestores

#### Scenario: La CONSULTA no pasa por el carrito
- **WHEN** se agrega a una orden `ABIERTA` una línea con `tipo_servicio='CONSULTA'`
- **THEN** la línea queda en estado `EJECUTADO`, no en `SOLICITADO`
- **AND** la orden pasa a `EN_ATENCION`

#### Scenario: Orden cerrada no acepta servicios
- **WHEN** se agrega un servicio a una orden en estado `CERRADA`
- **THEN** la respuesta es 409 y la orden no cambia

## ADDED Requirements

### Requirement: Atajo sin despacho al anexar CONSULTA directa

When a service with `tipo_servicio='CONSULTA'` is added through `POST /api/ordenes/{id}/servicios`, the system SHALL apply the no-dispatch shortcut immediately (no later confirmation needed), the same way the consultation line created by `POST /api/consultas/` does: state `EJECUTADO`, no area, assigned to the executing veterinarian, and the order moves from `ABIERTA` to `EN_ATENCION`. An order SHALL hold at most one live `CONSULTA` line.

#### Scenario: Anexar CONSULTA directa a orden con veterinario asignado
- **WHEN** se envía `POST /api/ordenes/{id}/servicios` con `tipo_servicio='CONSULTA'` y la orden tiene `veterinario_id` seteado
- **THEN** el servicio se crea con:
  - `estado = "EJECUTADO"`
  - `area_id = NULL`
  - `asignado_a_id = orden.veterinario_id`
  - `ejecutado_at = timestamp actual`
  - `consulta_id = NULL` (es honorario suelto, no vinculado a una consulta clínica)
- **AND** la orden pasa a `EN_ATENCION` si estaba `ABIERTA`

#### Scenario: Anexar CONSULTA directa a orden SIN veterinario asignado
- **WHEN** se envía `POST /api/ordenes/{id}/servicios` con `tipo_servicio='CONSULTA'`, sin `veterinario_id` en el body, y la orden tiene `veterinario_id = NULL`
- **THEN** la respuesta es 422 con error "La orden no tiene veterinario asignado; indique veterinario_id en el body o asigne uno a la orden"
- **AND** la orden no cambia

#### Scenario: Veterinario_id inválido en el body
- **WHEN** se envía un `veterinario_id` que no existe o no es veterinario
- **THEN** la respuesta es 400 con error "El veterinario_id indicado no corresponde a un usuario con rol veterinario"

#### Scenario: Segunda CONSULTA en la misma orden
- **WHEN** se intenta anexar otra línea `tipo_servicio='CONSULTA'` a una orden que ya tiene una viva
- **THEN** la respuesta es 409 con error "La orden ya tiene una consulta. Una orden admite como máximo una consulta" (índice `uq_orden_una_consulta`)

### Requirement: Campo veterinario_id opcional en OrdenServicioAnexarServicio

The request schema `OrdenServicioAnexarServicio` SHALL include an optional `veterinario_id` that overrides the order's veterinarian for a `CONSULTA` line only; when omitted, the order's `veterinario_id` is used. It is ignored for any other service type.

#### Scenario: Herencia implícita
- **WHEN** no se envía `veterinario_id` en el body
- **THEN** se usa `orden.veterinario_id`

#### Scenario: Sobrescritura explícita
- **WHEN** se envía `veterinario_id` en el body, distinto al de la orden
- **THEN** el servicio se crea con `asignado_a_id` igual al valor provisto (validando que sea un veterinario)

### Requirement: Response enriquecido con veterinario_nombre y area_nombre

The response schema `ServicioConsultaResponse` SHALL expose `veterinario_nombre` (the username of `asignado_a`) and `area_nombre` (the area's name, or `"NINGUNO"` when `area_id` is NULL). The consultation line created by `POST /api/consultas/` SHALL also record the consultation's veterinarian as `asignado_a_id`, so it exposes `veterinario_nombre` too.

#### Scenario: Ver línea CONSULTA anexada directo
- **WHEN** se consulta `GET /api/ordenes/{id}` que tiene una línea CONSULTA anexada directamente
- **THEN** la línea en `servicios[]` incluye:
  - `veterinario_nombre` = username del veterinario que la ejecutó
  - `area_nombre = "NINGUNO"`
  - `estado_toma = "completada"`

#### Scenario: Ver línea CONSULTA creada via POST /api/consultas/
- **WHEN** se consulta una orden con consulta clínica (creada via flujo normal)
- **THEN** la línea CONSULTA incluye `veterinario_nombre` del veterinario de la consulta y `area_nombre = "NINGUNO"`
