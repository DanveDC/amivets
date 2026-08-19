# Tarea 03 — Rediseño integral del frontend

**Proyecto:** AmiVets
**Alcance:** replanteo completo — sistema visual, arquitectura de información y
flujos. No es un cambio de colores.
**Tema:** claro y oscuro, ambos diseñados desde el principio.

---

## Por qué existe esta tarea

Daniel dice que el front "no se aleja mucho" de lo que ya había. Tiene razón, y
la causa es concreta:

`static/css/styles.css` **ya tiene un sistema de tokens sólido** — 319 usos de
custom properties, prácticamente ningún color suelto, Inter como tipografía. El
problema no es la ejecución. Es que el sistema es **el que sale por defecto**:
indigo `#6366F1` sobre slate `#F1F5F9`, la paleta exacta de cualquier plantilla
de dashboard generada automáticamente. Es competente y anónimo.

Repintar sobre eso da más de lo mismo. Lo que hace falta es una identidad
propia, decidida a conciencia, y una estructura pensada para cómo se usa esto
de verdad.

## Dirección acordada con Daniel

**Personalidad: clínica, sobria y precisa.** No cálida ni decorativa. Esto es
una herramienta de trabajo donde alguien pasa ocho horas: la prioridad es leer
datos rápido y no equivocarse, no que resulte simpática.

Referencias de artesanía —para el nivel de acabado, no para copiar—:
**Linear** (densidad, contención, teclado), **Stripe Dashboard** (tablas de
datos y pantallas de dinero), **Vercel/Geist** (disciplina con paletas
neutras). Del sector: **Digitail**, **Shepherd**, **Provet Cloud**, **ezyVet**.
Mira cómo resuelven densidad y jerarquía; no imites su marca.

**Sin marca previa que respetar.** La paleta se propone desde cero y se
documenta el porqué. Requisito explícito: **que no sea el indigo por defecto.**

## Skills a cargar antes de trabajar

Lee estos `SKILL.md` completos antes de la primera línea:

- `/home/dalec/.claude/skills/impeccable/SKILL.md` — el sistema de custom
  properties manda; ninguna pantalla inventa valores sueltos.
- `/home/dalec/.claude/skills/fixing-accessibility/SKILL.md` — obligatoria.
  Modo oscuro sin auditoría de contraste es modo oscuro roto.
- `/home/dalec/.claude/skills/make-interfaces-feel-better/SKILL.md` — fase 4.
- `/home/dalec/.claude/skills/cognitive-doc-design/SKILL.md` — el documento del
  sistema de diseño es un entregable, no un anexo.
- `/home/dalec/.claude/skills/work-unit-commits/SKILL.md` — esto son decenas de
  commits, no uno.
- `/home/dalec/.claude/skills/judgment-day/SKILL.md` — cierre de fases 2 y 5.
- `/mnt/c/Users/dalec/Desktop/app aseguradora/.claude/skills/playwright-skill/SKILL.md`
  — para recorrer la app real y capturar pantallas.

---

## Terreno

| Archivo | Líneas | Qué es |
| --- | --- | --- |
| `static/templates/index.html` | 1.827 | Toda la app interna, una sola página |
| `static/js/app.js` | 3.727 | Toda la lógica de vistas |
| `static/css/styles.css` | 1.908 | El sistema actual |
| `static/agendar.html` | 321 | Agendamiento público por QR |
| `index.html` | 377 | Portada / entrada |

Once secciones internas: `sec-agenda`, `sec-consultorio`, `sec-propietarios`,
`sec-inventario`, `sec-facturacion`, `sec-catalogo`, `sec-ordenes-medico`,
`sec-citas-web`, `sec-reportes`, `sec-usuarios`, `sec-perfil`.

Dependencias visuales: **Chart.js** (reportes) y **FullCalendar** (agenda).
Ambas necesitan tematizarse; una librería con su estilo de fábrica en medio de
un sistema propio se nota inmediatamente.

---

# Fase 0 — Auditoría con la app delante

**No diseñes desde el código fuente.** Levanta la app y recórrela.

Con Playwright, entra a las once secciones y captura cada una en su estado real
—con datos del seed—, no vacías. Documenta en `docs/diseno/auditoria.md`:

- Qué hace cada sección y quién la usa.
- Cuántos clics cuesta la tarea más frecuente de cada una.
- Dónde se repite el mismo patrón resuelto de forma distinta.
- Dónde la densidad estorba: tablas que obligan a desplazamiento horizontal,
  formularios largos sin agrupar, listas sin jerarquía.
- Qué se ve claramente heredado de una plantilla.

Esta fase produce **el diagnóstico del que sale todo lo demás**. Si te la
saltas, el rediseño va a ser decoración.

# Fase 1 — Sistema de diseño

Escríbelo en `docs/diseno/sistema.md` **antes** de tocar CSS.

- **Paleta.** Neutro dominante, **un** acento usado con avaricia. El color
  semántico se reserva para estado —vencido, urgente, pagado, agotado—, nunca
  para adornar. Si todo destaca, nada destaca. Justifica cada elección: en una
  herramienta clínica, un color mal usado es ruido en una decisión médica.
