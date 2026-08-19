# Arquitectura de información de AmiVets

**Fase 2 de la tarea de rediseño.** Este documento decide **qué pantallas hay y
dónde vive cada cosa**. Sale del diagnóstico de [`auditoria.md`](auditoria.md) y
va antes de la Fase 3: la Fase 1 ([`sistema.md`](sistema.md)) definió **con qué**
se construye; acá se define **qué** se construye.

**Todavía no se tocó una línea de código.** Esto es una propuesta que necesita tu
aprobación, Daniel, antes de que se reconstruya una sola pantalla.

> **Cómo se verificó todo lo que dice acá.** Además de leer las 1.827 líneas del
> HTML y las 3.727 del JavaScript, se consultó la base de datos real que está
> corriendo ahora mismo. Cada número de este documento —cuántas consultas hay,
> cuánta plata sin facturar, cuántas citas— salió de una consulta a esa base, no
> de una estimación. **Ojo:** que el número salga de una consulta a la base no
> significa que describa comportamiento real del personal. Buena parte de esos
> datos —en particular los del Hecho 1 y el Hecho 2— son filas generadas por el
> script de seed de datos de prueba, no historial de uso capturado en
> producción; el detalle está en cada Hecho.

---

## La decisión, en una pantalla

| Qué | Hoy | Propuesta |
| --- | --- | --- |
| **Entradas en el menú** | 11 (una por tabla de la base) | **7**, agrupadas por momento de uso |
| **Pantalla de inicio** | No existe: abre en Consultorio, pero el menú marca Agenda como activa | **"Hoy"**, distinta según quién entra |
| **Pestañas dentro del paciente** | 11 | **6** |
| **Dónde se emite una factura** | Escondido: Consultorio → paciente → Consultas → fila → "Facturar" | **Caja → Por facturar**, con su propia pantalla |
| **Secciones que dejan de serlo** | — | Órdenes, Propietarios, Catálogo, Usuarios, Mi Perfil, Horarios y Veterinarios QR |
| **Clics para atender un paciente de punta a punta** | **27** | **12** (vale para el paciente ya agendado — ver «Ojo con la comparación» más abajo) |

### Las tres reglas que ordenan la propuesta

1. **Se agrupa por momento, no por tabla.** "Propietarios", "Mascotas" y
   "Consultas" son tres tablas de la base, pero una sola tarea: atender a un
   paciente. El menú de hoy es el esquema de la base de datos con íconos.
2. **Lo que se configura una vez no compite con lo que se usa cada día.**
   El catálogo de servicios tiene 215 filas y se toca cuando cambian los precios;
   hoy ocupa el mismo lugar en el menú que la agenda del día.
3. **Cada pantalla tiene un dueño.** Si no se puede decir quién la abre y en qué
   momento del día, la pantalla no existe: es un listado.

---

## Los cuatro hechos que ordenan todo lo demás

Antes del mapa, cuatro cosas que se descubrieron mirando la base de datos real y
que cambian por completo qué tiene sentido proponer.

### Hecho 1 — La agenda no se usa. El sistema se usa desde el consultorio.

| Tabla | Filas reales hoy |
| --- | --- |
| Consultas clínicas | **255** |
| Citas agendadas | **1** |

Doscientas cincuenta y cinco consultas cargadas contra **una sola cita**.

**De dónde salen esos números, en limpio:** `backend/scripts/seed_data.py`
genera las ~255 filas de `Consulta` con `random.choice`/`random.randint` en un
bucle que **nunca instancia un solo `Cita`** —el nombre está importado en el
archivo pero no se construye ninguno en el ciclo de carga—. La única cita real
que hay en la base la creó otra vía. Esto no es la app en producción: es el
seed de datos de prueba. La lectura de que "la gente entra al consultorio,
busca al paciente y carga la consulta directamente" es una **inferencia a
partir de la forma de los datos**, no una observación directa de cómo trabaja
el personal —nadie miró a un recepcionista hacer esto—.

La consecuencia para la arquitectura es grande: hoy la Agenda es la primera
entrada del menú superior y la que el HTML marca como activa al cargar, pero la
pantalla que de verdad se abre —porque el JavaScript la fuerza— es Consultorio.
**El sistema ya sabe cuál es su pantalla real; el menú todavía no se enteró.**

### Hecho 2 — Hay $11.150 de trabajo hecho que la pantalla de dinero no muestra

| Qué | Cuánto |
| --- | --- |
| Consultas marcadas "POR_COBRAR" | **252** |
| De esas, las que tienen cargos cargados (servicios, medicamentos) | **56** |
| Plata de esos cargos, nunca facturada | **$11.150** |
| Facturas emitidas en toda la historia del sistema | **3**, por $1.412 |
| De esas, con saldo pendiente de cobro | **1**, por $696 |

**Mismo origen que el Hecho 1, y la misma advertencia aplica:** el modelo
`Consulta` define `estado_pago` con `default="POR_COBRAR"` en
`backend/app/models/models.py`, y el bucle de `seed_data.py` no lo toca en
ningún momento. Es decir, de las 252 consultas "POR_COBRAR", la enorme mayoría
está en ese estado porque **nunca nadie la cambió**, no porque se haya
detectado un flujo de cobro roto en producción. El número de consultas con
cargos cargados (56) y la plata sin facturar ($11.150) sí son una lectura
directa de filas concretas de la base, pero el "252 de 255" como indicador de
un problema de cobro es en gran parte artefacto del generador de datos de
prueba, igual que el "255 contra 1" del Hecho 1.

La sección se llama "Facturación" y muestra tres filas por $1.412. Al lado, sin
que ninguna pantalla lo diga, hay **casi ocho veces esa plata** (7,9x) en trabajo
registrado y no facturado.

