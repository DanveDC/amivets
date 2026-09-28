# Proposal

## Why

Big services like a surgery are always sold with the same set of extra services (anesthesia, monitoring, post-op) and consume a known set of materials, but today the package is rebuilt by hand in every order: attach the base with "es paquete base", then attach each item and anchor it to the base. That is slow and error-prone, and nobody learns whether there is enough stock for the whole package until the lines are executed and the stock goes negative (or the execution is blocked when `STRICT_INVENTORY` is on). The package hierarchy on order lines (`es_base` / `servicio_padre_id`) just shipped, so the catalog can now carry reusable package templates that produce that hierarchy in one step.

## What Changes

- A catalog service can be flagged as a package (`es_paquete`). A package has an ordered list of components: other catalog services, each with a quantity. One level only: a component cannot be a package, and a package cannot contain itself. The package's own recipe (existing `RecetaServicio`) stays as "the package's own materials".
- New admin-only catalog endpoints to list, add, change and remove package components, and to mark or unmark a service as package, with validation (no self, no nested packages, no CONSULTA components, no inactive components, no duplicates).
- New read-only endpoint `GET /api/catalogo/{id}/disponibilidad` that aggregates the materials the service would consume (its own recipe plus every active component's recipe) and compares them with the current stock, returning required / available / missing per material. It never blocks and never reserves stock.
- New endpoint `POST /api/ordenes/{id}/paquetes` that attaches a package template to an order in a single transaction: one base line (`es_base = true`, at the package's own catalog price) plus one child line per active component (`servicio_padre_id` = base, at the component's catalog price × quantity). Lines are snapshots: later edits to the template do not change existing orders. Inactive components are skipped with a warning; stock shortages come back as warnings, not errors (stock is still consumed at execution, where `STRICT_INVENTORY` keeps governing).
- `POST /api/ordenes/{id}/servicios` rejects a catalog item flagged as package, so a package cannot be attached half-built by the old path.
- Catalog screen: "Es paquete" toggle (admin), a "Componentes del paquete" section to add, remove, reorder and set quantities, the computed package total, and the aggregated materials with stock.
- Open-order attach panel: packages show a "PAQUETE" badge in the picker; choosing one shows its components, total and the stock check before confirming with "Agregar paquete".

## Capabilities

### New Capabilities
- `paquetes-catalogo`: package templates in the service catalog (definition, components, validation), the stock availability preview, and attaching a template to an order as base + items in one step, with the related catalog and order UI.

### Modified Capabilities
- `orden-servicio-carrito`: `POST /api/ordenes/{id}/servicios` gains a rule that rejects catalog items flagged as package (they must go through the package endpoint).

## Non-Goals

- Saving a package from an existing order ("guardar como plantilla desde la orden"). Templates are defined only in the catalog.
- Multi-level packages (a package inside a package).
- Stock reservation. The preview compares against `Inventario.stock_actual` only; lines already attached to other open orders do not reserve stock today and this change does not add that.
- Per-component price overrides in the template, and billable inventory products (INSUMO lines) as components. Components are catalog services at their own catalog price.
- Changing when or how stock is consumed (still at execution, per line, via `consumo_service`).

## Impact

- **DB**: new column `catalogo_servicios.es_paquete`; new table `catalogo_paquete_componentes`. Hand-written Alembic migration after head `b7c8d9e0f1a2`.
- **Backend**: `models.py`, `schemas.py`, `routers/catalogo.py`, `routers/ordenes.py`, new `services/paquete_service.py` (pure aggregation, category → `tipo_servicio` mapping, attach orchestration reusing `orden_service.crear_servicio_en_orden`).
- **Frontend**: `static/js/sections/catalogo.js`, `static/js/sections/orden-abierta.js`, `static/templates/index.html`.
- **Tests**: new pure pytest file for aggregation and category mapping; new Playwright spec for catalog templates, availability preview and package attach; new helpers in `e2e/helpers.js`.
- No breaking change for existing orders or catalog items (`es_paquete` defaults to false).
