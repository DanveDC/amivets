# Design

## Context

See proposal.md (Why). Current state that shapes the approach:

- `CatalogoServicio` (`backend/app/models/models.py` ~1299) has `precio_ref`, `area_id`, `activo` (soft delete via `DELETE /api/catalogo/{id}`), commission override fields, and `recetas` → `RecetaServicio` (~1357: `catalogo_servicio_id`, `inventario_id`, `cantidad` Numeric(12,3), `unidad_medida`). `routers/catalogo.py` already enforces that a recipe line's unit equals the material's unit (`agregar_receta_servicio`, `actualizar_receta_servicio`), so no unit conversion exists or is needed anywhere.
- Catalog write gate is `_ROLES_CATALOGO_ESCRITURA = ("admin", "veterinario")`, with admin-only checks inside for `precio_ref`, `area_id`/`requiere_adjunto` and commission (`_aplicar_comision`).
- `orden_service.crear_servicio_en_orden` (~330) creates one line in `SOLICITADO`, snapshots `area_id` from the catalog, validates `es_base` / `servicio_padre_id`, flushes (does not commit), stores `ConsumoPrevisto` overrides, and returns `(servicio, [])` — it never produces advertencias for non-CONSULTA lines. The router (`routers/ordenes.py::anexar_servicio_orden` ~257) calls `asegurar_recibe_trabajo`, `validar_tipo_servicio_por_rol` (from `routers/servicios.py`, `TIPOS_SERVICIO_CLINICOS`) and commits.
- `tipo_servicio` of a catalog line is derived **client-side** from the category (`CATEGORIA_TIPO` in `static/js/sections/orden-abierta.js` ~49, default `'OTRO'`). The backend has no such mapping.
- Stock is consumed only at execution by `consumo_service.consumir_para_servicio`; `_necesidades` takes each recipe line **once per order line** (it does not multiply by `ServicioConsulta.cantidad`), overridden by `ConsumoPrevisto`. `settings.STRICT_INVENTORY` (default False) decides between 400 and a negative stock with warnings. There is no stock reservation: a `SOLICITADO` line holds nothing.
- Commissions (`comision_service.calcular_comision` / `_repartir_con_tipo`) are computed per line on `cantidad × precio_unitario`, and the encargado's part is capped at the line subtotal (`min(enc, base)`).
- Startup runs `Base.metadata.create_all` (`backend/app/main.py:32`), which creates new tables but never adds columns; columns on existing tables need Alembic. Alembic head is `b7c8d9e0f1a2` (verified: the only revision no other revision points to).
- `backend/tests` has pure pytest only (e.g. `test_comision_tipo.py`); DB behavior is covered by Playwright (`e2e/servicio-base-paquete-items.spec.js`, `e2e/helpers.js`).

## Goals / Non-Goals

**Goals:**
- One template definition in the catalog produces the existing base + items hierarchy in an order, with no change to how lines are dispatched, executed, consumed, billed or commissioned.
- The stock check reports exactly what execution will consume by default, from one pure function shared by the preview and the attach warnings.

**Non-Goals:** (in addition to proposal.md Non-Goals)
- No change to `consumo_service`, `confirmar_servicios`, billing, PDF or `agruparPorPaquete`: the attached lines are ordinary base/item lines.
- No generic backend port of every client-side category mapping use; the new backend mapping is used only by the package attach.

## Decisions

### D1. Template = `CatalogoServicio.es_paquete` + child table `CatalogoPaqueteComponente`

