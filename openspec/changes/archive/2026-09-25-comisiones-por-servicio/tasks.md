# Tasks

## 1. Modelo y migración

- [x] 1.1 Agregar a `backend/app/models/models.py` los modelos `ConfiguracionComision`, `ComisionEncargado`, `LiquidacionComision` y `LiquidacionComisionDetalle` (con los dos índices únicos parciales `(servicio_id, factura_id)` por `es_ajuste`), sin tocar columnas de tablas existentes; verificar que el backend recarga y que las cuatro tablas existen en la base (`\dt` en `veterinaria_db`)
- [x] 1.2 Crear la migración de Alembic para las cuatro tablas y sus índices, encadenada al head actual (`alembic heads` dentro del contenedor); verificar corriendo su `upgrade()`/`downgrade()` real dentro de una transacción con ROLLBACK (el modo `--sql` offline no soporta las guardas con `inspect()` que usa el proyecto)

## 2. Configuración de porcentajes

- [x] 2.1 Crear `backend/app/services/comision_service.py` con la configuración: leer/crear la fila única de `ConfiguracionComision` (defecto inicial 0), `porcentaje_efectivo(usuario_id)`, y alta/baja del porcentaje propio; sumar los schemas (`ConfiguracionComisionResponse/Update`, `EncargadoComisionResponse`, `PorcentajeEncargadoUpdate` con 0–100 o null); verificar con los tests de 2.3
- [x] 2.2 Crear `backend/app/routers/comisiones.py` (prefijo `/api/comisiones`) con `GET/PUT /configuracion`, `GET /encargados` y `PUT /encargados/{usuario_id}` (solo admin), y registrarlo en `main.py` respetando sus finales de línea CRLF; verificar que aparecen en `/openapi.json`
- [x] 2.3 Sumar helpers de comisiones a `e2e/helpers.js` y crear `e2e/comisiones.spec.js` con los escenarios de configuración: cambiar defecto, fuera de rango (422), sin permiso (403), porcentaje propio y volver al defecto; verificar que `npx playwright test e2e/comisiones.spec.js` pasa

## 3. Cálculo y control

- [x] 3.1 Implementar en `comision_service` el cálculo de pendientes (líneas `facturado` con encargado y factura `PAGADA`, factura por `servicio_id` o por `consulta_id` para la línea `CONSULTA`, excluyendo pares ya liquidados y consultas de `LiquidacionDetalle`, filtro por `fecha_emision`), los ajustes pendientes por anulación y los montos con `Decimal`; verificar con los tests de 3.3
- [x] 3.2 Agregar `GET /api/comisiones/?encargado_id=&desde=&hasta=` (admin) y `GET /api/comisiones/mias` (veterinario/gestor), con pendientes, liquidadas y totales; verificar con los tests de 3.3
- [x] 3.3 Sumar a `e2e/comisiones.spec.js`: servicio de área tomado por un gestor y cobrado → pendiente con reparto 40/60, honorario de consulta → comisión del veterinario, servicio sin área sin comisión (caja rápida cae en el mismo caso: sus servicios no tienen `asignado_a_id`, y el API no expone ese campo para probarlo aparte), factura `PENDIENTE`/`PARCIAL` no elegible, `/mias` solo lo propio, otro encargado 403, consulta ya liquidada con tarifa fija excluida; verificar que el spec pasa

## 4. Liquidación, ajustes y PDF

- [x] 4.1 Implementar `POST /api/comisiones/liquidaciones` y `GET /api/comisiones/liquidaciones?encargado_id=` (admin): congelar porcentaje y montos, incluir ajustes pendientes, 409 sin pendientes, 409 ante `IntegrityError` con rollback; verificar con los tests de 4.3
- [x] 4.2 Crear `backend/app/templates/comision_liquidacion_template.html` (logo por `file://`, datos del encargado, período, tabla con ajustes destacados, totales y firma), `PDFService.generar_liquidacion_comision_pdf` y `GET /api/comisiones/liquidaciones/{id}/pdf` (admin o el encargado dueño); verificar con los tests de 4.3 y abriendo un PDF generado
- [x] 4.3 Sumar a `e2e/comisiones.spec.js`: liquidar (líneas pasan a liquidadas, totales), porcentaje congelado tras cambiarlo, sin doble pago (409), anular antes de liquidar (deja de ser pendiente), anular después (ajuste -X que descuenta la próxima liquidación), PDF válido (`pdfBufferValido`) para admin y dueño, 403 para otro gestor, e historial de tarifa fija legible; verificar que el spec pasa

## 5. Pantalla (frontend)

- [x] 5.1 Reemplazar `#liqSeccion` en `static/templates/index.html` por la sección "Comisiones" (configuración, control, liquidaciones e historial de tarifa fija), reutilizando los estilos existentes; verificar que el DOM tiene la sección para admin
- [x] 5.2 Crear `static/js/sections/comisiones.js` (cargar configuración y encargados, guardar porcentajes, consultar control por encargado y rango, liquidar con `submitWithLoading`, listar liquidaciones y descargar PDF, historial viejo de solo lectura; `escapeHtml` y `money`) e integrarlo desde `reportes.js` en lugar del código de tarifa fija; verificar con el test de 5.3
- [x] 5.3 Ajustar `e2e/liquidaciones.spec.js` a lo que se quitó del front y sumar a `e2e/comisiones.spec.js` un test de UI: el admin configura el porcentaje de un gestor, ve la línea pendiente, liquida y la liquidación aparece con su botón de PDF; verificar que ambos specs pasan

## 6. Integración

- [x] 6.1 Correr la suite e2e completa en dos tandas y verificar que no hay regresiones, sobre todo en `liquidaciones.spec.js`, `reportes.spec.js`, `despacho.spec.js` y los specs de facturación
