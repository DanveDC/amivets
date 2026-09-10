# Etapa 2 — Shell + router + troceo de `app.js`

Contrato de la etapa 2 de la tarea 06. Depende de: `docs/diseno/1A-tokens.md`,
`static/css/nocturne.css`, `static/css/amivets.css`, `docs/diseno/1A/propuesta.dc.html`.

## Objetivo

Reemplazar el chrome de la SPA por el shell 1A (barra superior + pestañas
explícitas + command palette) y trocear `static/js/app.js` (4608 líneas, un solo
archivo) en **módulos ES nativos por dominio**. **Sin cambiar el comportamiento
de ninguna sección** — el rediseño de cada sección es la etapa 3.

## Restricciones (de la tarea)

- No tocar el backend, ni el contrato de auth, ni el manejo del token.
- Sin build step. FastAPI sirve estáticos directo. Módulos ES nativos, sin bundler.
- Sin dependencias nuevas salvo por CDN pineada y justificada.
- Los tres roles (`admin`, `veterinario`, `recepcionista`) y sus permisos se
  conservan exactamente. Nada que hoy vea solo un admin puede quedar visible
  para otro rol.
- Texto de UI en español, terminología existente.

## Hallazgos del recon (estado actual)

- `static/templates/index.html` (1986 líneas): head carga `styles.css?v=27`,
  **htmx 1.9.10 (cargado pero CERO uso — 0 atributos `hx-`)**, Chart.js,
  FullCalendar 6.1.10, fuentes Geist/Geist Mono/Newsreader. Al final:
  `auth.js?v=3` + `app.js?v=31` como scripts clásicos.
- Dos zonas de nav hoy: un `.nav` superior con 3 links y un sidebar
  `.menu-item` con 11 ítems. Ambas usan `data-target="sec-*"`.
- 11 secciones `<section class="content-area spa-section">`:
  `sec-consultorio`, `sec-agenda`, `sec-propietarios`, `sec-usuarios`,
  `sec-inventario`, `sec-facturacion`, `sec-reportes`, `sec-ordenes-medico`,
  `sec-perfil`, `sec-citas-web`, `sec-catalogo`.
- ~15 modales (`#modalPropietario`, `#modalMascota`, `#modalConsulta`,
  `#modalDetalleConsulta` [`.modal-xl`], `#modalReceta` [`.modal-lg`],
  `#modalCita`, `#modalProducto`, `#modalEditarProducto`, `#modalMovimientoStock`,
  `#modalNuevoUsuario`, `#modalEditarUsuario`, `#modalTransferir`,
  `#modalResumenDia`, `#modalPreviewFactura`, `#modalCatalogoServicio`, …).
- `app.js`: **CRLF line endings** (resto del repo es LF). Sin IIFE — todo en
  top-level. Handlers inline expuestos como `window.X = …`
  (`verConsultaCompleta`, `facturarConsulta`, `atenderDesdeOrden`,
  `exportarConsultaPDF`, `exportarRecetaPDF`, `exportarFacturaPDF`,
  `exportarAbonoPDF`, `abrirModalAbono`, `abrirPreviewFactura`,
  `verDetallesDesdeAgenda`, `checkInCita`, `atenderDesdeOrden`, …). Solo 17
  handlers inline en el HTML.
- Un solo `DOMContentLoaded` (línea 3510). Acoplamiento de nav:
  `.menu-item[data-target]`, `.spa-section`, `section.style.display`,
  `.menu-item.active`, `.admin-only` + `style.display='flex'`,
  `showSection()` que hace `.menu-item.click()`.
- `toggleForm(formId)` y varias funciones leen/escriben `el.style.display`
  directo — el `display:none` inline debe seguir inline en los elementos que
  se togglean así (ver 1A-tokens.md, regla del `.clinico-inline-form`).
- e2e: `e2e/helpers.js` es casi todo setup por API (`request.post('/token')`,
  `/api/inventario/`, …) — resiste cambios de DOM. Los selectores de DOM están
  en los specs (`auth`, `admin-panel`, `clinico`, `flujo-clinico`, `qr-booking`,
  `catalogo`, `reportes`, `notas`, `liquidaciones`, `gestion-usuarios`,
  `gestion-inventario`). En etapa 2 el DOM de sección se conserva → los specs
  quedan en el baseline actual (rojo por el import de datos reales de #153, no
  por esta etapa).

