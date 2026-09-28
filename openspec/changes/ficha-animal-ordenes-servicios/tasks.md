# Tasks

## 1. HTML Template (static/templates/index.html)

- [ ] 1.1 NO IMPLEMENTADO (fuera de scope de esta sesión). Reemplazar `consultorio-layout` por dos vistas mutuamente excluyentes (lista / ficha a ancho completo) requiere reescribir la navegación de `consultorio.js` (bloque 3) desde cero, con riesgo real de romper el layout de 2 columnas actual (sidebar + panel) que ya usan ~15 e2e specs. Se mantuvo el layout actual (sidebar + `patientWrapper`/`emptyPatientWrapper`) sin tocar. Recomendado como sesión de apply separada.
- [x] 1.2 Agregado `#fichaNuevaOrdenPanel` (panel inline, NO modal) dentro de `sec-consultorio`, hermano de `pet-layout`. Evidencia: `static/templates/index.html`, e2e `ficha-animal-ordenes-servicios.spec.js` ("crear una orden desde el panel inline...") pasa.
- [x] 1.3 N/A — confirmado que `#modalConsulta`/`#modalCita` son divs de nivel superior (líneas ~320/400), no anidados en `sec-consultorio`; no se tocaron.
- [ ] 1.4 NO IMPLEMENTADO — depende de 1.1 (no hay Vista 1/Vista 2, `patientWrapper` sigue siendo el nombre real en el DOM y en el código).
- [ ] 1.5 PARCIAL — no se agregaron las clases `ficha-layout`/`ficha-header`/`ficha-tabs`/`ficha-tab`/`ficha-content` (dependen de 1.1). Sí se agregó `.ficha-nueva-orden-panel` y sus subclases (`.ficha-nop-head/-body/-actions`) para el panel de 1.2.

## 2. CSS (static/css/ o inline en template)

- [ ] 2.1 NO IMPLEMENTADO — depende de 1.1 (no existe `ficha-layout`/`ficha-tabs` nuevos; se sigue usando `.pet-layout`/`.pet-sidebar` existentes).
- [ ] 2.2 NO IMPLEMENTADO — el header de ficha (`.pet-content-header`) no se rediseñó, sólo se le agregó el botón "+ Orden de servicio" (ver 1.2/4.3).
- [ ] 2.3 NO IMPLEMENTADO — depende de 1.1.
- [x] 2.4 PARCIAL — la tabla del nuevo tab "Órdenes de servicio" reusa `.consultas-table` + los `.serv-filtro-*` ya existentes (mismo patrón que el tab Servicios); se agregó `.status-pill--info` para el badge EN_ATENCION. No se creó una clase `.ficha-table` nueva porque no hizo falta.
- [ ] 2.5 NO IMPLEMENTADO — tabs Resumen/Facturación/Notas no se rediseñaron esta sesión.
- [ ] 2.6 NO IMPLEMENTADO — no se tocó el responsive del layout de la ficha (depende de 1.1).

## 3. Frontend - consultorio.js (State & Navigation)

Grupo NO IMPLEMENTADO (mismo motivo que 1.1): el estado de dos vistas es la pieza más grande y riesgosa del cambio original y se descartó esta sesión para no comprometer el resto (que ya funciona y está probado). Ver "Open questions" en el reporte final.

- [ ] 3.1 NO IMPLEMENTADO.
- [ ] 3.2 NO IMPLEMENTADO.
- [ ] 3.3 NO IMPLEMENTADO.
- [ ] 3.4 NO IMPLEMENTADO — `seleccionarMascota()` sigue mostrando `patientWrapper` directamente, sin cambios de fondo (sólo se le quitó el wiring de `abrirFormularioConsulta`, ver 8.1).
- [ ] 3.5 NO IMPLEMENTADO.
- [ ] 3.6 NO IMPLEMENTADO — sigue existiendo `switchPetTab(tabName)` (el mecanismo de tabs preexistente), al que se le agregó el caso `ordenes` (ver 5.2).

## 4. Frontend - consultorio.js (Header de Ficha)

