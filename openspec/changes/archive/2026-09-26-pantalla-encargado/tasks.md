# Tasks

## 1. Búsqueda global oculta para el gestor

- [x] 1.1 Agregar `.av-search[hidden] { display: none; }` en `static/css/shell.css` y, en `static/js/core/cmdk.js`, cortar la apertura de la paleta (no solo el atajo) para los roles de `ROLES_SIN_BUSQUEDA_GLOBAL`; verificar con el test de 1.2
- [x] 1.2 Crear `e2e/pantalla-encargado.spec.js` con los escenarios de búsqueda: el gestor no ve `#cmdkTrigger` y Ctrl/Cmd+K no abre la paleta; un veterinario sí la ve y la abre; verificar que `npx playwright test e2e/pantalla-encargado.spec.js` pasa

## 2. Rubro del encargado

- [x] 2.1 Agregar `area_id` a `ServicioConsultaResponse` y `GET /api/areas/mias` (cualquier usuario autenticado, solo sus áreas activas) en `backend/app/routers/areas.py`; verificar con los tests de 2.3
- [x] 2.2 En `bandeja-gestor.js`: cabecera "Tu rubro" desde `/areas/mias`, chips por `area_id` de sus áreas (visibles con la bandeja vacía), aviso si no tiene áreas, y `escapeHtml` en todo texto del servidor; verificar con los tests de 2.3
- [x] 2.3 Sumar a `e2e/pantalla-encargado.spec.js`: `/areas/mias` devuelve solo lo propio; la UI muestra el nombre del área con la bandeja vacía y el aviso sin áreas; un servicio con nombre HTML se muestra literal; verificar que el spec pasa

## 3. Historial de lo realizado

- [x] 3.1 Agregar `ServicioRealizadoResponse` y `GET /api/servicios/realizados?desde=&hasta=&area_id=` (gestor/veterinario: lo propio en `EJECUTADO`, por `ejecutado_at`, sin N+1, límite 200, área ajena 403) en `backend/app/routers/servicios.py`; verificar con los tests de 3.3
- [x] 3.2 Agregar al markup de `sec-bandeja-gestor` las pestañas Bandeja / Realizados / Mis comisiones y, en `bandeja-gestor.js`, la vista Realizados (rango, chip de área, tabla, detalle con adjuntos descargables y aviso de límite); verificar con los tests de 3.3
- [x] 3.3 Sumar a `e2e/pantalla-encargado.spec.js`: realizados propios ordenados, ajenos excluidos, filtro de rango y área, área ajena 403; UI: un servicio ejecutado con adjunto aparece en Realizados y el adjunto se descarga; verificar que el spec pasa

## 4. Mis comisiones

- [x] 4.1 Agregar `GET /api/comisiones/mias/liquidaciones` (veterinario/gestor, solo lo propio) en `backend/app/routers/comisiones.py`; verificar con los tests de 4.3
- [x] 4.2 Implementar la vista "Mis comisiones" en `bandeja-gestor.js` (rango, pendientes y liquidadas con totales, lista de liquidaciones con descarga del PDF); verificar con los tests de 4.3
- [x] 4.3 Sumar a `e2e/pantalla-encargado.spec.js`: `/mias/liquidaciones` propio, ajeno excluido y 403 para recepcionista; UI: el gestor ve su línea pendiente y descarga el PDF de su liquidación; verificar que el spec pasa

## 5. Integración

- [x] 5.1 Correr la suite e2e completa en dos tandas y verificar que no hay regresiones (sobre todo `despacho.spec.js`, `shell.spec.js` y `comisiones.spec.js`); después limpiar los datos `PWTEST_*` que deje la suite, con backup previo, para no ensuciar la base con datos reales
