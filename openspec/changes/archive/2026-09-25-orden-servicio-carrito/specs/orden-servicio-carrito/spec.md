# Spec Delta

## Purpose

La orden de servicio es el eje de la app: se abre con el propietario, acumula servicios como un carrito cuyo total es el presupuesto, se confirma para despachar el trabajo a las áreas, se cierra y se factura como una unidad. El front presenta ese flujo como el camino principal, no la consulta.

## Estados

- Estados de la **orden**: `ABIERTA`, `EN_ATENCION`, `CERRADA`, `FACTURADA`, `ANULADA`.
- Estados de cada **servicio de la orden**: `SOLICITADO`, `ASIGNADO`, `EN_PROCESO`, `EJECUTADO`, `FACTURADO`, `CANCELADO`.

## ADDED Requirements

### Requirement: Abrir orden con solo el propietario

The system SHALL create a service order from only a `propietario_id`, in state `ABIERTA`, with `total` equal to 0.

#### Scenario: Alta mínima
- **WHEN** se envía `POST /api/ordenes/` con un `propietario_id` válido y nada más
- **THEN** la respuesta es 201 con una orden en estado `ABIERTA` y `total` igual a 0

#### Scenario: Propietario inexistente
- **WHEN** se envía `POST /api/ordenes/` con un `propietario_id` que no existe
- **THEN** la respuesta es un error 4xx y no se crea ninguna orden

### Requirement: Agregar servicios al carrito

The system SHALL add every service posted to `POST /api/ordenes/{id}/servicios` in state `SOLICITADO`, with or without an area, and MUST NOT change the order state, execute the service, or consume inventory at that moment. Adding services MUST be rejected on orders in `CERRADA`, `FACTURADA` or `ANULADA`.

#### Scenario: Servicio sin área queda solicitado
- **WHEN** se agrega a una orden `ABIERTA` un servicio cuyo catálogo no tiene área
- **THEN** el servicio queda en estado `SOLICITADO`
- **AND** la orden sigue en estado `ABIERTA`

#### Scenario: Servicio con área queda solicitado sin despacho
- **WHEN** se agrega a una orden `ABIERTA` un servicio cuyo catálogo tiene área
- **THEN** el servicio queda en estado `SOLICITADO`
- **AND** no se crea ninguna notificación a los gestores de esa área
- **AND** el servicio no aparece en la bandeja de los gestores

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

The system SHALL, on `POST /api/ordenes/{id}/confirmar`, move every `SOLICITADO` service with an area to `ASIGNADO` and notify every active manager of that area (or the admins when the area has no managers), move every `SOLICITADO` service without an area to `EJECUTADO` (consuming its inventory), and move an `ABIERTA` order to `EN_ATENCION`. Confirming an order with no `SOLICITADO` services MUST succeed without changes.

#### Scenario: Confirmar despacha y pasa a atención
- **WHEN** se confirma una orden `ABIERTA` que tiene un servicio `SOLICITADO` con área y otro sin área
- **THEN** el servicio con área queda `ASIGNADO` y cada gestor activo del área recibe una notificación
- **AND** el servicio sin área queda `EJECUTADO`
- **AND** la orden queda en estado `EN_ATENCION`

#### Scenario: Servicio asignado visible en la bandeja
- **WHEN** se confirma una orden con un servicio de un área
- **THEN** el servicio aparece en la bandeja de los gestores de esa área y un gestor puede tomarlo

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

The Historia clínica screen MUST NOT offer billing a consultation directly ("Facturar" or "Cerrar y facturar"). Every consultation linked to an order SHALL offer "Ir a la orden", which opens the order screen.

#### Scenario: Sin atajo de facturación en la consulta
- **WHEN** un usuario ve una consulta sin facturar en Historia clínica
- **THEN** no hay botón para facturar la consulta, y sí hay uno "Ir a la orden"

#### Scenario: Navegar a la orden
- **WHEN** el usuario pulsa "Ir a la orden" en una consulta
- **THEN** se abre la pantalla de la orden a la que pertenece esa consulta
