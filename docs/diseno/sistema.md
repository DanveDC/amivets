# Sistema de diseño de AmiVets

**Fase 1 de la tarea de rediseño.** Este documento define **con qué se construye**
la nueva interfaz: los colores, los tamaños de letra, el aire entre las cosas y
cómo se ve cada pieza en cada uno de sus estados. Sale del diagnóstico de
[`auditoria.md`](auditoria.md) y es lo que la Fase 3 va a implementar en el
código, sección por sección.

**Todavía no se tocó una línea de CSS.** Acá se decide; en la Fase 3 se aplica.

> 👀 **Para verlo en vez de leerlo:** abrí [`paleta.html`](paleta.html) con doble
> clic. Es una página autónoma —no necesita servidor ni la app corriendo— con la
> paleta, la tipografía, los badges, los botones y una tabla de ejemplo, y un
> botón para pasar de tema claro a oscuro. El contraste de cada color se calcula
> ahí mismo, a la vista.

---

## La decisión, en una pantalla

| Qué | Decisión | Por qué |
| --- | --- | --- |
| **Color dominante** | Grises de grafito con un leve tinte frío verdoso | Es el 90 % de la pantalla. Si el gris tiene carácter, la app tiene carácter sin gritar. |
| **Botón de acción principal** | **Grafito casi negro** (blanco en modo oscuro), sin color | Si el botón "Guardar" es de color, el color deja de significar estado. Reservamos el color para lo que importa. |
| **Acento único** | **Petróleo `#0B6B70`** — un verde azulado profundo | Reemplaza al indigo genérico. Solo aparece en el foco del teclado, la sección activa, los enlaces y la serie principal de los gráficos. Nunca en un estado. |
| **Color semántico** | Verde / ámbar / rojo / azul, **solo para estado real** | Pagado, por vencer, vencido, programada. Nunca decorativo. |
| **Tipografía** | Inter, cuerpo de 14 px, y **cifras tabulares obligatorias** en dinero, stock y fechas | Una columna de importes tiene que compararse mirando, no leyendo. |
| **Densidad** | Filas de tabla de 40 px en vez de ~76 px | Pasa de ~9 a ~17 filas visibles sin scrollear. |
| **Temas** | Claro y oscuro, diseñados por separado | El oscuro no es el claro invertido: los grises no son simétricos y las sombras no funcionan igual. |
| **Contraste** | **80 pares verificados, 0 fallos** en los dos temas | Calculados, no asumidos. Ver [`contraste.py`](contraste.py). |

### Las cuatro reglas que no se rompen

1. **El color es información, no decoración.** Si algo tiene color, es porque su
   estado lo exige. Un botón "+ Nuevo" no es un estado.
2. **Un solo acento, usado con avaricia.** El petróleo aparece en foco de
   teclado, sección activa, enlaces y gráficos. En ningún otro lado.
3. **El color nunca es la única señal.** Todo estado lleva además una palabra y
   un símbolo. Quien no distingue rojo de verde tiene que poder trabajar igual.
4. **Nada inventa valores sueltos.** Si un color, un tamaño o un margen no está
   en este documento, no se usa. Se agrega acá primero.

---

## 1. Paleta

### 1.1 Por qué se va el indigo

El indigo `#6366F1` sobre slate `#F1F5F9` es la paleta que viene por defecto en
cualquier plantilla de panel administrativo. La auditoría lo confirmó en detalle:
degradado indigo en la cabecera del login y de la página pública, cabecera de
tabla en lila pálido, y `--primary` usado 70 veces sin que ninguna de esas veces
signifique nada en particular. No es fea — es **anónima**, y no dice nada de una
clínica veterinaria.

### 1.2 La idea: el color se gana, no se reparte

En una herramienta clínica, alguien mira esta pantalla ocho horas y toma
decisiones sobre un animal vivo. Cada mancha de color que no significa nada es
ruido que compite con la que sí significa: *ese lote de amoxicilina está vencido*.

Por eso la arquitectura de la paleta tiene **tres capas separadas por función**,
no por gusto:

| Capa | Qué la compone | Dónde aparece | Cuánta pantalla ocupa |
| --- | --- | --- | --- |
| **Neutro** | Grafitos fríos + blanco | Fondos, tarjetas, texto, bordes, **y el botón principal** | ~90 % |
| **Acento** | Un único petróleo | Foco de teclado, sección activa, enlaces, serie principal de gráfico | ~5 % |
| **Semántico** | Verde, ámbar, rojo, azul | Solo badges de estado, mensajes de error y puntos de gráfico | ~5 % |

**La consecuencia práctica más importante:** el botón "Guardar" es gris grafito,
no de color. Es la misma disciplina de Vercel y de Linear, y acá tiene una razón
médica además de estética — si el botón de guardar fuera verde, el verde dejaría
de querer decir "pagado".

### 1.3 Por qué petróleo y no otra cosa

Cuatro tonos ya están ocupados por significado y no se pueden tocar: verde =
correcto, ámbar = atención, rojo = problema, azul = programado / informativo. El
violeta está descartado por consigna (es la familia del indigo que se va). Queda
el hueco entre el verde y el azul: el **petróleo**.

Además de estar libre, encaja: es el color del instrumental quirúrgico y de la
ropa de quirófano, es frío y sobrio, y a `#0B6B70` está suficientemente oscuro
como para leerse sobre blanco sin esfuerzo (6,27:1).

> **El riesgo, dicho en voz alta:** el petróleo está a unos 40° del azul
> informativo en la rueda de color. En una pantalla chica podrían confundirse.
> Lo resolvemos por **rol, no por tono**: el acento nunca se dibuja como badge, y
> el azul semántico nunca se dibuja como cromo de la interfaz. Nunca ocupan el
> mismo tipo de forma en el mismo lugar. Y por encima de eso está la regla 3:
> todo estado lleva texto y símbolo, así que aunque alguien confundiera los dos
> tonos, la información sigue estando.

### 1.4 Tokens del tema claro

Los ratios son contraste WCAG calculado. El mínimo legal para texto normal es
**4,5:1** (criterio 1.4.3) y para bordes de control y elementos gráficos es
**3:1** (criterio 1.4.11).

#### Superficies y texto

| Token | Valor | Para qué | Contraste verificado |
| --- | --- | --- | --- |
| `--bg` | `#F2F5F6` | Fondo de la página | — |
| `--surface` | `#FFFFFF` | Tarjetas, tablas, modales | — |
| `--surface-sunken` | `#E9EEEF` | Cabecera de tabla, campos deshabilitados | — |
| `--surface-hover` | `#F3F6F7` | Fila de tabla bajo el cursor | — |
| `--text-primary` | `#101718` | Todo el texto que se lee | **16,56:1** sobre `--bg` · **18,14:1** sobre `--surface` |
| `--text-secondary` | `#4A585B` | Etiquetas, datos de apoyo | **6,75:1** sobre `--bg` · **7,40:1** sobre `--surface` |
| `--text-muted` | `#626F73` | Placeholders, metadatos, unidades | **4,74:1** sobre `--bg` · **5,20:1** sobre `--surface` |

#### Bordes

| Token | Valor | Para qué | Contraste |
| --- | --- | --- | --- |
| `--border-subtle` | `#E4E9EA` | Líneas entre filas de tabla | 1,23:1 — decorativo, ver nota |
| `--border` | `#D3DBDD` | Borde de tarjetas y paneles | 1,41:1 — decorativo, ver nota |
| `--border-control` | `#7E8C90` | **Borde de inputs, selects, textareas, botón secundario** | **3,48:1** sobre `--surface` · **3,17:1** sobre `--bg` |

