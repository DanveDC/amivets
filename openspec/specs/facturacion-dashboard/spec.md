# facturacion-dashboard Specification

## Purpose

El dashboard de facturación da a caja y administración una vista rápida de lo cobrado y lo pendiente: las facturas emitidas en el día, lo que corresponde pagarle a cada gestor o encargado según sus liquidaciones de comisión ya congeladas, el saldo pendiente de cada orden por cobrar, y la posibilidad de vincular un abono a la orden que cobra.

## Requirements

### Requirement: Facturas emitidas hoy

The system SHALL expose `GET /api/facturas/hoy` to the `admin`, `recepcionista` and `veterinario` roles, returning the invoices whose `fecha_emision` falls on the current day (server UTC), ordered by `fecha_emision` descending, with the same response schema as the invoice list. It SHALL accept pagination (`skip`, `limit`, defaults 0 and 100) and the optional filters `estado` and `propietario_id`. The facturación screen SHALL show them in a "Hoy" tab.

#### Scenario: Solo facturas de hoy
- **WHEN** existe una factura emitida hoy y otra emitida ayer
- **THEN** `GET /api/facturas/hoy` incluye la de hoy y no la de ayer, ordenadas por `fecha_emision` descendente

#### Scenario: Filtro por estado
- **WHEN** se pide `GET /api/facturas/hoy?estado=PAGADA`
- **THEN** solo se devuelven facturas de hoy en estado `PAGADA`

### Requirement: Pagos a gestores y encargados

The system SHALL expose `GET /api/facturas/gestores-pagos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`, restricted to `admin` (403 for any other role), returning one row per encargado with commission settlements (`LiquidacionComision`) whose `fecha_calculo` falls within the range (UTC, both ends inclusive). Each row SHALL carry `encargado_id`, `username`, `role`, `total_encargado` (sum of `monto_encargado`, negative adjustments included), `total_amivets` (sum of `monto_amivets`), `cantidad_lineas` (non-adjustment lines) and `total_ajustes` (sum of `monto_encargado` over adjustment lines). The amounts SHALL be the ones frozen in `LiquidacionComisionDetalle` at settlement time; they SHALL NOT be recalculated. An invalid date or `hasta` earlier than `desde` MUST be rejected with 422. The facturación screen SHALL show this as an admin-only "Pagos a gestores" tab.

#### Scenario: Totales por encargado
- **WHEN** hay liquidaciones de 3 encargados dentro del rango
- **THEN** la respuesta tiene 3 filas con los totales de cada encargado, ordenadas por `username`

#### Scenario: Ajustes negativos
- **WHEN** un encargado tiene en el rango una línea de ajuste con `monto_encargado` -50
- **THEN** `total_ajustes` es -50 y `total_encargado` ya lo descuenta, y la línea de ajuste no cuenta en `cantidad_lineas`

#### Scenario: Rango sin liquidaciones
- **WHEN** no hay liquidaciones en el rango
- **THEN** la respuesta es una lista vacía

#### Scenario: Solo admin
- **WHEN** un `recepcionista` o `veterinario` pide `GET /api/facturas/gestores-pagos`
- **THEN** la respuesta es 403

#### Scenario: Rango inválido
- **WHEN** `hasta` es anterior a `desde` o una fecha no tiene formato `YYYY-MM-DD`
- **THEN** la respuesta es 422

### Requirement: Saldo pendiente por orden

The system SHALL expose `GET /api/facturas/orden/{orden_id}/saldo-pendiente` to the `admin`, `recepcionista` and `veterinario` roles. It SHALL resolve the order's current invoice as the most recent invoice linked through `FacturaOrden` whose estado is not `ANULADA`. When there is one, `saldo_pendiente` SHALL be 0 if it is `PAGADA` and its `saldo_pendiente` otherwise, and the response SHALL carry that invoice's id, number, estado, total and `total_pagado`. When there is none and the order is `CERRADA`, `saldo_pendiente` and `total_factura` SHALL be the total of its unbilled items, with `factura_id`, `factura_numero` and `factura_estado` null and `total_pagado` 0. A missing order MUST return 404; an order with no current invoice that is not `CERRADA` MUST return 409. The "Órdenes por cobrar" list SHALL show each order's saldo as a badge: green when 0, orange when partially paid, red when nothing has been paid.

#### Scenario: Factura parcial
- **WHEN** la orden está `FACTURADA` con una factura `PARCIAL` de total 5000 y 3500 pagados
- **THEN** la respuesta tiene `factura_estado` `PARCIAL`, `saldo_pendiente` 1500, `total_factura` 5000 y `total_pagado` 3500

#### Scenario: Factura pagada
- **WHEN** la factura vigente de la orden está `PAGADA`
- **THEN** `saldo_pendiente` es 0

#### Scenario: Orden cerrada sin factura
- **WHEN** la orden está `CERRADA` y nunca se facturó
- **THEN** `saldo_pendiente` es el total de sus ítems sin facturar y `factura_id` es null

#### Scenario: Factura anulada
- **WHEN** se anula la única factura de una orden y la orden vuelve a `CERRADA`
- **THEN** el saldo se calcula por los ítems pendientes, con `factura_id` null, y no refleja el saldo de la factura anulada

#### Scenario: Orden refacturada
- **WHEN** una orden tiene una factura anulada y otra posterior vigente
- **THEN** la respuesta refleja la factura vigente

#### Scenario: Orden no cobrable
- **WHEN** la orden está `ABIERTA` y no tiene factura vigente
- **THEN** la respuesta es 409

### Requirement: Abono vinculado a una orden

An `Abono` SHALL keep a mandatory `factura_id` and MAY additionally carry an `orden_id` (nullable FK to `ordenes_servicio`). `POST /api/facturas/{factura_id}/abonar` SHALL accept an optional `orden_id`; when present, the order MUST exist (404), MUST be `CERRADA` or `FACTURADA` (409), and, if it is linked to an invoice through `FacturaOrden`, that invoice MUST be the one in the path (409). The abono SHALL be recorded against the invoice as before, updating its `total_pagado`, `saldo_pendiente` and estado, and SHALL store the `orden_id`. The response SHALL include `orden_id` and `orden_numero`. The abono modal SHALL offer an optional order selector with the owner's `CERRADA`/`FACTURADA` orders.

#### Scenario: Abono con orden
- **WHEN** se registra un abono a una factura indicando la orden que esa factura cobra
- **THEN** el abono queda con `orden_id` y la respuesta incluye `orden_id` y `orden_numero`

#### Scenario: Abono sin orden
- **WHEN** se registra un abono sin `orden_id`
- **THEN** se registra como antes, con `orden_id` y `orden_numero` null

#### Scenario: Orden de otra factura
- **WHEN** se indica una orden vinculada a una factura distinta de la del path
- **THEN** la respuesta es 409 y no se registra el abono

#### Scenario: Orden en estado inválido
- **WHEN** se indica una orden `ABIERTA`
- **THEN** la respuesta es 409
