# 1A — Tokens y sistema de diseño

**Fuente de verdad del rediseño (tarea 06).** Todo lo que se construya en la rama
`redesign/minimalist-ui` toma sus valores de este documento. Si algo acá
contradice a `sistema.md`, `arquitectura-informacion.md`, `auditoria.md` o
`docs/tareas/03-rediseno-frontend.md`, **manda este documento** — esos se
actualizan en la etapa de limpieza.

## Origen

- **Diseño**: proyecto Claude Design *"Sistema veterinario amigable"*
  (`a74a67d2-2e0a-4b10-b051-a30aa4cad189`), archivo
  `AmiVets - Propuestas de rediseño.dc.html`, **propuesta 1a** —
  *"Consulta en una sola pantalla"*. La 1b queda descartada.
- **Design system**: **Nocturne** (`884121ad-216f-419a-8a1c-c75b80cfd562`).
  Interfaz oscura, compacta, Inter en peso medio, radios de 8px, acento usado
  como línea y brillo, nunca como relleno. Reglas que se desvanecen en los
  extremos. Contraste por rampas tonales, no por saturación.
- Valores extraídos de `Nocturne/styles.css`, `Nocturne/theme.json`,
  `Nocturne/readme.md`, `Nocturne/foundations/layout.html`. **No se inventaron
  valores**; lo que el diseño no define está en la sección *Decisiones propias* y
  marcado como tal.

## Decisión: oscuro por defecto + claro opcional

Nocturne ships dark-only y 1A está dibujado en oscuro, así que **el default es el
tema oscuro**. Daniel pidió después sumar modo claro, así que hay un toggle
(menú de usuario) con tres estados: `oscuro` explícito, `claro` explícito, o sin
elegir = seguir el `prefers-color-scheme` del sistema. Persistido en
`localStorage['amivets-theme']`; un script inline en `<head>` estampa
`data-theme` antes del primer paint (no FOUC).

