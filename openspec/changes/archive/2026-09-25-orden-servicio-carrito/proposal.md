# Proposal

## Why

La orden de servicio ya es la entidad central del backend (`/api/ordenes`, despacho por área, bandeja del gestor), pero la app todavía conserva el enfoque viejo centrado en la consulta:

- La pantalla de Facturación solo factura consultas (`/facturas/from-consulta`, `/facturas/pendientes/{consulta_id}`) y no muestra ninguna orden, aunque el menú promete "Abre las órdenes por cobrar".
- Historia clínica tiene atajos de "Facturar" y "Cerrar y facturar" que cobran una consulta sin pasar por su orden.
- La orden nunca llega a `FACTURADA`: facturar no cambia su estado.
- La orden no funciona como un carrito/presupuesto: un servicio sin área se da por `EJECUTADO` al agregarlo, la orden pasa a `EN_ATENCION` con el primer servicio y el API no expone un total.

Además hay un intento previo sin commitear (`anadir_servicio_carrito`, estado `CARROLA`, columna `OrdenServicio.total` sin migración) que no está conectado, rompe con `NameError` y contradice la decisión de no guardar un total en la orden.

## What Changes

**Backend: la orden como carrito/presupuesto (cambia comportamiento existente)**
- **BREAKING**: al agregar un servicio a la orden (`POST /api/ordenes/{id}/servicios`), el servicio SIEMPRE queda `SOLICITADO`, tenga o no área. Se elimina el atajo "sin área → `EJECUTADO` al agregar".
- **BREAKING**: agregar servicios ya no pasa la orden a `EN_ATENCION`; la orden sigue `ABIERTA` mientras es un presupuesto. `confirmar` la pasa a `EN_ATENCION`. Tomar la orden o abrirle una consulta la siguen pasando a `EN_ATENCION`, como hoy.
- `GET /api/ordenes/{id}` y el listado exponen `total`: la suma de `cantidad × precio_unitario` de los servicios no cancelados, calculada al leer (no se guarda en la base).
- El despacho al área se mantiene al confirmar (`SOLICITADO → ASIGNADO` + notificación a gestores); los servicios sin área pasan a `EJECUTADO` al confirmar.
- Se descarta el intento sin commitear: la función `anadir_servicio_carrito`, el estado `CARROLA` y la columna `total`.

**Backend: facturar por orden**
- Nuevo `GET /api/ordenes/{id}/pendientes-facturar`: vista previa de lo que falta facturar en la orden.
- Nuevo `POST /api/ordenes/{id}/facturar`: el servidor arma la factura con todos los servicios no facturados de una orden `CERRADA` y la orden pasa a `FACTURADA`.
- Anular una factura de una orden `FACTURADA` la devuelve a `CERRADA`.

**Frontend: la orden como flujo principal**
- Facturación: nueva vista "Órdenes por cobrar" (órdenes `CERRADA`) como vista principal; facturar abre la orden. El historial de facturas queda como vista secundaria.
- Orden abierta: se muestra el total (presupuesto) que devuelve el API con subtotal por línea, y se factura con `POST /api/ordenes/{id}/facturar` en vez de armar los ítems en el cliente.
- Historia clínica: se quitan "Facturar" y "Cerrar y facturar" de la consulta y se reemplazan por "Ir a la orden".

## Capabilities

### New Capabilities

- `orden-servicio-carrito`: ciclo de vida de la orden de servicio como carrito/presupuesto (alta, agregar servicios, total, confirmar con despacho por área, cerrar, facturar por orden) y su reflejo en el front como flujo principal de la app.

### Modified Capabilities

*(Ninguna: no hay specs principales en `openspec/specs/`.)*

## Impact

- Backend: `backend/app/services/orden_service.py`, `backend/app/routers/ordenes.py`, `backend/app/services/facturacion_service.py`, `backend/app/routers/facturas.py`, `backend/app/schemas/schemas.py`. En `models.py` se revierte el diff sin commitear.
- Sin migración: no hay columnas nuevas y el CHECK de estado de la orden queda como en `HEAD`.
- Frontend: `static/js/sections/facturacion.js`, `orden-abierta.js`, `consultorio.js`, `hoy.js` (total/estado), `static/js/core/router.js`.
- Tests e2e (Playwright): hay que reescribir los que dan por hecho el atajo sin área (`ordenes.spec.js:493`) y `SOLICITADO`/despacho (`despacho.spec.js:301`). Se suman escenarios de total, confirmar y facturar por orden, y hay que ajustar los tests de facturar consulta (`servicios-desde-consulta.spec.js`).
- El endpoint `POST /api/facturas/from-consulta/{id}` sigue existiendo para compatibilidad, pero el front deja de usarlo.
