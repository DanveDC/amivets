# AmiVets — Navegación v2 (Tarea 06, etapa 7)

Decisiones de navegación y de alcance para la etapa 7 ("Pantallas: inicio de
módulos, panel del día, orden abierta, anexar servicio, bandeja del gestor").

Este documento es a la navegación lo que `ordenes-de-servicio.md` fue al modelo:
la fase de implementación lo sigue al pie de la letra y no vuelve a decidir nada
de fondo. Cinco decisiones, cada una con su justificación y lo que se descartó.

Referencias: `docs/tareas/06-sistema-por-ordenes-de-servicio.md` (el enunciado),
`docs/diseno/arquitectura-informacion-v2.md` (los seis módulos y la propuesta de
navegación), `docs/diseno/ordenes-de-servicio.md` (el modelo y la matriz de
permisos §9.3), `docs/diseno/pantallas/` (las once maquetas).

---

## 0. El estado real del front — verificado, no asumido

Antes de decidir qué se reemplaza hay que saber qué hay. Estos seis puntos se
verificaron en el código y son los que dimensionan la etapa:

| Hallazgo | Evidencia |
|---|---|
| El shell es una **barra de pestañas plana**, no una barra lateral: `av-topbar` de 52 px + `av-tabs` de 39 px | `static/css/amivets.css:15-16`, `static/templates/index.html:43-86` |
| **12 secciones** registradas (no 13): 7 pestañas y 5 alcanzables por el menú de usuario | `static/js/core/router.js:38-58` |
| El verde clínico `--primary: #3F6B4F` **está muerto**: `bridge.css` se carga al final y lo remapea al acento 1A | `static/css/styles.css:22`, `static/css/bridge.css:19-22` |
| Lo que el navegador pinta hoy es **Nocturne oscuro** con acento `#9184d9` e Inter, no el sistema claro de las maquetas | `static/css/nocturne.css:11-14`, `static/css/bridge.css:13-16` |
| `styles.css` **ya declara** Geist / Newsreader / Geist Mono, pero `index.html` solo carga Inter de Google Fonts: esas familias nunca se descargan | `static/css/styles.css:14-16`, `static/templates/index.html:21` |
| La **búsqueda global ya existe**: paleta de comandos con Ctrl/Cmd+K sobre pacientes y propietarios | `static/js/core/cmdk.js:1-3` |

Y el dato que ordena la secuencia: `bridge.css` se autodescribe como
**transitoria**, y su destino era *"se BORRA en la etapa 5, cuando styles.css
desaparezca"* (`bridge.css:8-9`). Esa etapa 5 era de la tarea 1A, que quedó
reemplazada (`docs/tareas/06-rediseno-1A-claude-design.md`). El puente sigue en
pie pero ya no lleva a ninguna parte.

---

## Decisión 1 — Qué reemplaza a qué, y qué significa "overhaul completo" en la etapa 7

El enunciado parte el trabajo de pantallas en dos etapas: la 7 son las cinco
pantallas listadas, la 8 es *"resto de pantallas y limpieza del menú viejo"*. La
pregunta es dónde cae la piel y el shell, que el enunciado no asigna.

**Decisión: el shell y la piel se reemplazan completos en la etapa 7; los
layouts de las secciones que la etapa 7 no lista se rehacen en la etapa 8.**

Concretamente, en la etapa 7:

1. **Shell.** `av-topbar` (52 px) + `av-tabs` (39 px) se retiran y se reemplazan
   por el shell de las maquetas: **barra lateral de 248 px** con los seis
   módulos y **cabecera de 68 px**. `router.js` conserva el registro de
   secciones, `roleAllows()` y `showDenied()`; se eliminan `renderTabs()`,
   `wireTabs()` y `activateTab()`.
2. **Piel.** Se dejan de cargar `nocturne.css`, `themes.css`, `amivets.css` y
   `bridge.css`. `styles.css` vuelve a ser la hoja base y solo cambian de valor
   `--primary`, `--primary-light`, `--primary-dark`, `--primary-subtle` y
   `--focus-ring`: verde clínico → teal de marca (`#0C7A89` / `#13ABDF` /
   `#0B6976` / `rgba(12,122,137,0.07)`). Actualizar también el *fallback*
   literal de `static/js/sections/historial-precios.js:88`.
3. **Tipografía.** Corregir el `<link>` de Google Fonts de `index.html` para que
   traiga Geist, Geist Mono y Newsreader. Es una línea y con ella el sistema
   tipográfico que `styles.css` ya pide empieza a existir.
4. **Shell nuevo, CSS nuevo.** La barra lateral, la cabecera, el lanzador y la
   cola del gestor viven en una hoja propia (`static/css/shell.css`) cargada
   después de `styles.css`. Lo que se rescata de `amivets.css` es únicamente el
   estilo de la paleta de comandos (`.av-cmdk*`), que se muda ahí.
5. **Las otras secciones no se rediseñan.** Agenda, propietarios, inventario,
   catálogo, usuarios, perfil, citas web y reportes se **rehospedan** bajo el
   módulo que les corresponde en la barra lateral y siguen con su layout actual.
   Al quitarse `bridge.css` —que solo remapeaba tokens— recuperan el aspecto
   claro nativo de `styles.css`, que ya es el sistema de las maquetas. No se
   rompen: se acercan al objetivo.

**Justificación.** La piel no se puede partir en dos. Si `bridge.css` se queda,
las cinco pantallas nuevas se pintan en morado sobre fondo oscuro mientras sus
maquetas son claras y teal: no es un estado entregable ni revisable. Y el costo
de retirarla es bajo por dos razones verificables: (a) solo remapea *tokens* que
`styles.css` ya define con los valores correctos; (b) sus únicos consumidores de
componentes 1A son `sec-hoy` (`.av-hoy`) y `sec-consulta-abierta` (`.av-ca`), que
son **exactamente** las dos secciones que la etapa 7 reemplaza por *Panel del
día* y *Orden abierta*. Retirar la capa 1A en la etapa 7 no deja huérfanos
porque la etapa 7 se lleva a sus dos únicos inquilinos.

Lo que "overhaul completo" **no** significa: no se rehacen los formularios, las
tablas ni los 25 modales de las secciones viejas. Eso es etapa 8, y el enunciado
lo dice.

**Alternativas descartadas**

| Alternativa | Por qué no |
|---|---|
| Mantener `bridge.css` y pintar solo las 5 pantallas nuevas en teal | Aplicación con dos pieles durante toda la etapa 7 y 8. Imposible de revisar y de mostrar a la clínica. |
| Retirar la capa 1A en la etapa 8, junto con "la limpieza del menú viejo" | La etapa 7 tiene que entregar cinco pantallas que ya no pueden verse como sus maquetas. Se estaría entregando una etapa que no cumple su propio criterio de aceptación. |
| Rediseñar también las 8 secciones restantes ahora | Scope que el enunciado asigna explícitamente a la etapa 8. |
| Conservar el modo claro/oscuro de `themes.css` | No hay variante oscura diseñada en ninguna de las once maquetas. Se retira el `themeToggle` de `index.html` y el script anti-FOUC de `data-theme` del `<head>`. Si la clínica lo pide, se diseña primero. |

---

## Decisión 2 — Cuál es la pantalla de inicio

Hay dos frases que hay que reconciliar. `arquitectura-informacion-v2.md` §3:
*"el mapa de seis módulos se conserva como estructura mental y como **barra
lateral**"* y *"el **panel del día** (Admisión) como pantalla de inicio"*. El
enunciado de la etapa 7: *"la **pantalla de entrada** es el lanzador de
módulos"*.

No se contradicen: hablan de dos momentos distintos. Una es la entrada a la
**sesión**, la otra es el aterrizaje del **trabajo**.

**Decisión: el lanzador de seis módulos (`Inicio.html`) es la entrada de sesión.
El panel del día sigue siendo el aterrizaje del trabajo, pero por dentro del
módulo 1. La barra lateral de seis módulos es permanente en todas las pantallas
de trabajo.**

Las reglas, sin ambigüedad:

1. **Después del login se entra al lanzador.** `DEFAULT_SECTION` pasa de
   `sec-hoy` a `sec-inicio`. El `.av-brand` de la barra lateral pasa de
   `href="#sec-hoy"` a `#sec-inicio`: el logo siempre vuelve al lanzador.
2. **El lanzador no tiene barra lateral.** Está *por encima* de los módulos, no
   dentro de uno. Solo lleva la cabecera de 68 px con marca, búsqueda global y
   usuario. Repetir las seis tarjetas y la barra lateral en la misma pantalla es
   redundancia, no navegación.
3. **Dentro de un módulo, cambiar de módulo se hace por la barra lateral, no
   volviendo al lanzador.** El lanzador no es un peaje: se ve una vez por sesión.
4. **La tarjeta 1 abre el panel del día** (`Main.html`), que es la portada del
   módulo 1 y no la del sistema.
5. **Las tarjetas que el rol no puede usar no se dibujan.** Sin tarjeta apagada,
   sin candado, sin "sin acceso". La grilla se recompone. La visibilidad se
   deriva de la matriz de permisos de `ordenes-de-servicio.md` §9.3 — no es una
   segunda lista que pueda quedar desincronizada:

   | Rol | Módulos visibles | Derivado de |
   |---|---|---|
   | Administrador | 1 · 2 · 3 · 4 · 5 · 6 | todas las filas ✅ |
   | Recepción | 1 · 3 · 5 | filas 1, 2, 5, 22 y 19; ❌ en 8, 14, 23, 25 |
   | Veterinario | 1 · 2 · 3 | filas 1, 3, 8, 9, 22; ❌ en 19-21, 23, 25 |
   | Gestor de servicio | 2 (solo *Mi bandeja*) | filas 10, 11, 16; ❌ en 1, 5, 19, 22 |

6. **Si el rol tiene un solo módulo utilizable, se omite el lanzador y se entra
   directo a él.** Un gestor puro cae en `BandejaGestor`. Un lanzador de una
   tarjeta es un paso muerto.
7. **El módulo 6 se muestra solo al administrador** en la etapa 7, y queda
   anotado como punto abierto (ver §Puntos abiertos): hoy `sec-reportes` es una
   pestaña visible para todos y la matriz §9.3 no cubre la lectura de KPI.

**Justificación.** El lanzador gana la entrada porque es lo que pide el
enunciado, y porque es el único lugar del sistema donde el recorte por rol es
*legible*: un gestor que ve una tarjeta y un administrador que ve seis entienden
su alcance sin leer documentación. La barra lateral se conserva porque §3 la
conserva y porque sin ella cada cambio de módulo obligaría a volver al lanzador
— justo el "ir y volver al menú" que el rediseño quería eliminar.

**Alternativas descartadas**

| Alternativa | Por qué no |
|---|---|
| Panel del día como landing, lanzador como pantalla secundaria accesible desde el logo | Contradice el enunciado, y deja el recorte por rol invisible. |
| Lanzador como landing **y** sin barra lateral en ningún lado | Cada cambio de módulo pasa por el lanzador: dos clics donde había uno. |
| Lanzador como panel desplegable sobre la barra lateral | Es un menú disfrazado; reintroduce el árbol de funciones que §3 descarta. |

---

## Decisión 3 — La orden abierta y el panel de anexar servicio

Ya hay precedente en el código: `sec-consulta-abierta` está registrada con
`tab: false` (`router.js:46`) porque se abre desde otro lado y no es una entrada
del menú.

**Decisión: la orden abierta sigue ese patrón. Anexar servicio es un panel
lateral de 452 px hermano del contenido, dentro de la misma sección.**

1. **`sec-orden-abierta`, `tab: false`.** No es entrada de la barra lateral. Se
   abre desde el panel del día, desde la ficha del paciente, desde la búsqueda
   global y desde la orden de origen en la bandeja del gestor.
2. **La barra lateral no se apaga:** mientras la orden está abierta, *Admisión*
   queda marcado como módulo activo. La orden es contexto dentro del módulo 1,
   no un lugar fuera del sistema.
3. **Anexar servicio no es una ruta.** Es un panel dentro de
   `sec-orden-abierta`. La maqueta `AnexarServicio.html` lo dibuja como
   **hermano flex de `<main>`**, no como capa flotante: `width:452px`,
   `border-left:1px solid #EAEAEA`, `box-shadow:-2px 0 8px rgba(0,0,0,0.04)`, con
   su propia cabecera de 68 px. **Comprime el contenido, no lo tapa.** La orden
   y su total acumulado siguen visibles y legibles mientras se elige el servicio;
   eso es justamente lo que un modal impide.
4. **No es un modal.** `arquitectura-informacion-v2.md` §3 lo dice explícito:
   *"Anexar un servicio es un panel lateral, no un modal que hay que abrir y
   cerrar tres veces seguidas"*. Los modales quedan para confirmaciones cortas
   (anular una orden, confirmar el despacho).
5. **Comportamiento:** Esc cierra, el foco queda atrapado dentro del panel
   mientras está abierto, la orden no pierde su posición de scroll al cerrarlo, y
   anexar un servicio no recarga la orden completa — inserta la fila.

**Alternativas descartadas**

| Alternativa | Por qué no |
|---|---|
| Ruta propia `sec-anexar-servicio` | Perder de vista la orden es el error que el rediseño corrige; además obliga a volver navegando. |
| *Drawer* flotante sobre la orden con fondo oscurecido | Es un modal con otro nombre: tapa el total acumulado, que es lo que se está mirando al anexar. |
| Modal, como las 25 que ya hay | Descartado explícitamente por `arquitectura-informacion-v2.md` §3. |

---

## Decisión 4 — La búsqueda global

`arquitectura-informacion-v2.md` §3 la presenta como *"el reemplazo práctico de
la navegación por menús"*. La etapa 7 del enunciado no la lista entre sus
pantallas. Pero tampoco es trabajo nuevo: **ya existe**. `static/js/core/cmdk.js`
es una paleta de comandos completa —Ctrl/Cmd+K, `role="dialog"`, foco atrapado,
flechas, Enter navega— que busca pacientes y propietarios en paralelo.

**Decisión: en la etapa 7 la búsqueda global se re-hospeda, no se construye. La
búsqueda por número de orden y por número de factura queda fuera de la etapa 7.**

1. La caja de la cabecera de las maquetas (330 × 38 px, radio 6, atajo `⌘K`
   visible) es el disparador `#cmdkTrigger` ya existente, mudado al nuevo header
   de 68 px. `cmdk.js` no se reescribe.
2. Se corrige el vocabulario: el rótulo dice **"dueño"** y tiene que decir
   **"tutor"** (`index.html:48-50`).
3. **La búsqueda por orden y por factura queda fuera de la etapa 7.** Dicho con
   esas palabras, y por dos razones: la etapa 7 no la lista, y `cmdk.js` ya
   documenta que no existe endpoint `/facturas/?search`
   (`cmdk.js:193`). Queda como deuda anotada para la etapa 8, junto con el
   endpoint de búsqueda de órdenes.
4. **Consecuencia de la anterior:** mientras la búsqueda por orden no exista, el
   rótulo del disparador dice **"Buscar mascota o tutor"**, no *"mascota, tutor,
   orden o factura"* como en las maquetas. Un control que promete lo que no hace
   es peor que un control más chico.
5. **La búsqueda global está alcanzada por el rol.** El gestor **no** la tiene:
   la matriz §9.3 fila 4 dice que solo ve sus servicios y la cabecera de su orden,
   así que un buscador del padrón de pacientes sería una fuga. En su lugar,
   `BandejaGestor.html` lleva un **filtro local** de 230 × 34 px sobre su propia
   cola. Esto no es cosmético: si la implementación monta el mismo header para
   todos los roles, filtra en el front lo que tiene que filtrar el backend.

---

## Decisión 5 — Lo que la implementación no se puede permitir descubrir sola

Seis cosas del código actual que muerden si se encuentran tarde.

1. **`static/js/sections/ordenes.js` ya existe y no tiene nada que ver.** Es un
   shim de la tarea 09 sobre **citas**: consulta `/citas/`, cuenta las
   `PENDIENTE` para un badge y expone `atenderOrden(citaId, mascotaId)` que abre
   el consultorio. Colisión directa de nombre con la sección de órdenes de
   servicio que la etapa 7 necesita.
   **Hay que renombrarlo a `sections/citas-pendientes.js`** (o borrarlo, si el
   nuevo panel del día ya no necesita ese badge) y dejar `sections/ordenes.js`
   libre. Importadores a actualizar: `app.js:30`, `agenda.js:11`,
   `consultorio.js:19`; y `hoy.js:289` escucha su evento `av:hoy-refresh`.
   **No fusionar los dos conceptos**: una es una cita agendada, la otra es el
   contenedor de facturación del paciente.
2. **El ARIA queda roto si solo se cambia la barra.** Las 12 `<section>` de
   `index.html` llevan `role="tabpanel"` y `aria-labelledby="tab-sec-*"`. La
   barra lateral es un `<nav>` con enlaces, no un `tablist`: hay que quitar esos
   atributos de las 12 secciones, o quedan `tabpanel` sin `tablist` y el patrón
   de pestañas WAI-ARIA a medio desmontar.
3. **La suite e2e tiene un único punto de contacto con el shell.**
   `e2e/helpers.js:937`, `gotoSection()`, es lo único que conoce `.av-tab` y
   `.av-usermenu`. El cambio de shell se absorbe ahí y no en los 13 specs. No
   debilitar aserciones ni marcar `skip` (restricción del enunciado).
4. **La agenda tiene un parche de altura que depende del shell viejo.**
   `bridge.css:108-114` desclava la altura de FullCalendar *porque el shell 1A es
   content-height*. Al cambiar a un shell de altura fija con scroll por sección,
   ese parche hay que **re-resolverlo**, no copiarlo a ciegas: `agenda.js` inicia
   el calendario con `height:'auto'` por la misma razón.
5. **Los iconos: no agregar dependencias, no reescribir cien.** Phosphor
   (`@phosphor-icons/web@2.1.1`) ya está cargado y las secciones viejas lo usan.
   Las maquetas usan SVG inline de 19/16 px con `stroke-width:1.7`. Regla: el
   shell nuevo (seis módulos, cabecera, lanzador, bandeja) usa los SVG inline
   copiados de las maquetas; las secciones no rediseñadas siguen con Phosphor
   hasta la etapa 8. Ninguna dependencia nueva.
6. **El logo de las dos maquetas nuevas es SVG inline, no el PNG en data URI** de
   las otras nueve. Al llevarlo a código da igual: en la aplicación se referencia
   el archivo del logo, no un data URI. Ver la nota en
   `docs/diseno/pantallas/README.md`.

---

## Puntos abiertos

Los tres se resolvieron en la etapa 8:

- ~~**Quién ve el módulo 6.**~~ Resuelto: sigue solo-admin. La matriz §9.3
  cubre liquidaciones (admin) pero no la lectura de KPI en general; esconder
  el módulo lo restringe de hecho, y así queda — la etapa 7 ya lo mostraba
  solo al administrador y la etapa 8 confirma la decisión sin tocarla. Si la
  clínica quiere que cada veterinario vea sus propios números, sigue siendo
  una lectura con alcance de backend que no se decidió, no un cambio de
  visibilidad de tarjeta.
- ~~**Pantalla de entrada del módulo 3.**~~ Resuelto: `docs/diseno/pantallas/
  Mascotas.html` es la maqueta nueva (listado por especie, búsqueda, acceso a
  la ficha) y `sec-mascotas` (`sections/mascotas.js`) es la entrada real del
  módulo 3 desde la etapa 8. `sec-propietarios` sigue registrada en
  `router.js` como ruta alcanzable (`verMascotasPropietario` la sigue usando),
  pero ya no tiene entrada de sidebar propia.
- ~~**Notificaciones en la cabecera.**~~ Resuelto: el mismo panel de la
  campana (`core/notificaciones.js`) agrega un botón "Ver histórico" que
  cambia a listar TODAS las notificaciones del usuario (leídas + no leídas),
  paginadas con `skip`/`limit` sobre `GET /api/notificaciones` (el `skip` es
  nuevo en esta etapa) y un botón "Cargar más" al pie. No se abrió una
  sección nueva — el panel ya scrollea dentro de sus 420px.

Un cuarto punto, no listado acá pero sí en `cmdk.js` (comentario inline): la
búsqueda global no cubría número de orden ni número de factura. También se
resolvió en la etapa 8 — `GET /api/ordenes/` ahora acepta `?numero=` (filtro
nuevo, mismo patrón que sus otros `Optional`) y `cmdk.js` empezó a usar
`GET /api/facturas/?search=`, que ya existía en el backend desde antes y
nunca se había conectado a la paleta de comandos.
