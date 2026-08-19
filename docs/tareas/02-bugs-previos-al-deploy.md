# Tarea 02 — Bugs y ajustes antes del despliegue

**Proyecto:** AmiVets
**Depende de:** tarea 01 (completada — 15 commits sin pushear)
**Objetivo:** dejar la rama lista para desplegar en Render. **Esta tarea no
despliega.**

## Estado de partida

La tarea 01 dejó tres cosas abiertas a propósito:

- Dos bugs reales que las pruebas E2E cazaron y que se reportaron sin arreglar,
  tal como pedía aquella tarea.
- Un rate limiter que, según su propia documentación, es efectivamente global
  en producción.

Además, **los 7 archivos de cambios de interfaz de Daniel siguen sin
commitear**, y hay 15 commits sin pushear.

## Skills a cargar antes de trabajar

- `/home/dalec/.claude/skills/work-unit-commits/SKILL.md`
- `/home/dalec/.claude/skills/judgment-day/SKILL.md` — cierre de la unidad C.

---

# Unidad A — Los cambios de interfaz de Daniel

Van primero: son el trabajo de otra persona y no deben mezclarse con arreglos.

Sin commitear:

```
backend/app/main.py               |  39 ++--
backend/app/routers/inventario.py |  11 +-
index.html                        | 218 +------
static/agendar.html               | 196 +------
static/css/styles.css             | 438 +++++++
static/js/app.js                  |  96 ++--
static/templates/index.html       | 176 +++---
```

Mirando el diff, `index.html` y `agendar.html` pierden ~400 líneas entre las dos
y `styles.css` gana 438: **es una extracción de estilos embebidos a la hoja
externa**, no un retoque. El commit debe decirlo — dentro de seis meses, "cambios
de interfaz" no le sirve a nadie.

La suite de Playwright de la tarea 01 se escribió contra este árbol de trabajo,
así que ya cubre estos cambios. Córrela antes de commitear y confirma que sigue
en 19 pasando.

Aplica `work-unit-commits`. Si el cambio de `inventario.py` no tiene relación
con el trabajo de estilos, va en su propio commit.

---

# Unidad B — Los dos fallos silenciosos del frontend público

Los dos bugs son el mismo patrón: **la página del QR falla sin decir nada.** El
usuario ve una pantalla vacía y no sabe si está cargando, si no hay nada, o si
se rompió. Es la página a la que llega un cliente escaneando un código en la
recepción, sin nadie que le explique.

## B1 — Lista de veterinarios vacía

La suite detectó que la lista sale vacía cuando ningún usuario tiene
`role='veterinario'`. Endpoint: `listar_veterinarios`, `supabase_admin.py:106`.
Consumido en `static/agendar.html:104`.

**Primero diagnostica:** ¿es solo que el entorno de pruebas no siembra
veterinarios, o producción puede quedar en ese estado? Consulta el estado real
antes de decidir. La respuesta cambia la urgencia, no el arreglo.

En cualquier caso hacen falta dos cosas:

1. Un estado vacío explícito en la página. Si no hay veterinarios disponibles,
   el visitante debe leer un mensaje que lo diga, no quedarse mirando un
   desplegable en blanco.
2. Sembrar el dato en el entorno de pruebas para que la suite cubra el camino
   real, y dejar el fallo de lista vacía como su propia prueba.

### Resultado: causa raíz encontrada — `backend/scripts/seed_data.py`

El estado vacío ya se manejaba bien en la UI, pero en un entorno recién
sembrado la lista salía vacía **de verdad**, no solo mostraba el mensaje: el
seed creaba los 10 médicos con `role="user"`, y tanto `listar_veterinarios`
(`supabase_admin.py:112`) como `usuarios.py:88` filtran por
`role == "veterinario"`. Corregido: el seed ahora crea (y, en la rama de
usuario ya existente, sincroniza) `role="veterinario"`.

## B2 — `cargarHorarios()` traga los errores de red

`static/agendar.html:124`. El `try` envuelve el `fetch` y el fallo se pierde:
si la petición falla, `horariosVet` queda vacío y la interfaz se comporta como
si el veterinario no tuviera horarios. Un error de red se ve exactamente igual
que una agenda llena.

