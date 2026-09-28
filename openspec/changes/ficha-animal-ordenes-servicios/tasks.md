# Tasks

## 1. HTML Template (static/templates/index.html)

- [x] 1.1 IMPLEMENTADO (slice 2), con una adaptación deliberada respecto al plan original: en vez de reescribir `consultorio-layout` con markup nuevo, Vista 1 (listado) y Vista 2 (ficha) se hicieron mutuamente excluyentes ALTERNANDO visibilidad sobre el DOM existente -- `.patient-list-sidebar` se oculta con `hidden` al entrar a la ficha (`_mostrarVistaFicha()`), y `#petProfileContainer`/`#emptyPatientWrapper` alternan `display` dentro de `#patientWrapper` (que ahora queda siempre visible como contenedor). Se preservaron TODOS los ids/clases que usan los ~15 e2e existentes (`patientWrapper`, `.pet-list-item`, `.pet-nav-item`, `consultorioSearchMascota`, `switchPetTab`, `count-*`). Evidencia: `static/templates/index.html`, `static/js/sections/consultorio.js` (`_mostrarVistaFicha`/`mostrarLista`/`mostrarFicha`); e2e nuevo "volver a la lista restaura el término de búsqueda y el scroll" pasa; suite de regresión (shell/regresiones-revision/notas/flujo-clinico/orden-veterinario-y-tutores/clinico + el spec de esta feature) sin regresiones nuevas (ver reporte de apply).
- [x] 1.2 Agregado `#fichaNuevaOrdenPanel` (panel inline, NO modal) dentro de `sec-consultorio`, hermano de `pet-layout`. Evidencia: `static/templates/index.html`, e2e `ficha-animal-ordenes-servicios.spec.js` ("crear una orden desde el panel inline...") pasa.
- [x] 1.3 N/A — confirmado que `#modalConsulta`/`#modalCita` son divs de nivel superior (líneas ~320/400), no anidados en `sec-consultorio`; no se tocaron.
- [x] 1.4 IMPLEMENTADO (slice 2) — `#patientWrapper` ya no arranca `display:none`: por defecto queda visible con `#emptyPatientWrapper` mostrando "Seleccione un paciente de la lista..." (Vista 1) y `#petProfileContainer` oculto (`style="display:none"` inicial). Esto además corrige un bug real: antes del cambio, la columna derecha quedaba en blanco (ni ficha ni mensaje) hasta seleccionar un paciente. Evidencia: `static/templates/index.html`; e2e "volver a la lista restaura..." confirma que `#petProfileContainer` queda oculto y `.patient-list-sidebar` visible tras "Volver a la lista".
- [x] 1.5 PARCIAL (deliberado) — se agregaron `.ficha-header`/`.ficha-header-left`/`.ficha-header-actions`/`.ficha-btn-volver` sobre el header existente (`.pet-content-header`, sin quitarle la clase). NO se agregaron `.ficha-layout`/`.ficha-tabs`/`.ficha-tab`/`.ficha-content` como grid nuevo: el hard-constraint de esta sesión pide mantener el tab set/contenido tal cual (`.pet-layout`/`.pet-sidebar`/`.pet-nav-item`/`.pet-content` sin tocar), así que el "re-home" de header+tabs dentro de Vista 2 se hizo reutilizando esa estructura en vez de reemplazarla por el grid de design.md sección 3.

## 2. CSS (static/css/ o inline en template)