Y peor: la tabla de Facturación **no tiene columna de cliente ni columna de
saldo**. La factura FAC-000002 debe $696 y para enterarte hay que abrirla de a
una. La pregunta "¿quién me debe plata?" no se puede contestar hoy en la
pantalla que existe para eso.

Esto no es un problema de diseño visual. Es el argumento más fuerte de todo el
documento para que **Caja** exista como sección con su propia entrada, en vez de
ser un historial de comprobantes.

### Hecho 3 — El botón "Marcar Check-in" nunca se dibuja. Ni el de "Atender".

Esto no aparece en las capturas porque no hay nada que capturar: los botones
simplemente no están.

El sistema guarda el estado de una cita con estas cinco palabras:
`PENDIENTE`, `EN_ESPERA`, `EN_CONSULTA`, `FINALIZADO`, `CANCELADA`.

La pantalla, en cambio, dibuja el botón "Marcar Check-in" solo si el estado dice
`Programada`, y el botón "Atender" solo si dice `Programada` o `En Sala`.
**Ninguna de esas dos palabras existe en el sistema.** Los colores del calendario
usan ese mismo vocabulario inexistente, y el contador de "Órdenes (Médico)"
cuenta las citas en estado `pendiente` en minúscula, mientras el sistema escribe
`PENDIENTE` en mayúscula.

Verificado contra la base: la única cita cargada está en `EN_CONSULTA`.

**Traducción para el día a día:** la sala de espera es una lista que se mira, no
un tablero con el que se trabaja. No hay forma, desde la interfaz, de marcar que
un paciente llegó. Y el contador de órdenes del veterinario está condenado a
mostrar 0 para siempre.

Esto se arregla en la Fase 3 —es JavaScript, no backend— pero define la
arquitectura: **el estado del paciente durante el día es la columna vertebral de
la pantalla de inicio**, y hoy esa columna no existe.

### Hecho 4 — El backend ya tiene los informes. Nadie los llama.

El servidor expone, funcionando y montado, cuatro consultas de análisis:

| Informe | Qué devuelve |
| --- | --- |
| Ingresos | Total facturado del día o del mes |
| Cuentas por cobrar | Facturas con saldo, con nombre del cliente |
| Rendimiento por veterinario | Consultas realizadas por cada veterinario |
| Servicios más vendidos | Los servicios y productos más vendidos |

*(Las rutas exactas del backend están en el apéndice al final del documento, para quien quiera verificarlas en el código.)*

**El frontend no llama a ninguna.** En su lugar, la pantalla "Reportes y KPIs"
descarga las primeras 100 citas y cuenta a mano. En el código hay incluso un
comentario del programador que lo dice:
`// const reporteKpis = await fetchAPI('/reportes/kpis'); // Si existiera`.

Existía. Estaba a un renglón de distancia.

Esto importa para tu decisión, Daniel, porque significa que **"Hoy" e "Informes"
se pueden construir, con una sola excepción, sin tocar el backend**, que es
justamente lo que la tarea prohíbe hacer. La excepción es la comparación de
facturación contra el mes anterior (bloque del dueño, más abajo): el informe de
Ingresos no acepta ningún rango de fechas —queda anotada como hueco en "Lo que
hace falta y no está".

---

## El mapa: de once entradas a siete

### Cómo está hoy

```
Consultorio         ← la pantalla que de verdad se usa
Agenda              ← calendario + sala de espera
Propietarios        ← listado de dueños
Inventario          ← stock y farmacia
Facturación         ← historial de 3 comprobantes
Reportes y KPIs     ← tres números, uno roto
Órdenes (Médico)    ← cola del veterinario (siempre vacía)
Citas Web / QR      ← 3 pestañas: recibidas, horarios, veterinarios
Catálogo            ← 215 precios de servicios
Usuarios (admin)    ← 11 usuarios
Mi Perfil           ← nombre y contraseña
```

Once entradas, once tablas, cero jerarquía. Nada dice qué mirar primero.

### Cómo quedaría

```
Hoy              ← NUEVA. Lo que hay que hacer, según quién sos
Pacientes        ← Consultorio + Propietarios
Agenda           ← calendario + bandeja de solicitudes web
Caja             ← Por facturar + Emitidas
Inventario       ← igual, pero con sus alertas adentro
Informes         ← Reportes, con los datos que ya existen
Configuración    ← Catálogo + Usuarios (solo admin) + Horarios y Veterinarios QR

  · Mi Perfil sale del menú y pasa al menú del avatar, arriba a la derecha
```

**Siete entradas.** Adentro de Configuración, solo la pestaña **Usuarios**
queda oculta para quien no es administrador —igual que hoy—; Catálogo y
Horarios/Veterinarios QR se ven igual para todos. Una recepcionista o un
veterinario ven las mismas siete entradas del menú; lo único que cambia según
el rol es qué pestañas hay dentro de Configuración.

### La tabla de correspondencias, sección por sección

