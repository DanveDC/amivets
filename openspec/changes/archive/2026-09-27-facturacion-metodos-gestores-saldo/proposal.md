# Proposal

## Why

- No hay forma rápida de ver las facturas emitidas hoy (dashboard de facturación)
- No hay endpoint para calcular qué se debe pagar a cada gestor/encargado basado en las liquidaciones de comisión ya realizadas
- El `saldo_pendiente` de una orden no se expone en la respuesta de facturación, dificultando el seguimiento de cuentas por cobrar
- El modelo `Abono` solo tiene `factura_id` pero no `orden_id`, lo que impide registrar pagos directamente sobre una orden (útil para ventas de servicio directo/caja rápida)

## What Changes

### FacturacionService (backend/app/services/facturacion_service.py)

1. **`obtener_hoy(db: Session) -> List[Factura]`**: Retorna facturas emitidas hoy (fecha_emision = hoy), ordenadas por fecha desc. Filtros opcionales: estado, propietario.

2. **`obtener_pagos_gestores(db: Session, desde: date, hasta: date) -> List[dict]`**: Calcula totales a pagar por cada gestor/encargado en un rango de fechas, basándose en `LiquidacionComisionDetalle` ya liquidados (congelados). Para cada gestor suma:
   - `total_encargado` = suma de `monto_encargado` (ya calculado con tipo_comision FIJO/PORCENTAJE/MIXTO y monto_fijo/porcentaje congelados)
   - Incluye ajustes negativos (`es_ajuste=true`)
   - Retorna lista: `[{encargado_id, username, role, total_encargado, total_amivets, cantidad_lineas, total_ajustes}]`

3. **`obtener_saldo_pendiente_orden(db: Session, orden_id: int) -> dict`**: Retorna el saldo pendiente de una orden específica:
   - Busca la factura vinculada via `FacturaOrden`
   - Si la factura está `PAGADA` → saldo 0
   - Si `PARCIAL` o `PENDIENTE` → retorna `saldo_pendiente` de la factura
   - Si no hay factura vinculada pero la orden está `CERRADA` → calcula total de items sin facturar
   - Retorna: `{orden_id, orden_numero, estado_orden, factura_id, factura_estado, saldo_pendiente, total_factura, total_pagado}`

### Modelo Abono (backend/app/models/models.py)

- Agregar columna `orden_id` (Integer, ForeignKey("ordenes_servicio.id"), nullable=True, index=True)
- Relación `orden = relationship("OrdenServicio")`

### Schemas (backend/app/schemas/schemas.py)

- `AbonoCreate`: agregar `orden_id: Optional[int] = Field(None, gt=0)` (exclusivo con `factura_id` o al menos uno requerido)
- `AbonoResponse`: agregar `orden_id: Optional[int]` y `orden_numero: Optional[str]`
- Nuevos schemas de response para los endpoints:
  - `FacturaHoyResponse` (extiende FacturaResponse o similar)
  - `GestorPagoResponse`: `{encargado_id, username, role, total_encargado, total_amivets, cantidad_lineas, total_ajustes}`
  - `SaldoPendienteOrdenResponse`: como dict arriba

### Router (backend/app/routers/facturas.py)

- `GET /api/facturas/hoy` — usa `FacturacionService.obtener_hoy()`, roles: admin, recepcionista, veterinario
- `GET /api/facturas/gestores-pagos` — query params `desde`, `hasta` (YYYY-MM-DD), usa `FacturacionService.obtener_pagos_gestores()`, solo admin
- `GET /api/facturas/orden/{orden_id}/saldo-pendiente` — usa `FacturacionService.obtener_saldo_pendiente_orden()`, roles: admin, recepcionista, veterinario
- `POST /api/facturas/{factura_id}/abonar` — actualizar para aceptar `orden_id` opcional en body (AbonoCreate), validar que factura u orden exista

## Capabilities

### Modified Capabilities
- `caja-rapida` / `orden-servicio-carrito`: `saldo_pendiente` por orden visible en facturación
- `comisiones-por-servicio`: endpoint `gestores-pagos` usa liquidaciones congeladas con tipos mixtos

### New Capabilities
- `facturacion-dashboard`: facturas de hoy, pagos a gestores, saldo por orden

## Impact

- Backend: `facturacion_service.py` (3 métodos nuevos), `models.py` (Abono.orden_id), `schemas.py` (AbonoCreate/Response + nuevos responses), `routers/facturas.py` (3 endpoints GET + update POST abonar), migración Alembic para `Abono.orden_id`
- Frontend: facturacion.js (nueva sección "Hoy", tabla "Pagos a gestores", columna saldo en órdenes por cobrar)
- Tests: `e2e/facturacion-metodos-gestores-saldo.spec.js`