> **Nota sobre los bordes claritos.** El criterio 1.4.11 exige 3:1 solo a lo que
> *identifica un control*. Una línea entre dos filas de tabla no identifica un
> control: es una guía visual, y el dato de cada fila ya se lee al 16:1. Por eso
> hay **dos tokens distintos**: el borde de un input tiene que verse sí o sí
> (`--border-control`, 3,48:1) y el separador de filas puede ser sutil
> (`--border-subtle`). Confundirlos es lo que hace que un formulario parezca un
> montón de texto flotando — que es exactamente lo que pasa hoy.

#### Acento y acción

| Token | Valor | Para qué | Contraste |
| --- | --- | --- | --- |
| `--accent` | `#0B6B70` | Foco de teclado, sección activa, enlaces, serie de gráfico | **6,27:1** sobre `--surface` · **5,72:1** sobre `--bg` |
| `--accent-hover` | `#085458` | Enlace bajo el cursor | — |
| `--accent-subtle` | `#E3F0F1` | Fondo del ítem de menú activo, fila seleccionada | **5,37:1** con `--accent` encima |
| `--action` | `#1A2426` | Relleno del botón primario | **15,86:1** con texto blanco |
| `--action-hover` | `#0E1517` | Botón primario bajo el cursor | **18,45:1** con texto blanco |
| `--on-action` | `#FFFFFF` | Texto sobre el botón primario | ver arriba |

Blanco sobre acento sólido (`#FFFFFF` sobre `#0B6B70`) da **6,27:1** — válido
para el chip de "hoy" en el calendario y para el slot horario seleccionado.

#### Semántico — solo estado

Hay cinco familias — `--success`, `--warning`, `--danger`, `--info` y
`--neutral` — y cada una tiene tres piezas: `--{familia}-subtle` es el fondo del
badge, `--{familia}-text` es el texto encima, y `--{familia}` a secas es el punto
de estado y la serie de gráfico.

| Familia | Fondo (`-subtle`) | Texto (`-text`) | Sólido | Contraste texto/fondo | Ejemplo real |
| --- | --- | --- | --- | --- | --- |
| `--success` | `#E3F3EA` | `#0B5E34` | `#0F7A44` | **6,86:1** | Pagado · Activo · Finalizada · Aplicado |
| `--warning` | `#FBEEDC` | `#8A5200` | `#B26A00` | **5,59:1** | En sala · Por vencer · Bajo stock |
| `--danger` | `#FBE7E6` | `#97201C` | `#B4231F` | **6,96:1** | Vencido · Agotado · Cancelada · Error |
| `--info` | `#E5EDFB` | `#164AAB` | `#1A56C4` | **6,86:1** | Programada · Nota del sistema |
| `--neutral` | `#E9EEEF` | `#4A585B` | `#7E8C90` | **6,32:1** | Inactivo · Sin datos · Borrador |

Sobre fondo blanco los mismos textos dan 7,88 / 6,39 / 8,27 / 8,07:1 — es decir,
un mensaje de error escrito directamente sobre una tarjeta también pasa AA sin
necesidad de fondo tintado.

### 1.5 Tokens del tema oscuro

**El oscuro no se calcula invirtiendo el claro.** Se diseñó aparte, y estas son
las tres diferencias estructurales:

1. **El fondo no es negro puro.** `#0D1214` es grafito. El negro puro con texto
   blanco produce halo alrededor de las letras (el ojo "derrama" el blanco sobre
   el negro) y cansa en jornadas largas.
2. **El texto no es blanco puro.** `#E8EDEE` en vez de `#FFFFFF`, por lo mismo.
3. **La elevación no se hace con sombra, se hace con luz.** Una sombra sobre
   grafito es invisible. Lo que está "más arriba" es **más claro**, no más
   sombreado. Por eso en oscuro `--surface` (`#141A1C`) es *más claro* que
   `--bg` (`#0D1214`), mientras que en claro pasa exactamente lo contrario.

#### Superficies y texto

| Token | Valor | Contraste verificado |
| --- | --- | --- |
| `--bg` | `#0D1214` | — |
| `--surface` | `#141A1C` | — |
| `--surface-sunken` | `#0A0F10` | — |
| `--surface-hover` | `#1A2224` | — |
| `--text-primary` | `#E8EDEE` | **15,96:1** sobre `--bg` · **14,89:1** sobre `--surface` |
| `--text-secondary` | `#A5B0B3` | **8,49:1** sobre `--bg` · **7,92:1** sobre `--surface` |
| `--text-muted` | `#8B9699` | **6,21:1** sobre `--bg` · **5,79:1** sobre `--surface` |

#### Bordes, acento y acción

| Token | Valor | Contraste |
| --- | --- | --- |
| `--border-subtle` | `#1E2628` | decorativo |
| `--border` | `#2A3436` | decorativo |
| `--border-control` | `#5E6A6D` | **3,15:1** sobre `--surface` · **3,37:1** sobre `--bg` |
| `--accent` | `#4CC9D0` | **8,85:1** sobre `--surface` · **9,49:1** sobre `--bg` |
| `--accent-hover` | `#7ADCE1` | — |
| `--accent-subtle` | `#0F2C2E` | **7,45:1** con `--accent` encima |
| `--action` | `#E8EDEE` | **15,96:1** con `--on-action` encima |
| `--action-hover` | `#FFFFFF` | **18,86:1** |
| `--on-action` | `#0D1214` | ver arriba |

> **La inversión del botón principal es deliberada.** En claro es grafito con
> letra blanca; en oscuro es casi blanco con letra grafito. No es el mismo
> pigmento invertido por descuido: es la **misma relación de contraste** (≈16:1)
> lograda con los pigmentos que funcionan en cada fondo. En oscuro, un botón
> grafito sobre fondo grafito no existiría.

#### Semántico en oscuro

Los tonos suben en luminosidad y bajan en saturación. Un rojo `#B4231F` sobre
grafito casi no se ve; un rojo saturado y brillante sobre grafito vibra.

| Familia | Fondo (`-subtle`) | Texto (`-text`) | Sólido | Contraste |
| --- | --- | --- | --- | --- |
| `--success` | `#0C2A1C` | `#5CD494` | `#3FBF7F` | **8,29:1** |
| `--warning` | `#2E2008` | `#EDB863` | `#E0A040` | **8,77:1** |
| `--danger` | `#33130F` | `#F58C85` | `#F0736B` | **7,23:1** |
| `--info` | `#0F1F3D` | `#8FB8F8` | `#6BA0F5` | **8,09:1** |
| `--neutral` | `#1E2628` | `#A5B0B3` | `#5E6A6D` | **6,94:1** |

### 1.6 Verificación del contraste

No hay ningún "pasa AA" asumido en este documento. Todos los números salen de
[`contraste.py`](contraste.py), que se corre así:

```bash
python3 docs/diseno/contraste.py           # informe completo, ambos temas
python3 docs/diseno/contraste.py --strict  # devuelve error si algo falla (para CI)
```

**Resultado actual: 80 pares evaluados (40 por tema), 0 fallos.**

Si en la Fase 3 alguien cambia el valor de un token, lo cambia también en ese
archivo y lo vuelve a correr. Los números del documento se recalculan; no se
estiman.

### 1.7 Cómo migrar desde los tokens actuales

