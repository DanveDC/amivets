# Design

## Context

- `CatalogoServicio` tiene `nombre`, `categoria`, `precio_ref`, `precio_variable`, `area_id`, `requiere_adjunto` y recetas (`RecetaServicio`: material + cantidad en unidad base). El detalle ya permite sumar, editar y quitar insumos.
- `CatalogoServicioCreate/Update` ya aceptan `area_id` y `requiere_adjunto`; el modal no los manda.
- `Inventario`: `precio_unitario` es el precio del envase; con `contenido_por_envase` (ml/g) el precio por unidad base es `precio_unitario / contenido_por_envase` (sin contenido, 1 unidad = 1 envase).
- `PUT /catalogo/{id}` con otro `precio_ref` registra el cambio en el historial (con motivo opcional).

## Decisions

1. **Categoría:** el select suma la opción "Otra…" que muestra un input; se manda el texto en mayúsculas.
2. **Área y adjunto:** el modal suma un select de área (`/areas/`, admin) con "Sin despacho", y un select de adjunto (Heredar del área / Sí / No → `null`/`true`/`false`).
3. **Costo:** `GET /api/catalogo/{id}/costo` (roles de lectura del catálogo) devuelve `{total, lineas:[{inventario_id, nombre, cantidad, unidad, costo_unitario, subtotal}]}`, redondeado a 2 decimales.
4. **Precio base:** el detalle muestra el costo y el botón hace `PUT` con `precio_ref = total` y motivo "Precio base desde costo de insumos".

## Risks / Trade-offs

- [Costo = precio de lista] El sistema no guarda un costo de compra aparte; se usa el precio de lista del material. Se aclara en la pantalla.
