# Proposal

## Why

Cada servicio que se cobra lo hizo alguien, pero hoy el sistema no registra cuánto de ese cobro le corresponde al encargado y cuánto se queda AmiVets. La única regla que existe es una tarifa fija por consulta para el veterinario (`Usuario.tarifa_consulta`). Los gestores de área, que ejecutan la mayoría de los servicios, no tienen ningún registro de lo que se les debe. Hace falta un solo sistema de comisiones por porcentaje, configurable, con control de lo pendiente y lo pagado, y un comprobante de liquidación presentable para entregarle a cada encargado.

## What Changes

**Configuración de porcentajes**
- Un porcentaje de comisión **por defecto**, que se configura una vez y aplica a todos los encargados.
- Un porcentaje **propio por encargado** que reemplaza al de defecto. Si se quita, vuelve al de defecto.
- Solo el admin puede verlos y cambiarlos, desde una pantalla de configuración.

**Reparto por servicio**
- Cada línea de servicio cobrada (factura `PAGADA`) con un encargado se reparte así: `encargado = subtotal × porcentaje` y `AmiVets = subtotal − encargado`.
- **Quién es el encargado:** el gestor que tomó el servicio (servicios con área) o el veterinario de la consulta (línea de honorario `CONSULTA`).
- Los servicios sin encargado (sin área, caja rápida) y los productos quedan 100% para AmiVets.
- **BREAKING:** el veterinario deja de cobrar la tarifa fija por consulta y pasa a comisión por porcentaje sobre el honorario de la consulta, como el resto. Las liquidaciones ya hechas con la tarifa fija se conservan como histórico, y esas consultas no se vuelven a pagar.

**Control y liquidación**
- Una vista de comisiones por encargado y rango de fechas, con lo **pendiente** (cobrado y todavía no liquidado) y lo **liquidado**, línea por línea y con totales para el encargado y para AmiVets.
- "Liquidar" congela en un registro permanente las líneas pendientes de un encargado en un rango, con el porcentaje aplicado en ese momento. Una línea nunca se liquida dos veces.
- Si se anula una factura cuyas comisiones ya se liquidaron, el sistema genera un ajuste negativo que se descuenta en la próxima liquidación del encargado.

**Comprobante**
- PDF de cada liquidación con el logo de AmiVets, los datos del encargado, el período, el detalle por servicio (fecha, orden, servicio, subtotal, porcentaje, monto del encargado y de AmiVets) y los totales.

## Capabilities

### New Capabilities
- `comisiones-servicio`: configuración de porcentajes de comisión (por defecto y por encargado), reparto entre AmiVets y el encargado de cada servicio cobrado, control de lo pendiente y lo liquidado, liquidación con ajustes por anulación y comprobante PDF.

### Modified Capabilities
*(Ninguna con spec principal: la liquidación por tarifa fija de veterinarios no tiene spec en `openspec/specs/`. Su reemplazo queda descrito en la capability nueva.)*

## Impact

- **Backend:** tablas nuevas (configuración de comisiones, porcentaje por encargado, liquidación de comisiones y su detalle), un servicio `comision_service.py` y el router `/api/comisiones`, más una migración de Alembic para las tablas nuevas. No se agregan columnas a tablas existentes.
- **Liquidaciones existentes:** `POST /api/liquidaciones/calcular` y la configuración de `tarifa_consulta` dejan de ofrecerse en el front. El historial de liquidaciones viejas sigue disponible para leer.
- **PDF:** nueva plantilla `comision_liquidacion_template.html` en `backend/app/templates/`, con el logo `static/img/logo-amivets.png`.
- **Frontend:** en Informes, la sección de liquidaciones se reemplaza por "Comisiones" (control, liquidar, PDF), y se suma la configuración de porcentajes (solo admin).
- **Tests:** nuevo `e2e/comisiones.spec.js`. Hay que ajustar `e2e/liquidaciones.spec.js` al reemplazo de la tarifa fija.
