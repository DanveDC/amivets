# Proposal

## Why

Hoy toda venta pasa por un propietario registrado y una orden (abrir → agregar → confirmar → cerrar → facturar). Para una venta de mostrador, como una bolsa de alimento, un accesorio o un baño rápido, ese recorrido es demasiado largo: obliga a dar de alta a un cliente que no lo necesita y a pasar por cinco pantallas. Hace falta una caja rápida que venda y cobre en un solo paso.

## What Changes

**Backend**
- Nuevo `POST /api/caja-rapida/ventas`: recibe una lista de ítems (productos de inventario y/o servicios del catálogo), el método de pago y, opcionalmente, un `propietario_id`. En una sola transacción arma una orden, registra los servicios como ejecutados, emite la factura cobrada al 100% y deja la orden `FACTURADA`.
- Cliente genérico "Consumidor final": un propietario de sistema que se usa cuando la venta no indica cliente. Se crea solo la primera vez que se usa. `Factura.propietario_id` sigue siendo obligatorio y no hay migración.
- Los precios salen siempre del maestro (`Inventario.precio_unitario`, `CatalogoServicio.precio_ref`), nunca del cliente, salvo los servicios con `precio_variable`.
- Solo se venden productos `tipo_item = PRODUCTO` activos con stock suficiente, y servicios del catálogo activos **sin área de despacho**. Los servicios con área necesitan que un gestor los ejecute, así que siguen yendo por una orden.
- Nuevo `GET /api/caja-rapida/items?q=`: busca en un solo listado los productos y servicios que se pueden vender.

**Frontend**
- Nueva pantalla "Caja rápida" en el módulo Facturación: buscador de productos y servicios, carrito con cantidades y total, método de pago, botón "Cobrar y emitir" y, al terminar, la opción de descargar el PDF de la factura.

## Capabilities

### New Capabilities
- `caja-rapida`: venta de mostrador de productos de inventario y servicios del catálogo sin registrar cliente, facturada y cobrada en un solo paso.

### Modified Capabilities
*(Ninguna: no hay specs principales en `openspec/specs/`.)*

## Impact

- Backend: nuevo `backend/app/routers/caja_rapida.py` (registrado en `main.py`) y `backend/app/services/caja_rapida_service.py`, que reutiliza `FacturacionService.crear_factura` y `consumo_service.consumir_para_servicio`. Se suman schemas en `backend/app/schemas/schemas.py`.
- Datos: un propietario "Consumidor final" (cédula fija de sistema), sin cambios de esquema ni migración.
- Frontend: nueva sección `sec-caja-rapida` (`static/js/sections/caja-rapida.js`, `static/templates/index.html`, `static/js/core/router.js`) dentro del módulo Facturación.
- Reportes e historial de facturas: las ventas sin cliente aparecen a nombre de "Consumidor final".
- Tests: nuevo `e2e/caja-rapida.spec.js` y helpers en `e2e/helpers.js`.
