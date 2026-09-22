# Tarea 11 — Revisión integral de la transformación y cierre de la etapa 8

> **Requisito previo:** la Tarea 10 (routers sin autenticación) tiene que estar
> cerrada y commiteada antes de empezar esta. Si no lo está, pará y decímelo.

---

## Qué es esta tarea

Las tareas 06 a 09 transformaron AmiVets de una app de consultas con pestañas
planas a un sistema de órdenes de servicio con shell de seis módulos. Fueron
ocho etapas, más de treinta commits, y la etapa 8 —"resto de pantallas y
limpieza del menú viejo"— **quedó a medias**.

Esta tarea hace dos cosas a la vez, y en este orden:

1. **Cierra la etapa 8**: las pantallas que todavía tienen el layout viejo.
2. **Revisa la transformación completa** contra los bocetos, con Playwright, y
   corrige lo que esté desviado.

Trabajás de corrido: auditás y corregís en la misma pasada, sin punto de
parada. El informe va al final.

---

## 1 · El estado real, verificado

No asumas nada de esto: confirmalo antes de tocar. Pero es de dónde parto.

### Pantallas ya elevadas al shell nuevo

`sec-inicio` (lanzador), `sec-hoy` (Panel del día), `sec-orden-abierta`,
`sec-bandeja-gestor`, `sec-mascotas`, `sec-consultorio` (Ficha), `sec-inventario`
(Insumos), `sec-catalogo`, `sec-facturacion`.

Commits de referencia: `ea1bd96`, `951ae21`, `b7d2386`, `442dee4`, `5a837d0`,
`e44dcb8`, `9b59b45`, `b1d7fe0`.

### Pantallas que siguen con el layout viejo

| Sección | ¿Tiene boceto? |
|---|---|
| `sec-reportes` (Informes) | **Sí** — `docs/diseno/pantallas/Reportes.html` |
| Login (`static/templates/login.html`) | **Sí** — `docs/diseno/pantallas/Login.html` |
| `sec-agenda` | No |
| `sec-propietarios` | No |
| `sec-usuarios` | No |
| `sec-perfil` | No |
| `sec-citas-web` | No |
| `sec-consulta-abierta` | No *(ver punto 4)* |

El `login.html` actual es una tarjeta genérica con `<h1>AmiVets</h1>` como
marca. `Login.html` tiene el logo, el sistema tipográfico y el teal. La
distancia es grande y es la primera pantalla que ve cualquiera.

### Los doce bocetos

`docs/diseno/pantallas/` — doce archivos de 1440×900 autocontenidos, que se
abren en el navegador sin servidor. Su `README.md` trae los tokens literales.
**Son la fuente**, no el canvas publicado ni tu criterio.

`Login · Inicio · Main (panel del día) · OrdenAbierta · AnexarServicio ·
BandejaGestor · Mascotas · FichaMascota · Insumos · Catalogo · Facturacion ·
Reportes`

---

## 2 · Cerrar la etapa 8

### 2a · Reportes y Login — hay boceto, se sigue el boceto

Igual que `9b59b45` hizo con Ficha, Insumos, Catálogo y Facturación. Copiá los
valores **literales** del boceto: colores, tamaños, espaciados, alturas de
control, radios. No los redondees a una cuadrícula de 4/8 px ni los sustituyas
por los de ningún framework.

`Reportes.html` dibuja KPI que hoy pueden no existir en el backend. Donde el
boceto pida un dato que `backend/app/routers/reportes.py` no produce, **no lo
inventes ni lo mockees**: implementá lo que el backend sí soporta y listá lo
que falta. Un gráfico con datos falsos es peor que un gráfico ausente.

### 2b · Agenda, Propietarios, Usuarios, Perfil, Citas web — no hay boceto

Estas cinco no tienen maqueta y **no las vas a diseñar de cero**. Lo que hacés
es rehospedarlas en el idioma visual que ya existe: los componentes de
`docs/diseno/componentes.html`, los tokens del `README.md` de pantallas, y los
patrones que ya quedaron implementados en las nueve pantallas elevadas.

Regla dura: **cero patrones nuevos**. Si una de estas pantallas necesita un
componente que no existe en ninguna de las doce maquetas ni en
`componentes.html`, no lo inventes — decímelo y seguí con el resto.

### 2c · Limpieza del menú viejo

La etapa 8 también incluye "limpieza del menú viejo". Verificá que no quede
nada de la capa 1A ni del shell de pestañas:

- `renderTabs()`, `wireTabs()`, `activateTab()` — deberían haber desaparecido
  de `router.js`.
- `nocturne.css`, `themes.css`, `amivets.css`, `bridge.css` — `b1d7fe0` dice
  que se borraron. Confirmá que ningún `<link>` ni `@import` los referencia.
