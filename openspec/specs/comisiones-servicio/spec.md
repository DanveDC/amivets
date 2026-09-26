# comisiones-servicio Specification

## Purpose

Las comisiones por servicio reparten lo cobrado por cada servicio entre AmiVets y el encargado que lo realizó, según un porcentaje configurable, y permiten controlar, liquidar y documentar con un comprobante lo que se le paga a cada encargado.

## Requirements

### Requirement: Porcentaje de comisión por defecto

The system SHALL keep a single default commission percentage, between 0 and 100 inclusive, that applies to every encargado without a percentage of their own. Only an `admin` SHALL read or change it, through `GET` and `PUT /api/comisiones/configuracion`. Values outside 0–100 MUST be rejected with 422.

#### Scenario: Cambiar el porcentaje por defecto
- **WHEN** un admin envía `PUT /api/comisiones/configuracion` con `porcentaje_defecto` 40
- **THEN** la respuesta es 200 y `GET /api/comisiones/configuracion` devuelve 40

#### Scenario: Porcentaje fuera de rango
- **WHEN** un admin envía un `porcentaje_defecto` de 120 o de -5
- **THEN** la respuesta es 422 y el porcentaje no cambia

#### Scenario: Sin permiso
- **WHEN** un usuario con rol `recepcionista` o `veterinario` llama a cualquiera de los dos endpoints de configuración
- **THEN** la respuesta es 403

### Requirement: Porcentaje propio por encargado

The system SHALL let an `admin` set, through `PUT /api/comisiones/encargados/{usuario_id}`, a percentage of their own (0–100) for an encargado, overriding the default, and remove it (`porcentaje` null) so the encargado falls back to the default. `GET /api/comisiones/encargados` SHALL list the active `veterinario` and `gestor` users with their own percentage (if any) and the effective percentage that applies to them.

#### Scenario: Porcentaje propio
- **WHEN** el porcentaje por defecto es 40 y un admin le asigna 55 a un gestor
- **THEN** el listado muestra a ese gestor con porcentaje propio 55 y efectivo 55, y al resto con efectivo 40

#### Scenario: Volver al porcentaje por defecto
- **WHEN** un admin envía `porcentaje` null para un encargado que tenía 55
- **THEN** ese encargado queda sin porcentaje propio y su porcentaje efectivo es el de defecto

### Requirement: Encargado de cada servicio

The system SHALL determine the encargado of a billed service line as follows: for the consultation-fee line (`CONSULTA`), the consultation's veterinarian; for any other line, the user who took it (`asignado_a_id`). A line without an encargado (services without area, quick-sale services) and product lines SHALL generate no commission: 100% goes to AmiVets.

#### Scenario: Servicio de área
- **WHEN** un gestor toma, ejecuta y se cobra un servicio de su área
- **THEN** la comisión de esa línea es para ese gestor

#### Scenario: Honorario de la consulta
- **WHEN** se cobra una orden con la consulta de un veterinario
- **THEN** la comisión de la línea de la consulta es para ese veterinario

#### Scenario: Sin encargado
- **WHEN** se cobra un servicio sin área o un servicio vendido en caja rápida
- **THEN** esa línea no genera comisión y no aparece en el control de ningún encargado

### Requirement: Reparto de lo cobrado

The system SHALL consider a service line eligible for commission once the invoice that billed it is `PAGADA`, and SHALL split its subtotal (`cantidad × precio_unitario`) into `monto_encargado = subtotal × porcentaje / 100`, rounded to 2 decimals, and `monto_amivets = subtotal − monto_encargado`. Lines on invoices that are `PENDIENTE`, `PARCIAL` or `ANULADA` SHALL NOT be eligible.

#### Scenario: Reparto al 40%
- **WHEN** un servicio de subtotal 1000 de un gestor con 40% se cobra en una factura `PAGADA`
- **THEN** la línea muestra 400 para el gestor y 600 para AmiVets

#### Scenario: Factura no pagada
- **WHEN** el servicio está en una factura `PENDIENTE` o `PARCIAL`
- **THEN** la línea no aparece como pendiente de liquidar

### Requirement: Control de comisiones

The system SHALL expose `GET /api/comisiones/?encargado_id=&desde=&hasta=` (admin), returning for the encargado and date range: the pending lines (eligible and not yet liquidated) computed with the encargado's current effective percentage, the already-liquidated lines with the percentage and amounts frozen at liquidation, and totals for the encargado and for AmiVets. A `veterinario` or `gestor` SHALL be able to see only their own commissions through `GET /api/comisiones/mias`.

#### Scenario: Ver lo pendiente
- **WHEN** un admin consulta las comisiones de un gestor con dos servicios cobrados sin liquidar
- **THEN** la respuesta lista las dos líneas como pendientes, con fecha, orden, servicio, subtotal, porcentaje y montos, y los totales suman esas líneas

#### Scenario: El encargado ve solo lo suyo
- **WHEN** un gestor consulta `GET /api/comisiones/mias`
- **THEN** ve solo sus propias líneas pendientes y liquidadas