| Sección de hoy | Qué pasa con ella | El hecho que lo motiva |
| --- | --- | --- |
| **Consultorio** | Se renombra **Pacientes** y absorbe Propietarios | 255 consultas contra 1 cita: es la pantalla real del sistema (Hecho 1) |
| **Propietarios** | Deja de ser sección → **buscador por dueño dentro de Pacientes** | De sus tres botones por fila, "Mascotas" ya te lleva a Consultorio y filtra la lista de pacientes —el listado en sí es un buscador disfrazado de sección—; "Editar" y "Eliminar" son acciones CRUD propias que se preservan en la tarjeta del dueño, editable dentro de la ficha del paciente en el diseño fusionado |
| **Agenda** | Se queda, pierde la sala de espera y gana la bandeja de solicitudes web | La sala de espera es material de "Hoy", no del calendario |
| **Órdenes (Médico)** | **Desaparece** → se disuelve en **Hoy** | Lee exactamente el mismo dato que la Agenda (el endpoint de citas) y lo filtra distinto. Y hoy nunca muestra nada (Hecho 3) |
| **Facturación** | Se renombra **Caja** y gana la pestaña "Por facturar" | $11.150 de trabajo sin facturar que la pantalla del dinero no muestra (Hecho 2) |
| **Reportes y KPIs** | Se renombra **Informes** y se llena con los datos que ya existen | Cuatro consultas de análisis vivas en el backend y sin usar (Hecho 4) |
| **Inventario** | Se queda tal cual, con las alertas de stock adentro | 69 productos, tarea propia, persona propia. Es de las pocas secciones que se sostiene sola |
| **Citas Web / QR** | Se parte en dos: "Citas recibidas" → **Agenda**; "Horarios" y "Veterinarios" → **Configuración** | Una pestaña es trabajo diario (llegó una solicitud) y dos son configuración (quién atiende y en qué franjas). Estaban juntas porque comparten base de datos, no porque compartan momento |
| **Catálogo de Servicios** | Deja de ser sección → **pestaña de Configuración** | 215 precios que se editan cuando cambia la lista, no todos los días |
| **Usuarios (admin)** | Deja de ser sección → **pestaña de Configuración** | 11 usuarios. Ya es la única entrada oculta para no-administradores: es configuración y el propio código lo sabe |
| **Mi Perfil** | Sale del menú → **menú del avatar** | Son dos datos y un cambio de contraseña. No es trabajo; es una preferencia personal |
| — | **Hoy** (nueva) | No existe ninguna pantalla que conteste "¿qué tengo que hacer ahora?" |

---

## Las fusiones, una por una

### Fusión 1 — Consultorio + Propietarios = **Pacientes**

**Por qué son la misma tarea partida en dos pantallas.**

Cuando alguien busca a un dueño en Propietarios y aprieta "Mascotas", el sistema
**no le muestra las mascotas ahí**: cambia solo de sección, te deposita en
Consultorio y filtra la lista de pacientes por ese dueño. Está escrito así en el
código y funciona bien. Es la prueba de que Propietarios ya es, en los hechos,
**un segundo buscador de la misma pantalla**.

**Cómo queda.** Una sola sección con un buscador que tiene dos lentes:

```
Pacientes
 └─ Buscar por:  [ Paciente ]  [ Dueño ]
     └─ lista de resultados
         └─ ficha del paciente  (con la tarjeta del dueño arriba, editable ahí mismo)
```

El alta de un dueño nuevo pasa a ser un botón dentro de Pacientes, no un botón
suelto en la barra superior como está hoy —donde, además, aparece en todas las
pantallas, incluso en Inventario.

**Lo que se gana concretamente:** hoy, para atender a un cliente nuevo hacen
falta dos secciones distintas (registrar dueño en una, registrar mascota en
otra). Después, es una pantalla y dos pasos encadenados.

### Fusión 2 — La sala de espera + Órdenes (Médico) = **Hoy**

**Por qué son la misma tarea partida en dos pantallas.**

Las dos leen la misma dirección del servidor (el endpoint de citas) y le aplican
filtros distintos. La Agenda muestra las citas de hoy; Órdenes muestra las citas
pendientes. Es el mismo dato mirado por dos personas que están en la misma
habitación, en el mismo momento del día, y hoy compiten por la atención en el
menú.

**Y ninguna de las dos funciona** (Hecho 3): la sala de espera no dibuja sus
botones y el contador de órdenes está clavado en cero.

**Cómo queda.** Una sola tabla en "Hoy", con el paciente avanzando por estados
visibles, y las acciones cambiando según el estado y según quién mira.

### Fusión 3 — Laboratorio + Imágenes = **Estudios** (dentro del paciente)

Este es el caso más claro de todos: **son la misma tabla de la base de datos**,
filtrada por un campo "tipo". Dos pestañas para el mismo cajón. En toda la base
hay **4 estudios cargados** entre las dos.

Con solo 4 registros en toda la clínica, "Estudios" no aguanta ser una pestaña
propia en la estructura final: en la tabla de las seis pestañas (más abajo) se
absorbe, a su vez, dentro de **Procedimientos** (Fusión 5), junto con cirugías
y hospitalizaciones. Es una fusión de segundo nivel, y va por volumen, no por
parecido de datos: siete pestañas —Resumen, Consultas, Fórmulas, Preventiva,
Estudios, Procedimientos, Cobros— es una más de las seis que se adoptan como
límite, y una pestaña con 4 filas compite por atención igual que una con 255.

### Fusión 4 — Vacunas + Desparasitaciones = **Preventiva** (dentro del paciente)

Son la misma forma de dato: ambas son un producto aplicado en una fecha, ligado
a una consulta y a un ítem de inventario. En toda la base hay **4 vacunas y 4
desparasitaciones**: ocho registros repartidos en dos pestañas de un menú de
once.

### Fusión 5 — Cirugías + Hospitalizaciones = **Procedimientos** (dentro del paciente)

Acá la evidencia del código es más floja de lo que parece a primera vista: en
`static/js/app.js`, las funciones `buildClinicoForm()` y `submitClinico()` sí
manejan cirugía y hospitalización con el mismo mecanismo, pero ese mismo par de
funciones también arma los formularios de vacunación, desparasitación y
laboratorio —**cinco** tipos en total, no cuatro, y sin ninguna lista con
nombre que los agrupe como "módulos complejos" ni de ninguna otra forma; esa
frase no existe en el código. La línea que separa "Preventiva" (Fusión 4) de
"Procedimientos" (Fusión 5) la traza este documento, no el programador: se
apoya en que cirugía y hospitalización comparten `mascota_id`, `consulta_id`,
el campo de costo aplicado (`precio_aplicado`) y el flag `facturado` en el
modelo de datos (`backend/app/models/models.py`), y son más parecidas entre sí
que a una vacuna —no en un par de fechas de entrada/salida ni en un campo de
documento adjunto: `Cirugia` solo tiene `fecha_cirugia` (una fecha, no un
rango) y ningún campo de archivo o documento; `informe_quirurgico` es texto
libre, no un adjunto. Esto no es una agrupación que ya existiera en el código,
y el parecido de campos es más modesto de lo que parece a primera vista: se
sostiene en el propósito (registrar un evento clínico con costo asociado a una
consulta), no en una forma de dato idéntica.