La buena noticia de la auditoría se aprovecha: el proyecto ya usa custom
properties en 557 lugares (286 solo en `styles.css`). **No hay que renombrar nada
donde el significado sobreviva — alcanza con redefinir el valor.** Eso hace que
gran parte del repintado sea un cambio en `:root` y nada más.

| Token actual | Qué pasa con él | Usos hoy |
| --- | --- | --- |
| `--bg`, `--surface`, `--surface-hover` | Se mantienen, cambia el valor | — |
| `--text-primary`, `--text-secondary`, `--text-muted` | Se mantienen, cambia el valor | — |
| `--border` | Se mantiene; se agrega `--border-control` para inputs | 27 en `--border-light` |
| `--primary`, `--primary-light`, `--primary-dark` | **Se retiran.** Cada uso se reasigna a `--action` (si era un botón) o a `--accent` (si era foco/activo/enlace) | 97 |
| `--secondary`, `--secondary-dark` | **Se retiran** → `--success` | 13 |
| `--accent` (hoy es rosa `#F43F5E`, se usa para errores) | ⚠️ **Colisión de nombre.** El nombre `--accent` pasa a ser el petróleo. Los 7 usos actuales tienen que reasignarse a `--danger` **antes** de redefinir | 7 |
| `--accent-subtle` (hoy naranja `#FFEDD5`) | ⚠️ Mismo caso → `--danger-subtle` | 1 |
| `--surface-glass` + `backdrop-filter` | **Se retira.** El vidrio esmerilado baja la legibilidad del texto que queda encima | 4 |
| `--shadow-premium` | **Se retira.** Sombra teñida de indigo, no hay equivalente | 2 |
| `--radius-pill` | Se conserva solo para el punto de estado y el avatar | 2 |

> ⚠️ **La trampa a evitar en la Fase 3.** Hoy `--accent` es el **rojo de error**.
> En el sistema nuevo `--accent` es el **petróleo**. Si se redefine `:root` sin
> reasignar antes, todos los mensajes de error de la app pasan a ser color
> petróleo — en silencio, sin romper nada y sin que ninguna prueba lo note.
>
> Son solo 8 usos entre `--accent` (7) y `--accent-subtle` (1), así que la
> secuencia obligatoria es **dos commits separados, en este orden**:
>
> ```bash
> # Commit 1 — renombrar el significado viejo. Todavía no se toca :root.
> #   --accent        -> --danger
> #   --accent-subtle -> --danger-subtle
> # Verificación: no debe quedar ningún uso del nombre viejo.
> rg -- '--accent' static/ index.html      # esperado: 0 resultados
>
> # Commit 2 — recién ahora se define :root con la paleta nueva,
> # donde --accent pasa a significar petróleo.
> ```
>
> Invertir el orden es lo que rompe los errores sin dejar rastro.

---

## 2. Tipografía

Se sigue usando **Inter**. Lo que cambia es la escala, los pesos y — sobre todo —
el tratamiento de los números.

### 2.1 La escala

El cuerpo base es **14 px**, no 16. Es un producto de trabajo de escritorio: con
contraste de 16:1, 14 px se lee perfecto y entra un tercio más de información por
pantalla. Todo está en `rem` sobre una raíz de 16 px, así que el zoom del
navegador y la preferencia de tamaño de letra del sistema operativo siguen
funcionando.

| Token | Tamaño | Interlineado | Peso | Espaciado | Dónde se usa |
| --- | --- | --- | --- | --- | --- |
| `--text-2xs` | 11 px | 1,4 | 600 | +0,06em, mayúsculas | Cabecera de columna de tabla, etiqueta de grupo |
| `--text-xs` | 12 px | 1,4 | 500 | 0 | Badges, texto de ayuda, unidades, metadatos |
| `--text-sm` | 13 px | 1,45 | 400 | 0 | Celdas densas, texto secundario |
| `--text-base` | **14 px** | 1,5 | 400 | 0 | **Cuerpo, inputs, celdas de tabla, botones** |
| `--text-md` | 16 px | 1,5 | 500 | −0,005em | Subtítulo de panel, nombre del paciente en la ficha |
| `--text-lg` | 18 px | 1,4 | 600 | −0,01em | Título de modal, cabecera de panel |
| `--text-xl` | 22 px | 1,3 | 600 | −0,015em | Título de sección (hoy son 36 px) |
| `--text-2xl` | 28 px | 1,2 | 600 | −0,02em | Cifra de tarjeta KPI |
| `--text-3xl` | 36 px | 1,15 | 600 | −0,025em | Total a cobrar en pantalla de facturación |

**Pesos permitidos: 400, 500, 600, 700. Nada más.** Hoy la app usa `800` en
títulos, logo, KPIs y cabeceras de modal — el peso 800 con espaciado negativo
fuerte es una firma de plantilla de marketing y en pantallas densas compite con
el dato en lugar de ordenarlo. El 700 se reserva para el total de una factura y
poco más.

**Interlineado del cuerpo: 1,5** (hoy es 1,6). En celdas de tabla baja a 1,45.
Con 1,6 cada fila de tabla crece 3 px por línea sin ganar legibilidad.

**Prohibido: texto con degradado.** Hoy el logo y todos los `<h2>` de sección
usan `background-clip: text` con degradado. Es el recurso más reconocible de
plantilla gratuita, y además rompe el contraste medible (no se puede auditar un
texto cuyo color varía a lo largo del glifo).

### 2.2 Números: la parte que más cambia el trabajo diario

Inter trae variantes tipográficas que hoy no se están usando y que en esta app
valen oro.

```css
/* Aplicar a TODA celda con dinero, stock, peso, cantidad, fecha numérica o ID */
.num, td.num, .money, .kpi-value {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
}

/* Además, para lotes de medicamento, IDs y números de comprobante */
.code {
    font-variant-numeric: tabular-nums slashed-zero;
    font-feature-settings: 'tnum' 1, 'zero' 1;
}
```

**Qué hace `tabular-nums`:** obliga a que todos los dígitos ocupen exactamente el
mismo ancho. Sin eso, el "1" es más angosto que el "8" y una columna de importes
queda desalineada aunque esté alineada a la derecha. Con eso, `$1.240,00` y
`$696,00` se comparan mirando la forma de la columna, sin leer cada número. Es
literalmente el problema que la auditoría encontró en Facturación y en Catálogo.

**Qué hace `slashed-zero`:** el cero lleva una barra. En un número de lote de
amoxicilina, confundir `0` con `O` es un error que llega al paciente.

**Reglas de formato de números:**

| Dato | Alineación | Formato |
| --- | --- | --- |
| Dinero | Derecha | Siempre 2 decimales, incluso `$20,00`. Símbolo en `--text-muted` y `--text-xs` |
| Stock / cantidad | Derecha | Entero. La unidad ("u.", "ml") va en `--text-muted` |
| Peso | Derecha | 1 decimal + "kg" en `--text-muted` |
| Fecha | Izquierda | `dd/mm/aaaa`, siempre con ceros a la izquierda para que la columna alinee |
| ID / lote / comprobante | Izquierda | `.code`, con `slashed-zero` |

---

## 3. Densidad y espaciado

### 3.1 El problema, con números

La app de hoy tiene espaciado de landing page: `3rem` (48 px) de padding en el
área de contenido, `3rem` de margen bajo la cabecera de sección, celdas de tabla
con `1,5rem` arriba y abajo. El resultado son filas de ~76 px de alto: en una
pantalla de 1440×900 entran **unas 9 filas**. Una recepcionista buscando un
propietario entre 200 hace scroll todo el día por un aire que no le sirve.

### 3.2 La escala