**Cómo se implementa** (`static/css/themes.css`): el tema claro **espeja las
rampas** neutral y de acento (100 ↔ 900, 200 ↔ 800, …) y da vuelta los roles de
fondo. Como cada componente elige un *paso* de rampa por su rol ("relleno oscuro
sobre oscuro" = 800/900, "texto claro sobre ese tinte" = 100/200), espejar la
rampa invierte todos los componentes de una sin CSS por componente. `--color-bg`
`#f6f7fb`, `--color-surface` `#fff`, `--color-text` `#1b1d29`, `--color-accent`
`#5d5294` (accent-700, para AA sobre blanco). Tokens semánticos oscurecidos para
AA. `bridge.css` mapea los tokens legacy a los de Nocturne, así que las secciones
sin migrar siguen el tema solas.

---

## Paleta

### Roles base

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#161826` | Fondo de la aplicación |
| `--color-surface` | `#232532` | Cards, barras, inputs, paneles elevados |
| `--color-text` | `#e9e9ed` | Texto principal |
| `--color-accent` | `#9184d9` | Líneas, marcas, íconos de acción, borde de botón primario, foco. **Nunca como relleno de área grande.** |
| `--color-accent-2` | `#a7a1db` | Esquema mono: resuelve igual que el acento. No elegir como segundo color. |
| `--color-divider` | `color-mix(in srgb, #e9e9ed 16%, transparent)` | Separadores, bordes de caja, líneas dentro de controles |

### Rampa neutral (100 claro → 900 oscuro)

`#f3f5fe` · `#e4e7f5` · `#cfd3e5` · `#b2b6ca` · `#9397ab` · `#75798c` · `#595d6c` · `#3f424d` · `#292b31`

Tokens: `--color-neutral-100 … --color-neutral-900`.

Sobre fondo oscuro:
- **700–900**: rellenos tintados, hovers, bordes sutiles.
- **500**: base del rol (texto secundario, íconos inactivos).
- **100–300**: texto sobre esos rellenos, estados *pressed*.

Preferir un paso de rampa antes que un `color-mix()` ad-hoc.

### Rampa de acento (100 → 900)

`#f5f4ff` · `#e7e5fe` · `#d2cefd` · `#b5abfc` · `#968ae0` · `#796cbf` · `#5d5294` · `#423a6a` · `#2b2741`

Tokens: `--color-accent-100 … --color-accent-900`. (`--color-accent-2-*` existe en
paralelo pero se trata como el mismo rol.)

- `--color-accent-900` / `--color-accent-800`: fondo de estado activo (item de
  menú seleccionado, tag de acento).
- `--color-accent-300`: **texto tamaño párrafo en acento** — el acento puro solo
  llega a 3:1, sirve para íconos, texto grande y chrome, no para texto corrido.
- `--color-accent-200` / `--color-accent-100`: texto sobre relleno de acento.

### Semántica (advertencia / éxito / error)

1A solo usa un color semántico explícito: **amarillo `#e0b062`** para
"1 vencida" / alertas de vacuna. Nocturne no define tokens semánticos.

**Decisión propia** — se agregan tres tokens mínimos, tomados de la familia
del amarillo de 1A y de la rampa para el resto, con chroma bajo para no romper
la regla de "no saturar":

| Token | Valor | Uso |
|---|---|---|
| `--color-warning` | `#e0b062` | Vencimientos, alertas clínicas (valor exacto de 1A) |
| `--color-danger` | `#d98a8a` | Errores de formulario, acciones destructivas, saldos vencidos |
| `--color-success` | `#8fae8f` | Confirmaciones, "cobrado", stock ok |

Se usan como **texto e ícono**, nunca como relleno de área. Fondo tintado de
estado: `color-mix(in srgb, var(--color-danger) 14%, transparent)` y equivalente.

### Ground saturado (`--color-section`)

`#262a60` / `#353b80` / `#4c5397`. Solo escala de deck/landing. **No usar en la
interfaz de AmiVets.**

---

## Tipografía

- **Familia**: `Inter` para títulos y cuerpo — `--font-heading` / `--font-body`
  (`"Inter", system-ui, sans-serif`). Cargar pesos 400, 500, 600, 700 desde
  Google Fonts (ya viene en el `@import` de `styles.css`).
- **Peso de títulos**: `--font-heading-weight: 500`. **No poner los títulos en
  negrita más allá de 500** — la jerarquía es tamaño y espacio, no peso.
- **Cuerpo base**: 15px / línea 1.55 / peso 400.
- `letter-spacing` de títulos: `-0.015em`. Línea de títulos: 1.12.

### Escala (de `styles.css`)

| Elemento | Tamaño |
|---|---|
| `h1` | 42px |
| `h2` | 32px |
| `h3` | 25px |
| `h4` | 20px |
| `h5` | 16px |
| `h6` | 13px · `letter-spacing: 0.08em` · `text-transform: uppercase` |

### Tamaños de UI que usa 1A (contexto denso, por debajo de la escala de títulos)

| Uso en 1A | Tamaño |
|---|---|
| Nombre de paciente (cabecera) | 26px, `letter-spacing: -0.02em` |
| Total de presupuesto / factura | 24–26px, peso 600, `font-variant-numeric: tabular-nums` |
| Valor de card / constante | 18–21px, peso 600 |
| Título de sección (`h4` visual) | 16px |
| Texto de fila, input, item de menú | 13–14px |
| Kicker / label / eyebrow | 11–12px, `letter-spacing: 0.06–0.1em`, `uppercase`, `--color-neutral-500` |
| Metadato fino (lote, fecha, sub) | 11px, `--color-neutral-600` |

`font-variant-numeric: tabular-nums` es **obligatorio** en toda cifra de dinero,
peso, cantidad y en columnas numéricas de tabla.

---

## Espaciado

Escala de 4px a densidad **0.70×** (ya calculada; usar el token, no el número):

| Token | Valor |
|---|---|
| `--space-1` | 2.8px |
| `--space-2` | 5.6px |
| `--space-3` | 8.4px |
| `--space-4` | 11.2px |
| `--space-6` | 16.8px |
| `--space-8` | 22.4px |

No hay `--space-5` ni `--space-7`. Padding de página en 1A: `--space-6`/`--space-8`.
Separar secciones con **whitespace de esta escala, no con reglas ni cajas**.

---

## Radios

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 4px | Chips diminutos, marca de tecla `⌘K` |
| `--radius-md` | 8px | Botones, inputs, cards, tags, la mayoría de las cosas |
| `--radius-lg` | 14px | Contenedor de pantalla, diálogo |

`.tag` usa `calc(var(--radius-md) * 0.75)` = 6px.

---

## Sombras / elevación

En fondo oscuro la elevación es **borde de pelo + oscuridad ambiente**, no capas
de sombra.

| Token | Valor |
|---|---|
| `--shadow-sm` | `0 0 0 1px #3f424d` |
| `--shadow-md` | `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)` |
| `--shadow-lg` | `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65)` |

Utilidades: `.elev-sm` / `.elev-md` / `.elev-lg`. 1A usa `--shadow-md` en el
marco de pantalla y `--shadow-lg` está reservado para el diálogo. **No apilar
sombras propias.**

---

## Estados (integrados en `styles.css`, no re-estilar por página)

| Estado | Regla |
|---|---|
| `:hover` | Tinte del acento: `color-mix(in srgb, var(--color-accent) 10–12%, transparent)` en variantes outline/ghost; `color-mix(... var(--color-text) 7%, ...)` en secundario/fila de tabla. |
| `:active` / pressed | Un paso más del tinte (22% acento / 14% texto) o `--color-accent-400` sobre fondo oscuro. |
| `:focus-visible` | `outline: 2px solid var(--color-accent); outline-offset: 2px;` — **nunca** el anillo azul del navegador. En controles con borde (`.input`, `.seg-opt`) el offset baja a 0 / -2px. |
| `:disabled` | `opacity: 0.45; cursor: not-allowed;` |
| `::selection` | `color-mix(in srgb, var(--color-accent) 30%, transparent)` |

---

## Inventario de componentes

### Existen en Nocturne (`styles.css`) — usar tal cual

| Componente | Clase(s) | Notas para 1A |
|---|---|---|
| **Botón** | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-icon` / `.btn-block` | Primario = **outline de acento sobre transparente**, jamás relleno. 14px, gap 6px, `padding: var(--space-2) calc(var(--space-3)*1.2)`. `.btn-icon` = 36×36. `.btn-block` = ancho completo + `margin-top: var(--space-2)`. Todo botón que sea solo ícono lleva `aria-label`. |
| **Tag / badge** | `.tag` + `.tag-accent` / `.tag-neutral` / `.tag-outline` (`.tag-accent-2` = igual que accent) | 11px, `padding: 3px 10px`, radio 6px. `.tag-accent` = fondo `--color-accent-800`, texto `--color-accent-100`. `.tag-outline` = borde + texto acento. 1A los usa para filtros ("En sala · 3", "Perros"), estado de borrador, y chips de historial. |
| **Campo de formulario** | `.field` + `<label>`, `.input`, `textarea.input` | `label`: 12px, `--color-text` al 70%, `margin-bottom: 5px`. `.input`: `min-height: 36px`, `padding: 6px 10px`, fondo `--color-surface`, borde `--color-divider`, `caret-color` acento. `textarea.input`: `min-height: 90px`, `resize: vertical`. Focus: borde acento. |
| **Radio** | `.radio` + `.dot` sobre `<input type=radio>` nativo | Punto de 16px; checked = relleno acento con `box-shadow: inset 0 0 0 4px var(--color-bg)`. |
| **Control segmentado** | `.seg` + `.seg-opt` (con `<input>` oculto) | Para "Forma de pago" (Efectivo / Tarjeta / Transfer.). Opción activa: texto acento + `box-shadow: inset 0 0 0 1px var(--color-accent)`. |
| **Card** | `.card` + `.card-kicker` / `.card-title` / `.card-body` / `.card-meta`; `.elev-sm/md/lg` | `.card`: flex column, `gap: var(--space-2)`, `padding: var(--space-3)`, fondo `--color-surface`, radio md. `.card-kicker`: 10px, `letter-spacing: 0.1em`, uppercase, **color acento**. En 1A el panel de presupuesto es una `.card` con `position: sticky`. |
| **Nav / header** | `.nav` + `.nav-brand` | `.nav`: flex, `gap: var(--space-4)`, `padding: var(--space-3) var(--space-4)`, **sin** `border-bottom` propio. `.nav-brand`: 18px, `margin-right: auto`. Link activo: `aria-current="page"` → color acento. (1A extiende esto, ver *Patrones compuestos*.) |
| **Tabla** | `.table` | `th`: 11px uppercase `letter-spacing: 0.08em`, texto al 60%. Reglas de fila **a nivel de fila** con gradiente que se desvanece 48px en cada extremo. Hover de fila: tinte del 4% que se superpone a la regla. Columnas numéricas: alinear a la derecha + `tabular-nums`. |
| **Diálogo** | `.dialog-backdrop` + `.dialog` (+ `.dialog-title` / `.dialog-body` / `.dialog-actions`) | `width: min(440px, 100%)`, `padding: var(--space-4)`, radio lg, `--shadow-lg`. Backdrop: `color-mix(in srgb, var(--color-neutral-900) 50%, transparent)`. `.dialog-actions` alinea a la derecha. **Reservado para confirmaciones cortas** — no para formularios largos (esos van a página o panel). |
| **Regla** | `.hr` | Existe pero el sistema **prefiere whitespace**. Usar solo donde 1A la dibuja explícitamente (entre "consulta en curso" e "historial"). |
| **Imagen** | `.lighten` | `mix-blend-mode: lighten`. Toda foto de contenido va envuelta acá. AmiVets casi no tiene fotos; aplica si aparece avatar de mascota real. |

### No existen en Nocturne — **decisiones propias** (derivadas del sistema)

| Componente | Definición propuesta | Por qué |
|---|---|---|
| **Command palette / búsqueda global** | Caja en la barra superior: fondo `--color-neutral-900`, borde `--color-neutral-800`, radio md, `padding: 6px 10px`, ícono `magnifying-glass` en `--color-neutral-500`, placeholder 13px, marca `⌘K` a la derecha (borde `--color-neutral-800`, radio 4px, 11px). Al abrir: overlay tipo `.dialog` pero anclado arriba, lista de resultados con la fila de `.table`/rail. | 1A la dibuja pero Nocturne no la tipifica. Es el reemplazo del menú de 11 ítems. |
| **Riel de pacientes (item)** | Fila: avatar circular 26px (`--color-neutral-900`, ícono de especie), nombre 13px, sub "raza · #historia" 11px `--color-neutral-500`. Activo: fondo `--color-accent-900` + `box-shadow: inset 2px 0 0 var(--color-accent)` + punto de 7px acento a la derecha. | Patrón central de 1A. |
| **Tira de constantes** | Grid de N columnas, `gap: 1px` sobre fondo `--color-divider`, cada celda `background: var(--color-bg)`, `padding: 10px 12px`: label uppercase 11px `--color-neutral-500`, valor 18px/600, delta 11px (acento-300 si sube, warning si alerta). | 1A la usa para Peso/Última visita/Vacunas/Alergias/Saldo. |
| **Fila de timeline (historial)** | Grid `74px 26px 1fr auto`: fecha `--color-neutral-500`, ícono en círculo 26px `--color-neutral-900`, título 13px/500 + detalle 12px `--color-neutral-500`, monto a la derecha `tabular-nums`. Separador: `border-top: 1px solid var(--color-divider)` por fila. | Reemplaza las ~12 pestañas del expediente actual. |
| **Panel de presupuesto vivo** | `.card` sticky de 320px: kicker "Presupuesto", líneas de cargo (nombre + detalle + precio con `border-bottom` divider), `.btn-ghost` "Agregar servicio o producto", subtotales en `--color-neutral-400`, total 24px/600, `.btn-primary.btn-block` "Cerrar consulta y facturar" + `.btn-secondary.btn-block`. | Corazón del flujo 1A. |
| **Estado vacío** | Contenedor centrado, `padding: var(--space-8)`: ícono Phosphor 32px en `--color-neutral-600`, título 16px, texto 13px `--color-neutral-500`, `.btn-secondary` opcional. Sin ilustración. | 1A no los dibuja; el sistema pide "diseñá de verdad los estados que hoy no existen". |
| **Toast / notificación** | Caja fija abajo-derecha: fondo `--color-surface`, `--shadow-md`, radio md, `padding: var(--space-3) var(--space-4)`, barra de 2px a la izquierda en `--color-success` / `--color-danger` / `--color-accent` según tipo, texto 13px, auto-cierre 4s, `aria-live="polite"`. | El `app.js` actual ya dispara notificaciones; hay que darles forma Nocturne. |
| **Skeleton / carga** | Bloques con `background: var(--color-neutral-900)` y animación de opacidad (0.5→1, 1.2s). Mismo alto que el contenido real. Nada de spinners centrados salvo acción puntual (botón con ícono girando). | Estado de carga inexistente hoy. |
| **Sin permisos** | Igual que estado vacío: ícono `lock`, "No tenés acceso a esta sección", sin botón. El item de nav ni se renderiza para ese rol (ver *Roles*). | Reemplazo de `.admin-only` + `display:none`. |

### Patrones compuestos de 1A (no son componentes nuevos, son composición)

- **Barra superior (52px)**: `--color-surface`, `border-bottom: 1px solid var(--color-divider)`. Contiene marca + command palette + nombre de usuario + `.btn-primary` "Nuevo".
- **Navegación explícita por pestañas**: fila de items 13px, `padding: 9px 14px`, activo con `box-shadow: inset 0 -2px 0 var(--color-accent)`. Reemplaza el sidebar de 11 ítems. Orden en escritorio: Consultorio · Agenda · Propietarios · Facturación · Inventario · Informes. Las secciones menos frecuentes (Catálogo, Citas web/QR, Usuarios, Perfil) entran por menú de usuario o command palette — **se decide y documenta en la etapa de shell**.
- **Layout de consultorio**: grid `264px 1fr` — riel de pacientes + panel del paciente. Dentro del panel: cabecera (nombre + constantes) y grid `1fr 320px` (consulta + presupuesto).
- **Tablet (768px)**: la barra colapsa a hamburguesa + nombre + `.btn-primary` "Facturar $X"; las pestañas se reducen a Consulta / Historial / Cuenta / Datos; el presupuesto pasa a una tira inferior con "Ver y cobrar".

---

## Reglas de oro (de `Nocturne/readme.md`)

1. **Nunca** hardcodear un hex, un nombre de fuente o un px que un token ya lleva.
2. **No inundar** áreas grandes con el acento ni con ningún relleno saturado. El
   acento vive en líneas, bordes, marcas e íconos.
3. Ni negro puro ni blanco puro — todo sale de las rampas (la sombra es la
   excepción: negro mezclado como oscuridad ambiente).
4. **Whitespace antes que reglas y cajas** para separar. `.hr` solo donde 1A la
   dibuja.
5. No apilar sombras; elevación = borde + oscuridad ambiente.
6. Títulos no pasan de peso 500. Jerarquía = tamaño y espacio.
7. Botones primarios **outline**, foco con `:focus-visible` de acento.
8. Íconos: **Phosphor** (`@phosphor-icons/web@2.1.1`, set `regular`), en todos
   lados. Reemplaza el `ICONS` map Lucide del `app.js` actual.
9. Densidad 0.7× a propósito — la interfaz es densa, no aireada.
10. Texto de párrafo en acento → `--color-accent-300`, no el acento puro.

## Dependencias de front que introduce 1A

| Recurso | Versión pineada | Cómo se sirve |
|---|---|---|
| Inter | Google Fonts (`wght@400;500;600;700`) | `<link>` desde `fonts.googleapis.com` |
| Phosphor Icons | `@phosphor-icons/web@2.1.1` (`/src/regular/style.css`) | `<link>` desde `unpkg.com` (pineado) |
| `Nocturne/styles.css` | copia vendorizada en el repo | archivo estático servido por FastAPI |

Sale: **Chart.js** y **FullCalendar** se evalúan sección por sección (Informes y
Agenda). Si se mantienen, se pinean por CDN y se justifican en el resumen final.
No se agrega bundler.

---

## Decisión: pantallas sueltas → todas al rediseño

Daniel: *"integralo al rediseño, integra todas las pantallas al rediseño"*.

- **`dashboard-veterinaria.html`** (897 líneas, raíz, sin trackear, sin ruta en
  FastAPI, paleta propia esmeralda, datos falsos hardcodeados): es el mockup de
  la sección **Informes**. Se reconstruye con tokens Nocturne y se cablea a
  `/api/reportes/*` (KPIs, ingresos por período, distribución de servicios,
  especies, pacientes por día, top razas, ingresos por veterinario, citas del
  día). El archivo suelto se elimina en la etapa de limpieza una vez que su
  contenido vive dentro del SPA. Widgets que el backend no soporte hoy →
  se listan en el resumen final como endpoints faltantes y se omiten.
- **`AmiVets - Consultorio actual.dc.html`** (en el proyecto de Claude Design):
  es solo el estado *previo* documentado, no una pantalla a portar.
- No hay otras pantallas fuera de: `index.html` (SPA, 11 secciones), `login.html`,
  `agendar.html`. Las tres entran al rediseño (Pasos 2–4 de la entrega).

## Qué NO define este documento (se resuelve más adelante)

- El inventario funcional completo → `docs/diseno/inventario-funcional.md` (Paso 2).
- La estructura de navegación final y qué secciones quedan fuera de la barra → etapa de shell (Paso 2 de la entrega).
- El troceo de `app.js` en módulos ES por dominio → etapa de shell.
- La página de muestra de componentes → `docs/diseno/componentes.html` (Paso 1 de la entrega).
