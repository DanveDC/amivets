# Tarea 11 — Revisión integral de la transformación y cierre de la etapa 8

Informe de cierre. Método seguido: para cada una de las doce pantallas se
tomaron capturas reales con Playwright (boceto a `file://` y app autenticada,
1440×900) y se compararon mirándolas, no leyendo el CSS y adivinando. Las
capturas quedan en `docs/diseno/capturas/revision-11/`.

---

## 1 · Las doce pantallas

| Pantalla | Estado antes | Estado después | Clasificación de diferencias |
|---|---|---|---|
| Login | Tarjeta genérica centrada, `<h1>AmiVets</h1>` | Split-screen fiel al boceto: panel teal 620px (logo real, 3 stats) + formulario 372px | Estructura reescrita. 1 desvío encontrado y corregido en la propia revisión (gap de 14px agrupando todo el form en vez de solo los dos campos, corrido el bloque hacia arriba) — ver §3. Stat "Pacientes" usa conteo real (`Mascota.activo=True`) en vez del 1.284 de placeholder del boceto → **mejora deliberada** (no mockear un número). |
| Reportes | `.content-area` con 3 KPI aproximados ("simulamos stats básicos", nunca mostraba stock real) | Panel superior fiel al boceto: 4 KPI con comparación vs. mes anterior, "Ingresos por servicio" (pills Mes/Trimestre/Año), "Producción por médico", "Por tipo de mascota" | Backend nuevo (4 endpoints, sin tocar modelo/migraciones) para los datos que sí soporta. "Patologías más frecuentes" → **imposible hoy** (no hay catálogo de diagnósticos; el boceto lo anota y aun así dibuja barras con relleno — no se copió esa parte). 2 desvíos propios encontrados con datos reales y corregidos: "% del total atendido" podía superar 100% (el boceto asume subconjunto, no lo es necesariamente), y "Producción por médico" sin límite hacía una tabla de cientos de filas. |
| Agenda | `.content-area`, botones `.btn-primary`/`.btn-secondary` (negro) | Mismo layout, botones `.av-btn`/`.av-btn--primary` (teal) | Sin boceto propio (§2b). Único desvío real: color de botones y un verde saturado hardcodeado en el calendario. **Desvío, corregido.** |
| Propietarios | ídem | ídem | Sin boceto. Mismo fix de botones. Ya era alcanzable vía el botón "Tutores" de Mascotas (416c6a4, previo a esta tarea). |
| Usuarios | ídem | ídem | Sin boceto. Mismo fix de botones. |
| Perfil | ídem (ya usaba `.av-btn` en su único botón) | Sin cambios | Sin boceto. No había desvío que corregir. |
| Citas web / QR | `.content-area`, un botón `.btn-secondary` | `.av-btn` | Sin boceto. Mismo fix de botones. |
| Inicio (lanzador) | Ya elevado (etapa 7) | Sin cambios estructurales | Coincide casi al pixel con `Inicio.html`. Único gap: el header del lanzador no tiene el ícono de marca (solo texto "AmiVets"), a diferencia del boceto — **desvío menor, no corregido** (toca el header global, ver pendientes). Se encontró y corrigió un bug real de otra naturaleza acá: rol sin módulos asignados dejaba la grilla completamente vacía sin explicación — ver §3. |
| Main (Panel del día) | Ya elevado (etapa 7) | Sin cambios estructurales | Coincide con `Main.html`. Formato de moneda sin separador de miles (`$204000.00` en vez de `$ 204.000,00`) — **desvío confirmado, no corregido** (ver pendientes, es sistémico). |
| Orden abierta | Ya elevado (etapa 7) | **Corregido un bug real** | Coincide con `OrdenAbierta.html` salvo un bug de layout serio: `.oa-canvas` no tenía `display:grid`, el panel "Resumen / Facturar orden" caía apilado debajo de la tabla de servicios, fuera del viewport. Es la pantalla más usada del sistema. **Desvío grave, corregido**, con test e2e nuevo que lo hubiera detectado. |
| Anexar servicio | Ya elevado (etapa 7) | Ajustado junto con Orden abierta | Coincide con `AnexarServicio.html`. El fix de Orden abierta rompía este estado comprimido (todo se aplastaba) — corregido en el mismo commit. |
| Bandeja del gestor | Ya elevado (etapa 7) | Corregido un detalle | Coincide con `BandejaGestor.html`, incluido el estado vacío documentado en el boceto. Único desvío: el pill "Todas" y su contador quedaban pegados ("Todas0") por falta de `gap` en `.av-pill` — **desvío menor, corregido** (afecta a todos los usos de `.av-pill`, no solo acá). |
| Mascotas | Landing nuevo de la etapa 8 | **Corregidos 3 bugs reales** | Estructura fiel a `Mascotas.html` salvo que reemplaza las columnas "Última visita"/"Órdenes abiertas" por "Sexo" — **desvío confirmado, no corregido** (requiere una agregación nueva por mascota, no es un ajuste de una línea; a pendientes). Bugs reales encontrados y corregidos: tutor en blanco por `limit=200` fijo en el lookup de propietarios; columna Sexo partiendo "Hembra" en dos líneas; subtítulo con conteo que el boceto trae y la pantalla no tenía. |
| Ficha de mascota | Ya elevado ("idioma visual", 9b59b45); layout de 3 columnas con lista maestra de pacientes + tabs de íconos (Resumen/Consultas/Servicios/Fórmulas/Notas/Cobros) | **Mejora parcial, real y aditiva.** Se agregó "Constantes recientes" (peso/temperatura/frecuencia cardíaca de la última consulta que las registró — `Consulta` ya tenía esos tres campos, sin cambio de modelo) a la pestaña Resumen. La reestructuración completa (reemplazar el layout de 3 columnas por header+tabs Historia clínica/Órdenes/Vacunas y desparasitación/Archivos/Tutor de `FichaMascota.html`) **queda como desvío confirmado, no corregido**: es un archivo de 2529 líneas con formularios clínicos reales (vacunación, cirugía, hospitalización, pruebas) para 318 pacientes reales — la evalué y decidí no tocarla entera bajo presión de tiempo. Ver pendientes. |
| Insumos | Ya elevado ("idioma visual", 9b59b45); tabla plana sin KPI ni barras de nivel | **Corregido — fidelidad estructural real.** Reescrita con los 4 KPI del boceto (materiales activos/bajo mínimo/por reponer/valor del inventario), pills de categoría (de categorías reales, no las del boceto) y barra de "Nivel" por fila. El "% del máximo" del boceto se implementó como "% del mínimo" — `InventarioResponse` no tiene un campo de stock objetivo/máximo — ver pendientes. De paso, un botón "Bajo Stock" del header que duplicaba TODO el renderizado de la tabla inline en `app.js` (contra una estructura vieja de 7 columnas) se eliminó, reemplazado por la pill "Bajo mínimo" sobre el único renderer real. |
| Catálogo | Ya elevado ("idioma visual", 9b59b45); tabla plana ID/Nombre/Categoría/Precio/Unidad/Activo | **Corregido — fidelidad estructural real.** Reescrita maestro-detalle: lista de servicios a la izquierda, panel de detalle a la derecha con insumos que consume (agregar/editar/quitar, siempre visible) e historial de precios inline. El backend ya soportaba todo esto desde las tareas 07/08 (recetas, historial de precios) — vivía dentro de un modal de edición; se retiró de ahí y pasó al panel siempre visible. "Duración estimada" del boceto no se copió: no hay ese campo en el modelo. |
| Facturación | Ya elevado ("idioma visual", 9b59b45); la entrada de menú es un historial/listado de facturas ya emitidas | **Corregido — el checkout del boceto ahora existe.** "Facturar orden" (en Orden abierta) creaba la factura directo por API, `total_pagado:0.0`, sin ningún paso de cobro — el checkout de `Facturacion.html` (conceptos, forma de pago, "Emitir factura") no existía en ningún lado de la app. Ahora "Facturar orden" abre un modal fiel al boceto con esos tres elementos, reusando `POST /facturas/` que ya aceptaba `metodo_pago`/`total_pagado` sin que nadie se los mandara. `sec-facturacion` (la entrada de menú) se mantiene como historial de facturas — es un propósito real y distinto, no un resto a reemplazar: el boceto trae "Orden OS-2418" en su subtítulo, así que pertenece al contexto de una orden puntual. |