Base de 4 px. Nada intermedio, nada inventado.

| Token | Valor | Uso típico |
| --- | --- | --- |
| `--space-0-5` | 2 px | Separación de un ícono y su etiqueta dentro de un badge |
| `--space-1` | 4 px | Aire interno mínimo |
| `--space-2` | 8 px | Padding vertical de celda, separación entre botones |
| `--space-3` | 12 px | Padding horizontal de celda, separación entre campos de una fila |
| `--space-4` | 16 px | Padding de tarjeta, separación entre campos de un formulario |
| `--space-5` | 20 px | Separación entre bloques dentro de un panel |
| `--space-6` | 24 px | **Padding del área de contenido**, separación entre secciones |
| `--space-8` | 32 px | Separación entre grandes bloques |
| `--space-10` | 40 px | Aire superior de una pantalla vacía |
| `--space-12` | 48 px | Solo en la página pública `/agendar` |

### 3.3 Qué cambia, medido

| Elemento | Hoy | Nuevo | Efecto |
| --- | --- | --- | --- |
| Padding del área de contenido | 48 px | **24 px** | +48 px útiles de ancho y alto |
| Margen bajo la cabecera de sección | 48 px | **20 px** | +28 px verticales |
| Celda de tabla (vertical / horizontal) | 24 / 32 px | **8 / 12 px** | — |
| **Alto de fila de tabla** | **~76 px** | **40 px** | **de ~9 a ~17 filas visibles** |
| Separación entre campos de formulario | 32 px | **16 px** | Un formulario de 8 campos entra sin scroll |
| Padding de tarjeta KPI | 32 px | **16 px** | — |
| Separación entre tarjetas KPI | 32 px | **12 px** | Las 3 tarjetas se leen como una sola fila de datos |

### 3.4 Dos densidades, un token

```css
:root            { --row-height: 40px; }  /* cómoda — por defecto */
[data-density="compact"] { --row-height: 32px; }
```

La densidad compacta (32 px, ~21 filas) es para quien pasa el día en Inventario o
Facturación. Se guarda por usuario. **No es obligatorio implementarla en la Fase
3**, pero el token existe desde ahora para que agregarla después no obligue a
rehacer las tablas.

### 3.5 Radios, elevación y movimiento

**Radios** — más chicos que hoy. Un radio grande es amable; acá queremos preciso.

| Token | Valor | Uso |
| --- | --- | --- |
| `--radius-xs` | 3 px | Badges de estado, chips |
| `--radius-sm` | 5 px | Botones, inputs, selects |
| `--radius-md` | 7 px | Tarjetas, paneles, tablas |
| `--radius-lg` | 10 px | Modales |
| `--radius-full` | 9999 px | **Solo** el punto de estado y el avatar |

Los badges dejan de ser píldoras. Una píldora redondeada es lenguaje de app de
consumo; un rectángulo de 3 px con un punto adelante es lenguaje de tablero de
datos.

**Elevación — acá los dos temas divergen de verdad:**

| Nivel | Claro | Oscuro |
| --- | --- | --- |
| **0** — pegado al fondo | Solo `1px solid var(--border)` | Solo `1px solid var(--border)` |
| **1** — tarjeta, tabla | `0 1px 2px rgba(16,23,24,.06)` + borde | **Sin sombra.** `--surface` (`#141A1C`) es más claro que `--bg` + borde |
| **2** — dropdown, popover | `0 2px 4px -1px rgba(16,23,24,.08), 0 1px 2px rgba(16,23,24,.04)` | **Sin sombra.** Fondo `#1A2224` + `1px solid var(--border)` |
| **3** — modal | `0 8px 24px -6px rgba(16,23,24,.16), 0 2px 6px -2px rgba(16,23,24,.08)` | Fondo `#1F282A` (texto principal encima: **12,74:1**) + `1px solid var(--border-control)` + `0 16px 40px -12px rgba(0,0,0,.7)` para separarlo del velo |

En claro la luz viene de arriba y la sombra funciona. En oscuro la sombra no
existe: lo que está más arriba está **más iluminado**. Copiar las sombras del
claro al oscuro es el error más común del modo oscuro y es exactamente por qué
este documento define los dos por separado.

**Movimiento** — hoy las transiciones son de 300 a 500 ms con una curva que
rebota (`cubic-bezier(0.175, 0.885, 0.32, 1.275)`). Eso es lenguaje de landing.
En una herramienta donde se hace clic 400 veces por día, el rebote cuesta
precisión.

| Token | Valor | Uso |
| --- | --- | --- |
| `--motion-fast` | 90 ms | Hover, cambio de color |
| `--motion-base` | 140 ms | Apertura de dropdown, cambio de pestaña |
| `--motion-slow` | 220 ms | Solo la entrada del modal |
| `--ease` | `cubic-bezier(0.2, 0, 0.2, 1)` | Todo. Sin rebote. |

**Prohibido:** que un elemento se mueva bajo el cursor. Nada de
`transform: translateY(-2px)` en hover de tarjetas, botones o filas — hoy lo
hacen `.btn-primary`, `.btn-secondary`, `.kpi-card`, `.card-item` y
`.pet-nav-item`. El hover cambia fondo y borde, no posición. Se conserva el
hundimiento de 1 px en `:active`, que sí es información útil ("registré tu clic").
Se retira también la animación `badgePulse`: un contador que late permanentemente
en la barra lateral es una alarma que nunca se apaga.

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        animation-iteration-count: 1 !important;
    }
}
```

---

## 4. Inventario de componentes

Estas son las piezas que ya existen en la app (salidas de `index.html`, de
`app.js` y de las capturas de la auditoría), con todos sus estados definidos.
**Los estados vacío y de error se diseñan acá; no se dejan "para después".**

### 4.1 Botones

| Variante | Relleno | Texto | Borde | Cuándo |
| --- | --- | --- | --- | --- |
| **Primario** | `--action` | `--on-action` | ninguno | La acción principal de la pantalla. **Uno solo por vista.** |
| **Secundario** | `--surface` | `--text-primary` | `1px --border-control` | Acciones de fila, "Cancelar", filtros |
| **Sutil** (ghost) | transparente | `--text-secondary` | ninguno | Acciones terciarias, íconos de tabla |
| **Destructivo** | `--surface` | `--danger-text` | `1px --danger` | "Eliminar", "Anular factura" |
| **Destructivo confirmado** | `--danger` | `#FFFFFF` (claro) / `--bg` (oscuro) | ninguno | Solo el botón final del diálogo de confirmación |

Tamaños: `sm` 26 px de alto (`--text-xs`), `md` 32 px (`--text-base`, por
defecto), `lg` 38 px (formularios largos y la página pública).

**Sin degradados.** Hoy `.btn-primary`, `.btn-add`, `.btn-login` y `.btn-submit`
usan `linear-gradient`. Se van los cuatro.

**Se elimina `.btn-add` como variante propia.** Hoy es el único botón verde de la
app: en Consultorio, "+ Nuevo" usa `--secondary` mientras que los otros seis
botones de creación usan `--primary`. Es la misma acción con dos colores, y el
verde ya significa "OK / activo". Todos los "+ Nuevo X" pasan a ser botón
primario.