```python
# models.py, CatalogoServicio
es_paquete = Column(Boolean, nullable=False, default=False, server_default=text("false"))
componentes = relationship(
    "CatalogoPaqueteComponente",
    foreign_keys="CatalogoPaqueteComponente.paquete_id",
    back_populates="paquete",
    cascade="all, delete-orphan",
    order_by="(CatalogoPaqueteComponente.posicion, CatalogoPaqueteComponente.id)",
)

class CatalogoPaqueteComponente(Base):
    __tablename__ = "catalogo_paquete_componentes"
    id = Column(Integer, primary_key=True)
    paquete_id = Column(Integer, ForeignKey("catalogo_servicios.id", ondelete="CASCADE"), nullable=False, index=True)
    componente_id = Column(Integer, ForeignKey("catalogo_servicios.id"), nullable=False, index=True)
    cantidad = Column(Numeric(12, 3), nullable=False)
    posicion = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        UniqueConstraint("paquete_id", "componente_id", name="uq_paquete_componente"),
        CheckConstraint("cantidad > 0", name="ck_paquete_componente_cantidad"),
        CheckConstraint("paquete_id <> componente_id", name="ck_paquete_componente_no_self"),
    )
    paquete = relationship("CatalogoServicio", foreign_keys=[paquete_id], back_populates="componentes")
    componente = relationship("CatalogoServicio", foreign_keys=[componente_id])
```

The package's own `RecetaServicio` rows are "the package's own materials" — no new recipe concept.

- Alternative: `precio_paquete` column (the abandoned `servicios-anidados` draft). Rejected: `precio_ref` already is the package's own price, with history (`HistorialPrecioServicio`) and admin-only editing; a second price column would duplicate both.
- Alternative: JSON column with the component list. Rejected: no FK integrity, no unique constraint, and "is this service a component somewhere?" becomes a scan.
- Only single-row rules live in CHECKs. "Component is not a package", "a component cannot become a package", "no CONSULTA component", "active component" are cross-row → validated in the router/service (PostgreSQL rejects subqueries in CHECK, same lesson as `ck_servicio_base_sin_padre`).
- `cantidad` is `Numeric(12,3)` like recipes; converted with `float()` when creating the `ServicioConsulta` (`cantidad` is Float there).

### D2. Pricing: base at the package's own `precio_ref`, each component at its own `precio_ref × cantidad`; total = sum of lines

This is option (b). `total_paquete = paquete.precio_ref + Σ(componente.precio_ref × cantidad)` over active components. A package whose price is entirely in its components sets its own `precio_ref` to 0.

- Why not (a) "base carries the whole price, components at 0": commissions are per line to whoever executed it (`asignado_a_id`). With (a) the gestor who executes the anesthesia line would earn 0 and the base's encargado would earn on the anesthesia too. With (b) each executor is paid on the line they did, which is how manual packages already behave. Note: a base at price 0 yields commission 0 even with a FIJO catalog override, because `_repartir_con_tipo` caps the encargado's part at the line subtotal — this is existing behavior and acceptable.
- Order and invoice totals keep being the sum of lines (spec "Datos del paquete en la respuesta" is unchanged); `subtotal_paquete` of the base equals `total_paquete` at attach time.

### D3. New endpoint `POST /api/ordenes/{id}/paquetes`, orchestrated in `paquete_service`, reusing `crear_servicio_en_orden`

```python
# schemas.py
class OrdenAnexarPaquete(BaseModel):
    catalogo_servicio_id: int = Field(..., gt=0)

class PaqueteAnexadoResponse(BaseModel):
    base: ServicioConsultaResponse
    items: List[ServicioConsultaResponse] = []
    advertencias: List[dict] = []   # [{"mensaje": str, ...}]
```

```python
# services/paquete_service.py
def anexar_paquete(db, orden, paquete_id: int, current_user) -> tuple:  # (base, items, advertencias); no commit
```

