# Design

## Context

- API de áreas (admin): `POST /api/areas/`, `GET /api/areas/`, `PUT /api/areas/{id}`, `POST /api/areas/{id}/gestores` (`usuario_id`), `DELETE /api/areas/{id}/gestores/{usuario_id}`. No hay listado de gestores de un área.
- El catálogo acepta `area_id` en `PUT /api/catalogo/{id}` (admin/veterinario).
- `AreaServicio.requiere_adjunto` y `CatalogoServicio.requiere_adjunto` ya gobiernan el candado de adjunto al ejecutar.
- `usuarios.js` / modal de usuario: el select de rol solo tiene user/veterinario/admin.

## Decisions

1. **Roles:** el select de rol del alta y de la edición suma "Recepcionista" y "Gestor de área".
2. **Listado de gestores:** `GET /api/areas/{id}/gestores` (admin) devuelve `[{usuario_id, username, role}]`.
3. **Sección `sec-areas`** ("Áreas y gestores", módulo Servicios, solo admin, `areas.js`): lista de áreas a la izquierda; a la derecha, el área elegida con su formulario (nombre, código, adjunto, activa), sus gestores (select de usuarios activos gestor/veterinario + quitar) y sus servicios (lista + select de servicios del catálogo sin área para asignar, y quitar = `area_id` null). Todo texto del servidor escapado.

## Risks / Trade-offs

- [Mover un servicio de área] Asignar un servicio a otra área no cambia los servicios ya despachados (el área se copia al anexar). Es el comportamiento existente del modelo.