- [x] 2.1 PARCIAL (deliberado, mismo criterio que 1.5) — no se implementó el CSS Grid `.ficha-layout` literal de design.md porque requeriría tocar el markup de tabs (`.pet-layout`/`.pet-sidebar`), fuera de alcance de esta sesión. El objetivo funcional (Vista 2 = header + riel de tabs + contenido, ancho completo al ocultar la lista) se logró con el `.pet-layout` flex existente + `.patient-list-sidebar[hidden]`. Evidencia: `static/css/styles.css`.
- [x] 2.2 IMPLEMENTADO — el header de ficha (`.pet-content-header.ficha-header`) ahora agrupa botón "Volver a la lista" + nombre/meta en `.ficha-header-left`, dejando `.ficha-header-actions` (+ Orden de servicio) como segundo bloque; en mobile ambos envuelven (ver 2.6). Evidencia: `static/templates/index.html`, `static/css/styles.css`.
- [x] 2.3 N/A (deliberado) — dependía de 1.1 con el grid nuevo; con la adaptación de 1.1/1.5/2.1 (toggle sobre estructura existente) no aplica un rediseño adicional de tabs verticales más allá del responsive de 2.6.
- [x] 2.4 PARCIAL — la tabla del nuevo tab "Órdenes de servicio" reusa `.consultas-table` + los `.serv-filtro-*` ya existentes (mismo patrón que el tab Servicios); se agregó `.status-pill--info` para el badge EN_ATENCION. No se creó una clase `.ficha-table` nueva porque no hizo falta.
- [ ] 2.5 NO IMPLEMENTADO — tabs Resumen/Facturación/Notas no se rediseñaron esta sesión (fuera de alcance de slice 2: contenido de tabs es slice 3).
- [x] 2.6 IMPLEMENTADO — `@media (max-width: 860px)` en `static/css/styles.css`: `.consultorio-layout` pasa a columna, `.patient-list-sidebar` a 100% ancho/alto acotado, `.pet-layout` a columna con `.pet-sidebar` colapsado a fila horizontal con scroll propio (`overflow-x:auto`), `.ficha-header`/`.ficha-header-left` envuelven, `.pet-content-body` gana `overflow-x:auto` (scroll contenido, no de la página). Evidencia: e2e nuevo "a 390px de ancho no hay scroll horizontal y los tabs de la ficha son usables" pasa (`document.documentElement.scrollWidth - clientWidth <= 1`, antes y después de cambiar de tab).

## 3. Frontend - consultorio.js (State & Navigation)

Implementado con la adaptación de 1.1: el estado de dos vistas se agregó como un toggle de visibilidad sobre el DOM existente (no una reescritura completa de `consultorio-layout`), para no arriesgar el layout que ya usan ~15 e2e specs.

- [x] 3.1 `currentView`/`listaScrollPosition` agregados como estado de módulo en `consultorio.js` (no se agregó `currentTab`/`Map` por mascota — `switchPetTab` ya trackea la pestaña activa vía clase `.active` en el DOM, no hacía falta duplicarlo en JS).
- [x] 3.2 `mostrarLista()` implementada y exportada: vuelve a Vista 1, restaura scroll de `#consultorioMascotasList` (con reflow forzado -- ver "Learned" del reporte) y cierra el panel "Nueva orden" si había quedado abierto. La usa el botón `#btnVolverALista` y `propietarios.js::verMascotasPropietario`.
- [x] 3.3 `mostrarFicha(mascotaId)` implementada y exportada: activa Vista 2 y delega en `seleccionarMascotaBasica` (ya resuelve nombre/especie/código desde el id). La usa `orden-abierta.js` ("← Volver a la ficha").
- [x] 3.4 `seleccionarMascota()` ahora llama a `_mostrarVistaFicha()` al entrar (activa Vista 2 desde CUALQUIER punto de entrada existente: click en la lista, búsqueda global/cmdk, `seleccionarMascotaBasica` usada por hoy.js/agenda.js/citas-pendientes.js) en vez de tocar `patientWrapper` directamente.
- [x] 3.5 N/A — no se implementó `Map<mascotaId, tab>` (ver 3.1): al volver a la ficha se mantiene el comportamiento preexistente de `seleccionarMascota()` (siempre activa `resumen` por defecto), consistente con la decisión de design.md "Riesgos/Trade-offs" #1 ("resetear currentTab a 'resumen' para la próxima ficha").
- [x] 3.6 Sin cambios adicionales sobre lo ya hecho en slice 1: sigue existiendo `switchPetTab(tabName)` con el caso `ordenes` ya agregado.

## 4. Frontend - consultorio.js (Header de Ficha)

