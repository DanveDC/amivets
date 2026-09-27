# Tasks

## 1. Migración Alembic

- [x] 1.1 Generar migración: escrita a mano (siguiendo el estilo de `a2b3c4d5e6f7_add_orden_id_to_abonos.py`, con guards idempotentes) en `backend/alembic/versions/b7c8d9e0f1a2_add_servicio_padre_id_and_es_base.py`, `down_revision='a2b3c4d5e6f7'` (head confirmado con `alembic heads`).
- [x] 1.2 upgrade(): ADD COLUMN `servicio_padre_id` INTEGER nullable + FK nombrada `fk_servicios_consulta_padre` ON DELETE SET NULL + índice separado `ix_servicios_consulta_servicio_padre_id`; ADD COLUMN `es_base` BOOLEAN NOT NULL DEFAULT false; CHECK `ck_servicio_base_sin_padre` = `NOT (es_base AND servicio_padre_id IS NOT NULL)` — **desviación de diseño**: NO se agregaron los otros dos CHECK con subquery del design.md ("padre es_base", "misma orden") porque PostgreSQL rechaza subqueries dentro de un CHECK ("cannot use subquery in check constraint"); esas dos reglas + "un solo nivel" se validan en `orden_service.crear_servicio_en_orden` (service layer), documentado en el modelo y la migración.
- [x] 1.3 downgrade(): drop check, drop columna `es_base`, drop índice, drop FK, drop columna `servicio_padre_id` (con guards idempotentes).
- [x] 1.4 Ejecutado `docker exec veterinaria_backend alembic upgrade head` (mismo mecanismo que la migración previa) y verificado con `psql \d servicios_consulta`: columnas, FK, índice y CHECK presentes.

## 2. Modelo (backend/app/models/models.py)

- [x] 2.1 Agregadas `servicio_padre_id`, `es_base` y las dos relaciones autorreferenciales (`servicio_padre`/`items_adicionales`) en `ServicioConsulta` (backend/app/models/models.py).
- [x] 2.2 En `__table_args__`: agregado SOLO `ck_servicio_base_sin_padre` (row-level) — ver nota de desviación en 1.2; las reglas cross-row NO son un CHECK, viven en `crear_servicio_en_orden`.
- [x] 2.3 `text` ya estaba importado de sqlalchemy (usado por `is_deleted` y `uq_orden_una_consulta`); confirmado `app.main` importa sin errores.

## 3. Schemas (backend/app/schemas/schemas.py)

- [x] 3.1 `ServicioConsultaBase`: agregado `servicio_padre_id` y `es_base` (heredados por Create/Response).
- [x] 3.2 `ServicioConsultaUpdate`: NO se agregan `servicio_padre_id` ni `es_base` (decisión del usuario, 2026-09-27). `PATCH /api/servicios/{id}` aplica los campos con `setattr` sin validar la jerarquía, así que exponerlos permitía padres de otra orden o no-base, y un 500 por el CHECK. La jerarquía solo se define al anexar.
- [x] 3.3 `ServicioConsultaResponse`: `servicio_padre_id`/`es_base` ya vienen de `ServicioConsultaBase`; agregados como **campos planos** (no `@computed_field`) `es_item_adicional`, `items_adicionales_count`, `subtotal_items_adicionales`, `subtotal_paquete`, llenados en el `model_validator(mode='before')` existente (`_adjuntar_asignado_a_nombre`) — un `@computed_field`/`@property` leyendo `items_adicionales` NO funciona con `from_attributes` porque no es un campo real de la clase. **Desviación de diseño (documentada, ver decisión del orquestador)**: `es_item_adicional` se define como `servicio_padre_id is not None`, NO como `not es_base` (spec) — un servicio suelto sin padre y sin `es_base` no es un "item adicional" de nada; con el alias literal del spec, cualquier servicio suelto normal (la inmensa mayoría de las filas hoy) se reportaría como `es_item_adicional=true`, lo cual rompe el propósito del campo.
- [x] 3.4 `OrdenServicioAnexarServicio`: agregado `servicio_padre_id` y `es_base`.
- [x] 3.5 Verificado: `OrdenServicioDetalleResponse.servicios: List[ServicioConsultaResponse]` hereda los campos nuevos (ver OpenAPI schema generado, confirmado por script ad-hoc).

## 4. Servicio orden_service.py

