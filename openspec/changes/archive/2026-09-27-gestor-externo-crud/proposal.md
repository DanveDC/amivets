# Proposal

## Why

- El sistema actual solo tiene gestores internos (usuarios con rol `gestor` o `veterinario` con fila en `gestor_area`) que atienden servicios despachados a áreas.
- Existen casos donde el trabajo se deriva a proveedores/gestores externos (laboratorios de referencia, imágenes externas, especialistas) que no son usuarios del sistema pero necesitan recibir notificaciones, ver su bandeja de trabajo y reportar resultados.
- No hay forma de registrar datos de pago/bancarios (RIF, teléfono, método de pago, número de cuenta, Zelle) para estos gestores externos.
- El admin necesita CRUD completo para gestionar estos gestores externos y asignarlos a áreas de servicio.

## What Changes

- **Nueva tabla `gestor_externo`**: `id`, `rif` (unique), `telefono`, `metodo_pago`, `numero_cuenta` (nullable), `es_movil` (default false), `zelle` (nullable), `usuario_id` (FK nullable a `usuarios.id` para vincular opcionalmente a un usuario del sistema).
- **Tabla pivote `gestor_area_externo`**: relación N:M entre `gestor_externo` y `areas_servicio` con `created_at` para auditoría.
- **Modelos SQLAlchemy**: `GestorExterno`, `GestorAreaExterno` en `models.py`.
- **Schemas Pydantic**: `GestorExternoCreate`, `GestorExternoUpdate`, `GestorExternoResponse` en `schemas.py`.
- **Router CRUD**: `GET/POST/PATCH/DELETE /api/gestores-externos/`, `GET/POST/DELETE /api/gestores-externos/{id}/areas`, protegidos con `require_roles("admin")`.
- **Migración Alembic**: crear ambas tablas con índices, FKs, constraints.

## Capabilities

### New Capabilities
- `gestor-externo-crud`: gestión completa de gestores externos, asignación a áreas, datos de pago/bancarios.

### Modified Capabilities
- `areas-y-gestores`: la pantalla de "Áreas y gestores" podrá mostrar/gestionar gestores externos además de los internos.

## Impact

- Backend: `models.py` (2 nuevos modelos), `schemas.py` (3 schemas), `routers/areas.py` o nuevo `routers/gestores_externos.py` (endpoints CRUD), migración Alembic.
- Frontend: `areas-gestores.js` (nueva pestaña/sección para gestores externos, formularios, tabla).
- Tests: `e2e/gestor-externo-crud.spec.js`.