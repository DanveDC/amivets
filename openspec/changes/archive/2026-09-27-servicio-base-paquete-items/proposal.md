# Proposal

## Why

- Clínicas veterinarias suelen vender "paquetes" o procedimientos base (ej. cirugía, hospitalización) que tienen un precio predefinido, pero que internamente son la suma de items/servicios asociados (materiales, medicamentos, consultas, anestesia).
- Actualmente no hay forma de distinguir visualmente en la orden/factura cuál es el "servicio base/paquete" y cuáles son los "items adicionales" anclados a ese paquete.
- El total ya se calcula correctamente (suma de cantidad × precio_unitario de todos los servicios), pero falta la estructura padre/hijo para reportes y UX.
- El usuario quiere poder elegir entre: precio base fijo del paquete, O precio base = 0 y que el total sea solo la suma de sus items asociados.

## What Changes

### Backend - Model (models.py: ServicioConsulta)
- Agregar columna `servicio_padre_id` (Integer, FK a servicios_consulta.id, nullable, index=True) — autorreferencia para jerarquía padre/hijo
- Agregar columna `es_base` (Boolean, default=False) — identifica si el servicio es el "paquete base" (True) o un item adicional (False)
- Constraint: si `es_base = True` entonces `servicio_padre_id` DEBE ser NULL
- Constraint: si `es_base = False` y `servicio_padre_id` no es NULL, el padre DEBE tener `es_base = True`
- Relaciones: `servicio_padre` (self-referential), `items_adicionales` (children)

### Backend - Schemas (schemas.py)
- `ServicioConsultaBase/Create/Update/Response`: agregar `servicio_padre_id: Optional[int]`, `es_base: bool = False`
- `OrdenServicioAnexarServicio`: agregar `servicio_padre_id: Optional[int]`, `es_base: bool = False`
- `ServicioConsultaResponse`: agregar computed fields:
  - `es_base: bool`
  - `servicio_padre_id: Optional[int]`
  - `items_adicionales_count: int` (cuenta de hijos directos)
  - `subtotal_items_adicionales: float` (suma de subtotal de hijos directos)
  - `es_item_adicional: bool` (alias de `not es_base`)

### Backend - Service (orden_service.py)
- `crear_servicio_en_orden`: aceptar `servicio_padre_id` y `es_base` del request
- Validaciones:
  - Si `es_base=True`: `servicio_padre_id` debe ser None
  - Si `servicio_padre_id` provisto: validar que el padre existe, está en la misma orden, y tiene `es_base=True`
  - Un servicio base no puede tener otro servicio base como padre
- Al crear un servicio con `servicio_padre_id`, heredar `orden_id`, `mascota_id` del padre si no se proveen

### Backend - Router (routers/ordenes.py)
- `anexar_servicio_orden`: pasar `servicio_padre_id` y `es_base` a `crear_servicio_en_orden`

### Frontend - orden-abierta.js
- En `pintarServicios`: agrupar visualmente servicios base con sus items adicionales
  - Servicio base: fila principal con estilo destacado (bold, fondo sutil)
  - Items adicionales: filas indentadas debajo del padre, con indicador visual (ej. "└─" o indentación)
  - Mostrar subtotal del paquete (base + items) y subtotal solo de items
- En `pintarResumen`: mantener total general (ya funciona), opcionalmente mostrar desglose por paquetes
- En panel "Anexar servicio": permitir marcar un servicio como "base" y seleccionar padre para items adicionales

### Frontend - facturacion.js / factura preview
- En preview de factura: mostrar desglose padre/hijo igual que en orden-abierta
- En PDF de factura: agrupar items por paquete base

### Base de datos - Migración Alembic
- ADD COLUMN `servicio_padre_id` (INTEGER, FK a servicios_consulta.id, NULLABLE, INDEX)
- ADD COLUMN `es_base` (BOOLEAN, DEFAULT FALSE, NOT NULL)
- ADD CHECK constraints para reglas de integridad

## Capabilities

### New Capabilities
- `servicio-base-paquete-items`: jerarquía padre/hijo para servicios, con distinción base/items

### Modified Capabilities
- `orden-servicio-carrito`: anexar servicios con estructura padre/hijo
- `caja-rapida` (servicio-directo): soporte para paquetes en ventas de mostrador

## Impact

- Backend: models.py (2 columnas + relationships + constraints), schemas.py (campos + computed fields), orden_service.py (validaciones), routers/ordenes.py (pass-through), migración Alembic
- Frontend: orden-abierta.js (renderizado jerárquico), facturacion.js (preview/Pdf), anexar panel (UI para crear paquetes)
- Tests: e2e/servicio-base-paquete-items.spec.js