# Crear un proyecto nuevo de Supabase para el agendamiento por QR

AmiVets usa Supabase **solo** para el flujo público de agendamiento: los
veterinarios visibles, sus horarios y las citas que la gente crea escaneando el
QR. El resto del sistema —pacientes, consultas, facturación— vive en el
Postgres de Render y no se toca acá.

---

## Antes de empezar: ¿de verdad necesitás uno nuevo?

Los proyectos del plan gratuito **se pausan tras una semana sin actividad**. Si
el error aparece al abrir el proyecto (no al iniciar sesión), probablemente
solo esté pausado y haya un botón para restaurarlo.

**Vale la pena intentarlo primero**, porque al crear un proyecto nuevo:

- Las citas agendadas, horarios y veterinarios del proyecto viejo **se quedan
  en el proyecto viejo**. Empezás con las tablas vacías.
- La URL y las claves cambian, y hay que actualizarlas en tres sitios.

Si el acceso está definitivamente perdido, seguí adelante.

---

## Paso 1 — Crear cuenta y proyecto

1. Entrá a `supabase.com` y creá la cuenta (o iniciá sesión con la nueva).
2. **New project**.
3. Completá:
   - **Name**: `amivets` (o el que prefieras)
   - **Database Password**: generala y **guardala**. No la vas a usar en la app
     —AmiVets se conecta por la API, no por Postgres directo— pero recuperarla
     después es un lío.
   - **Region**: la más cercana a Venezuela. Suele ser `East US (North Virginia)`.
   - **Plan**: Free.
4. Esperá unos minutos a que termine de aprovisionar.

## Paso 2 — Crear las tablas ⚠️ El paso crítico

En el panel del proyecto: **SQL Editor** → **New query**.

Abrí `supabase_setup.sql` de la raíz del repositorio, copiá **el archivo
entero** y pegalo. Ejecutá con **Run**.

> ### Ejecutá el archivo COMPLETO, no solo las tablas
>
> Ese script tiene 99 líneas y hace dos cosas distintas:
>
> **Líneas 1-80** — crea las tres tablas (`veterinarios`,
> `horarios_veterinarios`, `citas_agendadas`) y un índice.
>
> **Líneas 82-99** — activa **Row Level Security** en las tres y define tres
> políticas: lectura pública de veterinarios y horarios, inserción pública de
> citas.
>
> Esa segunda parte no es opcional ni es "seguridad extra". La clave que va en
> el navegador es publicable **precisamente porque RLS limita lo que puede
> hacer**. Si creás las tablas y te saltás las políticas, esa clave —que está
> a la vista en el código del sitio— da acceso libre a la base.
>
> Si el script falla a mitad, **arreglá el error y volvé a correrlo entero**.
> Todo usa `if not exists`, así que re-ejecutarlo es seguro.

Verificá en **Table Editor** que estén las tres tablas, y en cada una que el
indicador de RLS aparezca **activado**.

## Paso 3 — Copiar la URL y las claves

**Settings** → **API Keys**.

Necesitás tres valores:

| Valor | Aspecto | Dónde va |
|---|---|---|
| **Project URL** | `https://xxxxx.supabase.co` | Backend y frontend |
| **Publishable key** | `sb_publishable_...` | **Solo frontend** |
| **Secret key** | `sb_secret_...` | **Solo backend** |

> La clave **secret ignora por completo el RLS**: tiene acceso total a la base.
> No puede aparecer nunca en `index.html`, en el repositorio, ni en nada que
> llegue a un navegador. Solo como variable de entorno en el servidor.
>
> Si tu panel muestra los nombres antiguos, `anon` equivale a la publicable y
> `service_role` a la secreta.

## Paso 4 — Actualizar los tres sitios

### 4.1 El frontend — `index.html`, líneas 101-102

Están escritas directamente en el código:

```javascript
const SUPABASE_URL = "https://twvytfictllxylhuynrw.supabase.co";
const SUPABASE_KEY = "sb_publishable_M2FZrIRjwxWV12xB1gUrzg_AfNs2aPl";
```

Reemplazá ambas por las del proyecto nuevo. **La segunda es la publicable, no
la secreta.**

### 4.2 Render — variables de entorno

Panel de Render → servicio `amivets-backend` → **Environment**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_SECRET_KEY` | la clave `sb_secret_...` |

Las usan `backend/app/routers/supabase_admin.py` (líneas 20-21) y
`sync_worker.py` (líneas 48-49).

### 4.3 Tu `.env` local

Las mismas dos, para que funcione al desarrollar.

> **Pendiente:** `.env.example` **no documenta ninguna de las dos**. Habría que
> agregarlas, porque hoy nada en el repositorio indica que la app las necesita.

## Paso 5 — Poblar y verificar

Las tablas nacen vacías. El backend sincroniza los veterinarios desde el
Postgres principal —`_get_or_create_sb_vet` en `supabase_admin.py`—, así que
los usuarios con `role='veterinario'` deberían aparecer solos al usarse el
sistema.

Los horarios sí hay que cargarlos a mano desde el panel de administración.

Verificá en orden:

1. Los tres valores están puestos y el servicio redesplegado.
2. El panel de administración lista veterinarios.
3. Podés crear un horario y aparece guardado.
4. La página del QR (`/static/agendar.html`) lista veterinarios y sus horarios.
5. Agendás una cita de prueba y aparece en el panel.
6. **`sb_secret_` no aparece en ningún archivo del repositorio.**

## Si algo falla

- **"Supabase no configurado"** → faltan `SUPABASE_URL` o `SUPABASE_SECRET_KEY`
  en el entorno del backend.
- **La página del QR carga pero la lista sale vacía** → o no hay usuarios con
  `role='veterinario'`, o las políticas de RLS no se crearon. Revisá el paso 2.
- **Error de permisos al insertar una cita** → falta la política
  `public_insert_citas`. Volvé a correr el script completo.