- El `themeToggle` y el script anti-FOUC de `data-theme` en el `<head>` de
  `index.html`, que `navegacion-v2.md` (Decisión 1, alternativas descartadas)
  manda retirar.
- El *fallback* literal de color en
  `static/js/sections/historial-precios.js:88`, que la misma decisión manda
  actualizar al teal.
- `docs/diseno/1A/` y `docs/tareas/06-rediseno-1A-claude-design.md` describen
  un rediseño que quedó reemplazado. No los borres: marcá en cada uno, arriba,
  que quedaron superados por la Tarea 06 y por `navegacion-v2.md`.

---

## 3 · La comparación contra los bocetos

Esto es el corazón de la tarea y quiero que lo hagas con método, no a ojo.

**Para cada una de las doce pantallas:**

1. Abrí el boceto y la pantalla implementada, ambas a **1440×900**, con
   Playwright, y guardá las dos capturas en
   `docs/diseno/capturas/revision-11/<pantalla>-boceto.png` y
   `<pantalla>-app.png`.
2. Miralas las dos. Listá las diferencias reales: estructura, jerarquía,
   espaciado, tipografía, color, estados.
3. Clasificá cada diferencia en una de tres:
   - **Desvío** — la implementación se apartó del boceto sin razón. Se corrige.
   - **Mejora deliberada** — se apartó y está mejor, o el boceto no contemplaba
     un caso real. Se deja y se anota **por qué**.
   - **Imposible hoy** — el boceto pide algo que el modelo de datos no soporta.
     Se anota en la lista de pendientes, no se fuerza.

La clasificación va en el informe, con las tres categorías separadas. Si
absolutamente todo entra en "mejora deliberada", revisá tu criterio: es la
categoría que se usa para no corregir nada.

**Además, en cada pantalla revisá lo que un boceto estático no muestra:**

- **Estados vacíos.** Ninguna lista puede quedar en blanco sin explicación.
- **Estados de carga y de error.** Qué se ve mientras el fetch va, y qué se ve
  si falla.
- **Foco visible** en todo control interactivo (`--focus-ring`).
- **Responsive.** Las maquetas son de 1440. Probá también 1280 y 768. La
  clínica usa tablets en consultorio.
- **Contraste.** `docs/diseno/contraste.py` ya existe en el repo — usalo.

---

## 4 · Coherencia del sistema, no solo de cada pantalla

Cosas que solo se ven mirando el conjunto:

- **`sec-consulta-abierta` vs `sec-orden-abierta`.** `navegacion-v2.md`
  (Decisión 1) dice que la etapa 7 reemplazaba *Consulta abierta* por *Orden
  abierta*. Las dos siguen registradas en `router.js` con `init: null`.
  Averiguá si `sec-consulta-abierta` sigue siendo alcanzable y si tiene razón
  de existir. Si es un resto muerto, sacalo; si sigue en uso, decí por qué.
- **`sec-propietarios` quedó sin entrada de barra lateral** (`tab: false`)
  cuando `sec-mascotas` tomó el módulo 3. Verificá que siga siendo alcanzable
  por los caminos que el código asume (`verMascotasPropietario`, hash directo,
  cmdk) y que no haya quedado una pantalla huérfana.
- **La paleta de comandos (Ctrl/Cmd+K).** `96484b0` menciona que exponía
  facturas a roles sin acceso. Revisá **todo** lo que cmdk ofrece contra la
  visibilidad por rol del router: no puede ofrecer nada que el rol no pueda
  abrir.
- **El lanzador y los roles.** `getVisibleModules()` deriva la visibilidad de
  módulo de la de sus secciones. Probá el lanzador con los cinco roles
  (`admin`, `recepcionista`, `veterinario`, `gestor`, `user`) y confirmá que
  cada uno ve exactamente lo que puede usar — y la regla de que si un rol tiene
  un solo módulo utilizable, se omite el lanzador.
- **Terminología.** Todo el texto de UI en español y con el vocabulario de la
  clínica: *tutor*, *paciente*, *orden de servicio*, *gestor*. Barré las doce
  pantallas buscando "dueño", "cliente", "cita" donde corresponde "orden", y
  cualquier cadena en inglés.

---

## 5 · Playwright

La suite tiene **138 tests en 19 specs** y la última corrida pasó
(`test-results/.last-run.json`). Eso es el piso, no el techo.

```bash
docker compose up -d
npm run test:e2e
```

El host no sostiene los 138 tests en un solo proceso sin quedarse sin memoria:
corré en dos tandas, como se hizo en `96484b0`.

**Lo que tenés que agregar**, porque hoy no está cubierto:

- Un spec de la etapa 8: cada pantalla recién elevada carga, muestra sus datos
  y sus controles responden. Con el mismo nivel de exigencia que
  `shell.spec.js`.
