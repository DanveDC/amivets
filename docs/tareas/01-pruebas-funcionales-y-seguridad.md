# Tarea 01 — Pruebas funcionales y auditoría de seguridad

**Proyecto:** AmiVets (`veterinaria/amivets`)
**Stack:** FastAPI + SQLAlchemy + Alembic, frontend estático, Supabase para el
agendamiento por QR, Docker, desplegado en Render.
**Registro maestro:** tareas 03, 04 y 06.

## Contexto

Daniel hizo cambios de interfaz y de backend que **nunca probó**. Sin commitear
hay 8 archivos: `backend/app/main.py`, `backend/app/routers/inventario.py`,
`index.html`, `static/agendar.html`, `static/css/styles.css`,
`static/js/app.js`, `static/templates/index.html`.

Además, una revisión preliminar del código encontró tres problemas de seguridad
confirmados. Están detallados abajo con ruta y línea: **no hace falta que los
descubras, hace falta que los cierres.**

## Skills a cargar antes de trabajar

Este repo no tiene `.atl/skill-registry.md`. Las skills de usuario en
`/home/dalec/.claude/skills/` aplican igual:

- `/home/dalec/.claude/skills/work-unit-commits/SKILL.md`
- `/home/dalec/.claude/skills/judgment-day/SKILL.md` — para cerrar la unidad B.

La skill de Playwright vive en el otro proyecto:
`/mnt/c/Users/dalec/Desktop/app aseguradora/.claude/skills/playwright-skill/SKILL.md`
Léela desde ahí. Si acabas usándola de forma recurrente aquí, propón moverla a
`~/.claude/skills/` para que sea global — pero no la muevas por tu cuenta.

---

# Paso 0 — Urgente, antes que todo lo demás

**Esto es explotable en producción ahora mismo. Son minutos de trabajo.**

`backend/app/core/security.py` firma los JWT con `settings.JWT_SECRET_KEY`.
En `backend/app/core/config.py:39` ese valor tiene por defecto la cadena
literal `"your-jwt-secret-key"`.

`render.yaml` declara `SECRET_KEY` con `generateValue: true`, pero **no declara
`JWT_SECRET_KEY` en ninguna parte**. Son dos variables distintas y la que firma
los tokens es la que falta.

Consecuencia: salvo que esa variable esté puesta a mano en el panel de Render,
la instancia en producción está firmando tokens de sesión con una cadena que
está escrita en un repositorio público de plantillas de FastAPI. Cualquiera que
la conozca puede fabricarse un token válido para el usuario que quiera,
incluido un administrador.

**Qué hacer:**

1. Verifica primero si `JWT_SECRET_KEY` está definida en el panel de Render. Si
   lo está, el riesgo es menor — confírmalo y sigue igual con los puntos 2 y 3.
2. Declara `JWT_SECRET_KEY` en `render.yaml` con `generateValue: true`.
3. Quita los valores por defecto de `config.py`: ni `SECRET_KEY` ni
   `JWT_SECRET_KEY` deben tener un fallback literal. Que la app **falle al
   arrancar** si faltan. Un arranque roto es un incidente de diez minutos; un
   secreto por defecto es una puerta abierta que nadie ve.
4. Rotar la clave invalida las sesiones activas. Los usuarios vuelven a entrar
   una vez. Vale la pena.

Commit aparte, el primero de todos.

---

# Unidad A — Pruebas funcionales E2E con Playwright

**Primero las pruebas.** Vas a tocar autenticación y autorización en la unidad
B; sin una red que diga "esto seguía funcionando antes", no hay forma de
distinguir un arreglo de una regresión.

## Cobertura mínima

**Flujo público de agendamiento por QR** (`static/agendar.html` — cambiado y sin probar):
- Cargar la página lista los veterinarios disponibles.
- Elegir un veterinario carga sus horarios.
- La opción "cualquier veterinario" funciona (se añadió recientemente:
  commit `442c73d`).
- Enviar el formulario crea la cita y da confirmación visible.
- Enviar con campos incompletos da un error entendible, no un 500.

**Autenticación** (`static/js/auth.js`, `index.html` — cambiados):
- Login con credenciales correctas entra.
- Login con credenciales incorrectas falla con mensaje claro.
- El menú de administración aparece solo para usuarios admin
  (`checkAdminAccess()`, commit `ec1645a`).
- Cerrar sesión invalida el acceso.

**Panel de administración** (`static/js/app.js` — cambiado):
- Listar y filtrar citas QR por estado.
- Cancelar una cita QR.
- Crear, editar y eliminar horarios de veterinario.
- Editar usuario: cambiar nombre, correo y rol (commit `40a0955`).

**Inventario** (`backend/app/routers/inventario.py` — cambiado):
- El flujo principal responde. Si el cambio fue puntual, cubre esa parte
  específica y dilo.

## Criterios

- Las pruebas corren contra un entorno local levantado con Docker, **nunca
  contra producción**.
- Cada prueba se limpia lo que crea. Una suite que deja basura deja de ser
  fiable a la tercera corrida.
