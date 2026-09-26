# Design

## Context

- **Liquidación actual (Unidad E):** `Usuario.tarifa_consulta` es un monto fijo por consulta. `routers/liquidaciones.py` calcula las consultas elegibles (factura `PAGADA`, `NOT IN LiquidacionDetalle.consulta_id`), y el `unique` sobre `LiquidacionDetalle.consulta_id` es el candado contra el doble pago (captura `IntegrityError`). No tiene PDF. La UI está en Informes (`#liqSeccion`, `reportes.js`).
- **Quién hizo cada servicio:** `ServicioConsulta.asignado_a_id` guarda el gestor que tomó un servicio de área. La línea de honorario es un `ServicioConsulta` con `tipo_servicio = 'CONSULTA'` y `consulta_id`; el veterinario es `Consulta.veterinario_id`.
- **Dos formas de facturar el honorario:**
  - por orden: `DetalleFactura.servicio_id` apunta a la línea `CONSULTA`;
  - por el endpoint de compatibilidad `from-consulta`: el honorario sale sin `servicio_id`, la factura queda enlazada por `Factura.consulta_id`, y `crear_factura` marca igual `facturado = True` en la línea `CONSULTA`.
- **La factura puede pasar a `PAGADA` por tres caminos:** `crear_factura`, `registrar_abono` y `PATCH /api/facturas/{id}`. `anular_factura` devuelve `facturado = False` a los servicios.
- **`Usuario`** tiene `username`, `role` e `is_active`, pero no nombre completo.
- **Entorno de desarrollo:** el override de dev corre `Base.metadata.create_all`, no Alembic. `create_all` crea tablas nuevas pero **no agrega columnas** a tablas existentes. Producción corre Alembic (`backend/alembic/versions`).
- **PDF:** `PDFService.render_to_pdf` (xhtml2pdf + Jinja2, plantillas en `backend/app/templates/`). El logo está en `/app/static/img/logo-amivets.png` dentro del contenedor.

## Goals / Non-Goals

**Goals:**
- Un solo sistema de comisión por porcentaje para todos los encargados, incluido el veterinario de la consulta.
- Porcentaje por defecto más un porcentaje propio opcional por encargado, configurable por el admin.
- Control de lo pendiente y lo liquidado, liquidación sin doble pago, ajustes por anulación y comprobante PDF con logo.

**Non-Goals:**
- Registrar el pago efectivo al encargado (transferencia, recibo firmado). El comprobante documenta la liquidación; el pago queda fuera del sistema.
- Comisión sobre productos o sobre servicios sin encargado.
- Porcentajes distintos por servicio o por área.
- Migrar ni recalcular las liquidaciones de tarifa fija ya hechas.
- Descuentos e impuestos de la factura: el front los manda en 0, y la comisión se calcula sobre el subtotal de la línea.

## Decisions

1. **Tablas nuevas, sin columnas nuevas en tablas existentes.** Cuatro modelos nuevos en `models.py`:
   - `ConfiguracionComision`: fila única, con `porcentaje_defecto Numeric(5,2)` (0–100), `updated_at` y `updated_by_id`.
   - `ComisionEncargado`: `usuario_id` único (FK a `usuarios`), `porcentaje Numeric(5,2)`. Si no hay fila, el encargado usa el porcentaje por defecto.
   - `LiquidacionComision`: `encargado_id`, `desde`, `hasta`, `fecha_calculo`, `creada_por_id`, `total_encargado` y `total_amivets`. El número visible es `LC-` más el id con ceros adelante.
   - `LiquidacionComisionDetalle`: `liquidacion_id`, `servicio_id` (FK a `servicios_consulta`), `factura_id`, `orden_id`, `descripcion`, `fecha_cobro`, `subtotal`, `porcentaje`, `monto_encargado`, `monto_amivets` y `es_ajuste`.

   Así `create_all` los levanta en dev sin tocar tablas viejas, y se agrega la migración de Alembic equivalente para producción. *Alternativa descartada:* una columna `Usuario.porcentaje_comision`. Exige una migración que el dev no corre y rompe al levantar.

2. **Candado contra el doble pago con un índice único por (servicio, factura, tipo).** Dos índices únicos parciales sobre el detalle:
   - `(servicio_id, factura_id) WHERE NOT es_ajuste`
   - `(servicio_id, factura_id) WHERE es_ajuste`

   Una línea cobrada en una factura se liquida una sola vez. Si esa factura se anula y la línea se vuelve a cobrar en otra, es otra combinación y se puede liquidar de nuevo. Dos liquidaciones concurrentes chocan contra el índice y la segunda responde 409, que es el mismo patrón que `LiquidacionDetalle.consulta_id`. *Alternativa descartada:* un `unique` solo sobre `servicio_id`. Dejaría sin comisión una línea que se anula y se vuelve a cobrar.

3. **Las comisiones se calculan del estado, no se generan por eventos.** `comision_service` arma lo pendiente al leer, sin hooks en los caminos de cobro:
   - **Línea elegible:** un `ServicioConsulta` vivo, con `facturado = True` y un encargado, cuya factura está `PAGADA`, y que no tiene detalle normal para ese par (servicio, factura).
   - **Factura de la línea:** la del `DetalleFactura.servicio_id`; si no hay, para la línea `CONSULTA` la del `Factura.consulta_id`.
   - **Ajuste pendiente:** un detalle normal ya liquidado cuya factura ahora está `ANULADA` y que todavía no tiene su detalle de ajuste.

   Como la factura puede pasar a `PAGADA` por tres caminos, los hooks serían frágiles. Calcular desde el estado siempre da el mismo resultado, sin importar por dónde se cobró. *Alternativa descartada:* crear filas de comisión al pasar a `PAGADA`. Habría que tocar `crear_factura`, `registrar_abono` y el PATCH, y cualquier camino nuevo quedaría afuera.