| Estado | Aspecto |
| --- | --- |
| Normal | Según la tabla |
| **Hover** | Primario → `--action-hover`. Secundario → fondo `--surface-hover`, borde `--text-muted`. Sin desplazamiento. |
| **Foco** | `outline: 2px solid var(--accent); outline-offset: 2px` |
| **Activo** (`:active`) | `transform: translateY(1px)`, sin cambio de sombra |
| **Cargando** | Texto se mantiene (no cambia el ancho), spinner de 14 px a la izquierda, `aria-busy="true"`, `pointer-events: none` |
| **Deshabilitado** | `opacity: .45`, `cursor: not-allowed`. **Nunca deshabilitar sin decir por qué**: `title` o texto de ayuda al lado |

### 4.2 Campos de formulario

Alto 32 px (`md`), borde `1px --border-control`, radio `--radius-sm`, fondo
`--surface`, texto `--text-base`, padding `--space-2 --space-3`.

| Estado | Aspecto |
| --- | --- |
| Normal | Borde `--border-control` (3,48:1 — se ve que es un campo, no un texto) |
| Hover | Borde `--text-muted` |
| **Foco** | Borde `--accent` + `outline: 2px solid var(--accent); outline-offset: 1px` |
| **Con error** | Borde `--danger`, ícono ✕ dentro del campo a la derecha, mensaje debajo en `--danger-text` `--text-xs`, `aria-invalid="true"` y `aria-describedby` apuntando al mensaje |
| **Deshabilitado** | Fondo `--surface-sunken`, texto `--text-muted`, `cursor: not-allowed` |
| **Solo lectura** | Sin borde, fondo transparente, texto `--text-primary`. Un campo de solo lectura no debe parecer un campo roto |
| **Cargando opciones** (select) | Placeholder "Cargando…" + `aria-busy` |

**Etiquetas obligatorias y visibles.** `--text-xs`, peso 500, color
`--text-secondary`, 4 px por encima del campo. Nada de campos con solo
placeholder — el placeholder desaparece al escribir y el usuario pierde la
referencia. Los campos obligatorios llevan `*` en `--danger` **y**
`aria-required="true"`.

**Agrupación.** Todo formulario de más de 5 campos se parte en bloques con un
título en `--text-2xs` en mayúsculas. La página pública `/agendar` ya lo hace
("Turno" / "Tus Datos" / "Tu Mascota") y es, según la auditoría, el formulario
mejor estructurado del proyecto. Se copia ese patrón hacia adentro.

### 4.3 Tabla de datos

Es el componente más usado de la app: aparece en Propietarios, Inventario,
Facturación, Catálogo, Usuarios y Citas Web.

**Estructura obligatoria:**

```
.table-container   → overflow-x: auto;  ← ESTO ES LO QUE HOY FALTA
  table
    thead (sticky top: 0)
    tbody
```

> **El bug estructural de la auditoría.** Hoy `.container` tiene
> `overflow: hidden` y ninguna tabla tiene contenedor con `overflow-x: auto`. En
> Inventario y en Catálogo la columna "Acciones" queda cortada por el borde de la
> ventana a 1440 px **y no hay forma de llegar a ella**. No es incomodidad: es
> contenido inalcanzable. El envoltorio `.table-container` es obligatorio en las
> seis tablas.

| Parte | Especificación |
| --- | --- |
| Cabecera | Fondo `--surface-sunken`, texto `--text-2xs` mayúsculas peso 600 `--text-secondary`, `position: sticky; top: 0` |
| Fila | Alto `--row-height` (40 px), borde inferior `1px --border-subtle` |
| Celda | Padding `--space-2 --space-3`, `--text-base` |
| Celda numérica | `text-align: right` + `tabular-nums` |
| Columna primaria | Peso 500, `--text-primary` |
| Columnas secundarias | Peso 400, `--text-secondary` |
| **Columna de acciones** | Última, `position: sticky; right: 0`, fondo heredado. Así nunca se pierde al hacer scroll horizontal |
| Hover de fila | Fondo `--surface-hover`. Sin desplazamiento |
| Fila seleccionada | Fondo `--accent-subtle` + barra de 2 px `--accent` a la izquierda |
| Ordenamiento | Flecha ▲/▼ en la cabecera, `aria-sort` en el `<th>` |

**Jerarquía tipográfica dentro de la tabla.** Hoy todas las columnas pesan igual
—la auditoría lo señala en Inventario con siete columnas planas—. La regla: la
columna que identifica el registro va en peso 500 y `--text-primary`; el resto va
en 400 y `--text-secondary`. El ojo encuentra la fila por la columna primaria.

### 4.4 Badge de estado

Rectángulo de `--radius-xs`, padding `2px 6px`, `--text-xs` peso 500, fondo
`{estado}-subtle`, texto `{estado}-text`, con **un símbolo delante**.

| Estado | Símbolo | Color | Valores reales en la app |
| --- | --- | --- | --- |
| Éxito | `✓` | verde | Finalizada · Pagado · Activo · Aplicado |
| Advertencia | `▲` | ámbar | En Sala · Por vencer · Bajo stock |
| Peligro | `✕` | rojo | Cancelada · Vencido · Agotado · Inactivo (baja) |
| Info | `●` | azul | Programada |
| Neutro | `○` | gris | Sin estado · Borrador · rol "user" |

**El símbolo no es adorno: es el requisito de accesibilidad.** El color por sí
solo no puede transmitir significado (WCAG 1.4.1). Con el símbolo y la palabra,
alguien con daltonismo rojo-verde —que es 1 de cada 12 hombres, es decir, muy
probablemente alguien del equipo— distingue "Pagado" de "Vencido" sin depender
del tono.

> **Deuda técnica a arreglar en la Fase 3.** Hoy los colores de badge están
> escritos a mano dentro de `app.js`: `getStatusColor()` en la línea 481, el mapa
> `colors` de roles en la 669, y varios `style="background:#eef2ff"` sueltos en
> las líneas 889, 2305, 2762 y 3460. En total, `app.js` tiene **240 valores
> hexadecimales escritos a mano, 54 de ellos distintos**, y ninguno pasa por el
> sistema. La Fase 3 debe reemplazarlos por clases (`.badge--success`,
> `.badge--warning`, …): un `#3b82f6` incrustado en JavaScript **no cambia cuando
> cambia el tema**, así que sin esto el modo oscuro nace roto.

### 4.5 Tarjeta KPI

Padding `--space-4`, borde `1px --border`, radio `--radius-md`, elevación 1.
**Sin barra de color arriba** (hoy `.kpi-card` tiene un borde superior indigo de
3 px y un degradado de fondo: dos decoraciones sin significado).

| Parte | Especificación |
| --- | --- |
| Etiqueta | `--text-2xs` mayúsculas, `--text-secondary` |
| Cifra | `--text-2xl` peso 600, `--text-primary`, **`tabular-nums`** |
| Unidad / contexto | `--text-xs`, `--text-muted`, al lado de la cifra |
| Variación | `--text-xs` + flecha ▲/▼ + signo, en verde o rojo **solo si el KPI tiene un sentido "bueno" claro** |
| **Vacío** | La cifra muestra `—` en `--text-muted`, no `0`. Cero y "sin datos" no son lo mismo, y la auditoría encontró exactamente esto en `kpiStock` |
| **Cargando** | Bloque de skeleton del tamaño de la cifra |
| **Error** | Cifra reemplazada por `—` + ícono ✕ + tooltip con el motivo |

La cifra deja de ser color acento (hoy es indigo). Va en `--text-primary`: es el
dato más importante de la tarjeta, y en un sistema donde el color significa
estado, un número teñido de acento sugiere un estado que no tiene.

### 4.6 Modal