- Si una prueba falla por un bug real de los cambios sin probar: **repórtalo,
  no lo arregles en silencio.** Encontrar bugs es el objetivo de esta unidad.
- Deja documentado cómo se corren, en `docs/pruebas.md`.

---

# Unidad B — Cerrar los hallazgos de seguridad confirmados

## B1 — `supabase_admin.py` no tiene autenticación en ninguna ruta

`backend/app/routers/supabase_admin.py` monta trece endpoints bajo
`/api/admin/supabase/` y **ninguno exige usuario autenticado**. Todos declaran
solo `Depends(get_db)`.

Compara con `backend/app/routers/usuarios.py`, que sí usa
`Depends(get_current_user)` y `Depends(get_current_admin)`. El patrón correcto
ya existe en el proyecto; este router simplemente no lo usa.

Queda expuesto a cualquiera que conozca la URL:

| Endpoint | Línea | Qué permite hoy sin credenciales |
| --- | --- | --- |
| `GET /citas-qr` | 198 | Listar todas las citas agendadas — datos de dueños y mascotas |
| `DELETE /citas-qr/{id}` | 240 | Cancelar la cita de cualquiera |
| `POST /horarios` | 148 | Crear horarios de veterinario |
| `PUT /horarios/{id}` | 178 | Modificar horarios |
| `DELETE /horarios/{id}` | 190 | Borrar horarios |

**El matiz que hace esto no trivial:** la página pública de agendamiento
(`static/agendar.html`) necesita legítimamente que `GET /veterinarios`,
`GET /horarios` y `POST /citas-qr` sigan siendo públicos. Es una página sin
login, a la que se llega por un QR.

O sea: no puedes proteger el router entero de un golpe. Hay que separar la
superficie pública de la administrativa. Cómo lo hagas es decisión tuya
—dividir en dos routers, aplicar la dependencia endpoint por endpoint, o lo que
el código pida— pero **justifícalo** y deja claro qué queda público y por qué.

## B2 — CORS abierto

`render.yaml` define `CORS_ORIGINS: "*"` y `backend/app/main.py:134` lo pasa a
`CORSMiddleware`. Restríngelo a los orígenes reales. Revisa también
`allow_credentials`: comodín más credenciales es una combinación que los
navegadores rechazan, así que si está así, algo no funciona como crees.

## B3 — Abuso del agendamiento público

`POST /citas-qr` es público por diseño y no tiene límite de tasa. La política
RLS `public_insert_citas` lo permite desde el navegador. Un script llena la
agenda en un minuto.

Evalúa qué defensa cabe sin estorbar al usuario legítimo que escanea un QR
—límite por IP, ventana temporal, o lo que consideres— y si concluyes que no
vale la pena todavía, dilo con argumentos.

## Lo que sí está bien — no lo toques

**El RLS de Supabase está correctamente configurado.** `supabase_setup.sql:78-99`
activa row level security en las tres tablas y define políticas acotadas:
lectura pública de veterinarios y horarios, inserción pública de citas.

Por eso la clave `sb_publishable_...` en `index.html:102` **no es una filtración**:
es una clave publicable, diseñada para vivir en el navegador, y el RLS es lo que
la hace segura. Está bien resuelto.

## Cierre

Aplica `judgment-day` sobre los cambios de autorización antes de cerrar la
unidad. Es la parte donde un error se ve exactamente igual que un acierto.

---

# Unidad C — Barrido con Strix

Strix nunca se ha usado en estos proyectos. Esta unidad incluye montarlo.

1. Instálalo y déjalo funcionando. Documenta el procedimiento en
   `docs/seguridad/strix.md` — se va a repetir en broker-suite y en Cabal, y la
   segunda vez debería costar cinco minutos.
2. Córrelo sobre AmiVets **después** de la unidad B, para que no reporte lo que
   ya arreglaste.
3. Triaje de resultados. Las herramientas de seguridad automatizadas producen
   falsos positivos; tu trabajo no es pegar la salida, es separar lo real de lo
   ruidoso y explicar por qué.
4. Lo real que sea acotado, arréglalo. Lo real que sea grande, conviértelo en
   una tarea propuesta.

**Nunca contra producción ni contra Supabase.** Solo contra el entorno local.

---

# Verificación

- [ ] `JWT_SECRET_KEY` declarada en `render.yaml`, sin valores por defecto en
      `config.py`, y la app falla al arrancar si falta.
- [ ] La suite de Playwright corre en local y pasa.
- [ ] Los endpoints administrativos de `supabase_admin.py` devuelven 401 sin token.
- [ ] La página de agendamiento por QR **sigue funcionando sin autenticación**.
      Si se rompió, la unidad B está mal hecha.
- [ ] CORS restringido.
- [ ] Strix documentado, corrido y triado.
- [ ] Commits separados por unidad. `git status` limpio.

# Fuera de alcance

- No hagas el deploy a Render. Eso es la tarea siguiente.
- No refactorices `static/js/app.js` — es grande y no es el momento.
- No toques el esquema de Supabase: el RLS está bien.