- [x] 4.1 PARCIAL (deliberado) — no se extrajo un `renderFichaHeader()` separado (el header sigue siendo el HTML+JS preexistente en `seleccionarMascota()`, por no tocar de más), pero sí se le agregó el botón "Volver a la lista" y las clases `.ficha-header*` (ver 1.5/2.2/4.2). El nombre/código/especie/raza/sexo ya se pintaban ahí desde antes de este cambio (sin regresión).
- [x] 4.2 "Volver a la lista": implementado -- `#btnVolverALista` (nuevo, en `.ficha-header-left`) llama a `mostrarLista()`. Evidencia: e2e "volver a la lista restaura..." pasa. "Ver tutor": NO IMPLEMENTADO -- no existe hoy un link directo mascota→propietario desde la ficha (la única forma indirecta es `propietarios.js::verMascotasPropietario`, que va en el sentido contrario); agregar "Ver tutor" implicaría tocar el bloque de info del dueño, que vive en tab Resumen (contenido de tab, slice 3), así que se deja fuera de alcance. Editar/Transferir/Eliminar: sin cambios de comportamiento (ya funcionaban), confirmados visibles para roles no-admin por el nuevo e2e "el header de la ficha muestra los datos del animal y los botones... para un rol no-admin".
- [x] 4.3 Botón "+ Orden de servicio" en header → `abrirPanelNuevaOrden()`. Evidencia: `#btnFichaNuevaOrden` wireado a nivel de módulo en `consultorio.js`; e2e "no hay botón de Agregar consulta..." y "crear una orden..." pasan.

## 5. Frontend - consultorio.js (Tabs Content)

### 5.1 Tab Resumen
- [ ] 5.1.1 NO IMPLEMENTADO — el tab Resumen sigue siendo el existente (historia + constantes + peso), sin las cards nuevas de última orden/próxima cita/totales acumulados.
- [ ] 5.1.2 NO IMPLEMENTADO (depende de 5.1.1).

### 5.2 Tab Órdenes de servicio (tab nuevo, junto al tab `consultas`)

**Corrección de regresión (post slice 2):** el tab `consultas` NO se elimina/renombra — slice 2 lo había reemplazado por `ordenes` y agregado un alias `PET_TAB_LEGACY.consultas -> 'ordenes'`, lo que rompía las acciones de reparación legacy por consulta (Facturar sin orden / Ir a la orden / Agregar honorario a la orden) que sólo vivían en el viejo tab `consultas` -- ver `e2e/regresiones-revision.spec.js` tests 9 y 1c, que habían quedado marcados como fallas conocidas en 11.6. Se restauró el tab `consultas` (markup + `case 'consultas'` en `switchPetTab` + `count-consultas` en `actualizarCountsPet`) tal como estaba antes de slice 1, SIN el botón "+ Nueva Consulta" (la alta sigue siendo exclusiva de "Órdenes de servicio"), se quitó el alias `consultas: 'ordenes'` de `PET_TAB_LEGACY`, y se agregó `escapeHtml()` sobre `motivo`/`diagnostico` en `cargarConsultas()` (no lo tenía). Ambos tabs coexisten en la barra vertical. Ver Requirement "Tab 'Consultas' — se conserva para las acciones de reparación de datos legacy" en `specs/orden-veterinario-y-tutores/spec.md`.

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

- [x] 7.1 Implementado: `orden-abierta.js::pintarPaciente()` agrega `#btnOaVolverFicha` ("← Volver a la ficha") sólo cuando `orden.mascota_id` existe (una venta de mostrador sin paciente no lo muestra). El click hace `showSection('sec-consultorio')` + `mostrarFicha(orden.mascota_id)`. Importa `mostrarFicha` de `consultorio.js` -- relación cíclica segura (mismo patrón ya documentado en el archivo para facturacion.js/ordenes.js: sólo se usa dentro del handler, nunca en la evaluación del módulo). Evidencia: `static/js/sections/orden-abierta.js`.
- [x] 7.2 `mostrarFicha` exportada desde `consultorio.js` (ver 3.3). Evidencia: e2e nuevo "'← Volver a la ficha' desde la orden abierta vuelve al paciente correcto" pasa (navega a `sec-consultorio`, `#petProfileContainer` visible, `#displayNombreMascota` con el nombre correcto).