Flow (router `anexar_paquete_orden`, roles `admin/recepcionista/veterinario`):
1. `orden_service.obtener_orden` + `asegurar_recibe_trabajo` (409).
2. Load package with `componentes` + `componente` (404 missing; 422 not `es_paquete`, inactive, or zero active components).
3. Compute `tipo_servicio` for the base and each active component with `tipo_servicio_de_categoria(categoria)`; run `validar_tipo_servicio_por_rol` on every one **before** creating anything (403 → nothing created).
4. `crear_servicio_en_orden(..., es_base=True, cantidad=1, precio_unitario=paquete.precio_ref, nombre_servicio=paquete.nombre, catalogo_servicio_id=paquete.id, consumos_override=None)`.
5. For each active component in `(posicion, id)` order: `crear_servicio_en_orden(..., servicio_padre_id=base.id, cantidad=float(c.cantidad), precio_unitario=componente.precio_ref, ...)`. The base was flushed in step 4, so the padre validation query finds it in the same session.
6. Advertencias: one per skipped inactive component; one per material with `faltante > 0` from D4 (`"Stock insuficiente de {nombre}: se necesitan {requerido} {unidad}, hay {disponible}"`).
7. Router commits once; any exception before commit leaves nothing (session rollback by `get_db`).

- Alternative: extend `POST /api/ordenes/{id}/servicios` to expand packages. Rejected: that endpoint returns one `ServicioConsultaResponse`; changing its response shape for one kind of item breaks its contract and every caller. A dedicated endpoint keeps both contracts clean.
- Alternative: a client-side loop of N `POST /servicios`. Rejected: not atomic (a 403 on the 3rd line leaves a half package) and N round-trips.
- Reusing `crear_servicio_en_orden` keeps area snapshot, `SOLICITADO`, `mascota_id` and hierarchy validation identical. A package or component in category `CONSULTA` is forbidden at definition time (D5), so the CONSULTA shortcut inside that function is never reached from here.
- `tipo_servicio_de_categoria` is a pure dict lookup mirroring `CATEGORIA_TIPO` in `orden-abierta.js` (`LABORATORIO→LABORATORIO`, `IMAGENOLOGIA→LABORATORIO`, `QUIROFANO→CIRUGIA`, `HOSPITALIZACION→HOSPITALIZACION`, `PELUQUERIA→ESTETICA`, `FARMACIA→INSUMO`, `SERVICIOS→OTRO`, `ADMINISTRACION VARIOS→OTRO`, default `OTRO`), upper-cased and stripped. Both copies carry a comment pointing to the other. A `FARMACIA` component becomes an `INSUMO` line with `referencia_id=None`, so `_necesidades` only uses its recipe (no legacy double count).
- `POST /api/ordenes/{id}/servicios` gets a guard: if `catalogo_servicio_id` points to an `es_paquete` item → 422 `"Es un paquete: agregalo con POST /api/ordenes/{id}/paquetes"` (delta spec on `orden-servicio-carrito`).

### D4. Stock check = pure aggregation, shared by preview and attach

```python
# services/paquete_service.py (pure: no Session)
def agregar_necesidades(lineas: Iterable[tuple[int, Decimal, str]]) -> dict[int, dict]:
    """lineas: (inventario_id, cantidad, nombre_servicio_origen). Sums per material,
    quantized to 3 decimals; returns {inv_id: {"requerido": Decimal, "origenes": [str, ...]}}"""

def evaluar_disponibilidad(necesidades: dict, materiales: dict[int, SimpleNamespace-like]) -> dict:
    """materiales: {inv_id: obj with nombre, unidad_medida, stock_actual}.
    Returns {"suficiente": bool, "insumos": [{inventario_id, nombre, unidad, requerido,
    disponible, faltante, origenes}]} sorted by nombre; unidad None -> "unidad";
    faltante = max(requerido - disponible, 0)."""

# DB wrapper
def disponibilidad_servicio(db, catalogo_servicio: CatalogoServicio) -> dict  # + "componentes_omitidos"
```