Volumen real: 23 cirugías y 42 hospitalizaciones. Juntos, 65 registros que
comparten el mismo propósito (evento clínico con costo, ligado a mascota y
consulta), no una forma de dato idéntica.

---

## Las degradaciones: de sección a acción

Una sección de nivel superior le cuesta al usuario **atención permanente**: está
siempre visible, siempre compitiendo. Estas cinco no se ganan ese lugar.

| Pasa a ser | El hecho |
| --- | --- |
| **Catálogo de Servicios** → pestaña de Configuración | 215 precios. Se editan cuando cambia la lista de precios (¿una vez por trimestre?), no cada día. Además, hoy su columna "Acciones" queda fuera de la pantalla a 1440px y es inaccesible: no hay scroll horizontal posible porque un contenedor ancestro tiene `overflow: hidden` |
| **Usuarios** → pestaña de Configuración | 11 usuarios. Ya es la única entrada del menú con la marca `admin-only`, oculta para todos los demás. El código ya la trata como configuración |
| **Horarios (QR)** → pestaña de Configuración | Define en qué franjas atiende cada veterinario. Se arma una vez y se ajusta cuando cambian los turnos |
| **Veterinarios (QR)** → pestaña de Configuración | Es "qué médicos aparecen en el formulario público". Es una configuración del QR, no una agenda |
| **Mi Perfil** → menú del avatar | Nombre, correo y cambio de contraseña. Todos los sistemas de trabajo lo ponen ahí y nadie lo busca en el menú lateral |

**Nota sobre Mi Perfil:** el campo "Correo Electrónico" hoy queda en blanco para
cualquier usuario porque nada lo completa. Mudarlo al menú del avatar no lo
arregla —eso es de la Fase 3— pero deja de ocupar un lugar en el menú principal
para mostrar un campo vacío.

---

## La pantalla que falta: **Hoy**

Hoy no existe ninguna pantalla que conteste **"¿qué tengo que hacer ahora?"**.
Cada una contesta "¿qué hay en esta tabla?".

Peor: la app **no tiene una pantalla de inicio decidida**. El menú superior marca
"Agenda" como activa al cargar, pero el JavaScript fuerza que se muestre
Consultorio. Es una contradicción chiquita que dice todo: nadie decidió cuál es
la puerta de entrada.

**"Hoy" es esa puerta**, y muestra cosas distintas según quién entra.

### Qué ve la recepcionista al abrir el sistema

| Bloque | Qué muestra | De dónde sale el dato |
| --- | --- | --- |
| **La sala** | Los pacientes de hoy con su estado (Agendado · Llegó · En consulta · Terminado) y **un botón de acción por fila** | El endpoint de citas — el mismo de hoy, con el vocabulario de estados arreglado |
| **Por facturar** | Cuántas consultas terminadas esperan factura y por cuánta plata | El filtro de consultas por cobrar — ya existe y ya filtra |
| **Solicitudes web sin responder** | Turnos pedidos por el QR que nadie miró | El endpoint de citas del QR — ya existe, pero hoy solo responde para rol `admin`; ver el hueco más abajo |
| **Avisos de stock** | Productos bajo mínimo o por vencer, con enlace a Inventario | El endpoint de inventario — ya existe |

El punto de la primera fila: **el botón de acción cambia con el estado**.
Agendado → "Llegó". Llegó → "Pasar a consulta". Terminado → "Cobrar". Un botón
por fila, siempre el correcto. Eso es lo que hoy no funciona.

### Qué ve el veterinario

| Bloque | Qué muestra |
| --- | --- |
| **Esperando** | Los pacientes que ya llegaron y le tocan a él. Un clic entra a la consulta |
| **Mi día** | Sus citas de hoy, en orden de horario |
| **Internados** | Los pacientes hospitalizados a su cargo, con estado y jaula |
| **Sin cerrar** | Consultas suyas sin diagnóstico cargado — la deuda del día anterior |

Esto **reemplaza por completo** a "Órdenes (Médico)", que existe para esto y
está vacía.

### Qué ve el dueño de la clínica

| Bloque | Qué muestra | De dónde sale |
| --- | --- | --- |
| **Facturado hoy / este mes** | **Sin comparación contra el mes anterior por ahora** — el endpoint no admite un rango de fechas; ver el hueco reportado más abajo | El informe de Ingresos — **ya existe, nadie lo llama** |
| **Sin facturar** | El trabajo hecho que todavía no se convirtió en plata. Hoy: **$11.150** | El filtro de consultas por cobrar |
| **Con saldo** | Facturas emitidas y no cobradas, **con nombre del cliente**. Hoy: $696 | El informe de Cuentas por cobrar — **ya existe, nadie lo llama** |
| **Actividad por veterinario** | Consultas atendidas por cada médico | El informe de Rendimiento por veterinario — **ya existe, nadie lo llama** |

**Todo esto se puede construir sin tocar el backend, con la excepción de la
comparación contra el mes anterior** de la primera fila, que necesita un
parámetro de fecha que el endpoint de Ingresos no tiene hoy —mismo hueco que
señala "Informes" más abajo—. El resto es exactamente lo que la tarea exige.