Nota sobre las últimas cuatro filas: el enunciado de esta tarea, citando el
commit `9b59b45`, las daba por "elevadas al idioma visual del shell nuevo" en
el mismo sentido que Login/Reportes necesitaban elevarse ahora. Es cierto que
usaban la tipografía/paleta/tokens correctos — pero ninguna de las cuatro
seguía la *composición* de su boceto. Avisé de esto apenas lo encontré, se
me pidió corregirlas de verdad, y así se hizo para tres de las cuatro
(Insumos, Catálogo, Facturación) con fidelidad estructural real, verificada
con capturas y tests. La cuarta (Ficha de mascota) recibió una mejora real
pero acotada — la reestructuración completa quedó fuera por el tamaño y
riesgo del archivo que hay que tocar (2529 líneas, datos clínicos reales de
318 pacientes) frente al tiempo disponible; documentado en pendientes con lo
que haría falta.

---

## 2 · Qué se elevó en la etapa 8 y qué quedó fuera

**Elevado en esta tarea** (las dos pantallas con boceto propio que faltaban):

- **Login** — reescrita al pixel del boceto. Logo real extraído del boceto
  (`static/img/logo-amivets.png`), stat de pacientes con dato real vía Jinja2
  (`backend/app/main.py`, `login_page`).