Radio `--radius-lg`, elevación 3, ancho máximo 480 / 720 / 960 px (`sm` / `lg` /
`xl`), velo `rgba(10,15,16,.55)` **sin `backdrop-filter`** — el desenfoque cuesta
rendimiento y no aporta a la lectura.

| Parte | Especificación |
| --- | --- |
| Cabecera | Padding `--space-4 --space-5`, título `--text-lg` peso 600, borde inferior `1px --border-subtle`, sticky |
| Cuerpo | Padding `--space-5`, scroll propio |
| Pie | Padding `--space-4 --space-5`, fondo `--surface-sunken`, botones a la derecha: secundario primero, primario último |
| Cerrar | Botón sutil de 28 px con `aria-label="Cerrar"`. **Sin rotación de 90°** en hover |

**Comportamiento obligatorio:** al abrir, el foco entra al modal (primer campo o
al título); mientras está abierto, `Tab` y `Shift+Tab` quedan atrapados adentro;
`Escape` cierra; al cerrar, el foco vuelve al botón que lo abrió. `role="dialog"`
+ `aria-modal="true"` + `aria-labelledby` apuntando al título.

### 4.7 Navegación lateral

**Se retira la expansión por hover.** Hoy la barra mide 68 px y se abre a 260 px
solo cuando el mouse pasa por encima. Eso significa que en una tablet de mostrador
—uso plausible en una recepción— el usuario ve once íconos sin etiqueta, siempre,
y por teclado no hay forma de expandirla.

Reemplazo: barra fija de 220 px con etiqueta siempre visible, más un botón de
colapsar explícito que guarda la preferencia. Colapsada, cada ícono lleva `title`
y `aria-label`.

| Estado del ítem | Aspecto |
| --- | --- |
| Normal | `--text-secondary`, ícono `--text-muted`, alto 34 px |
| Hover | Fondo `--surface-hover`, texto `--text-primary` |
| **Activo** | Fondo `--accent-subtle`, texto e ícono `--accent`, barra de 2 px `--accent` a la izquierda |
| Foco | `outline: 2px solid var(--accent); outline-offset: -2px` |
| Con contador | Badge neutro a la derecha, `tabular-nums`. **Sin animación de latido** |

### 4.8 Navegación secundaria — unificar en un solo patrón

Hoy hay dos soluciones para el mismo problema: pestañas de texto en Citas Web/QR
y una columna de botones tipo tarjeta (`.pet-nav-item`) en Consultorio. Se
unifica en **pestañas horizontales**: texto `--text-base`, la activa en
`--text-primary` peso 500 con una barra inferior de 2 px `--accent`, las
inactivas en `--text-secondary`.

Accesibilidad: `role="tablist"` / `role="tab"` / `role="tabpanel"`, y las flechas
izquierda/derecha mueven entre pestañas.

> Consultorio tiene ocho vistas por paciente (Historia Clínica, Consultas,
> Vacunas, Desparasitaciones, Hospitalizaciones, Cirugías, Recetas, Facturación).
> **Si esas ocho siguen siendo ocho después de la Fase 2, no entran en una fila de
> pestañas.** Ese caso lo decide la Fase 2, no este documento.

### 4.9 Estado vacío

Se diseña. No es "la tabla sin filas".

| Parte | Especificación |
| --- | --- |
| Contenedor | Centrado, padding `--space-10 --space-6`, sin borde ni fondo propio |
| Ícono | 32 px, `--text-muted`, línea simple. **Sin emoji de 3 rem** |
| Título | `--text-md` peso 500, `--text-primary`. Dice qué falta, no "No hay datos" |
| Mensaje | `--text-sm`, `--text-secondary`, máximo 2 líneas |
| Acción | Botón primario `sm` con la acción que resuelve el vacío |

Tres vacíos distintos que hoy se ven iguales y **no lo son**:

| Tipo | Ejemplo real | Qué dice | Qué botón lleva |
| --- | --- | --- | --- |
| **Vacío inicial** | Un propietario sin mascotas cargadas | "Este propietario todavía no tiene mascotas" | "+ Registrar mascota" |
| **Sin resultados** | Búsqueda de "amoxi" sin coincidencias | "Ningún producto coincide con «amoxi»" | "Limpiar búsqueda" |
| **Vacío correcto** | La cola de órdenes del veterinario | "No hay pacientes esperando" | Ninguno. Está todo bien. |

Confundir el tercero con el primero es lo que hace que una pantalla sana parezca
rota.

### 4.10 Estado de error

También se diseña. Hoy no existe: la auditoría encontró el mensaje
`Error: Supabase no configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)` renderizado
crudo, sin estilo, dentro de una fila de tabla, en Citas Web. Eso es una traza de
servidor mostrada a una recepcionista.

**Tres niveles según el alcance de la falla:**

| Nivel | Cuándo | Aspecto |
| --- | --- | --- |
| **De campo** | Un campo mal completado | Borde `--danger` + ✕ + mensaje `--text-xs` debajo, `role="alert"` |
| **De bloque** | No cargó una tabla o un panel | Caja con fondo `--danger-subtle`, borde `1px --danger`, ícono ✕, título en lenguaje humano, botón "Reintentar" |
| **De pantalla** | Falló la sección entera | Estado vacío con ícono ✕ en `--danger`, título, y "Reintentar" |

**Reglas de redacción, y esta es la que más cambia la experiencia:** el mensaje
dice **qué no se pudo hacer** y **qué puede hacer la persona**. El detalle técnico
va detrás de un "Ver detalle" plegado, para que el equipo pueda reportarlo sin que
la recepcionista lo tenga que leer.

- ❌ `Error: Supabase no configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)`
- ✅ **No se pudieron cargar las citas web.** Es un problema de configuración del
  sistema, no de tus datos. Avisale al administrador. · *Ver detalle*

### 4.11 Estado de carga

| Contexto | Qué se muestra |
| --- | --- |
| Tabla | 5 filas de skeleton del alto exacto de la fila real (40 px) |
| Tarjeta KPI | Un bloque del tamaño de la cifra |
| Botón | Spinner de 14 px, **el texto no cambia** para que el botón no cambie de ancho |
| Sección entera | Skeleton de la estructura, nunca un spinner centrado a pantalla completa |

**Regla:** el skeleton tiene el **tamaño exacto** del contenido que reemplaza. Un
skeleton que mide distinto hace saltar la página cuando llegan los datos, y ese
salto es lo que hace que se haga clic en la fila equivocada.

Con `prefers-reduced-motion`, el brillo del skeleton se apaga y queda un bloque
gris fijo.

### 4.12 Otros componentes del inventario

| Componente | Dónde vive hoy | Nota |
| --- | --- | --- |
| Buscador con desplegable | `.search-box` + `.search-results-dropdown` | Elevación 2, sin `backdrop-filter`. Navegable con ↑ ↓ Enter Esc |
| Select buscable | `.custom-select-*` | Mismo comportamiento de teclado que el anterior. `role="combobox"` |
| Tarjeta de lista | `.card-item`, `.pet-list-item` | Sin desplazamiento en hover; borde izquierdo `--accent` de 2 px cuando está seleccionada |
| Barra de filtros | Inventario / Catálogo (horizontal), Agenda (vertical) | **Se unifica en horizontal.** Chip por filtro activo, con ✕ para quitarlo |
| Chip de horario | `.slot-btn`, `.hora-btn` en `/agendar` | Seleccionado: `--accent` sólido + blanco. Ocupado: `--surface-sunken`, `--text-muted`, tachado, `disabled` |
| Ícono de ayuda | `.help-icon` | Tooltip accesible: abre también con foco de teclado, no solo con hover |
| **Notificación (toast)** | ⚠️ **No existe.** La app usa `alert()` del navegador | Componente nuevo: esquina inferior derecha, `role="status"`, se va solo a los 5 s, con botón de cerrar. Los errores no se van solos |
| **Paginación** | ⚠️ **No existe.** Las tablas listan todo | Con 200+ consultas ya hace falta. La Fase 2 decide si es paginación o scroll infinito |

