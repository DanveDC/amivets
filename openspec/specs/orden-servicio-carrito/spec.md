# orden-servicio-carrito Specification

## Purpose

La orden de servicio es el eje de la app: se abre con el propietario, acumula servicios como un carrito cuyo total es el presupuesto, se confirma para despachar el trabajo a las áreas, se cierra y se factura como una unidad. El front presenta ese flujo como el camino principal, no la consulta.

## Requirements

### Requirement: Abrir orden con solo el propietario

The system SHALL create a service order from only a `propietario_id`, in state `ABIERTA`, with `total` equal to 0.

#### Scenario: Alta mínima
- **WHEN** se envía `POST /api/ordenes/` con un `propietario_id` válido y nada más
- **THEN** la respuesta es 201 con una orden en estado `ABIERTA` y `total` igual a 0

#### Scenario: Propietario inexistente
- **WHEN** se envía `POST /api/ordenes/` con un `propietario_id` que no existe
- **THEN** la respuesta es un error 4xx y no se crea ninguna orden

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

### Requirement: Total de la orden en tiempo real

The system SHALL return, in `GET /api/ordenes/{id}` and in the order listing, a `total` field equal to the sum of `cantidad × precio_unitario` over the order's services that are not `CANCELADO` and not deleted. The total MUST reflect every add, edit or removal on the next read.

#### Scenario: El total acumula
- **WHEN** a una orden se le agregan un servicio de cantidad 2 y precio 100 y otro de cantidad 1 y precio 50
- **THEN** `GET /api/ordenes/{id}` devuelve `total` igual a 250

#### Scenario: Servicio cancelado no suma
- **WHEN** uno de los servicios de la orden pasa a `CANCELADO` o se elimina
- **THEN** `GET /api/ordenes/{id}` devuelve un `total` sin ese servicio

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

### Requirement: Cerrar la orden

The system SHALL move an order to `CERRADA` on `POST /api/ordenes/{id}/cerrar` only when none of its services is `SOLICITADO`, `ASIGNADO` or `EN_PROCESO`.

#### Scenario: Cierre con todo ejecutado
- **WHEN** se cierra una orden cuyos servicios están todos `EJECUTADO` o `CANCELADO`
- **THEN** la orden queda en estado `CERRADA`

#### Scenario: Cierre con pendientes
- **WHEN** se cierra una orden con al menos un servicio `SOLICITADO`, `ASIGNADO` o `EN_PROCESO`
- **THEN** la respuesta es 409 y la orden no cambia de estado

### Requirement: Facturar por orden

The system SHALL expose `GET /api/ordenes/{id}/pendientes-facturar`, which returns the order's unbilled items and their total, and `POST /api/ordenes/{id}/facturar`, which bills every unbilled, non-cancelled service of a `CERRADA` order in a single invoice built on the server, marks those services as billed, and moves the order to `FACTURADA`. Billing MUST be rejected when the order is not `CERRADA` or has nothing to bill, and MUST NOT bill the same service twice under concurrent requests. When the order has a consultation, the invoice MUST reference it.

#### Scenario: Vista previa de lo pendiente
- **WHEN** se consulta `GET /api/ordenes/{id}/pendientes-facturar` de una orden `CERRADA` con dos servicios ejecutados sin facturar
- **THEN** la respuesta lista esos dos ítems y un total igual a la suma de sus subtotales

#### Scenario: Facturar una orden cerrada
- **WHEN** se envía `POST /api/ordenes/{id}/facturar` sobre una orden `CERRADA` con servicios sin facturar
- **THEN** se crea una factura del propietario de la orden con un detalle por servicio y el total de la orden
- **AND** esos servicios quedan facturados
- **AND** la orden queda en estado `FACTURADA`

#### Scenario: Facturar una orden no cerrada
- **WHEN** se envía `POST /api/ordenes/{id}/facturar` sobre una orden `ABIERTA` o `EN_ATENCION`
- **THEN** la respuesta es 409 y no se crea ninguna factura

#### Scenario: Doble facturación
- **WHEN** llegan dos `POST /api/ordenes/{id}/facturar` seguidos sobre la misma orden
- **THEN** se crea una sola factura y la segunda solicitud recibe 409

#### Scenario: Anular la factura reabre la orden para cobro
- **WHEN** un admin anula la factura de una orden `FACTURADA`
- **THEN** la orden vuelve a estado `CERRADA` y sus servicios quedan de nuevo sin facturar

### Requirement: Facturación centrada en órdenes en el front

The Facturación screen SHALL open on an "Órdenes por cobrar" view listing the `CERRADA` orders (number, owner, pet, date and total). The invoice history MUST stay available as a secondary view. Billing an order from this screen MUST open the order and bill it with the order billing endpoint.

#### Scenario: Ver órdenes por cobrar
- **WHEN** una recepcionista abre Facturación
- **THEN** ve la lista de órdenes `CERRADA` con su total, y no una lista de consultas

#### Scenario: Cobrar desde la lista
- **WHEN** la recepcionista elige "Cobrar" en una orden de la lista y confirma
- **THEN** la orden queda `FACTURADA`, desaparece de la lista y la factura aparece en el historial

### Requirement: Presupuesto visible en la orden abierta

The open-order screen SHALL show every service with its state and subtotal (`cantidad × precio_unitario`) and the order `total` returned by the API, SHALL refresh the total after each add, confirm or removal, and SHALL offer "Facturar" only when the order is `CERRADA`, billing through the order billing endpoint.

#### Scenario: El total se actualiza al agregar
- **WHEN** el usuario agrega un servicio a la orden abierta
- **THEN** la línea aparece como `SOLICITADO` con su subtotal y el total de la orden se actualiza sin recargar la página

#### Scenario: Facturar solo cerrada
- **WHEN** la orden está `ABIERTA` o `EN_ATENCION`
- **THEN** la acción "Facturar" no está disponible

### Requirement: La consulta no factura por fuera de la orden

The Historia clínica screen MUST NOT offer billing a consultation linked to an order directly ("Facturar" or "Cerrar y facturar"). Every consultation linked to an order SHALL offer "Ir a la orden", which opens the order screen. A consultation with no order (created before orders existed, or whose consultation line was deleted) has no order to bill through, so it SHALL offer "Facturar", which issues its invoice through the consultation billing endpoint.

#### Scenario: Sin atajo de facturación en la consulta
- **WHEN** un usuario ve una consulta sin facturar, vinculada a una orden, en Historia clínica
- **THEN** no hay botón para facturar la consulta, y sí hay uno "Ir a la orden"

#### Scenario: Consulta sin orden
- **WHEN** un usuario ve una consulta sin facturar que no tiene orden
- **THEN** hay un botón "Facturar" que emite su factura

#### Scenario: Navegar a la orden
- **WHEN** el usuario pulsa "Ir a la orden" en una consulta
- **THEN** se abre la pantalla de la orden a la que pertenece esa consulta

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