- [x] 4.1 `crear_servicio_en_orden`: agregados `servicio_padre_id`/`es_base`; validaciones (base con padre → 422, padre inexistente/soft-deleted/CANCELADO → 404, padre no `es_base` → 422, padre en otra orden → 422, padre con padre → 422); `mascota_id` se hereda del padre cuando hay uno (decisión del orquestador — en la práctica coincide con `orden.mascota_id` porque este endpoint siempre deriva mascota de la orden, nunca del cliente); campos pasados a ambos constructores `ServicioConsulta(...)` (rama CONSULTA y rama genérica). Verificado end-to-end con `curl` contra el backend vivo (ver evidencia en el reporte de la sesión): base creada con `es_base=true`, item con `servicio_padre_id` válido creado y vinculado, `es_base=true`+`servicio_padre_id` → 422, item con padre no-base → 422, item con padre de otra orden → 422, anidación de 2 niveles → 422.
- [x] 4.2 `obtener_orden(con_asignados=True)`: agregado `.selectinload(OrdenServicio.servicios).selectinload(ServicioConsulta.items_adicionales)`.
- [x] 4.3 FUERA DE ALCANCE (decisión del usuario, 2026-09-27): sin tests unitarios; `backend/tests` no tiene infraestructura de tests con DB. Los 6 escenarios de validación están cubiertos en `e2e/servicio-base-paquete-items.spec.js` contra la API real.

## 5. Router ordenes.py

- [x] 5.1 `anexar_servicio_orden`: pasa `servicio_padre_id`/`es_base` de `data` a `crear_servicio_en_orden(...)`.
- [x] 5.2 FUERA DE ALCANCE (decisión del usuario, 2026-09-27): sin test unitario del router; anexar base + item en requests separados está cubierto en `e2e/servicio-base-paquete-items.spec.js`.

## 6. Frontend - orden-abierta.js

- [x] 6.1 `pintarServicios()` refactorizado: usa `agruparPorPaquete()` (core/format.js, tarea 7.3) para separar bases/items-por-padre/sueltos; renderiza base + items indentados + fila de subtotal paquete; los sueltos (sin padre, no base) van al final. Un item cuyo padre no está en la lista visible (soft-deleted, huérfano) se pinta como suelto en vez de desaparecer.
- [x] 6.2 Agregados los helpers locales `filaBaseHtml()`, `filaHtml(s, {indent})` (cubre item Y servicio suelto con el mismo código) y `filaSubtotalHtml()`.
- [x] 6.3 Estilos agregados en `static/css/shell.css` (`.oa-paquete-base`, `.oa-paquete-item`, `.oa-paquete-subtotal`) + estilos inline para bold/badge PAQUETE/indentación "└─".
- [x] 6.4 Toggle colapso/expandir implementado (el spec lo exige, no es opcional pese al "(Opcional)" del enunciado): click en `.oa-paquete-base` alterna `display` de items + subtotal vía `[data-padre-id]`, delegado una sola vez en `#oaServiciosBody`.
- [x] 6.5 FUERA DE ALCANCE (decisión del usuario, 2026-09-27): tarea opcional; `pintarResumen()` sigue mostrando solo el total general, el desglose por paquete ya se ve en la tabla de servicios.

## 7. Frontend - facturacion.js

- [x] 7.1 `abrirPreviewFactura()` agrupa vía `pintarDetallesAgrupados()`. Requirió extender `DetalleFacturaResponse` (schemas.py) con `es_base`/`servicio_padre_id` leídos aditivamente de la relación `servicio` (NO se tocó `FacturacionService.crear_factura`) + `selectinload(Factura.detalles).selectinload(DetalleFactura.servicio)` en `FacturacionService.obtener_factura` para no disparar N+1. También se agrupó el preview de "Facturar orden" (`modalFacturarOrden`, orden-abierta.js::facturarOrden — no estaba en el enunciado de esta tarea, pero orden-servicio-carrito/spec.md sí lo exige como el mismo requirement): `FacturacionService.obtener_items_pendientes_orden` ahora incluye `es_base`/`servicio_padre_id` por ítem (cambio aditivo, dict plano, no toca la lógica de facturación).
- [x] 7.2 PDF (`invoice_template.html` + `PDFService.generar_factura_pdf`): agrupado por paquete con subtotal — helper `PDFService._agrupar_detalles_por_paquete` (nuevo, no toca `crear_factura`) arma `grupos_paquete`/`detalles_sueltos` a partir de `detalle.servicio` (ya eager-cargado). Sí había link (`DetalleFactura.servicio_id` + relación `servicio`), así que NO se paró la tarea.
- [x] 7.3 Extraído a `static/js/core/format.js::agruparPorPaquete()` (mismo módulo que `money`/`totalServicios`, sigue la convención existente); reutilizado en `orden-abierta.js` (tabla de servicios y preview de facturar-orden) y `facturacion.js` (preview de factura ya emitida).