- [ ] 4.1 NO IMPLEMENTADO — el header (`renderFichaHeader` no existe como tal) no se tocó; sigue siendo el HTML+JS preexistente en `seleccionarMascota()`.
- [ ] 4.2 NO IMPLEMENTADO ("Volver a la lista"/"Ver tutor" dependen de 1.1/3.x). Editar/Transferir/Eliminar ya estaban wireados antes de este cambio y siguen funcionando sin modificación (no era trabajo nuevo de este bloque).
- [x] 4.3 Botón "+ Orden de servicio" en header → `abrirPanelNuevaOrden()`. Evidencia: `#btnFichaNuevaOrden` wireado a nivel de módulo en `consultorio.js`; e2e "no hay botón de Agregar consulta..." y "crear una orden..." pasan.

## 5. Frontend - consultorio.js (Tabs Content)

### 5.1 Tab Resumen
- [ ] 5.1.1 NO IMPLEMENTADO — el tab Resumen sigue siendo el existente (historia + constantes + peso), sin las cards nuevas de última orden/próxima cita/totales acumulados.
- [ ] 5.1.2 NO IMPLEMENTADO (depende de 5.1.1).

### 5.2 Tab Órdenes de servicio (reemplaza el tab `consultas`)
- [x] 5.2.1 Implementado `cargarOrdenesTab()`: fetch a `GET /api/ordenes/?mascota_id={id}&limit=200` con filtros server-side (usa `search` de 9.1), tabla con columnas Orden/Estado/Fecha/Veterinario/Total/Acciones. Guard de generación (`_ordenesTabGen`) contra respuestas viejas al cambiar de tab/paciente rápido. Evidencia: `consultorio.js`, e2e "el tab Órdenes de servicio muestra las órdenes..." pasa.
- [x] 5.2.2 Filtros: buscador (usa `search`), select estado, rango fechas (`fecha_desde`/`fecha_hasta`), botón limpiar. Sin debounce explícito (el buscador dispara con submit del form "Filtrar", no on-input) — diferencia menor respecto al plan original, aceptable porque evita golpear la API en cada tecla.
- [ ] 5.2.3 PARCIAL — sólo se implementó "Ver" → `abrirOrden()` para todas las filas. Las acciones diferenciadas por estado ("+ Servicio" directo al panel Anexar, "Facturar", "Ver factura") NO se implementaron esta sesión (quedan alcanzables entrando a la orden con "Ver" y usando sus propios botones, que sí existen en `orden-abierta.js`).
- [x] 5.2.4 Botón "+ Orden de servicio" en el tab → `abrirPanelNuevaOrden()`. Evidencia: `#btnOrdenesNuevaOrden`, e2e pasa.

### 5.3 Tab Servicios e insumos
Ya existe una implementación considerable (`cargarServiciosPet`/`cargarServiciosFeed`/`_renderServiciosFeedFromState`) con filtros por tipo/estado/facturado/fechas y buscador client-side sobre `nombre_servicio`.
- [ ] 5.3.1 NO IMPLEMENTADO — se agregó el parámetro `search` en el backend (9.2, verificado con curl) pero `cargarServiciosFeed()` en `consultorio.js` NO se modificó para usarlo; el buscador del tab sigue filtrando client-side sobre lo ya traído. Cambio de bajo riesgo pendiente para una próxima sesión.
- [ ] 5.3.2 NO IMPLEMENTADO — no se agregó columna/link a la orden en cada fila de servicios.
- [ ] 5.3.3 NO VERIFICADO esta sesión (no se tocó el tab).

### 5.4 Tab Notas
- [ ] 5.4.1 NO IMPLEMENTADO — el tab Notas no se tocó, sigue con su implementación preexistente (`cargarNotasPet`).
- [ ] 5.4.2 NO IMPLEMENTADO (sin cambios, ya existía `guardarNota` preexistente si aplica).
- [ ] 5.4.3 NO IMPLEMENTADO/NO VERIFICADO.

### 5.5 Tab Facturación
- [ ] 5.5.1 NO IMPLEMENTADO — el tab Facturación de la ficha sigue usando `cargarFacturasMascota()` (una sola tabla), no las dos secciones pagadas/pendientes. El fix de backend (9.3, facturas vía `FacturaOrden` + filtro `estado`) sí está disponible para cuando se implemente este tab.
- [ ] 5.5.2 NO IMPLEMENTADO.
- [ ] 5.5.3 NO IMPLEMENTADO.
- [ ] 5.5.4 NO IMPLEMENTADO.

