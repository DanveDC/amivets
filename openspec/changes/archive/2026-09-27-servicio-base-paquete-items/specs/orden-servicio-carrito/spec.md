# orden-servicio-carrito Specification (Delta)

## ADDED Requirements

### Requirement: Paquete base e items adicionales

A service of an order SHALL be able to act as a package base (`es_base = true`, e.g. a surgery or a hospitalization) or as an additional item anchored to a base of the same order (`servicio_padre_id` = the base's id). The hierarchy has a single level. It SHALL be defined only when attaching the service through `POST /api/ordenes/{id}/servicios` (fields `es_base` and `servicio_padre_id`, both optional); editing a service (`PATCH /api/servicios/{id}`) SHALL NOT change it. When attaching, the system MUST reject with 422 a base that has a padre, a padre that is not a base, a padre from another order, and a padre that itself has a padre; and with 404 a padre that does not exist, is deleted, or is `CANCELADO`. The database SHALL enforce that a base has no padre (`ck_servicio_base_sin_padre`); the other rules are enforced when attaching. A service with neither flag remains a loose service, as before.

#### Scenario: Crear paquete e item
- **WHEN** se anexa una cirugía con `es_base=true` y después una anestesia con `servicio_padre_id` igual al id de la cirugía
- **THEN** ambos se crean, la anestesia queda como item adicional del paquete y el total de la orden suma los dos

#### Scenario: Base con padre
- **WHEN** se anexa un servicio con `es_base=true` y un `servicio_padre_id`
- **THEN** la respuesta es 422

#### Scenario: Padre que no es base
- **WHEN** se anexa un item cuyo `servicio_padre_id` apunta a un servicio que no es base
- **THEN** la respuesta es 422

#### Scenario: Padre de otra orden
- **WHEN** se anexa un item cuyo `servicio_padre_id` es un servicio base de otra orden
- **THEN** la respuesta es 422

#### Scenario: Padre borrado o cancelado
- **WHEN** se anexa un item cuyo `servicio_padre_id` apunta a un servicio base borrado o `CANCELADO`
- **THEN** la respuesta es 404

#### Scenario: La edición no cambia la jerarquía
- **WHEN** se hace `PATCH /api/servicios/{id}` enviando `es_base` o `servicio_padre_id`
- **THEN** esos campos se ignoran y el servicio conserva su jerarquía

### Requirement: Datos del paquete en la respuesta

Each service in the order responses SHALL carry `es_base`, `servicio_padre_id` and `es_item_adicional` (true when it has a padre; a loose service is not an additional item). A base SHALL also carry `items_adicionales_count`, `subtotal_items_adicionales` and `subtotal_paquete` (its own subtotal plus its items'), counting only items that are neither deleted nor `CANCELADO`, the same criterion as the order total. Where the children are not loaded (list endpoints), those three fields are 0. The pending items to invoice for an order and the lines of an invoice SHALL carry `es_base` and `servicio_padre_id`.

#### Scenario: Subtotales del paquete
- **WHEN** una orden tiene una base de 50000 con dos items de 8000 y 12000
- **THEN** en el detalle de la orden la base informa `items_adicionales_count` 2, `subtotal_items_adicionales` 20000 y `subtotal_paquete` 70000

#### Scenario: Servicio suelto
- **WHEN** un servicio no es base ni tiene padre
- **THEN** `es_item_adicional` es false

#### Scenario: Item cancelado
- **WHEN** uno de los items del paquete se cancela
- **THEN** deja de contar en `items_adicionales_count` y en los subtotales del paquete

### Requirement: Paquetes agrupados en pantalla y en la factura

The open order screen SHALL show each base with a "PAQUETE" badge, its items indented right below it and a "Subtotal paquete" row, and clicking a base SHALL collapse or expand its items. The attach panel SHALL offer an "es paquete base" checkbox and a "paquete padre" selector listing the order's live bases, mutually exclusive. The invoice-an-order modal, the invoice preview and the invoice PDF SHALL group lines the same way. An item whose base is not in the list shown (deleted, cancelled, or invoiced in another invoice) SHALL be shown as a loose service; no line is ever hidden. Totals SHALL not change: the order and invoice totals remain the sum of every line.

#### Scenario: Ver una orden con paquete
- **WHEN** una orden tiene una cirugía base con anestesia y materiales como items
- **THEN** la tabla muestra la cirugía con el badge "PAQUETE", los dos items indentados debajo y el subtotal del paquete

#### Scenario: Colapsar el paquete
- **WHEN** se hace click en la fila de la base
- **THEN** sus items y el subtotal se ocultan, y con otro click vuelven a verse

#### Scenario: Base que ya no está
- **WHEN** se borra una base que tiene un item vivo
- **THEN** el item se sigue mostrando, como servicio suelto

#### Scenario: Factura agrupada
- **WHEN** se factura una orden con un paquete
- **THEN** la vista previa y el PDF muestran las líneas agrupadas por paquete y el total es la suma de todas las líneas