## Arquitectura de módulos (destino)

```
static/js/
  auth.js                  ← se mantiene igual, script clásico, carga primero
  app.js                   ← <script type="module">: bootstrap fino
  core/
    api.js                 ← fetchAPI, CircuitBreaker, manejo de error/red
    ui.js                  ← toast (ex showNotification), submitWithLoading,
                              openModal/closeModal, debounce, helpers de icono
    select.js              ← createPrettySelect, initSearchableSelect
    session.js             ← GET /usuarios/me, rol, nombre de usuario,
                              visibilidad por rol (reemplaza .admin-only)
    router.js              ← registro de secciones, pestañas, showSection(),
                              gating por rol, hash opcional
    cmdk.js                ← command palette (buscar paciente/dueño/factura)
  sections/
    consultorio.js  agenda.js  propietarios.js  inventario.js
    facturacion.js  reportes.js  ordenes.js  citas-web.js
    catalogo.js  usuarios.js  perfil.js
```

Reglas del troceo:

1. **Mecánico, sin cambiar lógica.** Cortar cada grupo de funciones de `app.js`
   a su módulo, agregar `export` a lo que el router/otros módulos necesiten,
   `import` lo compartido desde `core/*`. Archivos nuevos en **LF** (norma del
   repo); no editar `app.js` con scripts que normalicen CRLF→LF en masa.
2. Cada `sections/*.js` expone al menos `export function init()` (idempotente:
   segunda llamada re-hidrata, no duplica listeners — hoy varias funciones ya
   usan flags `*ListenersBound`). Si la sección necesita limpieza, `export
   function teardown()`.
3. `app.js` bootstrap:
   - importa `core/*` y registra las 11 secciones en el router
     (`router.register('sec-consultorio', consultorio.init, { roles: [...] })`).
   - expone en `window.*` **solo** los handlers que siguen referenciados por
     `onclick=` inline en el HTML (los 17), importándolos de sus módulos.
   - dispara el arranque en `DOMContentLoaded`.
4. `showNotification(msg, type)` se renombra a `toast(msg, type)` en `core/ui.js`
   con la firma equivalente (`type`: `info|success|error|warn`) y pinta un
   `.av-toast` en un `.av-toast-stack` (crea el stack si no existe). Se deja un
   alias `window.showNotification = toast` por compatibilidad con el HTML.
5. `openModal/closeModal` se mantienen (mismo `id`, misma clase `.show`). El
   restyle de modales a `.dialog` Nocturne es etapa 3/5.
6. `htmx` se **elimina** del head (0 uso). Chart.js y FullCalendar se mantienen
   (los usan Informes y Agenda); se dejan por ahora, se revisan en su sección.

## Shell 1A en `index.html`

- **Head**: sacar `styles.css?v=27` y `htmx`. Agregar, en este orden:
  - `nocturne.css` y `amivets.css`
  - Google Fonts: `Inter:wght@400;500;600;700`
  - Phosphor: `https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css`
  - Chart.js y FullCalendar se mantienen.
  - Fuentes Geist/Newsreader: se sacan (Nocturne usa Inter).
- **Body**: reemplazar el header + sidebar por:
  ```
  <div class="av-app">
    <header class="av-topbar"> brand · av-search (trigger cmdk) · av-user · btn "Nuevo" </header>
    <nav class="av-tabs" role="tablist"> … pestañas … </nav>
    <main class="av-main"> … las 11 <section> … </main>
  </div>
  <div class="av-toast-stack" hidden></div>
  ```
