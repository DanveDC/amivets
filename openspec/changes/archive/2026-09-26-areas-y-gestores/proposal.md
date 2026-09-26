# Proposal

## Why

Para que un encargado reciba y cargue el trabajo de su rubro hace falta: crear su cuenta con rol de gestor, definir las áreas (laboratorio, imagenología, estética…), decir qué gestor atiende cada área y qué servicios del catálogo despacha cada una, y qué dato exige al cargar el resultado. Hoy el backend lo soporta, pero no hay ninguna pantalla: el formulario de usuarios ni siquiera ofrece el rol "Gestor" (ni "Recepcionista").

## What Changes

- El alta y la edición de usuarios ofrecen los roles "Recepcionista" y "Gestor de área".
- Nueva sección "Áreas y gestores" (módulo Servicios, solo admin):
  - crear, editar y desactivar áreas (nombre, código, si exige adjunto al cargar el resultado);
  - asignar y quitar gestores de cada área;
  - ver y asignar los servicios del catálogo que despacha cada área.
- Con esto, al confirmar una orden el servicio va a la bandeja de los gestores de su área, y al cargar el resultado se exige el adjunto según el área o el servicio.

## Capabilities

### New Capabilities
- `areas-y-gestores`: administración de áreas, gestores y servicios despachados, y roles de usuario completos.

### Modified Capabilities
*(Ninguna.)*

## Impact

- Frontend: nueva `static/js/sections/areas.js`, sección `sec-areas` en `index.html`, `router.js`, `usuarios.js` (roles), `index.html` (select de rol).
- Backend: `GET /api/areas/{id}/gestores` para listar gestores de un área (hoy no existe listado).
- Test: `e2e/areas-y-gestores.spec.js`.