### Y "Reportes y KPIs" pasa a ser **Informes**

Con los mismos cuatro datos de arriba, pero **con rango de fechas** —hoy no hay
ninguno, y sin fecha "cerrar el mes" es imposible— más los servicios más
vendidos. La diferencia con "Hoy" es la cadencia: **"Hoy" se mira cada mañana;
"Informes" se mira el último día del mes.** Por eso son dos entradas y no una.

El KPI "Bajo Stock" se muda a Inventario, donde vive la acción que lo resuelve.
Hoy es un número que nadie actualiza —está clavado en 0 sin importar el stock
real— parado en una pantalla desde la que no se puede hacer nada al respecto.

---

## Dentro del paciente: de once pestañas a seis

La ficha de un paciente tiene hoy **once pestañas** en una columna lateral. El
documento del sistema de diseño avisó que ocho no entran en una fila de
pestañas; en realidad son once.

Así se usan de verdad, contado sobre la base:

| Pestaña de hoy | Registros en toda la clínica |
| --- | --- |
| Consultas | **255** |
| Fórmulas (recetas) | **113** |
| Hospitalizaciones | 42 |
| Cirugías | 23 |
| Facturación | 3 |
| Vacunas | 4 |
| Desparasitaciones | 4 |
| Laboratorio + Imágenes | 4 (**la misma tabla**, partida en dos pestañas) |
| Historia Clínica | resumen, no guarda nada |
| Evol. Peso | un gráfico, no guarda nada |

Sumados, son 448 registros clínicos. **Dos pestañas concentran el 82 %**
(Consultas 57 %, Fórmulas 25 %). Las otras nueve se reparten el 18 % restante y
pesan exactamente lo mismo en la pantalla.

**Detalle revelador:** la pestaña "Fórmulas" tiene un botón cuya única función es
mostrar un cartel que dice *"Las recetas se crean desde una consulta"*. Un botón
que existe para avisar que no hace nada.

### Las seis que quedan

| Pestaña | Qué junta | Por qué |
| --- | --- | --- |
| **Resumen** | Historia clínica + gráfico de peso + tarjeta del dueño + alertas | Un gráfico no es una sección; es un dato del resumen |
| **Consultas** | Igual, pero cada consulta se abre **en la misma pantalla**, no en un único modal que hace de todo (cargar la consulta, buscar ítems, agregar cargos) | Es el 57 % del contenido clínico de toda la clínica |
| **Fórmulas** | Igual, sin el botón que avisa que no hace nada | 113 registros: el veterinario mira qué recetó la vez pasada |
| **Preventiva** | Vacunas + desparasitaciones | Misma forma de dato: producto aplicado en una fecha, ligado a una consulta y a un ítem de inventario |
| **Procedimientos** | Cirugías + hospitalizaciones + estudios (lab e imágenes) | Lab e imágenes son literalmente la misma tabla en el código; cirugía+hospitalización es una agrupación de este documento, no del código (ver Fusión 5) |
| **Cobros** | Facturas del paciente | La pregunta "¿este cliente debe algo?" merece su lugar |

Once → seis. El sistema de diseño dejó esta decisión en manos de esta fase; seis
**sí** entran en una fila de pestañas horizontal, que es el límite que se adopta
acá.

---

## El flujo completo: atender un paciente de punta a punta

Este es el corazón de la propuesta. Escenario: **llega un paciente sin turno
previo, se le carga la cita en el momento, lo atiende el veterinario, se le
aplica un tratamiento y se cobra.**

> **Cómo se cuentan los clics.** Un clic es una pulsación sobre un control:
> entrada de menú, botón, campo que hay que enfocar, opción de un desplegable
> (abrirlo y elegir cuentan dos) y cartel del navegador que hay que despachar.
> Escribir texto no se cuenta. Es la misma regla para el antes y para el después.

### Hoy: 27 clics, dos sesiones, dos búsquedas del mismo paciente

| # | Quién | Qué hace | Clics |
| --- | --- | --- | --- |
| 1 | Recepción | Menú → Consultorio | 1 |
| 2 | Recepción | Enfocar el buscador y escribir el nombre | 1 |
| 3 | Recepción | Clic en la tarjeta del paciente | 1 |
| 4 | Recepción | Botón "+ Registrar" → abre el modal de **Cita**, no el de consulta (el botón cambia de significado según el rol) | 1 |
| 5 | Recepción | Desplegable de médico: abrir + elegir | 2 |
| 6 | Recepción | Botón "Agendar Cita" | 1 |
| 7 | Recepción | Cerrar el cartel "Cita/Orden agendada correctamente." | 1 |
| 8 | Veterinario | Menú → Órdenes (Médico). **Sale vacía** (Hecho 3): la orden no aparece | 1 |
| 9 | Veterinario | Menú → Consultorio | 1 |
| 10 | Veterinario | Enfocar el buscador y escribir **otra vez** el mismo nombre | 1 |
| 11 | Veterinario | Clic en la tarjeta del paciente | 1 |
| 12 | Veterinario | Pestaña "Consultas" | 1 |
| 13 | Veterinario | Botón "+ Nueva Consulta" | 1 |
| 14 | Veterinario | Guardar la consulta | 1 |
| 15 | Veterinario | Botón "🔍 Completa" en la fila → abre el modal Expediente | 1 |
| 16 | Veterinario | Desplegable "Categoría *": abrir + elegir | 2 |
| 17 | Veterinario | Enfocar el buscador del ítem | 1 |
| 18 | Veterinario | Elegir el ítem de las sugerencias | 1 |
| 19 | Veterinario | Botón "🩺 Registrar Acción Clínica" | 1 |
| 20 | Veterinario | Cerrar el modal Expediente | 1 |
| 21 | Recepción | Botón "💲 Facturar" en la fila de la consulta | 1 |
| 22 | Recepción | Desplegable "Metodo de Pago" (así, sin tilde, en el código): abrir + elegir | 2 |
| 23 | Recepción | Botón "✔️ Emitir y Guardar" | 1 |
| 24 | Recepción | Cartel "¿Desea descargar el comprobante/PDF de la factura ahora?" | 1 |
| | | **Total** | **27** |