Que el visitante distinga las tres situaciones: cargando, sin horarios
disponibles, y algo falló — con la posibilidad de reintentar en el tercer caso.

Revisa si el mismo patrón se repite en los otros `fetch` de `agendar.html`
(la carga de veterinarios en la línea 104 y el envío de la cita en la 228).
Si están igual, arréglalos en el mismo commit: es el mismo defecto.

---

# Unidad C — Rate limiter: la clave está mal, no el límite

**Esta unidad corrige una decisión de la tarea 01. Lee el razonamiento
completo antes de tocar nada.**

## Por qué se cambia

`backend/app/core/limiter.py` documenta con cuidado por qué no se confía en
`X-Forwarded-For`: el cliente puede escribirlo y no hay forma de distinguir lo
que puso el proxy de lo que puso el atacante. La conclusión fue usar
`get_remote_address` (peer TCP), asumiendo el coste de que el límite quede
global.

**La premisa es incorrecta, y por eso la conclusión sobra.**

`X-Forwarded-For` no es de confianza *como conjunto*, pero sí lo es *por
posición*. Cuando un cliente envía la cabecera falsificada, el proxy del borde
**añade** la IP real del peer al final de la lista:

```
Cliente envía:  X-Forwarded-For: 1.2.3.4          (falsificado)
La app recibe:  X-Forwarded-For: 1.2.3.4, 203.0.113.7
                                            ^^^^^^^^^^ esto lo escribió el proxy
```

Con exactamente un proxy de confianza delante, **la clave correcta es la última
entrada**. El atacante puede meter la basura que quiera a la izquierda: se
descarta. No se está confiando en la cabecera, se está confiando en la parte
que escribió el proxy — que es una cosa distinta.

Es el patrón estándar: se cuentan saltos desde la derecha, tantos como proxies
de confianza haya.

## Qué hacer

1. Cambia `key_func` para tomar la **última** entrada de `X-Forwarded-For`,
   con caída a `get_remote_address` si la cabecera no viene (desarrollo local
   sin proxy).
2. Sube el límite a `60/minute` **de forma temporal**. El ataque real es un
   script llenando la agenda, que hace miles de peticiones por minuto: 60 lo
   frena igual que 5 y no estorba a nadie legítimo. El 5 estaba calibrado como
   si fuera por visitante, y ese fue el error.
3. **Añade una verificación empírica.** Un log —temporal, o un endpoint de
   diagnóstico protegido— que registre la cadena `X-Forwarded-For` completa
   más el peer TCP. Después del despliegue, una petición real desde un
   navegador confirma cuántos saltos hay de verdad y si la última entrada es
   la IP del cliente.
4. Reescribe el comentario de `limiter.py`. El actual documenta con detalle un
   razonamiento que ya no aplica, y un comentario largo y equivocado hace más
   daño que ninguno.

## Si al verificar Render resulta ser más de un salto

Ajusta el conteo desde la derecha y baja el límite a un número por visitante
razonable. Eso es trabajo de la tarea siguiente, no de esta.

## Cierre

Aplica `judgment-day`. Esta unidad revierte una decisión que ya pasó por un
`judgment-day` en tres rondas: merece el mismo escrutinio en sentido contrario.
Si el review concluye que el razonamiento original era correcto y este está
equivocado, **dilo** — no lo cambies por deferencia a lo que pide la tarea.

## Resultado: revertida (commit `0236110`)

Se aplicó el cambio (commit `552587f`), se corrió `judgment-day` como pedía
el cierre, y los dos jueces —trabajando por separado, sin verse entre
ellos— llegaron a la misma conclusión: **la premisa de esta unidad estaba
mal, y la tarea 01 tenía razón.**

"Exactamente un proxy de confianza delante" era una afirmación sin
verificar, no un hecho. Dos problemas concretos la desmienten:

1. **`docker-compose.yml`, de este mismo repo, publicaba el backend en el
   puerto `8000` directo al host**, además de nginx en el 80. Cualquiera
   podía saltarse nginx por completo — y ahí no hay ningún proxy que agregue
   nada de confianza al final de `X-Forwarded-For`. El propio entorno que el
   comentario de `limiter.py` daba por "confirmado" (nginx local) tenía una
   vía de bypass sin proxy de por medio. No hacía falta especular sobre
   Render para encontrar el agujero: estaba en el `docker-compose.yml` que
   se usa para correr la suite de pruebas.
