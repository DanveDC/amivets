# Design

## Context

- **Navegación del gestor.** El gestor ya entra directo a `sec-bandeja-gestor`, sin lanzador, y ve un solo módulo. El veterinario también ve "Mi bandeja" (`SERVICIOS_ROLES`), y un veterinario con una fila en `GestorArea` recibe servicios en ella.
- **Búsqueda global.**
  - `#cmdkTrigger` tiene `data-hide-for-role="gestor"`, y `applyRoleGating` le pone `hidden`. Pero `.av-search { display: flex }` (en `shell.css`) le gana al estilo por defecto de `[hidden]`, así que el botón sigue visible.
  - `cmdk.js` bloquea para `gestor` solo el atajo Ctrl+K (`ROLES_SIN_BUSQUEDA_GLOBAL`), no la apertura por clic.
  - `#bgFiltroLocal` también usa la clase `av-search`, pero no se oculta.
- **Bandeja** (`bandeja-gestor.js`):
  - Pide `GET /api/servicios/bandeja` (solo `ASIGNADO`/`EN_PROCESO`).
  - Resuelve el área mirando el catálogo del ítem, porque `ServicioConsultaResponse` no expone `area_id`.
  - Resuelve el nombre del área con `GET /api/areas/`, que da 403 al gestor, así que sale "Área #N".
  - Arma los chips con los servicios pendientes.
  - Inserta sin escapar el nombre del área, el del servicio y el del paciente.
- **Datos disponibles.**
  - `ServicioConsulta` tiene `area_id`, `asignado_a_id` y `ejecutado_at`.
  - `GestorArea(usuario_id, area_id)` relaciona encargados con áreas; `AreaServicio.activo` marca las áreas vigentes.
  - Los adjuntos ya se listan (`GET /api/servicios/{id}/adjuntos`) y se descargan (`GET /api/adjuntos/{id}`) con rol `gestor`.
- **Comisiones.** Existen `GET /api/comisiones/mias` (veterinario/gestor) y el PDF de la liquidación, que permite al dueño. El listado de liquidaciones es solo del admin.

## Goals / Non-Goals

**Goals:**
- Que el gestor no pueda abrir la búsqueda global por ningún camino del front.
- Que la pantalla muestre su rubro por nombre, aunque esté vacía.
- Historial de lo que el usuario ejecutó, con acceso a los adjuntos.
- Vista de sus comisiones y liquidaciones, con el PDF.
- Escapar todo texto del servidor en esa pantalla.

**Non-Goals:**
- Recortar en el backend el acceso del gestor a `/api/mascotas/` y `/api/propietarios/`. La bandeja usa `/mascotas/` para nombrar pacientes, y cerrar eso exige otro endpoint; queda anotado como riesgo.
- Editar o rehacer un servicio ya ejecutado.
- Cambiar las pantallas de veterinario, recepcionista o admin.
- Notificaciones en vivo de la bandeja.

## Decisions

1. **Ocultar la búsqueda en dos capas.**
   - CSS: `.av-search[hidden] { display: none; }` en `shell.css`, con la misma especificidad que `.av-search` y declarada después, así gana.
   - JS: `cmdk.js` revisa el rol en su función de apertura (no solo en el atajo); si el rol está en `ROLES_SIN_BUSQUEDA_GLOBAL`, no abre.

   *Alternativa descartada:* `!important` global sobre `[hidden]`. Podría romper otros componentes que dependen de mostrarse con `hidden` y una clase.

2. **`GET /api/areas/mias`.** Para cualquier usuario autenticado; devuelve las `AreaServicio` activas con fila en `GestorArea` para `current_user`, ordenadas por nombre (id, nombre, código). No expone la lista completa de áreas ni la de otros gestores. *Alternativa descartada:* abrir `GET /api/areas/` al gestor. Le mostraría las áreas de todos.

