# paquetes-catalogo Specification

## Purpose

El administrador define en el catálogo plantillas de paquete (por ejemplo una cirugía con sus servicios e insumos habituales), el sistema dice si hay stock suficiente para el paquete completo, y el paquete se agrega a una orden en un solo paso como servicio base con sus items.

## Requirements

### Requirement: Servicio del catálogo marcado como paquete

A catalog service SHALL carry an `es_paquete` flag (default false) that is exposed in every catalog response. Only an `admin` SHALL be able to set or clear it, through `POST /api/catalogo/` or `PUT /api/catalogo/{id}`; any other role creating a service with `es_paquete=true`, or updating it to a value different from the current one, MUST get 403. Setting it MUST be rejected with 422 when the service's category is `CONSULTA` or when the service is already a component of another package. Clearing it MUST be rejected with 409 while the package still has components. Changing the category of a package, or of a service that is a component of a package, to `CONSULTA` MUST be rejected with 422, whether or not the request also sends `es_paquete`. The package's own recipe keeps its meaning: the materials the package itself consumes.

#### Scenario: Marcar un servicio como paquete
- **WHEN** un admin envía `PUT /api/catalogo/{id}` con `es_paquete=true` sobre "Cirugía de esterilización"
- **THEN** la respuesta es 200 y el servicio devuelve `es_paquete` igual a true

#### Scenario: Veterinario no marca paquetes
- **WHEN** un veterinario envía `PUT /api/catalogo/{id}` con `es_paquete=true`
- **THEN** la respuesta es 403 y el servicio no cambia

#### Scenario: Un componente no puede ser paquete
- **WHEN** un admin marca como paquete un servicio que ya es componente de otro paquete
- **THEN** la respuesta es 422

#### Scenario: Desmarcar un paquete con componentes
- **WHEN** un admin envía `es_paquete=false` sobre un paquete que tiene componentes
- **THEN** la respuesta es 409 y el servicio sigue siendo paquete

#### Scenario: Paquete o componente pasado a CONSULTA
- **WHEN** un admin cambia a `CONSULTA` la categoría de un paquete o de un servicio que es componente de un paquete
- **THEN** la respuesta es 422 y el servicio no cambia

### Requirement: Componentes del paquete

The system SHALL let an `admin` manage the components of a package: `GET /api/catalogo/{id}/componentes` (readable by every role that can read the catalog), `POST /api/catalogo/{id}/componentes` with `componente_id` and `cantidad`, `PUT /api/catalogo/componentes/{componente_row_id}` with `cantidad` and/or `posicion`, and `DELETE /api/catalogo/componentes/{componente_row_id}`. Write operations by a non-admin MUST get 403. `cantidad` MUST be greater than 0. Adding a component MUST be rejected with 404 when the package or the component does not exist, with 422 when the target service is not a package, when the component is the package itself, when the component is a package, when the component's category is `CONSULTA`, or when the component is inactive, and with 409 when the component is already in the package. The listing SHALL return the components ordered by `posicion` and then by creation, each with its catalog name, category, reference price, `activo` and `subtotal` (`cantidad × precio_ref`), plus the package's own price (`precio_propio`, its `precio_ref`) and `total_paquete` = `precio_propio` + the sum of the subtotals of its active components.

#### Scenario: Armar una cirugía con sus servicios
- **WHEN** un admin agrega al paquete "Cirugía de esterilización" (precio 50000) los componentes "Anestesia general" (precio 15000, cantidad 1) y "Monitoreo" (precio 5000, cantidad 2)
- **THEN** `GET /api/catalogo/{id}/componentes` lista los dos en ese orden con subtotales 15000 y 10000
- **AND** `total_paquete` es 75000

#### Scenario: Paquete dentro de paquete
- **WHEN** un admin intenta agregar como componente un servicio con `es_paquete=true`
- **THEN** la respuesta es 422

#### Scenario: El paquete no se contiene a sí mismo
- **WHEN** un admin intenta agregar el propio paquete como componente
- **THEN** la respuesta es 422

#### Scenario: Componente repetido
- **WHEN** un admin agrega un componente que ya está en el paquete
- **THEN** la respuesta es 409

