# Pruebas E2E (Playwright) — Unidad A

Suite de pruebas funcionales end-to-end para AmiVets. Corre **exclusivamente**
contra el entorno local de Docker (`http://localhost`). Nunca contra Render
(producción) ni contra un proyecto real de Supabase — `e2e/helpers.js` corta
la ejecución si `BASE_URL` no apunta a `localhost`/`127.0.0.1`.

## 1. Levantar el entorno

```bash
docker compose up -d
docker ps   # esperar veterinaria_backend, veterinaria_db (healthy), veterinaria_nginx
```

La app queda disponible en `http://localhost/`. El backend directo (Swagger)
en `http://localhost:8000/docs`.

Usuarios de seed:

| Usuario | Password | Rol |
|---|---|---|
| `admin` | `admin123` | admin |
| `dr_pérez`, `dr_garcía`, ... | `doctor123` | user *(no `veterinario` — ver nota de producción abajo)* |

**Nota de producción, no solo de test**: `backend/scripts/seed_data.py` —
el mismo script que corre en un deploy nuevo de Render vía
`start.sh` → `init_db.py` — nunca crea un usuario con `role='veterinario'`.
Un despliegue fresco arranca con la lista de veterinarios de
`agendar.html` vacía hasta que un admin cree o edite manualmente un
usuario con ese rol desde el panel. La suite ahora siembra su propio
veterinario de prueba (`e2e/qr-booking.spec.js`) para cubrir el camino
con datos reales — no depende de que este gap de seed exista.

## 2. Instalar y correr la suite

```bash
npm install
npx playwright install chromium   # una sola vez; --with-deps requiere sudo, no usarlo acá
npm run test:e2e                  # o: npx playwright test
```

Ver el reporte HTML de la última corrida:

```bash
npm run test:e2e:report
```

Un test puntual:

```bash
npx playwright test e2e/auth.spec.js
npx playwright test -g "editar usuario"
```

## 3. Estructura

```
e2e/
  helpers.js          # login admin, creación/limpieza de datos de prueba, guard de entorno
  auth.spec.js         # login, error de credenciales, menú admin, logout
  qr-booking.spec.js   # agendar.html — formulario público de citas
  admin-panel.spec.js  # panel admin: usuarios, citas QR, horarios
  inventario.spec.js   # registrar movimiento de stock (backend/app/routers/inventario.py)
playwright.config.js
package.json
```

## 4. Por qué la mitad de `qr-booking.spec.js` y `admin-panel.spec.js` usa
   red mockeada (`page.route`)

El flujo de agendamiento por QR tiene dos fuentes de datos distintas:

- **`GET /api/admin/supabase/veterinarios`** lee la tabla `usuarios` de
  Postgres local (columna `role`). No depende de Supabase.
- **Horarios y citas QR** (`horarios_veterinarios`, `citas_agendadas`) viven
  **solo en Supabase** — no existen como tablas en el Postgres local
  (confirmado con `\dt` en `veterinaria_db`).

`docker-compose.yml` **no declara `SUPABASE_URL` ni `SUPABASE_SECRET_KEY`**
en el `environment:` del servicio `backend` (a diferencia de `DATABASE_URL`,
`SECRET_KEY`, etc.). Sin esas dos variables, `get_supabase()` en
`supabase_admin.py` lanza `500 Supabase no configurado` en cada request.
Confirmable en cualquier momento:

```bash
curl http://localhost/api/admin/supabase/health
# {"status":"error","message":"500: Supabase no configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)"}
```

Como resultado, en **este** entorno Docker no hay forma de probar
end-to-end contra el backend real: horarios, creación de citas, listado/
cancelación de citas QR y CRUD de horarios en el panel admin. Para no dejar
esa cobertura completamente afuera ni ensuciar un Supabase real (algo
explícitamente prohibido), la mayoría de esos escenarios se prueban
interceptando la red del navegador con `page.route()`: se ejerce el código
JS real que Daniel tocó (parseo de respuesta, armado de turnos, validación,
render de la UI) sin que el navegador ni el backend hablen jamás con
Supabase.

Dos pruebas sí pegan contra el backend real a propósito, porque el objetivo
es precisamente exponer el estado real del entorno (ver sección 5):

- El listado de veterinarios (no depende de Supabase, corre siempre).
- Un smoke test de horarios reales, condicionado a que
  `GET /api/admin/supabase/health` devuelva `status: ok` — si no, se salta
  con `test.skip(...)` y un mensaje explicando por qué, en vez de fallar en
  rojo por un problema de infraestructura ajeno al código bajo prueba.

**Para habilitar esa cobertura real**: agregar
`SUPABASE_URL: ${SUPABASE_URL}` y `SUPABASE_SECRET_KEY: ${SUPABASE_SECRET_KEY}`
al bloque `environment:` del servicio `backend` en `docker-compose.yml`
(los valores ya existen en `.env`, pero docker-compose no los pasa a menos
que estén declarados explícitamente ahí), y `docker compose up -d --build`.
Con eso configurado, `qr-booking.spec.js` y `admin-panel.spec.js` van a
ejercer las rutas reales sin cambios de código — usan
`isSupabaseAvailable()` para decidir en tiempo de ejecución.