#### Scenario: Otro encargado sin acceso
- **WHEN** un gestor llama a `GET /api/comisiones/?encargado_id=` con el id de otra persona
- **THEN** la respuesta es 403

### Requirement: Liquidar comisiones

The system SHALL expose `POST /api/comisiones/liquidaciones` (admin) with `encargado_id`, `desde` and `hasta`, which creates a permanent liquidation containing every pending line of that encargado in the range, freezing the percentage and amounts applied, and returns it with its totals. A line SHALL never be included in two liquidations, including under concurrent requests. Liquidating with no pending lines MUST be rejected with 409.

#### Scenario: Liquidar
- **WHEN** un admin liquida a un gestor con dos líneas pendientes en el rango
- **THEN** se crea una liquidación con esas dos líneas y sus totales, y las líneas pasan a liquidadas

#### Scenario: El porcentaje queda congelado
- **WHEN** después de liquidar se cambia el porcentaje del gestor
- **THEN** las líneas de esa liquidación conservan el porcentaje y los montos originales

#### Scenario: Sin doble pago
- **WHEN** se vuelve a liquidar al mismo gestor sobre un rango que incluye líneas ya liquidadas
- **THEN** esas líneas no se incluyen, y si no queda ninguna pendiente la respuesta es 409

### Requirement: Ajuste por anulación

The system SHALL, when an invoice whose lines were already liquidated is later annulled, produce for each such line a pending negative adjustment for the same encargado (the negated amounts of the liquidated line), which SHALL be included and discounted in that encargado's next liquidation. An annulled invoice whose lines were not yet liquidated SHALL simply stop being eligible.

#### Scenario: Anular antes de liquidar
- **WHEN** se anula la factura de un servicio pendiente de liquidar
- **THEN** la línea deja de aparecer como pendiente

#### Scenario: Anular después de liquidar
- **WHEN** se anula la factura de un servicio ya liquidado con 400 para el gestor
- **THEN** en el control del gestor aparece un ajuste pendiente de -400
- **AND** la próxima liquidación del gestor lo incluye y descuenta 400 del total

### Requirement: Reemplazo de la tarifa fija por consulta

The system SHALL pay the consultation veterinarian through commission percentage instead of the fixed per-consultation fee. Consultations already included in a fixed-fee liquidation SHALL NOT generate commission again. Previous fixed-fee liquidations SHALL stay readable.

#### Scenario: Consulta ya liquidada con tarifa fija
- **WHEN** una consulta ya fue incluida en una liquidación de tarifa fija
- **THEN** su línea de honorario no aparece como comisión pendiente

#### Scenario: Historial previo disponible
- **WHEN** un admin consulta `GET /api/liquidaciones/`
- **THEN** sigue viendo las liquidaciones de tarifa fija ya hechas

### Requirement: Comprobante de liquidación en PDF

The system SHALL expose `GET /api/comisiones/liquidaciones/{id}/pdf` (admin, or the encargado of that liquidation), returning a PDF with the AmiVets logo, the liquidation number and date, the encargado's name and role, the period, one row per line (date, order number, service, subtotal, percentage, encargado amount, AmiVets amount, adjustments marked as such) and the totals for the encargado and for AmiVets.

#### Scenario: Descargar el comprobante
- **WHEN** un admin descarga el PDF de una liquidación
- **THEN** recibe un PDF válido que incluye el nombre del encargado, cada servicio liquidado y el total a pagarle

#### Scenario: Comprobante ajeno
- **WHEN** un gestor pide el PDF de una liquidación de otra persona
- **THEN** la respuesta es 403

### Requirement: Pantallas de comisiones

The system SHALL offer the admin, in Informes, a "Comisiones" screen to configure the default percentage and each encargado's percentage, see pending and liquidated lines per encargado and date range with totals, liquidate, and download each liquidation's PDF. It SHALL replace the fixed-fee liquidation controls in the front.

#### Scenario: Configurar y liquidar desde la pantalla
- **WHEN** un admin elige un gestor y un rango, ve sus líneas pendientes y pulsa "Liquidar"
- **THEN** la liquidación aparece en el listado con su total y un botón para descargar el PDF

### Requirement: El encargado lista sus liquidaciones

The system SHALL expose `GET /api/comisiones/mias/liquidaciones` to `veterinario` and `gestor`, returning only the current user's commission liquidations, newest first, with their number, period, totals and lines.

#### Scenario: Ver mis liquidaciones
- **WHEN** un gestor con dos liquidaciones consulta `GET /api/comisiones/mias/liquidaciones`
- **THEN** recibe esas dos, de la más reciente a la más antigua

#### Scenario: No ve las de otro
- **WHEN** otro encargado tiene liquidaciones
- **THEN** ninguna aparece en la respuesta del primer gestor

#### Scenario: Sin permiso
- **WHEN** un usuario con rol `recepcionista` llama al endpoint
- **THEN** la respuesta es 403
