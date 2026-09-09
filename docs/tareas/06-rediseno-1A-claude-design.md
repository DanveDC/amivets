# Tarea 06 — Rediseño integral del front (Propuesta 1A de Claude Design)

> Prompt para pegar en Claude Code, ejecutándolo desde
> `C:\Users\dalec\Desktop\veterinaria\amivets`.

---

## PROMPT

Vas a rehacer **todo el front** de AmiVets adoptando la **Propuesta 1A** del
rediseño hecho en Claude Design. No es un cambio de paleta: es un rediseño
completo, y tienes libertad para rearmar la arquitectura del front y los flujos
de trabajo. Toma tú las decisiones de diseño e implementación — no me consultes
cada una, decide y justifica en el resumen final.

Lo único intocable es **qué hace el sistema**: toda función que existe hoy tiene
que seguir existiendo y funcionando al terminar.

---

### Paso 1 — Importar y estudiar el diseño (antes de escribir una línea)

Usa el MCP `claude_design` (`https://api.anthropic.com/v1/design/mcp`,
autenticación vía `/design-login`) para importar este proyecto:

```
https://claude.ai/design/p/a74a67d2-2e0a-4b10-b051-a30aa4cad189?file=AmiVets+-+Propuestas+de+redise%C3%B1o.dc.html
```

Archivos a leer (el proyecto entero es legible):

- `AmiVets - Propuestas de rediseño.dc.html`
- `_ds/nocturne-884121ad-216f-419a-8a1c-c75b80cfd562/_ds_bundle.js`
- `_ds/nocturne-884121ad-216f-419a-8a1c-c75b80cfd562/styles.css`
- `support.js`

El archivo contiene **varias propuestas**. Implementa **solo la 1A** (la
primera). Si la numeración del archivo no coincide con "1A", identifica la
primera propuesta del documento y confírmame cuál elegiste antes de seguir.

Antes de tocar código, escribe `docs/diseno/1A-tokens.md` con lo que extrajiste
del diseño: paleta completa con valores, tipografías y escala, espaciado, radios,
sombras, estados, y el inventario de componentes (botón, input, card, tabla,
modal, badge, nav, empty state, toast). Ese archivo es la fuente de verdad del
resto de la tarea. **No inventes valores que no estén en el diseño**; si algo
falta, dedúcelo del sistema y márcalo como decisión propia en ese documento.

Lee también lo que ya existe y puede contradecir al diseño nuevo:
`docs/diseno/sistema.md`, `docs/diseno/arquitectura-informacion.md`,
`docs/diseno/auditoria.md` y `docs/tareas/03-rediseno-frontend.md`. Donde 1A
contradiga a esos documentos, **manda 1A** — y actualízalos para que no queden
describiendo un sistema que ya no existe.

---

### Paso 2 — Inventario del front actual

Estás en la rama `redesign/minimalist-ui`. El front vive en:

| Archivo | Tamaño | Qué es |
|---|---|---|
| `static/templates/index.html` | 1.986 líneas | La SPA entera: 11 secciones + ~25 modales |
| `static/js/app.js` | 4.608 líneas | Toda la lógica de UI, navegación y llamadas a la API |
| `static/js/auth.js` | 108 líneas | Login, token, sesión |
| `static/css/styles.css` | 1.845 líneas | Estilos, con tokens en `:root` |
| `static/templates/login.html` | 40 líneas | Pantalla de login |
| `static/agendar.html` | 327 líneas | Agendamiento público por QR (fuera de la SPA) |
| `dashboard-veterinaria.html` | 897 líneas | Suelto en la raíz, sin trackear |

Lo sirve FastAPI: `backend/app/main.py` monta `/static` y devuelve `index.html`
en `/`, `login.html` en `/login` y lee `agendar.html` a mano en `/agendar`.

Las 11 secciones (`data-target` del menú lateral) son: `sec-consultorio`,
`sec-agenda`, `sec-propietarios`, `sec-inventario`, `sec-facturacion`,
`sec-reportes`, `sec-ordenes-medico`, `sec-citas-web`, `sec-catalogo`,
`sec-usuarios` (solo admin) y `sec-perfil`.

Roles: `admin`, `veterinario`, `recepcionista`. Hoy la visibilidad por rol se
resuelve con clases tipo `.admin-only` y `style="display:none"` — rehazlo bien,
no lo copies.

**Antes de rediseñar, levanta el inventario funcional completo** en
`docs/diseno/inventario-funcional.md`: cada sección, cada modal, cada formulario,
cada acción, cada estado vacío/error, cada badge, y qué endpoint del backend usa.
Ese inventario es tu checklist de "no perdí nada". Recórrelo al final y marca
cada ítem.

---

### Paso 3 — Rediseñar en serio

Tienes libertad para **rearmar**, no solo repintar. En particular:

- **La navegación puede cambiar por completo.** Once ítems planos en un sidebar
  es lo que hay hoy; si 1A propone otra cosa (agrupaciones, command palette,
  barra superior, navegación por contexto del paciente), impleméntalo. Si 1A no
  dice nada del tema, decide tú qué estructura sirve mejor a una veterinaria y
  documéntalo.
- **Los flujos de trabajo pueden cambiar.** El caso central es: llega un
  paciente → consulta → órdenes/recetas → factura. Hoy eso son cuatro secciones
  distintas y varios modales. Si el diseño permite convertirlo en un flujo
  continuo, hazlo.
- **Los ~25 modales son un problema de diseño, no un requisito.** Convierte en
  página, panel lateral o vista embebida lo que corresponda. Deja como modal
  solo lo que sea realmente una confirmación corta.
- **`app.js` con 4.608 líneas tiene que dejar de existir como archivo único.**
  Divídelo por dominio (un módulo por sección + un núcleo de API/estado/router).
  Usa módulos ES nativos.
- Diseña de verdad los estados que hoy no existen o están improvisados: carga,
  vacío, error, sin permisos, sin resultados de búsqueda.
- Accesibilidad real: foco visible, navegación por teclado en modales y menús,
  contraste AA, `aria-label` en los botones que hoy son solo un ícono.
- Responsive de verdad. Una veterinaria se usa desde tablet en el consultorio.

---

### Restricciones (esto sí es intocable)

1. **No toques el backend.** Ni los routers, ni los schemas, ni los modelos, ni
   la base. El front se adapta a la API que existe, no al revés. Si encuentras
   un endpoint que hace falta, anótalo en el resumen final y sigue sin él.
2. **No cambies el contrato de autenticación** ni el manejo del token.
3. **Las tres roles y sus permisos se conservan exactamente.** Nada que hoy vea
   solo un admin puede quedar visible para otro rol.
4. **Nada de build step nuevo sin avisarme.** Hoy FastAPI sirve archivos
   estáticos directo, y eso está atado a `Dockerfile`, `docker-compose.yml`,
   `nginx/` y `render.yaml`. Si crees que hace falta un bundler, **para y
   pregúntame antes**; no lo introduzcas por tu cuenta.
5. **Sin dependencias nuevas de front sin justificarlas.** Si metes una
   librería, que sea por CDN pineada a versión exacta y explicada en el resumen.
6. Todo el texto de UI en español, respetando la terminología que ya usa el
   sistema (propietario, mascota, consulta, orden, liquidación).
7. `dashboard-veterinaria.html` está suelto en la raíz y sin trackear —
   pregúntame qué hacer con él en vez de borrarlo o integrarlo por tu cuenta.

---

### Cómo entregarlo

**No lo hagas todo de un golpe.** Trabaja en este orden, commiteando por etapa
en la rama `redesign/minimalist-ui`:

1. Tokens y capa base de CSS + los componentes del sistema de diseño, con una
   página de muestra (`docs/diseno/componentes.html`) donde se vean todos.
2. Shell de la aplicación: navegación, layout, sesión, router del front.
3. Sección por sección, en este orden: consultorio → agenda → propietarios →
   inventario → facturación → catálogo → órdenes → citas web → reportes →
   usuarios → perfil.
4. Login y `agendar.html` (la pantalla pública también entra en el rediseño).
5. Limpieza: borrar CSS y JS muertos, actualizar los documentos de diseño.

Después de cada etapa, dime en una línea qué quedó listo y qué sigue.

---

### Verificación

Hay una suite Playwright en `e2e/` (13 specs: auth, flujo clínico, inventario,
liquidaciones, catálogo, reportes, QR, admin, usuarios, notas) que corre contra
el stack local de Docker con `npm run test:e2e`.

Esa suite es la red de seguridad de esta tarea:

- Los selectores van a romperse con el DOM nuevo: **actualízalos**.
- Las **aserciones de comportamiento no se tocan**. Si un test verifica que
  facturar una consulta descuenta stock, eso se sigue verificando igual.
- No borres tests ni los marques como `skip` para que pase la suite. Si un test
  ya no aplica porque el flujo cambió, reescríbelo para el flujo nuevo y
  explícame por qué en el resumen.
- Al terminar cada etapa del punto anterior, corre la suite. Al final tiene que
  pasar completa.
- Añade tests nuevos para lo que el rediseño introduzca (navegación nueva,
  estados vacíos, permisos por rol).

Además, toma capturas de cada sección rediseñada y guárdalas en
`docs/diseno/capturas/1A/` para poder comparar contra las que ya están ahí.

---

### Al terminar

Un resumen con: qué decisiones de diseño tomaste tú (y por qué), qué cambió en
los flujos de trabajo respecto al sistema anterior, el inventario funcional con
todo marcado, qué endpoints te hicieron falta y no existen, qué quedó pendiente,
y cómo levantarlo localmente para revisarlo.
