# Tasks

## 1. Backend - Archivos y Router

- [x] 1.1 Renombrar `backend/app/routers/caja_rapida.py` → `backend/app/routers/servicio_directo.py`
- [x] 1.2 En `servicio_directo.py`:
  - Cambiar `prefix="/api/caja-rapida"` → `prefix="/api/servicio-directo"`
  - Cambiar `tags=["Caja rápida"]` → `tags=["Servicio directo"]`
  - Cambiar `_ROLES_CAJA` → `_ROLES_SERVICIO_DIRECTO`
  - Renombrar función `registrar_venta` → `registrar_venta_directa`
  - Actualizar docstrings y comentarios: "caja rápida" → "servicio directo"
- [x] 1.3 Renombrar `backend/app/services/caja_rapida_service.py` → `backend/app/services/servicio_directo_service.py`
- [x] 1.4 En `servicio_directo_service.py`:
  - Mantener `ORIGEN = "CAJA_RAPIDA"` (solo cambio de nombre y sección: `facturacion_service` usa ese valor para anular estas ventas)
  - Renombrar `registrar_venta` → `registrar_venta_directa`
  - Actualizar docstrings, comentarios y mensaje de error (línea 150-152): "caja rápida" → "servicio directo"
  - Actualizar imports relativos si los hay
- [x] 1.5 En `backend/app/main.py`:
  - Cambiar import: `from app.routers import ..., servicio_directo`
  - Cambiar `app.include_router(caja_rapida.router)` → `app.include_router(servicio_directo.router)`

## 2. Backend - Schemas

- [x] 2.1 En `backend/app/schemas/schemas.py` (líneas 740-785):
  - Renombrar `VentaRapidaItem` → `VentaDirectaItem` (mantener campo `tipo: Literal["PRODUCTO", "SERVICIO"]`)
  - Renombrar `VentaRapidaCreate` → `VentaDirectaCreate`
  - Renombrar `ItemCajaResponse` → `ItemServicioDirectoResponse`
  - Actualizar docstrings: "caja rápida" → "servicio directo", referencias a endpoints
  - Actualizar referencias en `ServicioRealizadoResponse` si las hay (línea 760)

## 3. Backend - Service imports

- [x] 3.1 En `servicio_directo.py`: cambiar import `from app.services import caja_rapida_service` → `from app.services import servicio_directo_service`
- [x] 3.2 Actualizar llamadas: `caja_rapida_service.registrar_venta` → `servicio_directo_service.registrar_venta_directa`, idem `buscar_items`

## 4. Frontend - Archivo principal

- [x] 4.1 Renombrar `static/js/sections/caja-rapida.js` → `static/js/sections/servicio-directo.js`
- [x] 4.2 En `servicio-directo.js`:
  - Endpoints: `/caja-rapida/items` → `/servicio-directo/items`, `/caja-rapida/ventas` → `/servicio-directo/ventas`
  - Renombrar todos los IDs DOM: `caja*` → `servicioDirecto*` (Buscar, ResultadosBody, CarritoBody, Total, btnEmitir — `btnServicioDirectoCobrar` ya existe en el modal de servicio directo de `hoy.js` —, btnNueva, btnPdf, Venta, Confirmacion, FacturaNumero, FacturaTotal)
  - Renombrar `data-caja-*` attributes → `data-servicio-directo-*`
  - Comentarios y strings: "caja rápida" → "servicio directo"
  - Export: `initServicioDirecto` (antes `initCajaRapida`)
  - Funciones internas: mantener nombres (`buscar`, `pintarResultados`, `agregar`, `cobrar`, `nuevaVenta`, `wire`) o renombrar con prefijo para claridad

## 5. Frontend - Router

- [x] 5.1 En `static/js/core/router.js`:
  - Import: `import { initServicioDirecto } from '../sections/servicio-directo.js';`
  - Section: `{ id: 'sec-servicio-directo', label: 'Servicio directo', tab: true, init: initServicioDirecto, roles: ['admin', 'recepcionista'] }`
  - Módulo 5 (Facturación): `sectionIds: ['sec-facturacion', 'sec-servicio-directo']`
  - CTA: `'sec-servicio-directo': 'Vende en el mostrador sin registrar al cliente'`

## 6. Frontend - HTML (index.html)

- [x] 6.1 Verificar que los elementos DOM en `index.html` tengan los nuevos IDs (`servicioDirectoBuscar`, `servicioDirectoResultadosBody`, etc.) o que el JS los cree dinámicamente
- [x] 6.2 Si hay template HTML estático para la sección, actualizar IDs

## 7. Tests E2E

- [x] 7.1 Renombrar `e2e/caja-rapida.spec.js` → `e2e/servicio-directo.spec.js`
- [x] 7.2 En `servicio-directo.spec.js`:
  - `await gotoSection(page, 'sec-servicio-directo')`
  - `page.locator('#sec-servicio-directo')`
  - URLs: `/api/servicio-directo/ventas`, `/api/servicio-directo/items`
  - Selectores DOM: nuevos IDs
- [x] 7.3 En `e2e/helpers.js`:
  - Renombrar `ventaRapida` → `cobrarServicioDirecto` (endpoint `/api/servicio-directo/ventas`); actualizar también `e2e/regresiones-revision.spec.js`
  - Renombrar `buscarItemsCaja` → `buscarItemsServicioDirecto` (endpoint `/api/servicio-directo/items`)
  - Actualizar JSDoc/comentarios

## 8. Verificación y Tests

- [x] 8.1 Verificar que el backend arranca sin errores: `cd backend && python -m app.main` (o `uvicorn app.main:app`)
- [x] 8.2 Verificar OpenAPI docs en `/docs`: endpoints bajo `/api/servicio-directo/`, schemas `VentaDirectaItem`, `VentaDirectaCreate`, `ItemServicioDirectoResponse`
- [x] 8.3 Probar flujo completo manual:
  - Ir a sección "Servicio directo" en frontend
  - Buscar producto/servicio
  - Agregar al carrito
  - Cobrar con método de pago
  - Verificar factura emitida y orden con `origen = "CAJA_RAPIDA"` (cubierto por e2e)
- [x] 8.4 Correr tests E2E: `npx playwright test e2e/servicio-directo.spec.js`
- [x] 8.5 Verificar que no quedan referencias a "caja_rapida" o "caja-rapida" en código (grep)

## 9. Limpieza (opcional)

- [x] 9.1 Eliminar archivo `backend/app/routers/caja_rapida.py` original (ya renombrado)
- [x] 9.2 Eliminar archivo `backend/app/services/caja_rapida_service.py` original
- [x] 9.3 Eliminar archivo `static/js/sections/caja-rapida.js` original
- [x] 9.4 Eliminar archivo `e2e/caja-rapida.spec.js` original