## 8. Frontend - Quitar "Agregar consulta" solo del header/landing de la ficha

`abrirFormularioConsulta()`, `handleConsultaSubmit()`, `verConsultaCompleta()`, `initConsultaAbierta()`, `modalConsulta`, `cargarConsultas()` y `btnNuevaRecetaCA` **NO se eliminan**: los usa Panel del día (`hoy.js` ~158/388), Citas pendientes (`citas-pendientes.js` ~42), Reportes (`reportes.js` ~515), Facturación (`facturacion.js` ~511) y `app.js`. Eliminarlos rompería esos flujos.

- [x] 8.1 Quitado el wiring de `abrirFormularioConsulta()` en `seleccionarMascota()` (el viejo `#btnActionAdd`/`btnAction.onclick`, que además vivía dentro de `#petTabActions` y se perdía en cada cambio de tab — hallazgo de revisión, era código muerto). El header ahora usa `#btnFichaNuevaOrden`, fijo y fuera de `#petTabActions`, wireado una sola vez a `abrirPanelNuevaOrden()`.
- [x] 8.2 Tab nuevo `ordenes` agregado con botón de acción "+ Orden de servicio" (`abrirPanelNuevaOrden`), id `#btnOrdenesNuevaOrden`. **Corrección de regresión**: el tab `consultas` originalmente se había RENOMBRADO a `ordenes` (perdiendo las acciones de reparación legacy); se restauró como tab propio -- ver nota en 5.2. Su botón "+ Nueva Consulta" (`btnRegistrarConsulta`) NO se restauró (se elimina sin reemplazo en ese tab, consistente con el resto de esta tarea).
- [x] 8.3 Verificado por grep: dentro de `sec-consultorio`/`consultorio.js` sólo queda `abrirFormularioConsulta` como definición de función (usada por otros módulos), ningún botón de la ficha la llama. Panel del día/Citas pendientes no se tocaron.
- [x] 8.4 REVERTIDO (corrección de regresión) — se había agregado `consultas: 'ordenes'` a `PET_TAB_LEGACY`; se quitó porque `consultas` volvió a ser un tab real y propio, no un alias. `PET_TAB_LEGACY` conserva sólo sus entradas originales (`historia`/`peso`/`vacunas`/etc.).

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
- [x] 11.4 (slice 2) `npx playwright test e2e/ficha-animal-ordenes-servicios.spec.js` → **10/10 passed** (los 5 de slice 1 + 4 nuevos de navegación Vista 1/Vista 2 + 1 nuevo de `search` ya contado en 9.1... ver detalle en 11.6).
- [x] 11.5 IMPLEMENTADO — ver 2.6. Evidencia: e2e "a 390px de ancho no hay scroll horizontal y los tabs de la ficha son usables" (`document.documentElement.scrollWidth - clientWidth <= 1`, antes y después de cambiar de tab con el riel colapsado a fila horizontal).
- [x] 11.6 (slice 2) Regresión ejecutada ANTES de tocar código (baseline) y DESPUÉS, sobre el mismo set de 7 specs identificados como dependientes del layout de `sec-consultorio` (`shell.spec.js`, `regresiones-revision.spec.js`, `notas.spec.js`, `flujo-clinico.spec.js`, `orden-veterinario-y-tutores.spec.js`, `clinico.spec.js`, `ficha-animal-ordenes-servicios.spec.js`):
  - Baseline (antes de esta sesión): **62 passed, 2 failed** sobre 64 tests. Las 2 fallas (`regresiones-revision.spec.js:326` y `:362`) ya fallaban ANTES de cualquier cambio de esta sesión — dependen de `.pet-nav-item[data-tab="consultas"]`, un tab que slice 1 ya había renombrado a `ordenes` sin actualizar estos dos tests; además prueban botones "Facturar"/"Ir a la orden"/"Agregar honorario a la orden" por-consulta que sólo existían en el viejo tab de Consultas y NO se reimplementaron en el nuevo tab de Órdenes (tarea 5.2.3, deferida, fuera de alcance de slice 2 por ser contenido de tab). Se dejan sin tocar — quedan trackeadas bajo 5.2.3.
  - Después de slice 2 (68 tests: +4 nuevos de este slice): **66 passed, 2 failed** — las MISMAS 2 fallas de baseline, sin fallas nuevas. Se encontraron y corrigieron 2 regresiones intermedias del cambio (no quedaron en el resultado final): (a) el e2e "cambiar de paciente cierra el panel..." asumía que la lista seguía visible con la ficha abierta -- se actualizó para pasar por "Volver a la lista" primero (cambio de comportamiento intencional: Vista 1/Vista 2 son mutuamente excluyentes); (b) `shell.spec.js:700` usaba `getByRole('button', {name:'Ver'})` sin `exact:true`, que empezó a matchear también el nuevo botón "Volver a la lista" (substring "Ver" dentro de "Vol**ver**") -- se agregó `exact:true`.
  - `python -m pytest -q` en `backend/`: no se tocó nada de backend en slice 2, no se re-ejecutó (sin cambios de superficie de API).
