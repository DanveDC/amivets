# caja-rapida Specification (Delta)

## Purpose
Renombrar completamente la funcionalidad "caja rápida" a "servicio directo" en rutas API, schemas, tags, archivos y frontend, manteniendo idéntica la lógica de negocio.

## Requirements

### Requirement: Rutas API renombradas

El router SHALL exponer los endpoints bajo el nuevo prefijo `/api/servicio-directo/` con tag `"Servicio directo"`.

#### Scenario: POST venta directa
- **WHEN** se envía `POST /api/servicio-directo/ventas` con body válido
- **THEN** respuesta 201 con `FacturaResponse` (misma estructura que antes)
- **AND** la orden se crea con `origen = "CAJA_RAPIDA"` (valor sin cambios)

#### Scenario: GET items vendibles
- **WHEN** se consulta `GET /api/servicio-directo/items?q=texto`
- **THEN** respuesta 200 con lista de `ItemServicioDirectoResponse` (misma estructura que `ItemCajaResponse`)

#### Scenario: Rutas antiguas ya no existen
- **WHEN** se consulta `GET /api/caja-rapida/items` o `POST /api/caja-rapida/ventas`
- **THEN** respuesta 404 (ruta no encontrada)

### Requirement: Schemas renombrados

Los schemas Pydantic SHALL renombrarse manteniendo campos y validaciones idénticas.

#### Schema: VentaDirectaItem (antes VentaRapidaItem)
- `tipo: Literal["PRODUCTO", "SERVICIO"]` — **sin cambios en valores**
- `id: int (gt=0)`
- `cantidad: int (ge=1)`
- `precio_unitario: Optional[float]`

#### Schema: VentaDirectaCreate (antes VentaRapidaCreate)
- `propietario_id: Optional[int] (gt=0)`
- `metodo_pago: Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MULTIPLE"]`
- `items: List[VentaDirectaItem] (min_length=1)`

#### Schema: ItemServicioDirectoResponse (antes ItemCajaResponse)
- `tipo: Literal["PRODUCTO", "SERVICIO"]`
- `id: int`
- `nombre: str`
- `codigo: Optional[str]`
- `precio: float`
- `precio_variable: bool`
- `stock: Optional[float]`

### Requirement: Origen de orden sin cambios

El campo `origen` en `OrdenServicio` para ventas directas SHALL seguir siendo `"CAJA_RAPIDA"`: el cambio es solo de nombre y sección, y `facturacion_service` usa ese valor al anular.

#### Scenario: Orden creada por venta directa
- **WHEN** se registra una venta vía `POST /api/servicio-directo/ventas`
- **THEN** la `OrdenServicio` resultante tiene `origen = "CAJA_RAPIDA"`
- **AND** `estado = "FACTURADA"`, `mascota_id = NULL`

### Requirement: Frontend actualizado

La sección frontend SHALL usar las nuevas rutas y renombrar IDs DOM.

#### Navegación y sección
- Section ID: `'sec-servicio-directo'` (antes `'sec-caja-rapida'`)
- Label en menú: `'Servicio directo'` (antes `'Caja rápida'`)
- Módulo Facturación (num 5): incluye `'sec-servicio-directo'` en `sectionIds`

#### Endpoints consumidos
- `GET /api/servicio-directo/items?q=...` (antes `/caja-rapida/items`)
- `POST /api/servicio-directo/ventas` (antes `/caja-rapida/ventas`)

#### IDs DOM (prefijo `servicioDirecto`)
- Buscador: `servicioDirectoBuscar` (antes `cajaBuscar`)
- Tabla resultados: `servicioDirectoResultadosBody` (antes `cajaResultadosBody`)
- Tabla carrito: `servicioDirectoCarritoBody` (antes `cajaCarritoBody`)
- Total: `servicioDirectoTotal` (antes `cajaTotal`)
- Botón cobrar: `btnServicioDirectoEmitir` (antes `btnCajaCobrar`; `btnServicioDirectoCobrar` ya lo usa el modal de servicio directo)
- Botón nueva: `btnServicioDirectoNueva` (antes `btnCajaNueva`)
- Botón PDF: `btnServicioDirectoPdf` (antes `btnCajaPdf`)
- Sección venta: `servicioDirectoVenta` (antes `cajaVenta`)
- Confirmación: `servicioDirectoConfirmacion` (antes `cajaConfirmacion`)
- Número factura: `servicioDirectoFacturaNumero` (antes `cajaFacturaNumero`)
- Total factura: `servicioDirectoFacturaTotal` (antes `cajaFacturaTotal`)

#### Función de inicialización
- Export: `initServicioDirecto` (antes `initCajaRapida`)

### Requirement: Tests E2E actualizados

Los tests E2E SHALL usar las nuevas rutas, section IDs y helpers renombrados.

#### Archivo de test
- `e2e/servicio-directo.spec.js` (antes `e2e/caja-rapida.spec.js`)

#### Helpers (`e2e/helpers.js`)
- `cobrarServicioDirecto(request, body, token)` (antes `ventaRapida`)
- `buscarItemsServicioDirecto(request, q, token)` (antes `buscarItemsCaja`)

#### Selectores y URLs
- `page.locator('#sec-servicio-directo')`
- URLs incluyen `/api/servicio-directo/ventas` y `/api/servicio-directo/items`

### Requirement: Mensajes y documentación

Todos los mensajes de error, docstrings y comentarios SHALL usar "servicio directo" en lugar de "caja rápida".

#### Mensajes de error actualizados
- "El servicio {nombre} tiene área de despacho: se vende con una orden, no en caja rápida."
  → "El servicio {nombre} tiene área de despacho: se vende con una orden, no en servicio directo."

#### Docstrings
- Router: "Servicio directo: venta de mostrador sin registrar cliente"
- Servicio: "Servicio directo: venta de mostrador sin registrar cliente"
- Schemas: "Body de POST /api/servicio-directo/ventas...", "Resultado de GET /api/servicio-directo/items..."