#### Scenario: Reordenar componentes
- **WHEN** un admin cambia la `posicion` de "Monitoreo" para que quede antes que "Anestesia general"
- **THEN** el listado devuelve "Monitoreo" primero

#### Scenario: Componente desactivado después
- **WHEN** un componente del paquete se desactiva en el catálogo
- **THEN** sigue en el listado con `activo` false y su subtotal deja de sumar en `total_paquete`

### Requirement: Disponibilidad de insumos de un servicio del catálogo

The system SHALL expose `GET /api/catalogo/{id}/disponibilidad`, readable by every role that can read the catalog, that aggregates the materials a service of the catalog consumes with its standard recipe: for a package, its own recipe plus the recipe of every active component; for any other service, its own recipe. Each recipe line SHALL count once per order line that would be created (a component's recipe is not multiplied by the component's `cantidad`), which is the quantity the execution consumes by default. Quantities of the same material SHALL be summed. For each material the response SHALL return `inventario_id`, name, unit (the material's unit, `unidad` when empty), `requerido`, `disponible` (current stock), `faltante` (`requerido − disponible` when positive, else 0) and the names of the services that need it; plus `suficiente` (true when no material has a `faltante`) and the list of skipped inactive components. The endpoint MUST NOT change stock and MUST NOT reserve anything: services already attached to other open orders are not subtracted from the available stock.

#### Scenario: Stock suficiente
- **WHEN** un paquete necesita 50 ml de "Isoflurano" en su receta propia y 20 ml más en la receta de "Anestesia general", y hay 100 ml en stock
- **THEN** la respuesta tiene una sola línea de "Isoflurano" con `requerido` 70, `disponible` 100 y `faltante` 0
- **AND** `suficiente` es true

#### Scenario: Stock insuficiente
- **WHEN** el paquete necesita 70 ml de "Isoflurano" y hay 30 ml en stock
- **THEN** la línea de "Isoflurano" tiene `faltante` 40
- **AND** `suficiente` es false

#### Scenario: Servicio sin receta
- **WHEN** se consulta la disponibilidad de un servicio cuya receta y la de sus componentes están vacías
- **THEN** la respuesta es 200 con la lista de insumos vacía y `suficiente` true

#### Scenario: La consulta no toca el stock
- **WHEN** se consulta la disponibilidad de un paquete
- **THEN** el `stock_actual` de cada material queda igual y no se registra ningún movimiento de inventario

### Requirement: Agregar un paquete del catálogo a la orden

The system SHALL expose `POST /api/ordenes/{id}/paquetes` with a `catalogo_servicio_id` of a package, for the same roles as `POST /api/ordenes/{id}/servicios` (`admin`, `recepcionista`, `veterinario`). In a single transaction it SHALL create one base line (`es_base = true`) for the package, at the package's `precio_ref` and quantity 1, and one line per active component anchored to that base (`servicio_padre_id` = base), in `posicion` order, at the component's `precio_ref` and with the component's `cantidad`. Every line SHALL follow the same rules as a line attached through `POST /api/ordenes/{id}/servicios`: state `SOLICITADO`, area taken from its catalog item, no dispatch, no stock consumed. The order total SHALL therefore grow by the package's `total_paquete`. Lines are a snapshot: later changes to the template or to catalog prices MUST NOT change lines already created.

The request MUST be rejected with 404 when the catalog item does not exist, with 422 when it is not a package, is inactive, or has no active component, with 409 when the order does not accept work (`CERRADA`, `FACTURADA`, `ANULADA`), and with 403 when a `recepcionista` attaches a package where any line would be a clinical service. On any rejection no line SHALL be created. Inactive components SHALL be skipped. The response SHALL return the base line, the item lines and `advertencias`: one per skipped component and one per material whose stock is short according to the availability rule, each with a `mensaje`. A stock shortage MUST NOT block the attach.

#### Scenario: Agregar la cirugía como paquete
- **WHEN** se envía `POST /api/ordenes/{id}/paquetes` con el paquete "Cirugía de esterilización" (precio 50000) cuyos componentes son "Anestesia general" (15000 × 1) y "Monitoreo" (5000 × 2), sobre una orden `ABIERTA`
- **THEN** la respuesta es 201 con una línea base `es_base=true` a 50000 y dos items con `servicio_padre_id` igual al id de la base
- **AND** todas las líneas quedan `SOLICITADO`
- **AND** el total de la orden sube 75000

#### Scenario: Stock insuficiente no bloquea
- **WHEN** se agrega un paquete cuya disponibilidad informa un faltante de "Isoflurano"
- **THEN** la respuesta es 201, las líneas se crean y `advertencias` incluye un mensaje sobre "Isoflurano"
- **AND** el stock no cambia

#### Scenario: Componente inactivo se omite
- **WHEN** se agrega un paquete con un componente desactivado en el catálogo
- **THEN** se crean la base y los componentes activos, y `advertencias` indica el componente omitido

#### Scenario: Servicio que no es paquete
- **WHEN** se envía `POST /api/ordenes/{id}/paquetes` con un servicio sin `es_paquete`
- **THEN** la respuesta es 422 y la orden no cambia

#### Scenario: Orden cerrada
- **WHEN** se agrega un paquete a una orden `CERRADA`
- **THEN** la respuesta es 409 y no se crea ninguna línea

#### Scenario: Recepción y paquete clínico
- **WHEN** una recepcionista agrega un paquete de categoría "QUIROFANO"
- **THEN** la respuesta es 403 y no se crea ninguna línea

#### Scenario: Cambiar la plantilla no cambia órdenes existentes
- **WHEN** después de agregar el paquete a una orden, el admin cambia la cantidad de un componente o el precio de un servicio en el catálogo
- **THEN** las líneas ya creadas en esa orden conservan su cantidad y su precio

### Requirement: Plantillas de paquete en la pantalla del catálogo

The catalog detail of a service SHALL show a "PAQUETE" badge when `es_paquete` is true, and the service form SHALL offer an "Es paquete" checkbox visible only to `admin`. The detail of a package SHALL show a "Componentes del paquete" section with each component, its quantity, its subtotal and `total_paquete`, and an "Insumos y stock" section with the availability of the package. An `admin` SHALL be able to add a component from the catalog with a quantity, change its quantity, move it up or down, and remove it from that section; other roles SHALL see the section read-only.

#### Scenario: Admin arma el paquete en pantalla
- **WHEN** un admin abre un paquete en el catálogo, agrega "Anestesia general" con cantidad 1 y "Monitoreo" con cantidad 2
- **THEN** la sección "Componentes del paquete" muestra los dos con sus subtotales y el total del paquete actualizado

#### Scenario: Stock visible en el catálogo
- **WHEN** un admin abre un paquete cuyo insumo "Isoflurano" tiene faltante
- **THEN** la sección "Insumos y stock" muestra "Isoflurano" con lo requerido, lo disponible y el faltante resaltado

#### Scenario: Veterinario ve el paquete sin editarlo
- **WHEN** un veterinario abre un paquete en el catálogo
- **THEN** ve los componentes y el total, sin controles para agregar, mover o quitar

### Requirement: Agregar un paquete desde la orden abierta

The attach panel of the open order SHALL mark package items in the catalog picker with a "PAQUETE" badge. Choosing a package SHALL show its components with quantities and subtotals, the package total, and the availability of its materials with every shortage highlighted, and SHALL replace the confirm action with "Agregar paquete", which calls `POST /api/ordenes/{id}/paquetes`. For a package the panel SHALL hide the per-material consumption editor and the "es paquete base" / "paquete padre" controls. After adding, the panel SHALL show the returned `advertencias`, close, and reload the order, which then shows the package grouped as base plus items.

#### Scenario: Ver el stock antes de agregar
- **WHEN** el usuario elige en el panel un paquete con un insumo faltante
- **THEN** el panel muestra ese insumo como faltante antes de confirmar, y el botón "Agregar paquete" sigue habilitado

#### Scenario: Agregar el paquete desde el panel
- **WHEN** el usuario pulsa "Agregar paquete"
- **THEN** la orden muestra la base con el badge "PAQUETE" y sus componentes indentados debajo, y el total de la orden se actualiza