3. **`area_id` en `ServicioConsultaResponse`.** Campo opcional agregado; el ORM ya lo tiene. La bandeja deja de adivinar el área por el catálogo. No rompe a ningún consumidor, porque se agrega un campo.

4. **`GET /api/servicios/realizados`** (gestor y veterinario).
   - Filtros: `asignado_a_id == current_user.id`, `estado == 'EJECUTADO'`, `is_deleted == false` y `ejecutado_at` dentro de `desde`/`hasta` (fechas, por defecto hoy, con el mismo criterio de límites UTC que reportes). `area_id` es opcional y debe ser una de sus áreas; si no, 403.
   - Orden: `ejecutado_at` descendente, con límite de 200.
   - Respuesta (`ServicioRealizadoResponse`): `id`, `nombre_servicio`, `area_id`, `area_nombre`, `mascota_nombre`, `orden_id`, `orden_numero`, `ejecutado_at`, `detalles_clinicos` y `adjuntos` (cantidad).
   - Para evitar N+1, los nombres se resuelven con joins o consultas por lote (áreas, mascotas, órdenes y conteo de `Adjunto` agrupado).
   - Un servicio facturado sigue en `EJECUTADO` (la facturación es un flag), así que el filtro alcanza.

5. **`GET /api/comisiones/mias/liquidaciones`** (veterinario/gestor). Reutiliza `comision_service.listar_liquidaciones(db, current_user.id)`.

6. **La pantalla: tres pestañas en `sec-bandeja-gestor`.** Botones del tipo "Bandeja · Realizados · Mis comisiones" arriba (mismo estilo que `pd-filter` de Facturación), cada uno con un contenedor hermano con `hidden`.
   - **Bandeja:** la actual, con cabecera "Tu rubro: Laboratorio · Estética" desde `/areas/mias` y chips por esas áreas (por `area_id`, no por nombre). Si no tiene áreas, un aviso.
   - **Realizados:** rango (Hoy / Esta semana / Este mes + fechas), chip de área y una tabla. Al abrir una fila se listan sus adjuntos con descarga autenticada (`fetch` con token + blob, como el PDF de facturación).
   - **Mis comisiones:** rango (este mes por defecto), pendientes y liquidadas con totales, y la lista de liquidaciones con "Descargar PDF". Reusa el formateo de `comisiones.js` exportando sus helpers de render, o duplicando lo mínimo si el acoplamiento no conviene.

   Las pestañas no cambian la sección del router: es la misma `sec-bandeja-gestor`.

7. **Escape.** Todo `innerHTML` de `bandeja-gestor.js` que interpole texto del servidor pasa por `escapeHtml`. Los chips usan `data-area-id` numérico en vez del nombre como clave.

8. **Tests.** Playwright e2e en `e2e/pantalla-encargado.spec.js`:
   - API: `/areas/mias`, `/servicios/realizados` (propio, ajeno, rango, área ajena 403) y `/comisiones/mias/liquidaciones`.
   - UI: el buscador no se ve ni abre para el gestor; el rubro aparece con la bandeja vacía; un servicio ejecutado aparece en Realizados con su adjunto descargable; "Mis comisiones" muestra la línea y descarga el PDF; un nombre con HTML no se ejecuta.

   Revisar `despacho.spec.js` y `shell.spec.js`, que usan la bandeja.

## Risks / Trade-offs

- **[Acceso del gestor al padrón]** Aunque no vea el buscador, el backend le sigue respondiendo `/api/mascotas/` y `/api/propietarios/`. → Se deja para otro change, que tendría que exponer el nombre del paciente dentro de la respuesta de la bandeja.
- **[Veterinario en la bandeja]** Las pestañas nuevas también las ve el veterinario, porque comparte la sección. → Es deseable: él también ejecuta servicios y cobra comisión. "Realizados" solo lista lo que tomó por la bandeja, no sus consultas.
- **[Volumen del historial]** Un límite de 200 por consulta puede cortar un rango grande. → Se avisa en la pantalla cuando se llega al límite.