Y hay tres cosas que los 27 clics no cuentan:

- **El mismo paciente se busca dos veces**, una por cada persona, porque no hay
  nada que conecte la orden con el consultorio.
- **El paso 8 no devuelve nada.** El veterinario pasa por una pantalla que
  estructuralmente no puede mostrarle su orden.
- **La llegada del paciente nunca se registra.** El botón "Marcar Check-in" no se
  dibuja (Hecho 3), así que el aviso de que el paciente llegó es una persona
  diciéndoselo a otra.

### Con la reorganización: 12 clics, sin buscar, con una sola entrada a otra sección (paciente ya agendado — ver «Ojo con la comparación» abajo)

| # | Quién | Qué hace | Clics |
| --- | --- | --- | --- |
| — | Recepción | Abre el sistema. **Ya está en "Hoy"**, con la sala del día delante | 0 |
| 1 | Recepción | Botón "Llegó" en la fila del paciente | 1 |
| — | Veterinario | En su "Hoy" aparece el paciente en **Esperando**. No busca nada | 0 |
| 2 | Veterinario | Clic en la fila → abre la ficha **en una consulta nueva, emparejada con la cita por el paciente que ya está en pantalla** (sin buscarlo de nuevo) | 1 |
| 3 | Veterinario | Guardar la consulta | 1 |
| 4 | Veterinario | Botón "+ Agregar cargo" (en la misma pantalla, sin abrir un modal aparte) | 1 |
| 5 | Veterinario | Enfocar el buscador único de servicios y productos | 1 |
| 6 | Veterinario | Elegir el ítem | 1 |
| 7 | Veterinario | Botón "Agregar" | 1 |
| 8 | Veterinario | Botón "Finalizar consulta" → pasa a **Por facturar** automáticamente | 1 |
| — | Recepción | En su "Hoy", el contador "Por facturar" sube solo | 0 |
| 9 | Recepción | Clic en "Por facturar" → entra a la sección **Caja**, ya filtrada en la pestaña "Por facturar" (esto sí es un cambio de sección, no un widget dentro de "Hoy") | 1 |
| 10 | Recepción | Botón "Cobrar" en la fila | 1 |
| 11 | Recepción | Elegir el método de pago (botones a la vista, no desplegable) | 1 |
| 12 | Recepción | Botón "Emitir" | 1 |
| — | — | El comprobante se ofrece en un aviso con enlace, sin cartel que trabe la pantalla | 0 |
| | | **Total** | **12** |

**Ojo con la comparación:** los 12 clics arrancan con el paciente ya sentado en
"la sala del día", sin mostrar cómo llegó ahí la cita. El flujo de "antes"
en cambio sí carga esos 5 clics (filas 4 a 7) porque crea la cita desde cero
para un paciente que llega sin turno —y el Hecho 1, con la salvedad de que es
una inferencia a partir de la forma de los datos y no una observación directa,
sugiere que ese caso, el walk-in, es el uso dominante hoy, no el turno
pre-agendado—. La
reducción del 56 % vale para el camino de un paciente que ya está agendado
y en la sala; para el walk-in, la versión reorganizada también va a necesitar
un paso equivalente para crear la cita, así que ahí el ahorro es menor al que
muestra esta comparación.

### El resumen del cambio

| | Hoy | Propuesta |
| --- | --- | --- |
| **Clics** | 27 | **12** (−56 %; vale para el paciente ya agendado, ver «Ojo con la comparación» arriba) |
| Navegaciones por el menú | 3 | **1** |
| Búsquedas manuales del mismo paciente | 2 | **0** |
| Carteles del navegador que hay que despachar | 2 | **0** |
| Pantallas que no devuelven nada | 1 | **0** |
| La llegada del paciente queda registrada | **No** | **Sí** |

**De dónde salen los 15 clics que se ahorran, sin trucos** (esta cuenta vale
para el camino del paciente ya agendado y en la sala, como se aclara arriba en
«Ojo con la comparación»)**:** seis de no volver a
buscar al paciente ni navegar el menú, cuatro de que el estado del paciente
avance solo en vez de tener que crear una "orden" a mano, tres de reemplazar
desplegables por opciones a la vista donde hay pocas, y dos de sacar los carteles
del navegador.

**Ninguno sale de sacar información de la pantalla.** El veterinario sigue
cargando lo mismo; lo que desaparece es el trabajo de encontrar dónde cargarlo.

---

## Lo que hace falta y no está (para reportar, no para arreglar acá)

La tarea pide que si una pantalla necesita un dato que la API no da, **se
reporte** en vez de tocar el backend. Esto es lo que aparece:

| Qué falta | Para qué lo necesitaría | Quién lo resuelve |
| --- | --- | --- |
| **No hay forma de aceptar una solicitud del QR** | Una cita pedida por el QR solo se puede **cancelar**. No existe nada que la convierta en una cita interna. Hoy la recepcionista tiene que leerla y volver a cargarla a mano | Backend |
| **Los roles no distinguen recepcionista de veterinario** | "Hoy" muestra cosas distintas según el rol, pero en la base solo hay `admin` (1) y `user` (10) —verificado en vivo contra la base al escribir esto. Ojo: `backend/scripts/seed_data.py` tiene un cambio sin commitear que, si se corre, agrega un rol `veterinario`; conviene volver a chequear este número recién al arrancar la Fase 3, no darlo por congelado. El frontend ya pregunta por un rol `recepcionista` que nunca existió | Datos / backend |
| **Los diez médicos tienen rol `user`, no `veterinario`** | Ya reportado en la auditoría. Mientras siga así, el QR público y Horarios quedan vacíos | Datos / seeding |
| **El informe de Ingresos no acepta rango de fechas** | Solo sabe "hoy" y "este mes" —la rama "mensual" del endpoint está fijada al mes y año actuales (`extract('month', func.now())`), no admite ningún parámetro de fecha—. Esto afecta tanto al bloque "Facturado hoy / este mes" del dueño en "Hoy" (más arriba) como a "Informes": ninguno de los dos puede armar la comparación contra el mes anterior sin este cambio | Backend (o se calcula en el frontend por ahora) |
| **Las tablas no tienen paginación** | Con 255 consultas y 215 servicios ya hace falta. Hoy la app pide `limit=100` y descarta el resto en silencio[^pag] | Ya señalado en el sistema de diseño |
| **No hay un vínculo guardado entre `Cita` y `Consulta`** | El paso 2 del flujo de 12 clics abre la consulta emparejada con la cita por el paciente que ya está en pantalla, pero ni `Consulta` tiene `cita_id` ni `Cita` tiene `consulta_id` en el modelo de datos. Sin ese vínculo persistido, lo que se puede construir en la Fase 3 es un emparejamiento por identidad del paciente dentro de la misma carga de pantalla, no una relación guardada en la base | Backend |
| **El endpoint de "Solicitudes web sin responder" es solo para admin** | `GET /api/admin/supabase/citas-qr` (`backend/app/routers/supabase_admin.py`) exige `Depends(get_current_admin)` y devuelve 403 si el rol no es `admin`. Como hoy solo existen los roles `admin` y `user`, cualquier cuenta de recepción es `user` y no puede llamarlo. La pantalla "Hoy" de este documento le asigna ese bloque a la recepcionista dando por sentado que el endpoint "ya existe" y alcanza, pero hace falta ampliar el alcance del rol en el servidor —o resolver primero el rol `recepcionista` ya señalado en la fila de arriba— antes de que "Hoy" pueda llamarlo para alguien que no sea admin | Backend |

[^pag]: Este documento describe truncamiento silencioso (`limit=100/200/300` fijo en `static/js/app.js`, filas descartadas sin aviso). `docs/diseno/sistema.md` (línea 749) describe lo contrario para el mismo punto: "No existe. Las tablas listan todo". Son incompatibles entre sí. La caracterización de este documento es la verificada contra el código actual; `sistema.md` debería corregirse por separado — no asumas que están de acuerdo solo porque ambos lo mencionan.

---

## Decisiones que tomé sin instrucción, y las alternativas que descarté

| Duda | Qué decidí | Por qué |
| --- | --- | --- |
| ¿"Caja" e "Informes" van juntas en una sola sección de finanzas? | **Separadas** | Las usan personas distintas con cadencias distintas: cobrar es diario y lo hace recepción; analizar es mensual y lo hace el dueño. Juntarlas obligaría a la recepcionista a pasar por gráficos para cobrar |
| ¿"Hoy" reemplaza a la Agenda? | **No.** Agenda se queda | "Hoy" contesta "qué pasa ahora"; la Agenda contesta "qué pasa el jueves". Son dos preguntas y hoy están mezcladas en una sola pantalla |
| ¿Inventario se va también a Configuración? | **No** | Se movía todos los días y tiene alertas que exigen acción (stock bajo, vencimientos). El catálogo de precios no: se edita y se olvida |
| ¿Los estudios de laboratorio e imágenes van separados? | **Juntos**, con filtro por tipo | Son la misma tabla. Separarlos fue una decisión de menú, no de datos |
| ¿Cirugías y hospitalizaciones juntas? | **Juntas** | Comparten formulario en el código y, en el modelo de datos, `mascota_id`, `consulta_id`, `precio_aplicado` y `facturado` —no comparten un par de fechas de entrada/salida ni un campo de documento; ver Fusión 5. El código no las agrupa bajo un nombre propio. Si tenés un motivo clínico para separarlas, esta es la decisión de la lista que más fácil se revierte |
| ¿Se emite la factura desde Caja o se sigue emitiendo desde la consulta? | **Las dos** | El veterinario tiene que poder cerrar y cobrar sin cambiar de pantalla; la recepcionista tiene que poder cobrar lo acumulado sin entrar a cada ficha. Hoy solo existe el primer camino, y escondido a cinco clics de profundidad |
| ¿Cuántos bloques tiene "Hoy"? | **Cuatro como máximo, por rol** | Un tablero con doce tarjetas es la versión moderna de un menú de once entradas |
| ¿Catálogo y Horarios/Veterinarios QR quedan visibles para todos dentro de Configuración, o pasan a ser admin-only junto con Usuarios? | **Visibles para todos**, igual que hoy | Es una decisión de arquitectura de información, no de permisos: hoy solo Usuarios está oculta para no-administradores, y la tarea pide explícitamente no tocar el modelo de permisos. Si preferís que toda la sección Configuración sea admin-only, es una decisión de permisos aparte que hay que pedir explícitamente |

---

## Lo que necesito que decidas, Daniel

Son cinco preguntas. Ninguna necesita que leas código.

1. **¿Los siete grupos son los correctos?** Concretamente: ¿te cierra que
   Catálogo, Usuarios y la configuración del QR queden juntos bajo
   "Configuración", fuera del camino diario?