## 5. Cómo interpretar los resultados

Con el entorno tal como está hoy (`docker compose up -d`, sin credenciales
de Supabase), la corrida esperada es:

- **23 passed**
- **1 skipped** — gate de Supabase (ver sección 4).

Si alguna vez ves un `failed`, revisá primero si cambió el estado de
Supabase (`curl .../health`) antes de asumir una regresión nueva.

### Bugs de la Unidad A, cerrados en la tarea 02

Estos dos se reportaron sin arreglar por diseño en la unidad A de la tarea
01. La tarea 02 los cerró; quedan documentados acá por historia, no como
fallas activas.

1. **Lista de veterinarios vacía** — era un problema de dato, no de UI: la
   UI ya mostraba "Sin veterinarios disponibles" correctamente cuando la
   lista venía vacía. `backend/scripts/seed_data.py` nunca crea
   `role='veterinario'` (ver nota de producción en la sección 1). Arreglo:
   la suite ahora siembra un veterinario real antes de
   *"cargar la página lista veterinarios reales desde el backend"* y lo
   borra al terminar; el estado vacío tiene su propia prueba determinística
   con red mockeada (*"sin veterinarios disponibles, la página lo dice..."*).
   El seed de producción sigue sin crear el rol — ver la nota de la
   sección 1, es intencional no tocarlo acá.

2. **`cargarHorarios()` no revisaba `response.ok`** — corregido en
   `static/agendar.html`: ahora distingue cargando / sin horarios / error,
   con un botón "Reintentar" en el tercer caso. El mismo patrón se revisó
   en la carga de veterinarios (`init()`/`cargarVeterinarios()`, tenía el
   mismo defecto, mismo arreglo) y en `enviarCita()` (ya validaba `res.ok`
   correctamente, no necesitó cambios). Cubierto por
   *"si el backend de horarios falla..."* y *"si el backend de
   veterinarios falla..."* en `qr-booking.spec.js`, ambas verifican
   también que el botón de reintentar dispara un nuevo fetch.

### Bugs/gaps que siguen abiertos

1. **Entorno: Supabase no está cableado en `docker-compose.yml`** — ver
   sección 4. No es un bug de código, es un gap de configuración que impide
   probar (y hoy, usar) gran parte del flujo QR y del panel de horarios en
   local. Recomendado: agregar `SUPABASE_URL`/`SUPABASE_SECRET_KEY` al
   `environment:` de `backend` en `docker-compose.yml`.

2. **Panel admin: no hay forma de editar un horario ya creado** —
   `static/js/app.js::guardarHorario()` soporta modo edición vía
   `#horarioEditId`, pero ningún elemento de la UI lo setea con el id de un
   bloque existente — `cargarHorariosVet()` solo renderiza un botón
   "✕ Eliminar" por bloque, y `abrirModalNuevoHorario()` siempre limpia
   `#horarioEditId` a `''`. Se puede crear y eliminar, pero no editar, pese
   a que la cobertura mínima de esta unidad pide explícitamente poder
   editar horarios.
   Test: `admin-panel.spec.js` → *"GAP: no existe forma de editar un bloque
   de horario ya creado"* (este test pasa: documenta la ausencia de la
   funcionalidad, no la rompe).

### Nota de UX (no reportada como bug)

En el tab "Horarios" del panel admin, elegir un veterinario del `<select>`
no dispara la carga de su grilla automáticamente — hace falta apretar el
botón "Ver Horarios" a propósito (`onclick="cargarHorariosVet()"`, sin
listener de `change` en el select). Es un patrón manual, no un fallo; lo
dejamos anotado porque no es obvio la primera vez que se prueba.

## 6. Limpieza de datos de prueba

- Usuarios de prueba (`e2e/helpers.js::createTestUser`) se crean y borran
  con la API (`DELETE /api/usuarios/{id}`, hard delete) en `afterEach`.
- Productos de inventario de prueba se "borran" con
  `DELETE /api/inventario/{id}`, que es un soft-delete (`activo=false`) —
  es el único borrado que expone la API; quedan filas inactivas en la
  tabla, consistente con el comportamiento real de la app, no visibles en
  ningún listado (`activo=True` es el filtro por defecto).
- Las citas QR y horarios de las pruebas con red mockeada nunca tocan
  Supabase real — no requieren limpieza porque no se crean.
- El único caso que podría llegar a tocar Supabase real (smoke test
  condicionado por `isSupabaseAvailable`) solo hace un `GET`, no crea nada.

Todos los datos de prueba usan el prefijo `PWTEST_` para que sea trivial
auditarlos manualmente si hiciera falta:

```bash
docker exec veterinaria_db psql -U vetuser -d veterinaria_db \
  -c "select username from usuarios where username like 'PWTEST_%';"
```

## 7. Reproducibilidad

Corrida dos veces seguidas sobre el mismo entorno: mismo resultado
(19 passed / 2 failed reportados / 1 skipped), sin datos residuales entre
corridas.