- [x] 11.7 (reparación de regresión, post slice 2) Restaurado el tab `consultas` (ver 5.2/8.2/8.4). Regresión ejecutada sobre los mismos 7 specs + el spec dedicado, con el `assert` nuevo de ambos tabs agregado en `ficha-animal-ordenes-servicios.spec.js`:
  - `e2e/regresiones-revision.spec.js`: **16/16 passed** (incluye los tests 9 y 1c, antes fallando).
  - `e2e/ficha-animal-ordenes-servicios.spec.js` + `e2e/shell.spec.js` + `e2e/orden-veterinario-y-tutores.spec.js` + `e2e/notas.spec.js` + `e2e/flujo-clinico.spec.js` + `e2e/clinico.spec.js`: **52/52 passed**.
  - Total de la sesión: **68/68 passed, 0 failed** — las 2 fallas conocidas de slice 2 quedan resueltas; ninguna regresión nueva.
  - No se tocó backend en esta reparación; no se re-ejecutó `python -m pytest -q`.

## Open questions (slice 2)

- ~~**Inconsistencia proposal.md/design.md vs spec.md sobre si la lista queda visible junto a la ficha**~~ **RESUELTO (reparación de regresión, post slice 2)**: se actualizó `specs/orden-veterinario-y-tutores/spec.md` (Requirement "Ficha del animal — navegación de dos niveles Lista → Ficha") para que coincida con lo implementado: Vista 1 y Vista 2 mutuamente excluyentes, con un scenario nuevo "Volver a la lista restaura búsqueda y scroll".
- **"Ver tutor" (4.2)**: no implementado -- no hay hoy un link directo mascota→propietario individual desde el header de la ficha (la navegación existe en el sentido contrario, `propietarios.js::verMascotasPropietario`). Agregarlo requiere decidir dónde navega (¿`sec-propietarios` con el tutor preseleccionado? ¿un tab nuevo?) y toca contenido de tab (dueño se muestra hoy en el tab Resumen) -- se deja para slice 3 o una decisión de producto explícita.
- ~~**5.2.3 (acciones por estado en el tab Órdenes)**~~ **RESUELTO DE OTRA FORMA (reparación de regresión, post slice 2)**: las 2 fallas de `regresiones-revision.spec.js` (tests 9 y 1c) no eran por falta de "acciones por estado" en el tab Órdenes -- eran porque slice 2 había reemplazado el tab `consultas` (que tenía esas acciones: Facturar/Ir a la orden/Agregar honorario) por el alias `PET_TAB_LEGACY.consultas -> 'ordenes'`. Se restauró `consultas` como tab propio (ver 5.2/8.2/8.4); las 2 fallas quedaron resueltas sin tocar `cargarOrdenesTab`. 5.2.3 (acciones por estado dentro del tab Órdenes específicamente, ej. "+ Servicio"/"Facturar" inline en esa tabla) sigue pendiente como mejora de UX, pero ya no bloquea ningún test.