- **Login**: el camino completo con la pantalla nueva, incluido el error de
  credenciales y el foco.
- **Recorrido de punta a punta, en un solo test**, el que pide la Tarea 06 al
  final: llega el paciente → recepción abre la orden y asigna veterinario → el
  veterinario carga la consulta y tres servicios de tipos distintos → el gestor
  de laboratorio recibe el suyo y sube el PDF → recepción factura. Si ese
  camino ya está partido en varios specs, decilo y no lo dupliques.
- **Por rol**: los cinco roles entran, ven su lanzador correcto, y no alcanzan
  lo que no les toca ni por hash directo.

**Prohibiciones, sin excepción:**

- No ablandes ninguna aserción existente para que la suite pase.
- No marques nada `skip`. Si un test falla, o el test está mal y lo arreglás
  explicando por qué, o el código está mal y arreglás el código.
- No apuntes `BASE_URL` a nada que no sea `localhost`. El guard de
  `e2e/helpers.js` está ahí por algo.

Si hay una skill de Playwright disponible en tu configuración, usala. Si no,
la suite de `e2e/` con `npx playwright test` es el camino.

---

## 6 · Limpieza del repositorio

La raíz de `amivets/` acumuló archivos de trabajo que no deberían estar
versionados ni sueltos:

```
check_counts.py  check_db.py  dump_data.py  repair_app.py
test_api_responses.py  demo_output.txt  err.txt  error_log.txt
seeding_error.txt  veterinaria.db  dashboard-veterinaria.html
docs/diseno/__pycache__/
```

Para cada uno, decidí: es útil y va a `backend/scripts/` o a `docs/`, o es
basura y va a `_to_delete/`. **No borres nada directamente** — movelo a
`_to_delete/` en la raíz del repo y decime qué moviste. `veterinaria.db`
además merece una mirada: si es una base de datos con datos reales suelta en el
repo, es un problema aparte y quiero saberlo.

Revisá también que `.gitignore` cubra lo que corresponde para que no vuelva a
juntarse.

---

## 7 · Verificá que la documentación diga la verdad

Tres documentos hacen afirmaciones que pueden haber quedado viejas:

- `docs/diseno/pantallas/README.md`, sección *"Lo que estas pantallas dibujan y
  la base todavía no soporta"*: las tareas 07 y 08 ya se ejecutaron, así que
  "unidad de medida y stock fraccionado" e "historial de precios" deberían
  estar resueltos. Actualizá el estado real de los cinco puntos.
- `docs/pruebas.md` dice que `seed_data.py` nunca crea un usuario con
  `role='veterinario'`. El código hoy sí lo hace (`seed_data.py:49`).
  Corregí la nota.
- `docs/pruebas.md` dice "13 specs". Hay 19.

---

## Restricciones

- **Sin dependencias nuevas de front.** Ninguna.
- No toques el modelo de datos ni las migraciones. Si algo del boceto exige un
  cambio de modelo, va a la lista de pendientes.
- Todo el texto de UI en español.
- Ningún dato clínico se pierde. La base tiene los 318 pacientes y 264 tutores
  importados de los Excel de la clínica — no la reinicialices, no corras
  `init_db.py` con `force_reset`.
- Commits por unidad de trabajo, con la skill `work-unit-commits`. Una unidad
  por pantalla elevada, y los arreglos de revisión separados de las pantallas.
- Usá la skill `judgment-day` sobre tu propio trabajo antes de dar la tarea por
  terminada.

## Si este enunciado está equivocado

Escribí esto leyendo el código, no ejecutándolo. Si al verificar encontrás que
algo de acá es falso —que una pantalla que doy por vieja ya está elevada, que
un archivo que llamo basura se usa, que una decisión que cito ya se revirtió—
**decilo y no lo hagas por deferencia**. Prefiero corregir el enunciado a que
ejecutes algo que sabés que está mal.

Lo mismo si el alcance resulta más grande de lo que parece: paralo, decime qué
encontraste, y decidimos juntos cómo partirlo.

## Al terminar

Un informe en `docs/revision-integral-11.md` con:

1. **Tabla de las doce pantallas** — estado antes, estado después, y las
   diferencias clasificadas en desvío / mejora deliberada / imposible hoy.
2. Qué se elevó en la etapa 8 y qué quedó fuera, con el motivo.
3. Los hallazgos de coherencia del punto 4, uno por uno con su resolución.
4. Resultado de la suite: cuántos tests hay ahora, cuántos pasaron, qué specs
   nuevos agregaste.
5. Qué se movió a `_to_delete/`.
6. **La lista de pendientes**: lo que los bocetos dibujan y el sistema todavía
   no puede hacer, con qué haría falta para cada uno.

Y, en una línea, lo que más te preocupe de lo que viste.
