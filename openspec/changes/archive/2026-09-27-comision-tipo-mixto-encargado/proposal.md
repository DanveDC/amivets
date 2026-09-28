# Proposal

## Why

- Actualmente `ComisionEncargado` solo soporta un único campo `porcentaje` (Numeric(5,2)) que aplica a todos los servicios del encargado.
- No hay forma de definir comisiones mixtas: algunos servicios pagan monto fijo (ej. $50 por estudio) y otros pagan porcentaje (ej. 20% del valor).
- Un encargado puede necesitar ambos tipos simultáneamente según el servicio.
- `CatalogoServicio` no tiene campo para definir qué tipo de comisión aplica a cada servicio.
- `comision_service.py::_repartir()` siempre calcula `subtotal * porcentaje / 100` sin contemplar monto fijo.
- Las liquidaciones congelan solo `porcentaje` en `LiquidacionComisionDetalle`, no el tipo de comisión.

## What Changes

- **`ComisionEncargado`**: agregar campos:
  - `tipo_comision` (String: 'FIJO' | 'PORCENTAJE' | 'MIXTO') — define el modo de cálculo por defecto del encargado
  - `monto_fijo` (Numeric(10,2), nullable) — monto fijo por servicio cuando tipo es FIJO o MIXTO
  - `porcentaje` (Numeric(5,2), nullable) — porcentaje cuando tipo es PORCENTAJE o MIXTO
  - Mantener constraint: al menos uno de los dos no-null cuando tipo no es MIXTO

- **`CatalogoServicio`**: agregar `tipo_comision_servicio` (String: 'FIJO' | 'PORCENTAJE' | 'HEREDA', default 'HEREDA') — define qué tipo aplica a este servicio específico, sobrescribiendo el del encargado

- **`comision_service.py`**: 
  - Nueva función `calcular_comision(servicio_id, subtotal, encargado_id)` que resuelve el tipo efectivo (servicio > encargado > default) y calcula monto_encargado
  - Modificar `lineas_pendientes` y `ajustes_pendientes` para usar la nueva lógica
  - `_repartir()` pasa a recibir `tipo_comision` y `monto_fijo`

- **`LiquidacionComisionDetalle`**: agregar `tipo_comision` (String) y `monto_fijo` (Numeric(10,2), nullable) para congelar el tipo y monto fijo al momento de liquidar

- **Migración Alembic**: agregar columnas a `comision_encargados`, `catalogo_servicios`, `liquidacion_comision_detalles`

## Capabilities

### Modified Capabilities
- `comisiones-por-servicio`: soporte para comisiones mixtas (fijo + porcentaje) por servicio y por encargado, con congelación en liquidación.

## Impact

- Backend: `models.py` (3 tablas), `schemas.py` (ComisionEncargado, CatalogoServicio, LiquidacionComisionDetalle), `comision_service.py` (lógica de cálculo), `routers/comisiones.py` (endpoints de config), migración Alembic
- Frontend: configuración de comisiones por encargado (nuevo selector tipo, campos condicionales), catálogo de servicios (selector tipo comisión)
- Tests: `e2e/comision-tipo-mixto.spec.js`