- Lines fed to `agregar_necesidades`: the service's own `RecetaServicio` rows, plus, for a package, each **active** component's recipe rows — each recipe quantity taken **once per component line**, not × `componente.cantidad`. This mirrors `consumo_service._necesidades`, so "enough stock" in the preview means the default execution will not go negative. (See Risks.)
- `disponible` = `Inventario.stock_actual`. No reservation exists in the codebase (`ConsumoPrevisto` is an override of what a line will consume, not a hold), so pending lines of other open orders are not subtracted; the spec states it.
- Units: recipe unit equals material unit by construction (router validation), so quantities are summed as-is, reported in `Inventario.unidad_medida or "unidad"` (same default as `consumo_service.UNIDAD_DEFAULT`).
- Endpoint `GET /api/catalogo/{id}/disponibilidad` (read roles), response schema `DisponibilidadServicioResponse { catalogo_servicio_id, suficiente, insumos: List[DisponibilidadInsumo], componentes_omitidos: List[{catalogo_servicio_id, nombre}] }`, quantities serialized as float. Works for any catalog service, not only packages (it's the same computation; the UI uses it for packages).
- Alternative: `POST /api/ordenes/{id}/paquetes/preview`. Rejected: availability does not depend on the order, and the catalog screen needs it without an order.
- Attach never blocks on stock: consumption happens at execution where `STRICT_INVENTORY` already governs; blocking here would make a surgery impossible to budget while stock is being bought.

### D5. Catalog validation and roles

Package definition is **admin-only** (the `es_paquete` flag and component ABM), even though the router's general write gate is admin+veterinario: the composition decides what gets billed, the same reason `precio_ref` is admin-only. Implemented as `current_user.role != "admin"` → 403 inside the handlers (component endpoints use `require_roles("admin")` directly). Reads use `_ROLES_CATALOGO_LECTURA`.

Rules (router `catalogo.py`, helper `_validar_componente`):
- `es_paquete=true` → 422 if `categoria` is `CONSULTA` (case-insensitive) or the service appears as `componente_id` in any row; `es_paquete=false` → 409 if it has component rows.
- Add component → 404 package/component missing; 422 target not `es_paquete`, self, component `es_paquete`, component category `CONSULTA`, component inactive; 409 duplicate (pre-check + `uq_paquete_componente`).
- New component `posicion` = current max + 1. Reorder = `PUT` with `posicion`; the UI swaps the two neighbours' positions with two PUTs.
- Deactivating a component in the catalog stays allowed (no cross-check on `DELETE /api/catalogo/{id}`); the package listing shows it `activo=false`, excludes it from `total_paquete` and the attach skips it with a warning. Chosen over blocking the deactivation because deactivation is a routine catalog cleanup and should not require editing every package first.
- `CatalogoServicioResponse` gains `es_paquete`; `CatalogoServicioCreate` / `Update` accept it.

Component endpoints and schemas:

```
GET    /api/catalogo/{id}/componentes            -> PaqueteComponentesResponse {paquete_id, precio_propio, total_paquete, componentes: [PaqueteComponenteResponse]}
POST   /api/catalogo/{id}/componentes            PaqueteComponenteCreate {componente_id: int>0, cantidad: Decimal>0} -> 201 PaqueteComponenteResponse
PUT    /api/catalogo/componentes/{row_id}        PaqueteComponenteUpdate {cantidad?: Decimal>0, posicion?: int>=0}
DELETE /api/catalogo/componentes/{row_id}        -> 204
PaqueteComponenteResponse {id, paquete_id, componente_id, nombre, categoria, precio_ref, activo, cantidad, posicion, subtotal}
```

The `/componentes/{row_id}` routes mirror `/recetas/{receta_id}` and must be declared so they don't collide with `/{servicio_id}` (different segment count, as today with `/recetas/{id}`).

### D6. Frontend

- `catalogo.js`: `cargarDetalle` also fetches `/catalogo/{id}/componentes` and `/catalogo/{id}/disponibilidad` when `servicio.es_paquete`; `renderDetalle` adds a "PAQUETE" pill, a "Componentes del paquete" section (table: servicio, cantidad input, subtotal, ↑/↓, quitar; add row with a catalog `<select>` of active, non-package, non-CONSULTA services + cantidad; total), and an "Insumos y stock" table (requerido / disponible / faltante, faltante with `av-text-danger`). Edit controls rendered only when `getRole() === 'admin'`. Modal `formCatalogoServicio` (`index.html` ~2778) gets an `#catalogoEsPaquete` checkbox inside an admin-only group, sent by `guardarServicio`.
- `orden-abierta.js`: `pintarServiciosPicker` shows a "PAQUETE" pill for `s.es_paquete`; `seleccionarServicio` branches: for a package, fetch `componentes` + `disponibilidad`, render them in a new `#oaPaqueteWrap` block, hide `#oaConsumosWrap` and the `#oaEsBase` / `#oaPaquetePadre` group, and set the confirm button text to "Agregar paquete"; `confirmarAnexo` posts to `/ordenes/{id}/paquetes` for packages and shows `advertencias` as today. Reset on `cerrarAnexarPanel`. Grouping in the order table comes for free from `agruparPorPaquete`.

### D7. Migration `c8d9e0f1a2b3_add_paquetes_catalogo.py`

Hand-written, `down_revision = 'b7c8d9e0f1a2'`, same style as `b7c8d9e0f1a2_add_servicio_padre_id_and_es_base.py`: inspector-guarded (idempotent, since `create_all` may have created the table first), `add_column('catalogo_servicios', es_paquete Boolean NOT NULL server_default false)`, `create_table('catalogo_paquete_componentes', ...)` with named FK (`fk_paquete_componente_paquete` ON DELETE CASCADE, `fk_paquete_componente_componente`), named unique and the two CHECKs, and separate `op.create_index` for `ix_catalogo_paquete_componentes_paquete_id` and `ix_catalogo_paquete_componentes_componente_id`. Downgrade drops in reverse, guarded. No subquery CHECKs.

## Risks / Trade-offs

- [Recipe not scaled by component quantity] A component with `cantidad` 2 consumes its recipe once at execution (existing `_necesidades` behavior), and the preview mirrors that. → Consistent and truthful to what execution does; users adjust real consumption per line after attaching (`PATCH /api/servicios/{id}` with `consumos`). Changing the consumption rule is out of scope (see Open Questions).
- [Preview is a snapshot] Stock may change between preview and execution, and other open orders are not subtracted. → The preview is advisory; execution keeps the `STRICT_INVENTORY` guard. Stated in the spec.
- [Two copies of category → tipo mapping] Backend `tipo_servicio_de_categoria` and frontend `CATEGORIA_TIPO` can drift. → Cross-reference comments in both; unit test pins the backend map.
- [Admin-only definition vs. admin+vet catalog writes] A veterinarian can edit recipes but not package composition. → Intentional (billing impact, like `precio_ref`); read-only view for veterinarians.
- [Large package, many lines] Each component is one `crear_servicio_en_orden` call with a flush. → Packages are small (tens of lines at most); acceptable.
- [create_all vs Alembic] In dev, `create_all` creates the new table but not `es_paquete`. → Migration must run (startup/`init_db` already runs Alembic); the migration is idempotent for the table.

## Migration Plan

1. Deploy migration `c8d9e0f1a2b3` (adds `es_paquete` default false and the empty components table). Existing catalog and orders are unaffected.
2. Deploy backend + frontend together (the picker reads `es_paquete`; old frontends ignore it).
3. Rollback: `alembic downgrade b7c8d9e0f1a2` drops the table and the column; order lines created from packages remain valid base/item lines (they never referenced the template table).

## Open Questions

- Should a component's recipe be multiplied by the component `cantidad` at execution (and in the preview)? Today no line scales its recipe by `cantidad`; changing it would affect every order line, so it is deferred to a separate change.
- Should templates later support billable inventory products (INSUMO lines with `referencia_id`) as components? Can be added as another component kind without changing this design.
