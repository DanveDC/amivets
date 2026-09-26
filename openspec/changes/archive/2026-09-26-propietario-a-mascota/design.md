# Design

## Context

`propietarios.js::handlePropietarioSubmit` crea el propietario y cierra el modal. El alta de mascota vive en `consultorio.js` (modal con select `#mascotaPropietarioId` que se llena con `/propietarios/`).

## Decisions

1. `consultorio.js` exporta `abrirNuevaMascotaParaPropietario(propietarioId)`: llena el select (con todos los propietarios activos), preselecciona el nuevo y abre el modal.
2. `handlePropietarioSubmit`, al crear (no al editar), cierra su modal y llama a esa función con el id devuelto por el API.

## Risks / Trade-offs

- Ninguno relevante.