### 5.6 Tab Evolución peso
- [ ] 5.6.1 NO IMPLEMENTADO como tab separado — `loadWeightChart` se sigue mostrando dentro del tab Resumen existente (comportamiento preexistente, sin cambios).

## 6. Frontend - Panel inline "Nueva orden de servicio" (NO modal)

- [x] 6.1 Implementado `abrirPanelNuevaOrden()`: precarga paciente (nombre desde `displayNombreMascota`), carga veterinarios en select vía `GET /usuarios/veterinarios`, muestra el panel (`hidden = false`) y hace scroll hacia él. Evidencia: `consultorio.js`, e2e pasa.
- [x] 6.2 Implementado `confirmarNuevaOrdenDesdeFicha()`: valida veterinario, resuelve `propietario_id` desde `GET /mascotas/{id}` (evita el 422 que tenía el plan original), POST `/api/ordenes/`, oculta el panel, `abrirOrden(orden.id)`. Evidencia: e2e "crear una orden desde el panel inline..." verifica el 422 lógico (aviso sin veterinario) y la creación real con `veterinario_id`/`motivo_visita` correctos.
- [x] 6.3 Agregado el HTML del panel `#fichaNuevaOrdenPanel` en `index.html` + CSS `.ficha-nueva-orden-panel` con la regla `[hidden] { display: none; }`.

## 7. Frontend - Integración con orden-abierta.js

- [ ] 7.1 NO IMPLEMENTADO — depende de 1.1/3.x (no hay `mostrarFicha()` a la que volver). No se agregó botón "← Volver a la ficha" en `orden-abierta.js`.
- [ ] 7.2 NO IMPLEMENTADO (mismo motivo).

## 8. Frontend - Quitar "Agregar consulta" solo del header/landing de la ficha

`abrirFormularioConsulta()`, `handleConsultaSubmit()`, `verConsultaCompleta()`, `initConsultaAbierta()`, `modalConsulta`, `cargarConsultas()` y `btnNuevaRecetaCA` **NO se eliminan**: los usa Panel del día (`hoy.js` ~158/388), Citas pendientes (`citas-pendientes.js` ~42), Reportes (`reportes.js` ~515), Facturación (`facturacion.js` ~511) y `app.js`. Eliminarlos rompería esos flujos.

- [x] 8.1 Quitado el wiring de `abrirFormularioConsulta()` en `seleccionarMascota()` (el viejo `#btnActionAdd`/`btnAction.onclick`, que además vivía dentro de `#petTabActions` y se perdía en cada cambio de tab — hallazgo de revisión, era código muerto). El header ahora usa `#btnFichaNuevaOrden`, fijo y fuera de `#petTabActions`, wireado una sola vez a `abrirPanelNuevaOrden()`.
- [x] 8.2 Tab renombrado de `consultas` a `ordenes`; su botón de acción pasa de "+ Nueva Consulta" (`abrirFormularioConsulta`) a "+ Orden de servicio" (`abrirPanelNuevaOrden`), id `#btnOrdenesNuevaOrden`.
- [x] 8.3 Verificado por grep: dentro de `sec-consultorio`/`consultorio.js` sólo queda `abrirFormularioConsulta` como definición de función (usada por otros módulos), ningún botón de la ficha la llama. Panel del día/Citas pendientes no se tocaron.
- [x] 8.4 Agregado `consultas: 'ordenes'` a `PET_TAB_LEGACY`.

## 9. Backend - Cambios reales y acotados (verificados contra el código, no supuestos)

