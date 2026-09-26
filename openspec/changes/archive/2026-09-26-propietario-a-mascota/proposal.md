# Proposal

## Why

Al crear un propietario, la recepción casi siempre necesita cargar su mascota a continuación, pero hoy tiene que cerrar, ir a otra pantalla y buscar al propietario recién creado.

## What Changes

- Al guardar un propietario nuevo, se abre directamente el formulario de alta de mascota con ese propietario ya elegido.

## Capabilities

### New Capabilities
- `propietario-a-mascota`: continuidad del alta de propietario al alta de su mascota.

### Modified Capabilities
*(Ninguna.)*

## Impact

- `static/js/sections/propietarios.js`, `static/js/sections/consultorio.js` (apertura del modal de mascota con propietario preseleccionado).
- Test: `e2e/propietario-a-mascota.spec.js`.