- **Pestañas** (orden 1A, actualizado por Tarea 09 etapas 4–5):
  **Hoy** · Consultorio · Agenda · Propietarios · Facturación · Inventario ·
  Informes. Las restantes (Citas web/QR, Catálogo, Usuarios, Perfil) **no van
  en la barra**: entran por el menú del usuario (dropdown en `av-user`) y el
  command palette.
  - **Hoy** (`sec-hoy`) es la primera pestaña y el aterrizaje
    (`DEFAULT_SECTION`): bandeja de consultas `ABIERTA` + turnos en sala.
  - **Órdenes médico** (`sec-ordenes-medico`) **se eliminó** (Tarea 09,
    etapa 5): su función quedó absorbida por "Hoy". `sections/ordenes.js`
    queda como shim (badge + evento `av:hoy-refresh`).
  - **Consulta abierta** (`sec-consulta-abierta`) es una sección sin pestaña
    (Tarea 09, etapa 3): se abre desde "Hoy", desde el historial del paciente
    o al crear una consulta. Reemplaza al modal `#modalDetalleConsulta`.
  - `+ Nuevo` en la `av-topbar` es un menú (`av-newmenu`) con "Agregar
    consulta", "Agregar servicio directo" y "Agregar propietario".
  - Perfil → menú del usuario.
- **Gating por rol** (reemplaza `.admin-only` + `display:none`):
  `core/session.js` lee `/usuarios/me`, y `router.js` no registra / no pinta la
  pestaña ni la entrada de menú si el rol no corresponde, y bloquea la
  navegación directa por hash a una sección no permitida (muestra `.av-empty`
  "Sin acceso"). Mapa de roles: tomar el que ya aplica hoy —
  - `sec-usuarios`: solo `admin`.
  - `sec-ordenes-medico`: eliminado (Tarea 09, etapa 5).
  - resto: los tres roles (confirmar contra el comportamiento actual del HTML
    y de `checkAdminAccess`; si algo hoy no está gateado, no inventar
    restricciones nuevas).
- **Command palette** (`core/cmdk.js`): abre con click en `.av-search` o `⌘K` /
  `Ctrl+K`. Busca en paralelo pacientes (`/api/mascotas/?search=`), propietarios
  (`/api/propietarios/?search=` o equivalente) y facturas
  (`/api/facturas/?search=` o equivalente — usar los endpoints que ya existen;
  si alguno no soporta `search`, filtrar client-side sobre un listado corto y
  anotarlo como endpoint faltante). Enter navega: paciente → Consultorio con esa
  mascota seleccionada; propietario → Propietarios; factura → Facturación.
  Accesible: `role="dialog"`, foco atrapado, `Esc` cierra, flechas + Enter en la
  lista (`aria-selected`).

## Accesibilidad (nivel etapa 2, el resto por sección)

- `.av-tabs` con `role="tablist"`, cada `.av-tab` `role="tab"` +
  `aria-selected` + `aria-controls`; cada `<section>` `role="tabpanel"` +
  `aria-labelledby`. Flechas ←/→ mueven entre pestañas.
- Foco visible ya viene de Nocturne (`:focus-visible`).
- Todo botón que sea solo ícono lleva `aria-label`.
- El toggle de sección usa el atributo `hidden`, no `style.display`, salvo en
  los sub-forms que togglean con `el.style.display` (dejar inline ahí).

## Verificación de la etapa

1. `docker compose up -d` y comprobar `docker ps` antes de creer un run rojo.
2. `npm run test:e2e` — la firma debe quedar **igual al baseline actual**
   (rojo por el import de datos reales, no por esta etapa). Documentar la firma
   antes y después. No tocar aserciones de comportamiento; si un selector de
   navegación se rompe (`.menu-item` → `.av-tab`), actualizar **solo el
   selector** en el spec, no la aserción.
3. Cargar `/` en el navegador con los tres roles y recorrer las 11 secciones:
   cada una carga sus datos igual que antes.
4. Captura de `/` (shell) a `docs/diseno/capturas/1A/shell.png`.

## Commit

Un commit `feat(frontend): etapa 2 — shell 1A, router y troceo de app.js en módulos ES`.
Si el troceo y el shell salen muy grandes juntos, dos commits:
`feat(frontend): etapa 2a — troceo de app.js en módulos ES (sin cambio de comportamiento)`
y `feat(frontend): etapa 2b — shell 1A y router por pestañas`.
