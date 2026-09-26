# Proposal

## Why

El encargado de un área (rol `gestor`) ya entra directo a "Mi bandeja" y solo ve esa pantalla, pero le faltan cuatro cosas para que sea de verdad "su" pantalla de trabajo:

1. **Ve un buscador global que no le corresponde.** El botón "Buscar mascota o tutor" debería estar oculto para el gestor, pero la regla CSS `.av-search { display: flex }` le gana al atributo `hidden`. Además, al hacer clic en el botón la búsqueda se abre, porque solo está bloqueado el atajo Ctrl+K.
2. **No ve lo que ya hizo.** Cuando un servicio pasa a Ejecutado desaparece de la bandeja, y no hay historial ni forma de volver a ver un resultado ya cargado.
3. **No se muestra su rubro.** El gestor recibe 403 en `/api/areas/`, así que los nombres de área salen como "Área #N". Los chips por área solo aparecen si hay servicios pendientes.
4. **No ve sus comisiones.** `GET /api/comisiones/mias` existe, pero no tiene pantalla, y el encargado no puede listar sus liquidaciones.

## What Changes

- **Búsqueda global oculta de verdad para el gestor:** el botón no se ve y, si se intenta abrir por cualquier camino, no se abre.
- **Rubro visible:** nuevo `GET /api/areas/mias` (las áreas activas del usuario). La cabecera de la bandeja muestra sus áreas por nombre y los chips salen de esas áreas, aunque la bandeja esté vacía. La respuesta de servicio suma `area_id` (campo nuevo, opcional, no rompe nada).
- **Historial de lo realizado:** nuevo `GET /api/servicios/realizados?desde=&hasta=&area_id=`, con los servicios que el usuario ejecutó (área, paciente, orden, fecha de ejecución y cantidad de adjuntos). En la bandeja se suma una pestaña "Realizados", con rango de fechas y la opción de ver y descargar los adjuntos de cada servicio.
- **Mis comisiones:** pestaña "Mis comisiones" en la bandeja (gestor y veterinario), con lo pendiente y lo liquidado en el rango y sus totales. Nuevo `GET /api/comisiones/mias/liquidaciones` para listar sus liquidaciones y descargar cada comprobante PDF (el PDF ya permite al dueño).
- **Seguridad:** la bandeja escapa los textos que vienen del servidor (nombre de área, servicio y paciente); hoy los inserta sin escapar.

## Capabilities

### New Capabilities
- `pantalla-encargado`: la pantalla de trabajo del encargado de área: su rubro, su bandeja, el historial de lo realizado, sus comisiones, y la restricción de búsqueda global.

### Modified Capabilities
- `comisiones-servicio`: se agrega un requisito para que el encargado liste sus propias liquidaciones.

## Impact

- **Backend:**
  - `routers/areas.py`: `GET /mias`.
  - `routers/servicios.py`: `GET /realizados`.
  - `routers/comisiones.py`: `GET /mias/liquidaciones`.
  - `schemas.py`: `area_id` en `ServicioConsultaResponse` y un schema para los servicios realizados.
  - Sin migración.
- **Frontend:**
  - `static/css/shell.css`: `.av-search[hidden]`.
  - `static/js/core/cmdk.js`: chequeo de rol al abrir.
  - `static/js/sections/bandeja-gestor.js` y el markup de `sec-bandeja-gestor` en `index.html`: pestañas Bandeja / Realizados / Mis comisiones, cabecera con rubro y escape.
- **Tests:** nuevo `e2e/pantalla-encargado.spec.js`; revisar `e2e/despacho.spec.js` y `e2e/shell.spec.js` por la bandeja.