- **Reportes** — panel superior reescrito, 4 endpoints nuevos en
  `backend/app/routers/reportes.py` (sin tocar modelo ni migraciones).

**Llevadas a fidelidad estructural real** (no solo "idioma visual" — ver §1,
encontradas durante esta misma revisión y corregidas de verdad, no solo
documentadas):

- **Insumos** (`sec-inventario`) — KPI + pills de categoría + barra de nivel.
- **Catálogo** (`sec-catalogo`) — maestro-detalle con recetas e historial de
  precios siempre visibles.
- **Facturación** — el checkout por orden (conceptos, forma de pago, "Emitir
  factura") que no existía en ningún lado, ahora colgando de "Facturar
  orden" en Orden abierta.
- **Ficha de mascota** (`sec-consultorio`) — mejora parcial ("Constantes
  recientes" con dato real de la consulta); la reestructuración completa del
  layout queda pendiente, ver §8.

**Rehospedadas en el idioma visual existente** (sin boceto propio, §2b):
Agenda, Propietarios, Usuarios, Perfil, Citas web. El único patrón viejo real
que tenían era `.btn-primary`/`.btn-secondary` (negro) en vez de
`.av-btn`/`.av-btn--primary` (teal) — corregido. No hizo falta ningún
componente nuevo: `.search-input` y `.consultas-table` ya estaban
tokenizados desde la propia etapa 8 (comentario explícito en `styles.css`).

**Limpieza del menú viejo (§2c)** — verificada, no encontré nada para
corregir: `nocturne.css`/`themes.css`/`amivets.css`/`bridge.css` ya no
existen ni están referenciados, no hay `themeToggle` ni script anti-FOUC de
`data-theme` en el `<head>`, y el fallback de color de
`historial-precios.js:88` ya es el teal correcto (`#0C7A89`). Lo único que
faltaba era la nota de "superado" en `docs/diseno/1A/` (el archivo de tareas
ya la tenía) — agregada en `plan-shell.md` y `propuesta.dc.html`.

**Quedó fuera, documentado como desvío no corregido** (no boceto propio a
seguir, pero sí un boceto que dibuja otra composición): Ficha de mascota,
Insumos, Catálogo, Facturación. Ver la tabla de arriba y la lista de
pendientes.

---

## 3 · Bugs reales encontrados con capturas reales (no en el boceto de ninguna pantalla — comparando la app contra sí misma y contra datos reales)

Estos no son desvíos del boceto: son fallas de la implementación, encontradas
exactamente por el método que pide la tarea (mirar capturas reales, no leer
el código y asumir que funciona).

1. **`.oa-canvas` sin `display:grid`** (Orden abierta). El panel "Resumen /
   Facturar orden" —con el botón que emite la factura— caía apilado debajo
   de la tabla de servicios, confirmado con `getBoundingClientRect()`:
   vivía en `y:997` con el viewport en 900px de alto. Es la pantalla más
   usada del sistema. Corregido con `grid-template-columns: minmax(0,1fr)
   320px` (valor literal del boceto). Al corregirlo rompí un test existente
   (`shell.spec.js` espera `#oaTotal` visible con el panel de anexar
   abierto) — la causa era que el test pasaba *antes* porque el elemento,
   aunque mal ubicado, seguía siendo "visible" para Playwright (no chequea
   scroll). Ajustado para que el estado comprimido apile en una sola
   columna en vez de ocultar el panel, conservando ambos requisitos.
2. **Tutor en blanco en el listado de Mascotas.** `mascotas.js` pedía
   `/propietarios/?limit=200` fijo para el lookup de nombres. Con más de 200
   propietarios (ya hay 264 reales, sin contar los de prueba) cualquier
   tutor fuera de esa ventana dejaba "—" en la columna Tutor de *todas* sus
   mascotas, sin ningún aviso. Mismo patrón de pérdida silenciosa que
   `416c6a4` ya había corregido para el propio listado de mascotas
   (150→1000) pero no alcanzó este fetch. Subido a 2000.
3. **Lanzador vacío sin explicación para el rol `user`.** `role="user"` es
   el default real de `Usuario.role` en el modelo
   (`backend/app/models/models.py:663`) para cualquier cuenta sin rol
   asignado explícito. Ninguno de los seis módulos lo lista en sus roles
   permitidos, así que esa cuenta caía en un lanzador con la grilla
   completamente vacía: sin sidebar (oculta en el lanzador), sin mensaje,
   sin ninguna acción posible. Probado creando una cuenta real con
   `role=user` vía API (borrada después). Corregido con el patrón
   `.av-empty` ya existente ("el estado sin acceso") — mensaje explicando
   la situación y un botón para cerrar sesión.
4. **"Producción por médico" (Reportes) sin límite.** Con la contaminación
   de datos de prueba (ver §5), esa tabla podía tener cientos de filas.
   Limitada a los 10 de mayor ingreso real, con aviso de cuántos quedan
   afuera; la participación % se sigue calculando sobre el total real, no
   solo sobre los 10 visibles.
5. **"% del total atendido" de Pacientes nuevos podía superar 100%**
   (Reportes). "Pacientes nuevos" (altas) y "total atendido" (mascotas con
   consulta) miden cosas distintas y no son necesariamente un subconjunto
   uno del otro — el boceto asume que sí. Se muestra el porcentaje solo
   cuando es ≤100%; si no, un texto sin esa cuenta en vez de un número que
   no tiene sentido.
6. **`.av-pill` sin `gap`.** El texto y el contador de las pills quedaban
   pegados ("Todas0" en Mi bandeja). Corregido a nivel del componente
   compartido.
7. **Login: gap de 14px englobando error+campos+botón+ayuda** en vez de
   sólo los dos campos — corrí el formulario hacia arriba al centrarse
   verticalmente. Encontrado en la propia revisión de la captura que
   generé, corregido antes del commit.

---

## 4 · Coherencia del sistema (sección 4 del enunciado)

1. **`sec-consulta-abierta` vs `sec-orden-abierta`.** No es un resto
   muerto. Están documentadas como decisiones distintas: `sec-orden-abierta`
   es la orden de servicio en curso (admisión/gestor); `sec-consulta-abierta`
   es el detalle de una consulta ya registrada (`verConsultaCompleta()` en
   `consultorio.js`, usado desde Ficha, Facturación y el panel del día). Ya
   hay un comentario explícito en `shell.css` y `router.js` documentando la
   decisión de no retirarla todavía, con fecha del commit `416c6a4` de hoy
   mismo (una revisión previa a esta tarea ya encontró y resolvió esto). No
   se tocó.
2. **`sec-propietarios` sin entrada de sidebar.** Alcanzable por el botón
   "Tutores" en Mascotas (`#btnVerTutores`) — arreglado también en
   `416c6a4`, antes de esta tarea. Verificado que sigue funcionando.
3. **Paleta de comandos (cmdk) y roles.** El atajo de teclado y los
   resultados de búsqueda ya respetan `ROLES_SIN_BUSQUEDA_GLOBAL` (fix de
   `416c6a4`). Las búsquedas de órdenes/facturas dependen del 403 real del
   backend (`Promise.allSettled`, rechazos silenciosos) en vez de una lista
   de roles duplicada en el frontend — más robusto, una sola fuente de
   verdad. No se tocó.
4. **El lanzador y los roles.** Verificado con los cinco roles, contra la
   matriz que el propio boceto `Inicio.html` documenta en su nota de
   diseño: `admin` 6/6, `recepcionista` 3/6 (Admisión, Mascotas/Tutores,
   Facturación), `veterinario` 3/6 (Admisión, Servicios, Mascotas/Tutores),
   `gestor` 1/6 (se omite el lanzador, cae directo a su bandeja) — los
   cuatro coinciden exactamente con `getVisibleModules()`. El quinto rol,
   `user` (el default del modelo, sin mapeo en ningún módulo), tenía el bug
   real del punto 3 de la sección anterior — corregido. Los cinco casos
   tienen test e2e nuevo en `shell.spec.js`.
5. **Terminología.** Barrido de "dueño"/"cliente" en las doce pantallas y en
   el resto de la UI. Quedaban 4 cadenas con vocabulario viejo fuera de las
   doce pantallas ya revisadas en tareas previas: la columna "Cliente" de
   la tabla de Citas QR, el label "CLIENTE" del modal de facturación, y dos
   placeholders de ejemplo ("la dueña llamó...", "Transferir a otro
   dueño"). Corregidas a "Tutor"/"tutora"/"tutor". No se tocó ningún uso de
   "cita" en Agenda/Citas web — es un concepto real y distinto de "orden de
   servicio", no una confusión de vocabulario.

---

## 5 · Suite de Playwright

**Corrección al enunciado** (ya señalada antes de empezar): dice "138 tests
en 19 specs". La corrida limpia antes de tocar nada dio **147 passed + 2
skipped = 149 tests** en los mismos 19 specs (2 tandas de 9 y 10 specs, el
host no sostiene los 19 en un proceso). Usé 149 como piso real.

**Specs nuevos/ampliados agregados en esta tarea** (no se crearon archivos
nuevos — el recorrido de punta a punta que pide el enunciado ya está
cubierto, ver abajo):

- `shell.spec.js`: 3 tests nuevos de rol/lanzador (`recepcionista`,
  `veterinario`, rol `user` sin módulos) que verifican la matriz completa y
  el bloqueo por hash directo a una sección no permitida.
- `shell.spec.js`: assertion nueva de posición (no solo visibilidad) del
  panel "Resumen" de Orden abierta, que hubiera detectado el bug del punto
  1 de la sección 3; test actualizado para pasar por el nuevo modal de
  checkout de "Facturar orden" (antes creaba la factura con un solo click).
- `shell.spec.js`: assertion nueva sobre el nombre del tutor en la fila de
  Mascotas, que hubiera detectado el bug del punto 2.
- `auth.spec.js`: test nuevo de foco visible (`--focus-ring`) en los campos
  del Login nuevo y de login completo por teclado (Tab + Enter, sin mouse).
- `catalogo.spec.js`: 2 tests de UI existentes adaptados a la estructura
  maestro-detalle nueva (misma fuerza de aserción); test nuevo que cubre el
  panel completo (insumos con costo calculado, agregar uno por UI, historial
  de precios reflejando una edición).
- `gestion-inventario.spec.js`: test nuevo que confirma que el KPI "Bajo
  mínimo" coincide con `/alertas-stock` y que la pill homónima filtra la
  tabla por UI.

**Recorrido de punta a punta** ("llega el paciente → recepción abre la orden
y asigna veterinario → el veterinario carga la consulta y tres servicios de
tipos distintos → el gestor de laboratorio recibe el suyo y sube el PDF →
recepción factura"): ya está partido en varios specs existentes, tal como
permite el enunciado si se avisa en vez de duplicar:
`flujo-clinico.spec.js` (propietario→mascota→cita→consulta→factura),
`ordenes.spec.js` (orden sin veterinario → asignar veterinario → aparece en
su lista, incluida la reasignación vía `PUT /ordenes/{id}/veterinario`),
`servicios-desde-consulta.spec.js` ("abrir una consulta y anexarle 3
servicios de tipos distintos"), `despacho.spec.js` ("recorrido feliz
completo: anexar → confirmar → notifica → bandeja → tomar → ejecutar", con
el candado de adjunto obligatorio) + `adjuntos.spec.js` (el upload real del
PDF, `POST /api/servicios/{id}/adjuntos`), y el propio `shell.spec.js`
(panel del día → orden → anexar → confirmar → bandeja del gestor → tomar →
ejecutar, a nivel UI). No armé un
mega-test nuevo que reconstruya el camino de punta a punta con una sola
sesión de Playwright porque hubiera duplicado exactamente lo que estos
cuatro specs ya prueban por partes, con el costo de mantenimiento de tener
la misma lógica dos veces.

**Resultado, en dos momentos** (honesto sobre lo que se pudo re-confirmar y
lo que no — ver "lo que más me preocupa" al final):

1. **Corrida completa en 2 tandas**, después de Login, Reportes, las 5
   pantallas sin boceto y los bugs de la sección 3, pero *antes* de
   Catálogo/Insumos/Facturación/Ficha de mascota: Tanda 1 (9 specs) 65
   passed; Tanda 2 (10 specs) 86 passed + 2 skipped. **Total: 151 passed + 2
   skipped = 153 tests, 0 failed.**
2. Después de Catálogo, Insumos, Facturación y Ficha de mascota, corrí
   **cada spec afectado individualmente** (no la suite completa) y todos
   pasaron: `catalogo.spec.js` 9/9, `gestion-inventario.spec.js` 6/6,
   `inventario.spec.js` 3/3, `inventario-fraccionado.spec.js` 21/22 (1
   skip preexistente), `historial-precios.spec.js` 8/8, `clinico.spec.js` +
   `notas.spec.js` 12/12, `shell.spec.js` (recorrido feliz + facturar orden
   con consulta) confirmado dos veces. Al lanzar la corrida completa final
   de las dos tandas para cerrar la tarea, **Docker Desktop se cayó a mitad
   de la tanda 1** (64 passed, 1 falló por `ECONNREFUSED` — no por código,
   el contenedor dejó de responder — y 2 no llegaron a correr) y no se
   pudo recuperar desde WSL en lo que quedaba de la tarea. La tanda 2 no
   se re-intentó.

**No hay una corrida completa de las 19 specs juntas con TODOS los cambios
de esta tarea adentro.** Cada spec individual que toca algo modificado sí
está confirmado en verde; lo que falta es la confirmación cruzada de que
correr las 19 juntas (con la contención de recursos que eso implica en este
host) no produce una interacción que ningún spec aislado vería. Recomiendo
correr `npm run test:e2e` completo (2 tandas) apenas Docker Desktop esté
arriba de nuevo, antes de dar la rama por lista para mergear.

Sin ablandar ninguna aserción existente y sin marcar nada `skip` (los 2
skipped ya lo estaban antes de esta tarea, no los toqué).

---

## 6 · `_to_delete/`

Movidos con `git mv` (se conserva el historial como rename, no como
borrado+alta):

- `check_counts.py`, `check_db.py`, `dump_data.py`, `repair_app.py`,
  `test_api_responses.py` — scripts de depuración puntual con credenciales y
  rutas hardcodeadas (uno con una ruta absoluta de Windows). Ninguno se usa
  desde código ni CI.
- `demo_output.txt`, `err.txt`, `error_log.txt`, `seeding_error.txt` —
  salidas de corridas manuales.
- `dashboard-veterinaria.html` — mockup suelto con un sistema visual (Inter,
  tema oscuro) que no es el actual.

**`veterinaria.db`** (fuera de git, ya cubierto por `*.db` en `.gitignore`,
no se movió): **sí contiene datos reales**, no es un resto vacío como se
especulaba antes de esta tarea — confirmado abriéndolo con `sqlite3`:
**263 propietarios y 318 mascotas**, snapshot del 8 de septiembre (previo a
la migración a Postgres). Es un archivo de 385KB con permisos abiertos
(755) suelto en la raíz del repo. No lo toqué (no es mío decidir borrar un
archivo con datos reales de pacientes sin que alguien lo confirme), pero
es un problema aparte que merece resolución explícita — ver "lo que más me
preocupa" al final.

`docs/diseno/__pycache__/` (fuera de git) — borrado directo, es caché de
bytecode regenerable, no un archivo de trabajo.

`.gitignore` ya cubre todo lo que corresponde (`*.db`, `__pycache__/`, etc.)
— no hizo falta tocarlo.

---

## 7 · Documentación corregida

- `docs/diseno/pantallas/README.md` — "unidad de medida y stock fraccionado"
  e "historial de precios" ya no son pendientes (tareas 07 y 08), tachados
  con referencia a dónde se resolvieron. Los otros dos puntos (tutores
  jurídicos, catálogo de diagnósticos) siguen sin resolver — verificado
  contra el modelo actual.
- `docs/pruebas.md` — corregido que `seed_data.py` **sí** crea usuarios con
  `role='veterinario'` (la nota decía lo contrario); corregido "13 specs"/4
  specs listados por la lista completa de 19.
- `docs/diseno/1A/plan-shell.md` y `propuesta.dc.html` — marcados como
  superados por la Tarea 06 y `navegacion-v2.md`, igual que ya estaba
  marcado `docs/tareas/06-rediseno-1A-claude-design.md`.

---

## 8 · Pendientes (lo que los bocetos dibujan y el sistema todavía no puede hacer)

| Pendiente | Qué haría falta |
|---|---|
| Ficha de mascota — reestructuración completa del layout | El boceto reemplaza el layout de 3 columnas (lista maestra + tabs de íconos Resumen/Consultas/Servicios/Fórmulas/Notas/Cobros) por header + tabs Historia clínica/Órdenes/Vacunas y desparasitación/Archivos/Tutor + timeline. `consultorio.js` tiene 2529 líneas con formularios clínicos reales (vacunación, cirugía, hospitalización, pruebas, recetas) para 318 pacientes reales — reorganizarlo entero es un trabajo del tamaño de Catálogo+Insumos juntos, con más riesgo por tratarse de historiales clínicos. Se hizo la mejora aditiva de bajo riesgo (Constantes recientes, ver §1/§2); la reestructuración de tabs queda pendiente. |
| "Duración estimada" (Catálogo) | El boceto la muestra por servicio; `CatalogoServicioResponse` no tiene ese campo. Cambio de modelo chico (una columna). |
| "% del máximo" de stock (Insumos) | Implementado como "% del mínimo" (dato real) en vez de "% del máximo" (el boceto lo pide pero `InventarioResponse` no tiene un campo de stock objetivo/máximo). Si se quiere el original, hace falta agregar ese campo al modelo. |
| "Patologías más frecuentes" (Reportes) | Requiere un catálogo de diagnósticos cerrado. Hoy `Consulta.diagnostico` es texto libre. Cambio de modelo (tabla nueva + FK), fuera del alcance de esta tarea. |
| "Alergia" (Ficha de mascota) | El boceto la muestra en "Alertas"; no hay campo de alergias en el modelo, solo `observaciones` de texto libre general (ya usado para otra cosa). Cambio de modelo. |
| Tutores jurídicos | `Propietario` solo tiene nombre/apellido/cédula, no distingue persona física de jurídica. Cambio de modelo. |
| Columnas "Última visita" / "Órdenes abiertas" en Mascotas | El boceto las pide en vez de "Sexo". Necesita una agregación nueva por mascota (última consulta, conteo de órdenes abiertas) — no es un cambio de una línea, es un endpoint nuevo o una vista materializada. |
| Formato de moneda sin separador de miles | `static/js/core/format.js::money()` y variantes locales en `facturacion.js`, `catalogo.js`, `inventario.js`, `consultorio.js`, `reportes.js` usan `$${n.toFixed(2)}` sin separador de miles ni coma decimal — `$204000.00` en vez de `$ 204.000,00`. Es sistémico (afecta casi toda pantalla que muestra montos), no una sola línea. Requiere unificar en `money()` con `toLocaleString('es-AR')` y migrar cada call site — riesgo de romper alguna aserción exacta de texto en la suite, hay que revisar caso por caso. |
| Logo en el header del lanzador | `sec-inicio` muestra "AmiVets" en texto plano en el header (la sidebar, que sí tiene el logo, está oculta ahí). Boceto `Inicio.html` sí trae el ícono. Cambio chico pero toca el header global — bajo riesgo, baja prioridad. |
| Contaminación de datos de prueba en la base local | Ver la última sección. No es un pendiente de producto, es de higiene de entorno. |

---

## Lo que más me preocupa

La base de datos local de Docker —la misma que tiene los 318 pacientes y 264
tutores reales de la clínica que esta tarea tenía instrucción explícita de
no tocar— acumuló **1160 mascotas, 1225 propietarios y 885 usuarios
`PWTEST_*`** de corridas de la suite (confirmado con consultas directas a
Postgres). El *cleanup* de `helpers.js` está documentado como "best-effort"
a propósito, así que no es un descuido — pero la escala ya es tres a cinco
veces el dato real, y activamente degrada la utilidad de pantallas reales
(vi "Producción por médico" listar veterinarios de prueba en vez de los
reales, y "845 pacientes nuevos, 206% del total atendido" en Reportes antes
de mi fix). Si este mismo docker-compose se usara alguna vez como algo más
que un entorno de test descartable —o si alguien corre la suite contra una
base que no debería tocar por error de `BASE_URL`— el radio de daño ya es
grande. Sumado a que `veterinaria.db` (con datos reales de pacientes) está
suelto en la raíz del repo con permisos abiertos, el tema de "dónde vive el
dato real de la clínica y quién puede tocarlo sin querer" me parece el
punto que más atención humana necesita de todo lo que encontré.

Una línea aparte, operativa: Docker Desktop se cayó sobre el final de esta
tarea (ver §5) y no hay forma de reiniciarlo desde WSL. Antes de mergear
esta rama, correr la suite completa (2 tandas) con Docker arriba de nuevo —
todo lo que se pudo probar quedó en verde, pero la confirmación cruzada de
las 19 specs juntas después de Catálogo/Insumos/Facturación/Ficha de
mascota quedó pendiente por esto, no por elección.
