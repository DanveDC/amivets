# comisiones-servicio Specification (Delta)

## MODIFIED Requirements

### Requirement: Porcentaje propio por encargado

The system SHALL let an `admin` set, through `PUT /api/comisiones/encargados/{usuario_id}`, a commission of their own for an encargado, overriding the default, with a `tipo_comision`: `FIJO` (a fixed amount per line, `monto_fijo` ≥ 0), `PORCENTAJE` (`porcentaje` 0–100) or `MIXTO` (both). The fields a type requires MUST be present, otherwise the request is rejected with 422; a field the type does not use SHALL be discarded. Sending no type and no values SHALL remove the own commission so the encargado falls back to the default; sending only `porcentaje` (no type) SHALL be treated as `PORCENTAJE`. `GET /api/comisiones/encargados` SHALL list the active `veterinario` and `gestor` users with their `tipo_comision`, `monto_fijo` and own percentage (if any) and the effective percentage that applies to them (0 for `FIJO`).

#### Scenario: Porcentaje propio
- **WHEN** el porcentaje por defecto es 40 y un admin le asigna `PORCENTAJE` 55 a un gestor
- **THEN** el listado muestra a ese gestor con tipo `PORCENTAJE`, porcentaje propio 55 y efectivo 55, y al resto con efectivo 40

#### Scenario: Monto fijo
- **WHEN** un admin configura a un encargado con `tipo_comision` `FIJO` y `monto_fijo` 50
- **THEN** el listado lo muestra con tipo `FIJO`, monto fijo 50 y sin porcentaje propio

#### Scenario: Mixto
- **WHEN** un admin configura a un encargado con `tipo_comision` `MIXTO`, `monto_fijo` 30 y `porcentaje` 10
- **THEN** el listado lo muestra con tipo `MIXTO`, monto fijo 30 y porcentaje propio 10

#### Scenario: Campos obligatorios según el tipo
- **WHEN** un admin envía `FIJO` sin `monto_fijo`, `PORCENTAJE` sin `porcentaje` o `MIXTO` sin alguno de los dos
- **THEN** la respuesta es 422 y la comisión del encargado no cambia

#### Scenario: Volver al porcentaje por defecto
- **WHEN** un admin envía la comisión sin tipo ni valores para un encargado que tenía una propia
- **THEN** ese encargado queda sin comisión propia y su porcentaje efectivo es el de defecto

### Requirement: Reparto de lo cobrado

The system SHALL consider a service line eligible for commission once the invoice that billed it is `PAGADA`, and SHALL split its subtotal (`cantidad × precio_unitario`) according to the effective commission type of the line: `FIJO` gives `monto_encargado = monto_fijo`; `PORCENTAJE` gives `monto_encargado = subtotal × porcentaje / 100`; `MIXTO` gives `monto_encargado = monto_fijo + subtotal × porcentaje / 100`; rounded to 2 decimals and never greater than the subtotal. `monto_amivets = subtotal − monto_encargado`. Lines on invoices that are `PENDIENTE`, `PARCIAL` or `ANULADA` SHALL NOT be eligible.

#### Scenario: Reparto al 40%
- **WHEN** un servicio de subtotal 1000 de un gestor con `PORCENTAJE` 40 se cobra en una factura `PAGADA`
- **THEN** la línea muestra 400 para el gestor y 600 para AmiVets

#### Scenario: Reparto con monto fijo
- **WHEN** un servicio de subtotal 1000 de un encargado `FIJO` 150 se cobra
- **THEN** la línea muestra 150 para el encargado y 850 para AmiVets

#### Scenario: Reparto mixto
- **WHEN** un servicio de subtotal 1000 de un encargado `MIXTO` 50 + 10% se cobra
- **THEN** la línea muestra 150 para el encargado y 850 para AmiVets