4. **Quién es el encargado.** Si `tipo_servicio == 'CONSULTA'`, es `Consulta.veterinario_id`. Si no, es `asignado_a_id`. Si queda NULL, no hay comisión. Las líneas `CONSULTA` cuyo `consulta_id` ya está en `LiquidacionDetalle` (tarifa fija) se excluyen para siempre.

5. **Montos y porcentaje.**
   - `subtotal = cantidad × precio_unitario` de la línea de servicio, que es el precio cobrado.
   - `monto_encargado = round(subtotal × porcentaje / 100, 2)` y `monto_amivets = subtotal − monto_encargado`, con `Decimal`.
   - En lo pendiente se usa el porcentaje efectivo **actual** del encargado. Al liquidar, porcentaje y montos se **copian** al detalle y ya no cambian.
   - El ajuste copia la línea liquidada con `subtotal`, `monto_encargado` y `monto_amivets` negados y `es_ajuste = True`.

6. **Rango de fechas por fecha de cobro.** El rango `desde`/`hasta` filtra por `Factura.fecha_emision`. Los ajustes pendientes se incluyen siempre en la próxima liquidación del encargado, sin importar el rango, para que no queden colgados.

7. **Liquidar.** `POST /api/comisiones/liquidaciones`:
   - junta las líneas pendientes del rango y los ajustes pendientes;
   - si no hay nada, responde 409;
   - crea la cabecera y los detalles en una transacción;
   - ante `IntegrityError`, hace rollback y responde 409: "otra liquidación tomó estas líneas, recargá".

   El total puede ser negativo si solo hay ajustes; se permite y queda registrado.

8. **API** (`routers/comisiones.py`, prefijo `/api/comisiones`):

   | Endpoint | Roles |
   |---|---|
   | `GET` / `PUT /configuracion` | admin |
   | `GET /encargados` (activos con rol `veterinario` o `gestor`, porcentaje propio y efectivo) | admin |
   | `PUT /encargados/{usuario_id}` (`{porcentaje: number \| null}`) | admin |
   | `GET /?encargado_id=&desde=&hasta=` (pendientes, liquidadas y totales) | admin |
   | `GET /mias?desde=&hasta=` | `veterinario`, `gestor` |
   | `POST /liquidaciones`, `GET /liquidaciones?encargado_id=` | admin |
   | `GET /liquidaciones/{id}/pdf` | admin, o el encargado dueño de la liquidación |

9. **PDF.** Plantilla `comision_liquidacion_template.html`, siguiendo el estilo de `invoice_template.html`:
   - encabezado con el logo, pasado como `file://` absoluto (`/app/static/img/logo-amivets.png`) para que lo resuelva xhtml2pdf;
   - número y fecha de la liquidación, encargado (username y rol) y período;
   - tabla por línea, con los ajustes en otro color y la etiqueta "Ajuste por anulación";
   - totales del encargado y de AmiVets, y un pie para la firma.

   Nuevo `PDFService.generar_liquidacion_comision_pdf`.

10. **Tarifa fija.** El front deja de mostrar la tabla de tarifas y el "Calcular liquidación" de tarifa fija. Los endpoints viejos siguen existiendo por compatibilidad y el historial (`GET /api/liquidaciones/`) queda visible como "Liquidaciones anteriores (tarifa fija)". `Usuario.tarifa_consulta` no se borra.

11. **Front.** En `sec-reportes`, `#liqSeccion` se reemplaza por una sección "Comisiones", solo admin, en `static/js/sections/comisiones.js`, con:
    - **(a)** configuración: porcentaje por defecto y tabla de encargados con su porcentaje propio editable;
    - **(b)** control: encargado + rango → pendientes, liquidadas y totales, con el botón "Liquidar";
    - **(c)** liquidaciones del encargado con "Descargar PDF";
    - **(d)** historial de tarifa fija, solo lectura.

    Todo texto que viene del servidor pasa por `escapeHtml`, y los montos usan `money`.

12. **Tests.** Playwright e2e en `e2e/comisiones.spec.js`, con helpers REST en `e2e/helpers.js`. Cubren cada escenario del spec y un test de UI. Hay que ajustar `e2e/liquidaciones.spec.js` a lo que queda (historial legible, endpoints de compatibilidad) y a lo que se quita del front.

## Risks / Trade-offs

- **[BREAKING para veterinarios]** Cambia cómo cobran: de monto fijo a porcentaje. → Las consultas ya liquidadas con tarifa fija se excluyen. Las consultas cobradas y no liquidadas antes del cambio pasan a comisión por porcentaje. Hay que avisarle al equipo antes de desplegar.
- **[Rendimiento del cálculo al leer]** Lo pendiente se arma con consultas sobre `servicios_consulta` + `detalles_factura` + `facturas`. → Se filtra por encargado y por rango; si crece, se agrega un índice sobre `servicios_consulta.asignado_a_id`.
- **[Honorarios facturados por `from-consulta`]** Su factura se encuentra por `Factura.consulta_id`. Si una consulta tuviera más de una factura `PAGADA`, se toma la más reciente, con la misma defensa que la Unidad E.
- **[Logo en el PDF]** xhtml2pdf necesita una ruta de archivo accesible. → Se valida en un test que el PDF se genera; si el logo falta, la plantilla sigue sin imagen en vez de fallar.
- **[Porcentaje cambiado antes de liquidar]** Lo pendiente se muestra con el porcentaje actual, así que un cambio afecta a lo no liquidado. → Es la regla elegida: el porcentaje se congela al liquidar, y así se lo muestra en pantalla.
