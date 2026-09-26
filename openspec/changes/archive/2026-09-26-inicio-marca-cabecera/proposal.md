# Proposal

## Why

La pantalla de inicio no muestra la identidad de la clínica: no aparece el logo ni el nombre del sistema. Además, la cabecera superior del lanzador queda con el título y el subtítulo de la última sección visitada (por ejemplo "Panel del día · Sábado, 26 de septiembre"), porque el router no la actualiza al volver al inicio.

## What Changes

- La pantalla de inicio muestra el logo de AmiVets y el texto "AMIVETS · Sistema integral de gestión".
- Al entrar al inicio, la cabecera muestra "AMIVETS" y "Sistema integral de gestión", y nunca el texto de otra sección.
- La marca de la barra lateral dice "Sistema integral de gestión".

## Capabilities

### New Capabilities
- `inicio-marca`: identidad visible en la pantalla de inicio y cabecera sin textos de otras secciones.

### Modified Capabilities
*(Ninguna.)*

## Impact

- `static/js/core/router.js` (`syncHeaderTitle`), `static/js/sections/inicio.js` y `static/templates/index.html` (encabezado del lanzador), `static/css/shell.css`.
- Test: `e2e/inicio-marca.spec.js`.
