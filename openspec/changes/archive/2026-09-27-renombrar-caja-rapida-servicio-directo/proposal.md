# Proposal

## Why

- El término "caja rápida" es confuso y no refleja la funcionalidad real: ventas de mostrador de productos y servicios sin área de despacho.
- "Servicio directo" es el término técnico correcto usado en el dominio (orden de servicio directa, sin paciente/consulta).
- Consistencia con `ServicioConsulta` (modelo) y `crear_servicio_directo` (endpoint en `routers/servicios.py`).
- La lógica de negocio, validaciones y flujo son correctos; solo se renombra para claridad.

## What Changes

### Backend (Python)

**Archivos a renombrar:**
- `backend/app/routers/caja_rapida.py` → `backend/app/routers/servicio_directo.py`
- `backend/app/services/caja_rapida_service.py` → `backend/app/services/servicio_directo_service.py`

**Router (`servicio_directo.py`):**
- `prefix="/api/caja-rapida"` → `prefix="/api/servicio-directo"`
- `tags=["Caja rápida"]` → `tags=["Servicio directo"]`
- Endpoints: `/ventas` y `/items` se mantienen igual
- `_ROLES_CAJA` → `_ROLES_SERVICIO_DIRECTO` (mismos roles: admin, recepcionista)

**Servicio (`servicio_directo_service.py`):**
- `ORIGEN = "CAJA_RAPIDA"` → `ORIGEN = "SERVICIO_DIRECTO"`
- Función `registrar_venta` → `registrar_venta_directa` (opcional, mantener compatibilidad)
- Docstrings y comentarios: "caja rápida" → "servicio directo"
- Mensajes de error: "caja rápida" → "servicio directo"

**Schemas (`schemas.py`):**
- `VentaRapidaItem` → `VentaDirectaItem` (campo `tipo` mantiene `Literal["PRODUCTO", "SERVICIO"]`)
- `VentaRapidaCreate` → `VentaDirectaCreate`
- `ItemCajaResponse` → `ItemServicioDirectoResponse`
- Docstrings: "caja rápida" → "servicio directo"

**Main (`main.py`):**
- Import: `from app.routers import ..., servicio_directo`
- `app.include_router(servicio_directo.router)`

### Frontend (JavaScript)

**Archivo a renombrar:**
- `static/js/sections/caja-rapida.js` → `static/js/sections/servicio-directo.js`

**Router (`static/js/core/router.js`):**
- Import: `initCajaRapida` → `initServicioDirecto` from `'../sections/servicio-directo.js'`
- Section ID: `'sec-caja-rapida'` → `'sec-servicio-directo'`
- Label: `'Caja rápida'` → `'Servicio directo'`
- Module 5 (Facturación): `sectionIds` incluye `'sec-servicio-directo'`

**Servicio Directo (`servicio-directo.js`):**
- Endpoints: `/caja-rapida/items` → `/servicio-directo/items`, `/caja-rapida/ventas` → `/servicio-directo/ventas`
- DOM IDs: `cajaBuscar`, `cajaResultadosBody`, `cajaCarritoBody`, `cajaTotal`, `btnCajaCobrar`, `btnCajaNueva`, `btnCajaPdf`, `cajaVenta`, `cajaConfirmacion`, `cajaFacturaNumero`, `cajaFacturaTotal` → prefijo `servicioDirecto` (ej: `servicioDirectoBuscar`, `servicioDirectoResultadosBody`, etc.)
- Variables internas: `_carrito` se mantiene, funciones `buscar`, `pintarResultados`, `agregar`, `cobrar`, `nuevaVenta`, `wire`, `initServicioDirecto`
- Comentarios y strings: "caja rápida" → "servicio directo", "venta de mostrador" se mantiene

### Tests E2E
- `e2e/caja-rapida.spec.js` → `e2e/servicio-directo.spec.js`
- `e2e/helpers.js`: funciones `cobrarCajaRapida` → `cobrarServicioDirecto`, `buscarItemsCajaRapida` → `buscarItemsServicioDirecto`
- URLs: `/api/caja-rapida/` → `/api/servicio-directo/`
- Sección: `sec-caja-rapida` → `sec-servicio-directo`

### Documentación/Comentarios
- Todos los docstrings, comentarios y mensajes de error que mencionen "caja rápida" → "servicio directo"

## Capabilities

### Modified Capabilities
- `caja-rapida` → `servicio-directo`: renombrado completo de rutas, schemas, tags, archivos y frontend

## Impact

- **Breaking change**: URLs de API cambian (`/api/caja-rapida/` → `/api/servicio-directo/`)
- Frontend consume nuevas URLs
- Schemas de request/response cambian nombres (campos internos iguales)
- Tests E2E actualizados
- No hay cambios en lógica de negocio, base de datos, ni validaciones