---

## 5. Tematizar Chart.js y FullCalendar

Una librería con su estilo de fábrica en medio de un sistema propio se nota a
simple vista. La auditoría lo marcó en los dos casos.

### 5.1 Leer los tokens desde JavaScript

Las dos librerías se configuran desde JS, así que necesitan leer los valores CSS:

```js
const token = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
```

> **La trampa del cambio de tema.** Chart.js congela los colores en el momento en
> que se crea el gráfico. Si el usuario cambia de claro a oscuro, el gráfico
> queda con los colores viejos. El conmutador de tema tiene que volver a aplicar
> los `Chart.defaults` y llamar a `chart.update()` en cada instancia viva.
> FullCalendar no tiene ese problema: sus variables son CSS puro y siguen al tema
> solas.

### 5.2 Chart.js

Hoy el único gráfico —la evolución de peso del paciente— tiene `#4F46E5` y
`rgba(79, 70, 229, 0.1)` escritos a mano en `app.js` (línea 783). Configuración
global a aplicar una vez, al iniciar:

```js
Chart.defaults.font.family   = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.font.size     = 12;
Chart.defaults.font.weight   = 500;
Chart.defaults.color         = token('--text-muted');
Chart.defaults.borderColor   = token('--border-subtle');
Chart.defaults.maintainAspectRatio = false;   // la altura la manda el contenedor

// El título va en el HTML, no dentro del lienzo: así hereda la tipografía
// del sistema y lo lee un lector de pantalla.
Chart.defaults.plugins.title.display = false;

Chart.defaults.plugins.legend.position       = 'bottom';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle    = 'circle';
Chart.defaults.plugins.legend.labels.boxWidth      = 8;
Chart.defaults.plugins.legend.labels.boxHeight     = 8;
Chart.defaults.plugins.legend.labels.padding       = 12;

Chart.defaults.plugins.tooltip.backgroundColor = token('--surface');
Chart.defaults.plugins.tooltip.titleColor      = token('--text-primary');
Chart.defaults.plugins.tooltip.bodyColor       = token('--text-secondary');
Chart.defaults.plugins.tooltip.borderColor     = token('--border-control');
Chart.defaults.plugins.tooltip.borderWidth     = 1;
Chart.defaults.plugins.tooltip.cornerRadius    = 5;   // --radius-sm
Chart.defaults.plugins.tooltip.padding         = 8;
Chart.defaults.plugins.tooltip.displayColors   = true;
Chart.defaults.plugins.tooltip.boxPadding      = 4;

// Rejilla: solo horizontal, sin marcas, sin eje dibujado.
Chart.defaults.scales.linear.grid.color        = token('--border-subtle');
Chart.defaults.scales.linear.grid.drawTicks    = false;
Chart.defaults.scales.linear.border.display    = false;
Chart.defaults.scales.linear.ticks.padding     = 8;
Chart.defaults.scales.category.grid.display    = false;
Chart.defaults.scales.category.border.display  = false;
Chart.defaults.scales.category.ticks.padding   = 8;

// Línea contenida, sin puntos permanentes pero fáciles de apuntar.
Chart.defaults.elements.line.tension     = 0.2;   // hoy 0.3 — demasiado ondulado
Chart.defaults.elements.line.borderWidth = 2;
Chart.defaults.elements.point.radius      = 0;
Chart.defaults.elements.point.hoverRadius = 4;
Chart.defaults.elements.point.hitRadius   = 12;
Chart.defaults.elements.bar.borderRadius  = 3;    // --radius-xs
```

**Paleta categórica de series** — todas verificadas a ≥3:1 (WCAG 1.4.11) sobre la
superficie de su tema:

| Serie | Claro | ratio | Oscuro | ratio |
| --- | --- | --- | --- | --- |
| 1 (principal) | `#0B6B70` | 6,27:1 | `#4CC9D0` | 8,85:1 |
| 2 | `#1A56C4` | 6,62:1 | `#6BA0F5` | 6,68:1 |
| 3 | `#B26A00` | 4,24:1 | `#E0A040` | 7,76:1 |
| 4 | `#0F7A44` | 5,40:1 | `#3FBF7F` | 7,51:1 |
| 5 | `#8E3B86` | 6,73:1 | `#D588CC` | 6,89:1 |
| 6 | `#B4231F` | 6,56:1 | `#F0736B` | 6,17:1 |

> **Límite honesto de esta paleta:** seis colores distinguibles por tono, pero con
> poca diferencia de luminosidad entre sí (el cálculo está en `contraste.py`). En
> escala de grises o para una persona con daltonismo, seis series de color no se
> distinguen. Por eso: **hasta 3 series, alcanza el color. De 4 en adelante es
> obligatorio agregar `pointStyle` distinto por serie** (`circle`, `rect`,
> `triangle`, `rectRot`, `star`, `cross`) **y `borderDash` distinto en las
> líneas** — o directamente etiquetar cada serie sobre el gráfico y sacar la
> leyenda.

Relleno bajo la línea: el mismo color de la serie al 10 % de opacidad, nunca un
degradado decorativo.

### 5.3 FullCalendar

FullCalendar 6 expone **30 variables CSS propias** (verificadas una por una
contra el paquete `fullcalendar@6.1.10` que carga la app). Mapearlas a los tokens
del sistema reemplaza el bloque de **222 líneas con 114 `!important`** que hoy
tiene `styles.css` para pelear con la librería, y hace que el calendario siga el
cambio de tema solo, sin JavaScript.

```css
.calendar-wrapper {
    --fc-small-font-size:              var(--text-xs);
    --fc-page-bg-color:                var(--surface);
    --fc-neutral-bg-color:             var(--surface-sunken);
    --fc-neutral-text-color:           var(--text-secondary);
    --fc-border-color:                 var(--border-subtle);

    /* Botones de la barra: mismo aspecto que el botón secundario del sistema */
    --fc-button-text-color:            var(--text-primary);
    --fc-button-bg-color:              var(--surface);
    --fc-button-border-color:          var(--border-control);
    --fc-button-hover-bg-color:        var(--surface-hover);
    --fc-button-hover-border-color:    var(--text-muted);
    --fc-button-active-bg-color:       var(--accent-subtle);
    --fc-button-active-border-color:   var(--accent);

    /* Eventos: por defecto neutros; el estado los recolorea uno por uno */
    --fc-event-bg-color:               var(--accent-subtle);
    --fc-event-border-color:           var(--accent);
    --fc-event-text-color:             var(--text-primary);
    --fc-event-selected-overlay-color: rgba(11, 107, 112, .18);

    --fc-more-link-bg-color:           var(--surface-sunken);
    --fc-more-link-text-color:         var(--accent);

    --fc-non-business-color:           var(--surface-sunken);
    --fc-bg-event-color:               var(--accent-subtle);
    --fc-bg-event-opacity:             .25;
    --fc-highlight-color:              var(--accent-subtle);
    --fc-today-bg-color:               var(--accent-subtle);
    --fc-now-indicator-color:          var(--danger);

    --fc-list-event-hover-bg-color:    var(--surface-hover);
    --fc-list-event-dot-width:         8px;
    --fc-daygrid-event-dot-width:      6px;

    --fc-event-resizer-thickness:        6px;
    --fc-event-resizer-dot-total-width:  8px;
    --fc-event-resizer-dot-border-width: 1px;
}
```