2. **Los $11.150 sin facturar: ¿es un dato real o es basura del sistema de
   prueba?** La respuesta cambia si "Por facturar" es la pestaña principal de
   Caja o una más. Si es real, es la pantalla más importante de todo el
   rediseño. Y una segunda parte de la misma pregunta, porque comparten
   origen: el "255 consultas contra 1 cita" del Hecho 1 y el "252 de 255
   POR_COBRAR" del Hecho 2 salen del mismo generador de datos de prueba
   (`seed_data.py`), que nunca crea citas ni cambia el estado de pago por
   defecto. ¿Ese patrón —cargar la consulta directo, sin pasar por agenda ni
   cerrar el cobro— **describe cómo trabaja de verdad tu equipo**, o es
   puramente un artefacto de cómo se armó el seed? Toda la base de "Hoy" y
   "Caja" descansa en la respuesta.
3. **¿"Hoy" tiene que ser distinta por rol, o alcanza con una sola versión?**
   Distinta por rol es mejor, pero necesita que primero existan los roles de
   verdad en el sistema (hoy son solo `admin` y `user`).
4. **Cirugías y hospitalizaciones juntas en una sola pestaña: ¿te parece bien
   clínicamente?** Es la fusión de la que menos seguro estoy.
5. **¿Confirmás que la agenda se usa poco de verdad, o es que nadie la usa
   porque nunca funcionó?** Encontré una cita contra 255 consultas. Si la causa
   es el botón de check-in que nunca se dibuja, arreglarlo puede cambiar el uso,
   y entonces la Agenda merece más protagonismo del que le doy acá.

---

## Qué habilita esto para la Fase 3

Con esta estructura aprobada, el orden de implementación cambia respecto de lo
que sugería la tarea, y para mejor:

1. **Configuración** (Catálogo + Usuarios + QR). Es donde viven las tablas más
   simples: perfecto para asentar la tabla nueva, el modal nuevo y las pestañas
   nuevas sin riesgo.
2. **Inventario.** Una tabla, una acción, y arregla el bug de la columna cortada.
3. **Caja.** Primera pantalla de dinero, con cifras tabulares.
4. **Pacientes** (Consultorio + Propietarios). La más grande.
5. **Hoy** e **Informes.** Al final a propósito: son las dos pantallas nuevas y
   conviene construirlas cuando todos los componentes ya estén probados.

Y una regla que sale de esta fase: **el vocabulario de estados de una cita se
unifica en el primer commit de la Fase 3.** Mientras el frontend siga buscando
"Programada" donde el sistema escribe "PENDIENTE", cualquier tablero que se
construya arriba nace vacío.

**Aviso para quien programe la Fase 3:** reordenar secciones cambia los `id` que
hoy identifican cada pantalla (`sec-usuarios`, `sec-citas-web`, `sec-facturacion`,
`sec-ordenes-medico`, `sec-propietarios`, `sec-catalogo`, entre otros). De esos,
solo dos —`sec-usuarios` y `sec-citas-web`— son los que usan hoy las pruebas
automáticas de Playwright para navegar (`e2e/admin-panel.spec.js` y
`e2e/auth.spec.js`). Los otros cuatro (`sec-facturacion`, `sec-ordenes-medico`,
`sec-propietarios`, `sec-catalogo`) **no tienen ninguna prueba automática hoy**,
así que reordenarlos es más riesgoso, no menos: si algo se rompe ahí, nada de
la suite actual lo va a detectar. La propia tarea exige actualizar las pruebas
que sí existen para que apunten a la nueva estructura, no relajarlas ni
borrarlas, y conviene sumar cobertura nueva para las cuatro secciones que hoy
no la tienen. Cada sección que se mueva tiene que actualizar sus pruebas en el
mismo commit, no al final.

Hay además una colisión de `id` puertas adentro de la ficha del paciente: hoy
`static/templates/index.html` (línea 1041) ya usa `data-tab="procedimientos"`
como id de la pestaña "Cirugías" actual. La nueva pestaña fusionada
"Procedimientos" (Fusión 5: Cirugías + Hospitalizaciones + Estudios) reutilizaría
ese mismo id para un contenido más amplio y distinto —hay que revisarlo antes
de renombrar, junto con los `sec-*` de arriba.

**Otro aviso, este de HTML:** además del menú lateral, el `<header>` de
`static/templates/index.html` (líneas 33-37) tiene una segunda barra de
navegación ya renderizada (`<nav class="nav">`), con tres enlaces —Agenda,
Consultorio e "Informes"— que apuntan a `sec-agenda`, `sec-consultorio` y
`sec-reportes` con los mismos manejadores de clic que el menú lateral. Es la
barra que menciona el Hecho 1 cuando dice que "el menú superior marca 'Agenda'
como activa al cargar". Esta reestructuración de siete entradas no la
contempla: la Fase 3 tiene que decidir si la pliega dentro del nuevo menú o la
retira, y de paso corregir que ahí dice "Informes" mientras el menú lateral
dice "Reportes y KPIs" —dos nombres para la misma pantalla, para no terminar
sumando un tercero.

---

## Apéndice: rutas de API citadas (para quien quiera verificar en el código)

Ninguna de las tablas de arriba necesita esto para entenderse. Es solo la
referencia técnica, para quien quiera confirmar en el código lo que se afirma
en el documento.

| Nombre usado en este documento | Ruta |
| --- | --- |
| Ingresos | `/api/reportes/finanzas/ingresos` |
| Cuentas por cobrar | `/api/reportes/finanzas/cuentas-por-cobrar` |
| Rendimiento por veterinario | `/api/reportes/kpi/rendimiento` |
| Servicios más vendidos | `/api/reportes/kpi/servicios` |
| Endpoint de citas | `/api/citas/` |
| Filtro de consultas por cobrar | `/api/consultas/?estado_pago=POR_COBRAR` |
| Endpoint de citas del QR | `/api/admin/supabase/citas-qr` |
| Endpoint de inventario | `/api/inventario/` |

---

## Siguiente paso

**Aprobación de Daniel.** Después de eso, y no antes, empieza la Fase 3 —
implementación sección por sección.