#### Scenario: Monto fijo mayor que lo cobrado
- **WHEN** un servicio de subtotal 80 de un encargado `FIJO` 100 se cobra
- **THEN** la línea muestra 80 para el encargado y 0 para AmiVets

#### Scenario: Factura no pagada
- **WHEN** el servicio está en una factura `PENDIENTE` o `PARCIAL`
- **THEN** la línea no aparece como pendiente de liquidar

## ADDED Requirements

### Requirement: Comisión por servicio del catálogo

Each catalog item SHALL have a `tipo_comision_servicio`: `HEREDA` (default), `FIJO` (with `monto_fijo_servicio` ≥ 0) or `PORCENTAJE` (with `porcentaje_servicio` 0–100). When it is not `HEREDA`, it SHALL override the encargado's commission for lines of that item. Only an `admin` SHALL set it (403 otherwise); a type without its required value MUST be rejected with 422, and a partial update SHALL be validated against the values the item already has.

#### Scenario: El catálogo manda sobre el encargado
- **WHEN** el ítem "Rayos X" tiene `FIJO` 200 y su encargado tiene `PORCENTAJE` 20, y se cobra una línea de subtotal 1000
- **THEN** la línea usa `FIJO` y muestra 200 para el encargado

#### Scenario: Hereda del encargado
- **WHEN** el ítem tiene `HEREDA`
- **THEN** la línea usa el tipo, el monto fijo y el porcentaje del encargado

#### Scenario: Override sin valor
- **WHEN** un admin pone `FIJO` a un ítem sin `monto_fijo_servicio`
- **THEN** la respuesta es 422

#### Scenario: Sin permiso
- **WHEN** un usuario que no es admin intenta cambiar la comisión de un ítem
- **THEN** la respuesta es 403

### Requirement: Prioridad del tipo de comisión

The system SHALL resolve the commission of each line in this order: the catalog item's override (if not `HEREDA`), then the encargado's own commission, then the default percentage as `PORCENTAJE`. The type and its parameters SHALL always come from the same source.

#### Scenario: Sin comisión propia ni override
- **WHEN** el encargado no tiene comisión propia, el ítem hereda y el porcentaje por defecto es 12,5
- **THEN** una línea de subtotal 1000 usa `PORCENTAJE` 12,5 y muestra 125 para el encargado

### Requirement: Liquidación congela el tipo de comisión

Each liquidated line SHALL store, besides the percentage and amounts, the `tipo_comision` and `monto_fijo` used (percentage 0 when the type is `FIJO`). Later changes to the encargado's or the catalog item's commission SHALL NOT change liquidated lines. An adjustment for a cancelled invoice SHALL revert exactly the frozen amounts and carry the frozen type and fixed amount.

#### Scenario: La liquidación no cambia
- **WHEN** se liquida una línea de un encargado `MIXTO` 50 + 10% y después el admin lo cambia a `PORCENTAJE` 15
- **THEN** la línea liquidada sigue mostrando `MIXTO`, monto fijo 50, porcentaje 10 y sus montos originales

#### Scenario: Ajuste con tipo congelado
- **WHEN** se anula la factura de una línea liquidada con `FIJO` 100, después de cambiar la comisión del encargado
- **THEN** el ajuste pendiente es de -100 para el encargado, con tipo `FIJO` y monto fijo 100

### Requirement: Control muestra el tipo de comisión

Every line returned by the commission control (`GET /api/comisiones/`, `/mias`) and by liquidations SHALL include `tipo_comision_usado`, `monto_fijo_usado` and `porcentaje_usado` (null when the type does not use it): current values for pending lines, frozen values for liquidated ones. The control screen SHALL show them as Tipo, Monto fijo and % columns, and the liquidation PDF SHALL show the commission applied to each line.

#### Scenario: Ver control con tipos distintos
- **WHEN** un admin ve el control de un encargado con líneas de distintos tipos
- **THEN** cada línea muestra su tipo, monto fijo y porcentaje efectivos
