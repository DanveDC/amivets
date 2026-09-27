# Spec Delta

## MODIFIED Requirements

### Requirement: Confirmar la orden

The system SHALL, on `POST /api/ordenes/{id}/confirmar`, move every `SOLICITADO` service with an area to `ASIGNADO`, move every `SOLICITADO` service without an area to `EJECUTADO` (consuming its inventory), and move an `ABIERTA` order to `EN_ATENCION`. Confirming an order with no `SOLICITADO` services MUST succeed without changes.

The request body SHALL be optional and MAY carry, for each `SOLICITADO` service with an area, the id of a specific manager (`asignaciones: [{servicio_id, gestor_id}]`). A service without an entry SHALL be dispatched to its area for any manager, and the system SHALL notify every active manager of that area (or the admins when the area has no active managers). A service with an entry SHALL be dispatched directly to that manager, and the system SHALL notify only that manager.

The chosen manager MUST be an active user who manages the service's area; an entry whose manager is not, or whose `servicio_id` is not a `SOLICITADO` service with an area of that order, MUST be rejected with 422 and the order and all its services MUST stay unchanged. Only `admin` and `veterinario` SHALL be able to confirm.

#### Scenario: Confirmar despacha y pasa a atención
- **WHEN** se confirma una orden `ABIERTA` que tiene un servicio `SOLICITADO` con área y otro sin área, sin cuerpo
- **THEN** el servicio con área queda `ASIGNADO` y cada gestor activo del área recibe una notificación
- **AND** el servicio sin área queda `EJECUTADO`
- **AND** la orden queda en estado `EN_ATENCION`

#### Scenario: Servicio asignado visible en la bandeja
- **WHEN** se confirma una orden con un servicio de un área, sin elegir gestor
- **THEN** el servicio aparece en la bandeja de los gestores de esa área y un gestor puede tomarlo

#### Scenario: Confirmar eligiendo un gestor
- **WHEN** un veterinario confirma una orden indicando que el servicio "Ecografía" del área "Imagen" va al gestor A, gestor activo de "Imagen"
- **THEN** el servicio queda `ASIGNADO` y asignado directamente a A
- **AND** solo A recibe la notificación `SERVICIO_ASIGNADO`; los demás gestores de "Imagen" no reciben ninguna

#### Scenario: Mezcla de despachos en la misma orden
- **WHEN** se confirma una orden con dos servicios del mismo área, eligiendo gestor solo para el primero
- **THEN** el primero queda asignado directamente a ese gestor y el segundo queda disponible para cualquier gestor del área

#### Scenario: Gestor que no es del área
- **WHEN** se confirma indicando como gestor a un usuario que no gestiona el área del servicio
- **THEN** la respuesta es 422
- **AND** ningún servicio de la orden cambia de estado y la orden no cambia

#### Scenario: Gestor inactivo
- **WHEN** se confirma indicando como gestor a un miembro del área cuya cuenta está inactiva
- **THEN** la respuesta es 422 y la orden no cambia

#### Scenario: Servicio que no se puede asignar
- **WHEN** el cuerpo trae un `servicio_id` que no es un servicio `SOLICITADO` con área de esa orden
- **THEN** la respuesta es 422 y la orden no cambia

#### Scenario: Recepción no confirma
- **WHEN** un usuario con rol `recepcionista` o `gestor` envía `POST /api/ordenes/{id}/confirmar`
- **THEN** la respuesta es 403

#### Scenario: Confirmar sin pendientes
- **WHEN** se confirma una orden sin servicios `SOLICITADO`
- **THEN** la respuesta es 200 y ni la orden ni sus servicios cambian