## 8. Frontend - Panel Anexar Servicio (orden-abierta.js)

- [x] 8.1 Checkbox "Es un paquete base" (`#oaEsBase`) agregado al panel (`static/templates/index.html`); `confirmarAnexo()` manda `es_base: true` cuando está marcado.
- [x] 8.2 Selector "Paquete padre" (`#oaPaquetePadre`) agregado; se puebla en `pintarPaquetePadreOptions()` con los `es_base=true` vivos (no is_deleted, no CANCELADO) de `_ordenData.servicios` cada vez que se abre el panel; `confirmarAnexo()` manda `servicio_padre_id` cuando hay uno elegido y el checkbox está desmarcado.
- [x] 8.3 Wireado en `initOrdenAbierta()`: tildar el checkbox limpia y deshabilita el selector; elegir un padre destilda el checkbox. `confirmarAnexo()` repite la exclusión mutua (prioriza `es_base` si ambos quedaran seteados).
- [x] 8.4 Cada opción del selector muestra el nombre del servicio + sufijo "(PAQUETE)" — el badge visual real (`av-pill`) no es representable dentro de un `<option>` nativo; es la forma honesta de "mostrar PAQUETE en el picker" para un `<select>`.

## 9. Tests E2E

- [x] 9.1 Creado `e2e/servicio-base-paquete-items.spec.js` (9 tests, incluidos "PATCH no cambia la jerarquía" y "item con base soft-deleted se muestra suelto", todos verdes vía `npx playwright test`): base+item vinculados y campos computados en GET orden; `es_item_adicional` de un suelto es `false` (desviación documentada); validaciones 422/404 (base con padre, padre inexistente, padre no-base, padre en otra orden, "anidación profunda" — ver nota de hallazgo en el reporte de la sesión); padre soft-deleted no es ancla válida; `pendientes-facturar` incluye `es_base`/`servicio_padre_id`; UI: badge PAQUETE + indentación + subtotal + colapso en orden-abierta; panel "Anexar servicio" crea jerarquía vía checkbox/selector.

## 10. Verificación

- [x] 10.1 Backend arranca sin errores: `docker exec veterinaria_backend python -c "import app.main"` sin excepciones (no hizo falta reiniciar el contenedor — `uvicorn --reload` ya recargó con cada edición).
- [x] 10.2 OpenAPI: confirmado por script ad-hoc que `ServicioConsultaResponse`, `OrdenServicioAnexarServicio` y `DetalleFacturaResponse` exponen los campos nuevos (`es_base`, `servicio_padre_id`, `es_item_adicional`, `items_adicionales_count`, `subtotal_items_adicionales`, `subtotal_paquete`).
- [x] 10.3 Migración aplicada: `docker exec veterinaria_backend alembic current` → `b7c8d9e0f1a2 (head)`.
- [x] 10.4 `npx playwright test e2e/servicio-base-paquete-items.spec.js` → **9 passed** (22.1s, última corrida).
- [x] 10.5 Regresión conjunta (`e2e/servicio-base-paquete-items.spec.js` + `e2e/ordenes.spec.js` + `e2e/orden-veterinario-y-tutores.spec.js` + `e2e/servicio-directo.spec.js` + `e2e/regresiones-revision.spec.js` + `e2e/facturacion-metodos-gestores-saldo.spec.js`) → **82 passed, 0 failed** (3.1m). El total de orden/factura sigue siendo la suma de todos los servicios. Nota: ninguno de estos specs ejerce `GET /api/facturas/{id}/pdf`; un smoke test manual aparte (curl/urllib contra el backend vivo, factura con paquete) encontró y corrigió un bug real introducido por la tarea 7.2 — ver "Deviations"/reporte de la sesión (colisión `grupo.items` con `dict.items()` en Jinja).