- **Ambos temas desde el primer token.** El oscuro se **diseña**, no se
  invierte: los grises no se reflejan simétricamente y las sombras no funcionan
  igual. Cada par claro/oscuro pasa contraste AA.
- **Tipografía.** Inter sirve, pero define la escala. Y para tablas y dinero,
  **cifras tabulares** (`font-variant-numeric: tabular-nums`): sin eso, una
  columna de importes no se puede comparar de un vistazo.
- **Densidad.** Este es un producto de trabajo, no una landing. El espaciado de
  marketing aquí es un defecto: obliga a desplazarse para ver lo que debería
  caber en una pantalla.
- **Inventario de componentes** con sus estados —normal, hover, foco, cargando,
  vacío, error, deshabilitado—. Los estados vacío y error se diseñan; no
  aparecen solos.
- **Tematizar Chart.js y FullCalendar** con los mismos tokens.

# Fase 2 — Arquitectura de información · ⛔ PARADA OBLIGATORIA

Once entradas de menú plano no es una estructura, es una lista de tablas.

Propón cómo agrupar el trabajo por **cómo se usa**: qué mira una recepcionista
al abrir el sistema, qué necesita un veterinario en consulta, qué revisa el
dueño de la clínica al cerrar el mes. Puede que algunas secciones deban
fusionarse, otras dejar de ser secciones y volverse acciones dentro de otra, y
puede que falte una pantalla de inicio que hoy no existe.

Cuestiona también los flujos: cuántos pasos cuesta hoy atender a un paciente de
principio a fin, y cuántos debería costar.

**Presenta la propuesta a Daniel y espera su aprobación antes de escribir una
línea de implementación.** Reconstruir once pantallas sobre una organización
que él no comparte es la forma más cara posible de equivocarse.

Aplica `judgment-day` a la propuesta antes de presentarla.

# Fase 3 — Implementación, sección por sección

Una sección por unidad de trabajo. Cada una: implementada, revisada, commiteada,
funcionando. **Nunca dos a medias a la vez.**

Orden sugerido, de menor a mayor riesgo: empieza por la de estructura más
simple para asentar los componentes, y deja facturación y consultorio para el
final, cuando el sistema ya esté probado.

Reglas duras:

- **No rompas el comportamiento.** `app.js` son 3.727 líneas que dependen de
  ids y clases. Si cambias un selector, actualiza el JS en el mismo commit.
- **La suite de Playwright tiene que seguir pasando.** Va a romperse: los
  selectores cambian. **Actualiza las pruebas para que apunten a la nueva
  estructura — no las relajes ni las borres** para que pasen. Una prueba
  debilitada para no molestar es peor que ninguna.
- Después de cada sección, captura antes y después. Es la única forma de que
  Daniel juzgue el avance sin leer código.

# Fase 4 — Que se sienta bien

Con `make-interfaces-feel-better`: estados de carga que no salten, transiciones
que orienten en vez de decorar, formularios que respondan al escribir y no solo
al enviar, y confirmaciones que se vean.

Y teclado. En una herramienta clínica de uso diario, poder moverse sin ratón no
es accesibilidad opcional: es velocidad para quien la usa todo el día.

# Fase 5 — Accesibilidad y cierre

`fixing-accessibility` sobre el resultado completo. Contraste **en los dos
temas**. Foco visible en todo lo interactivo. Formularios con etiquetas reales.
Y una regla que en software clínico no se negocia: **el color nunca es la única
señal** — un estado que solo se distingue por color no existe para quien no lo
percibe.

Cierra con `judgment-day` sobre el conjunto.

---

## La página pública del QR

`static/agendar.html` es otra cosa: la usa el dueño de una mascota, una vez,
desde el móvil, sin ayuda de nadie. Comparte tokens con el resto, pero puede
—y probablemente debe— ser más amable y espaciada que el interior clínico.
Trátala aparte y dilo en su commit.

## Verificación

- [ ] `docs/diseno/auditoria.md` y `docs/diseno/sistema.md` existen y son
      legibles por Daniel sin que tú se los expliques.
- [ ] La paleta no es el indigo por defecto, y hay un porqué escrito.
- [ ] Ambos temas pasan contraste AA. Verificado, no asumido.
- [ ] Las once secciones rediseñadas, con capturas antes/después.
- [ ] La suite de Playwright pasa, **actualizada, no debilitada**.
- [ ] Chart.js y FullCalendar usan los tokens del sistema.
- [ ] Navegación completa por teclado.
- [ ] Ningún color suelto fuera del sistema.

## Fuera de alcance

- No toques el backend. Si una pantalla necesita un dato que la API no da,
  **repórtalo**, no cambies endpoints.
- No cambies el modelo de datos ni los permisos.
- No arregles la deuda de `init_db.py` / `reset_database` — es otra tarea.
- No introduzcas un framework de CSS ni de componentes sin plantearlo primero:
  el proyecto es HTML, CSS y JS sin dependencias de interfaz, y eso es una
  decisión que se cambia con argumentos y aprobación, no de paso.

## Nota sobre el ritmo

Esta tarea es grande y no debe hacerse de una sentada. La parada de la fase 2
existe por eso. Si en cualquier punto detectas que el alcance se desborda,
**para y dilo** — es mejor entregar cuatro secciones excelentes y un sistema
sólido que once a medio terminar.