- [x] 9.1 Agregado parámetro opcional `search` en `listar_ordenes` (ilike sobre `numero` OR `motivo_visita` OR `Usuario.username` del veterinario, con `outerjoin` sólo cuando `search` viene). No se tocaron `numero`/`estado`/`fecha_desde`/`fecha_hasta`/etc. Evidencia: curl en vivo (`search=control` devuelve la orden con `motivo_visita: "Control anual"`), e2e "search filtra por motivo de visita" pasa, `python -m pytest -q` sigue en 30/30.
- [x] 9.2 Agregado parámetro opcional `search` en `listar_servicios_mascota` (ilike sobre `nombre_servicio`). Evidencia: curl en vivo devuelve 200 (lista vacía porque no hay datos con ese término, sin error).
- [x] 9.3 Corregido `obtener_facturas_mascota`: ahora consulta `Factura` vía `Consulta.mascota_id` OR vía `FacturaOrden.orden_id -> OrdenServicio.mascota_id`, deduplicado por id, ordenado por `fecha_emision desc`. Agregado filtro opcional `estado` (csv). Evidencia: curl en vivo `?estado=PAGADA` devuelve 200; no hay test e2e específico para el caso "factura de orden sin consulta" (no había un fixture a mano para crear ese escenario sin gastar más tiempo) — recomendado agregarlo en una próxima sesión.
- [x] 9.4 Verificado sin cambios: `GET /api/notas/mascota/{id}` ya retorna orden ascendente; no hace falta tocar el backend (el tab de Notas, que no se implementó esta sesión, tendría que invertir la lista en el cliente cuando se construya).
- [x] 9.5 N/A — eliminada, no aplica.

## 10. Tests E2E

- [x] 10.1 PARCIAL. Creado `e2e/ficha-animal-ordenes-servicios.spec.js` (5 tests, los 5 pasan) cubriendo lo que sí se implementó:
  - No hay botón "Agregar consulta"/"Nueva consulta" en el header ni en el tab "Órdenes de servicio" de la ficha (con scope correcto: no confunde con el botón global "+ Nuevo → Agregar consulta" del header, que es un flujo distinto que se mantiene)
  - Crear una orden desde el panel inline `#fichaNuevaOrdenPanel` (NO modal): valida veterinario, crea la orden con `propietario_id` resuelto, navega a `sec-orden-abierta`
  - El tab "Órdenes de servicio" muestra las órdenes reales del animal (no consultas)
  - `GET /api/ordenes/?search=...` filtra correctamente (test de API)
  - Regresión: Panel del día → "paciente en espera" (fila de Sala de Espera) sigue abriendo `modalConsulta`/`modalCita` sin tocar
  - NO incluido (porque no se implementó): navegación lista↔ficha preservando scroll/filtros, "← Volver a la ficha" desde orden-abierta, tabs Resumen/Servicios/Notas/Facturación rediseñados, test de permisos dedicado (los permisos reales ya están cubiertos por `ordenes.spec.js` "alta de orden: gate de rol..." y el resto de la suite existente)
  - Además: se corrigió `e2e/shell.spec.js` (test "Ir a la orden" apuntaba a `data-tab="consultas"`, retirado a propósito) para usar el nuevo tab `data-tab="ordenes"` — comportamiento equivalente, ahora vía "Ver" en la tabla de órdenes en lugar de "Ir a la orden" en la tabla de consultas.

## 11. Verificación y QA

- [x] 11.1 Backend arranca sin errores — verificado con `docker compose logs backend` tras el auto-reload de uvicorn (Application startup complete, sin tracebacks).
- [x] 11.2 Sin errores de sintaxis: `node --check` sobre `consultorio.js` y el nuevo spec, `python -m py_compile` sobre los 3 routers tocados.
- [ ] 11.3 NO se hizo un recorrido manual (sin acceso a navegador interactivo en este entorno); en su lugar se cubrió el flujo nuevo con e2e automatizado (10.1). Los pasos de tabs Servicios/Notas/Facturación/Resumen no aplican porque no se tocaron esta sesión.
- [x] 11.4 `npx playwright test e2e/ficha-animal-ordenes-servicios.spec.js` → **5/5 passed**.
- [ ] 11.5 NO IMPLEMENTADO/NO VERIFICADO — no se tocó responsive (depende de 1.1/2.6).
- [x] 11.6 Regresión ejecutada: `e2e/orden-veterinario-y-tutores.spec.js`, `e2e/shell.spec.js`, `e2e/flujo-clinico.spec.js`, `e2e/notas.spec.js`, `e2e/clinico.spec.js`, `e2e/reportes.spec.js`, `e2e/facturacion-metodos-gestores-saldo.spec.js`, `e2e/ordenes.spec.js` + el nuevo spec → **93/93 passed** (1 falla inicial en `shell.spec.js:663`, causada por el rename intencional del tab `consultas`→`ordenes`; corregida). `python -m pytest -q` en `backend/` → **30/30 passed**, sin cambios.