2. **`request.headers.get()` de Starlette solo devuelve la primera línea**
   cuando `X-Forwarded-For` llega como múltiples líneas de header separadas,
   en vez de una sola línea con comas (que es como lo arma nginx, pero no
   necesariamente cualquier otro proxy). Si el borde de Render agrega su
   observación como una línea nueva en vez de extender el valor existente,
   la "última entrada" nunca se lee — vuelve a ser 100% lo que mandó el
   cliente. El endpoint de diagnóstico tenía el mismo punto ciego: no podía
   detectar justo el escenario que importaba.

La técnica en sí ("confiar en el último salto con N proxies de confianza
conocidos") es válida y estándar — el error no fue la teoría, fue aplicarla
sin verificar que su precondición se cumple en este despliegue. La tarea 01
no necesitaba esa precondición: paga precisión (bucket global detrás de
cualquier proxy que no preserve la conexión TCP), nunca seguridad.

**Se revirtió** `552587f` de vuelta al estado de `9f95aa3` (peer TCP vía
`get_remote_address`, límite `5/minute`). Ver commit `0236110` para el detalle
completo de ambos hallazgos.

### Dos cosas quedan abiertas, a propósito, para una tarea futura

1. **El puerto 8000 publicado en `docker-compose.yml`** era un hallazgo real
   e independiente del rate limiter. Se arregló aparte, en su propio commit
   (`9c2ff17`): nginx pasa a ser el único ingreso; el puerto sigue accesible
   *entre* contenedores (`expose`), no desde el host.
2. **El límite de `5/minute` sobre un bucket efectivamente global en
   producción sigue siendo poco** para el tráfico real de una clínica el día
   que se publique el QR — eso no cambió, y no se resuelve confiando en un
   header sin verificar. Queda como pregunta abierta para una tarea futura,
   cuyo primer paso tiene que ser **medir empíricamente la topología real de
   proxies en Render** (cuántos saltos hay, si son verificables) antes de
   decidir cualquier cosa. Si esa medición confirma un salto verificable, ahí
   sí vale la pena revisar la clave del limiter. Antes no.

---

# Verificación

- [x] La suite de Playwright pasa (23 pasando, no 19 — dos de las que fallaban
      a propósito ahora pasan de verdad, más las nuevas pruebas de estado
      vacío/error que las reemplazan).
- [x] Las dos pruebas que fallaban a propósito ahora pasan.
- [x] La página del QR distingue visiblemente: cargando, sin datos, y error
      (con reintentar).
- [x] Sin veterinarios en la base, la página lo dice en vez de quedarse en
      blanco (ya lo hacía; ahora tiene prueba propia).
- [ ] ~~El rate limiter usa la última entrada de `X-Forwarded-For`, con caída
      a peer TCP en local.~~ **No se cumple — revertido a propósito.**
      `judgment-day` concluyó que la premisa de la unidad C estaba mal (ver
      "Resultado" arriba). El limiter sigue en `request.client.host`, como
      lo dejó la tarea 01.
- [ ] ~~Existe el mecanismo para verificar la cadena de proxies tras el
      despliegue.~~ **No aplica — el endpoint de diagnóstico se revirtió
      junto con el resto de la unidad C.** Queda como parte del trabajo de
      la tarea futura mencionada arriba.
- [x] Commits separados por unidad.
- [x] **La rama está pusheada.**

# Fuera de alcance

- No despliegues en Render. Esta tarea termina con la rama subida y verde.
- No corras Strix — sigue pendiente de credencial.
- No toques el esquema de Supabase ni las políticas RLS.

# Para Daniel, no para ti

Queda pendiente confirmar en el panel de Render si `JWT_SECRET_KEY` estaba
puesta a mano. Aviso: `render.yaml` la declara con `generateValue: true`, así
que el despliegue va a generar una clave nueva y **todas las sesiones activas
se invalidarán**. Los usuarios vuelven a entrar una vez. Recuérdaselo en tu
reporte final.