Opciones de JavaScript:

```js
{
    locale: 'es',
    firstDay: 1,                       // la semana empieza el lunes
    height: '100%',
    expandRows: true,
    stickyHeaderDates: true,
    fixedWeekCount: false,             // no dibuja una sexta semana vacía
    dayMaxEvents: 3,                   // el resto va a "+N más"
    nowIndicator: true,
    eventDisplay: 'block',
    displayEventTime: true,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    buttonText: { today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día', list: 'Lista' },
    headerToolbar: {
        left:   'prev,next today',
        center: 'title',
        right:  'dayGridMonth,timeGridWeek,timeGridDay'
    }
}
```

**Color de los eventos por estado.** Hoy `getStatusColor()` devuelve un hex
suelto y lo aplica como relleno completo, lo que convierte al mes en un mosaico
saturado. En su lugar, cada evento recibe una clase y se dibuja como **fondo
tintado + barra lateral de 3 px sólida**, más el símbolo del badge delante del
título:

| Estado de la cita | Clase | Fondo | Barra | Símbolo |
| --- | --- | --- | --- | --- |
| Programada | `fc-event--info` | `--info-subtle` | `--info` | `●` |
| En sala | `fc-event--warning` | `--warning-subtle` | `--warning` | `▲` |
| Finalizada | `fc-event--success` | `--success-subtle` | `--success` | `✓` |
| Cancelada | `fc-event--danger` | `--danger-subtle` | `--danger` | `✕` |
| Sin estado | `fc-event--neutral` | `--surface-sunken` | `--border-control` | `○` |

El texto del evento va en `{estado}-text`, que ya está verificado a ≥7:1 sobre su
fondo tintado en los dos temas.

---

## 6. Decisiones que tomé sin instrucción explícita

El encargo tenía algunos huecos. Los resolví así, y queda anotado para que se
puedan discutir con el diseño delante en vez de descubrirlos en el código.

| Hueco | Qué decidí | Por qué |
| --- | --- | --- |
| "Un acento usado con avaricia" — ¿el botón principal es el acento? | **No.** El botón principal es grafito neutro; el acento se reserva para foco, sección activa y enlaces | Si el botón "Guardar" fuera petróleo, el acento aparecería 30 veces por pantalla. Eso no es avaricia. Es la disciplina de Vercel y Linear, dos de las referencias del encargo |
| El foco: la guía de accesibilidad sugiere `box-shadow` | Uso **`outline` con `outline-offset`**, no `box-shadow` | En esta app hay `overflow: hidden` en `.container`, en `.consultas-table` y en `.pet-content`. Un `box-shadow` se recorta contra esos contenedores: la primera y la última fila de cada tabla quedarían **sin foco visible**. `outline` no se recorta y respeta el radio del borde |
| ¿Se mantiene el fondo `--surface-glass` con desenfoque? | **Se retira** | El vidrio esmerilado deja pasar el contenido de abajo, que es lo que hace que el contraste del texto encima sea imposible de auditar. En una barra que muestra el nombre del paciente, eso no se negocia |
| Los badges, ¿píldora o rectángulo? | **Rectángulo de 3 px con símbolo delante** | La píldora es lenguaje de app de consumo. El símbolo además cumple WCAG 1.4.1 (el color no puede ser la única señal), que la Fase 5 va a exigir igual |
| ¿Qué se hace con los degradados y los pesos 800? | **Se van los dos** | Son las dos firmas más reconocibles de plantilla administrativa gratuita, que es justamente lo que Daniel señaló. Además el texto con degradado no tiene contraste auditable |
| ¿La barra lateral sigue expandiéndose con hover? | **No.** Barra fija de 220 px + botón de colapsar explícito | El hover no existe en una tablet ni con teclado. Hoy, en una tablet de mostrador, se ven once íconos sin etiqueta para siempre |
| ¿Cuánto texto es "cuerpo"? ¿14 o 16 px? | **14 px**, con raíz en 16 px y todo en `rem` | 14 px con contraste de 16:1 es cómodo en escritorio y entra un tercio más de dato. El `rem` deja intacto el zoom del navegador y la preferencia de tamaño del sistema |
| ¿Existe una densidad compacta? | El token existe (`--row-height`), la implementación queda opcional para la Fase 3 | Definirlo ahora cuesta una línea; agregarlo después obliga a rehacer las seis tablas |
| ¿Qué pasa con el KPI que hoy muestra `0` sin dato? | El vacío se dibuja como `—`, no como `0` | Es el bug `kpiStock` de la auditoría. Arreglar el dato es de otra fase, pero el sistema tiene que distinguir "cero" de "no sé" desde el diseño, o el bug vuelve |

---

## 7. Cómo se verifica que la Fase 3 respetó esto

- [ ] `python3 docs/diseno/contraste.py --strict` termina sin error
- [ ] `rg -i '#[0-9a-f]{3,6}' static/css/styles.css` solo devuelve líneas dentro
      de los bloques `:root` (claro y oscuro) — ningún color suelto fuera del sistema
- [ ] `rg -i '#[0-9a-f]{3,6}' static/js/app.js` devuelve 0 resultados: ningún
      color escrito en JavaScript (**hoy hay 240**)
- [ ] `rg -- '--primary|--secondary|--shadow-premium|--surface-glass' static/`
      devuelve 0 resultados (hoy: 97 · 13 · 2 · 4)
- [ ] `rg 'linear-gradient' static/` solo aparece, si acaso, en el brillo del
      skeleton (hoy: 16)
- [ ] `rg 'font-weight: *800' static/` devuelve 0 resultados (hoy: 7)
- [ ] `rg 'translateY\(-[0-9]px\)' static/css/styles.css` devuelve 0 resultados:
      nada se mueve bajo el cursor (hoy: 9)
- [ ] Toda tabla está envuelta en `.table-container` con `overflow-x: auto`
- [ ] Toda celda de dinero, stock, peso o fecha tiene `tabular-nums`
- [ ] Todo estado se lee sin color: tiene palabra **y** símbolo
- [ ] Todo elemento interactivo muestra foco visible al llegar con `Tab`
- [ ] La app entera se recorre con teclado, incluida la barra lateral colapsada
- [ ] El conmutador de tema actualiza también los gráficos de Chart.js vivos

---

## 8. Qué **no** decide este documento

Este documento define **con qué se construye**. No define **qué se construye ni
dónde va**. Queda expresamente para la Fase 2 (arquitectura de información), que
tiene parada obligatoria con Daniel:

- Cómo se agrupan las once secciones del menú.
- Si Consultorio y Órdenes (Médico) se fusionan.
- Si hace falta una pantalla de inicio que hoy no existe.
- Si Facturación tiene su propio botón para emitir una factura.
- Qué debería mostrar realmente "Reportes y KPIs".
- Cuántas vistas por paciente quedan en Consultorio (hoy son ocho, y ocho no
  entran en una fila de pestañas).

Tampoco se tocan acá los dos bugs de datos que encontró la auditoría (`kpiStock`
y `profileEmail`) ni el problema de rol de los veterinarios sembrados: son de
backend y de datos, no de diseño.

## Siguiente paso

**Fase 2 — arquitectura de información**, con parada obligatoria y aprobación de
Daniel antes de escribir una línea de implementación.
