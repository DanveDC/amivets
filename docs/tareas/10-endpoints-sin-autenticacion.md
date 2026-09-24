# Tarea 10 — Routers sin autenticación (urgente, antes que cualquier otra cosa)

> **Prioridad máxima.** Esto se hace solo, en su propia rama, y se cierra antes
> de empezar la Tarea 11. No la mezcles con trabajo visual.

---

## Contexto

El commit `96484b0` arregló que `backend/app/routers/facturas.py` no tuviera
**ninguna** autenticación: 13 endpoints —crear, anular, abonar, listar, PDFs—
respondían sin token, y se confirmó en vivo que `POST /api/facturas/` sin token
devolvía 201 y creaba una factura real.

Ese arreglo trató un router. **El agujero es más ancho.** Un barrido sobre
`backend/app/routers/` cuenta cuántas veces aparece `require_roles`,
`get_current_user` o `dependencies=` por archivo, contra cuántas rutas declara:

| Router | Rutas | Referencias a auth |
|---|---:|---:|
| `mascotas.py` | 7 | **0** |
| `propietarios.py` | 5 | **0** |
| `reportes.py` | 6 | **0** |
| `citas.py` | 6 | **0** |
| `auth.py` | 1 | 0 *(correcto: es el login)* |
| `inventario.py` | 9 | 4 |
| `clinico.py` | 10 | 6 |

`backend/app/main.py:160-181` monta los 22 routers con `app.include_router(...)`
sin `dependencies=` global, así que no hay ninguna capa que los cubra por
detrás: los ceros son ceros de verdad.

Entre lo que hoy está abierto sin token:

- `DELETE /api/mascotas/{id}` y `DELETE /api/propietarios/{id}`
- `PUT /api/mascotas/{id}`, `POST /api/mascotas/{id}/transferir`
- `GET /api/mascotas/` y `GET /api/propietarios/` — el padrón completo de
  pacientes y tutores, con cédulas
- Los seis endpoints de `reportes.py`, incluidos
  `/finanzas/ingresos`, `/finanzas/cuentas-por-cobrar` y
  `/kpi/rendimiento` (ingresos por médico)

Esto es data clínica y financiera real: la base ya tiene los 318 pacientes y
264 tutores importados de los Excel de la clínica.

---

## Lo que tenés que hacer

### 1 · Confirmalo antes de arreglarlo

Levantá el stack (`docker compose up -d`) y verificá con `curl`, sin token, al
menos estos cuatro:

```
GET  /api/mascotas/
GET  /api/propietarios/
GET  /api/reportes/finanzas/ingresos
DELETE /api/mascotas/{id de una mascota de prueba que creaste vos}
```

Anotá el código de respuesta real de cada uno **antes** del cambio. Si alguno
ya devuelve 401, decilo: significa que el conteo mecánico se equivocó en ese
caso y hay que entender por qué antes de tocarlo.

### 2 · Barré los 22 routers, no solo los cuatro

El conteo de arriba es una heurística de `grep`. Revisá **endpoint por
endpoint** los 22 archivos de `backend/app/routers/` y armá el inventario real:
ruta, método, gate que tiene hoy, gate que debería tener. Un router con 4
referencias y 9 rutas —como `inventario.py`— tiene 5 rutas que hay que mirar
una por una.

El inventario va en `docs/seguridad/matriz-endpoints.md`, como tabla. Es el
entregable que hace que esto no vuelva a pasar.

### 3 · Aplicá el gate

Seguí exactamente el patrón de `96484b0`: `from app.routers.usuarios import
require_roles`, `Depends(require_roles(...))` por endpoint, y un comentario
arriba del router que diga qué se encontró y por qué se eligió ese conjunto de
roles.

Los roles salen de la matriz de permisos de
`docs/diseno/ordenes-de-servicio.md` (Decisión 9, §9.3). **Pero la matriz no
es la última palabra si contradice un flujo real en uso** — eso es lo que pasó
con facturación y el veterinario, y se resolvió bien: se respetó el flujo real
y se anotó la tensión en el código en vez de adivinar. Hacé lo mismo acá.

**`citas.py` necesita criterio, no un gate parejo.** `POST /api/citas/` es el
agendamiento público del QR (`static/agendar.html`) y **tiene que seguir siendo
anónimo**. Los otros cinco endpoints —listar, cambiar estado, modificar,
cancelar— no. Separalos y explicá en el código por qué uno queda abierto.

### 4 · El efecto en cadena

Igual que con facturas: **ningún** llamador del front pasa token a estos
endpoints hoy, porque nunca lo necesitaron. Revisá `static/js/core/api.js` y
todas las secciones que consumen mascotas, propietarios, reportes y citas, y
arreglá los llamadores. Si `api.js` ya adjunta el token de forma centralizada,
decilo y no toques nada del front.

Lo mismo en `e2e/helpers.js` y en las specs que llaman directo por `request`.

### 5 · Test de regresión

Un test nuevo por router arreglado, con la forma del que ya existe para
facturas en `e2e/flujo-clinico.spec.js`: **cada endpoint del router, uno por
uno, sin token, devuelve 401**. No un test que pruebe uno y asuma el resto.

Y un test de rol, al menos para los tres que más importan: un usuario con rol
`gestor` no puede leer `/api/reportes/finanzas/ingresos` ni borrar una mascota.

### 6 · La suite completa

`npm run test:e2e` — los 138 tests. El host no los sostiene en un solo proceso
sin quedarse sin memoria; corré en dos tandas como se hizo en `96484b0`.
Cero fallidos antes de commitear.

---

## Restricciones

- **No ablandes ninguna aserción existente** ni marques nada `skip` para que la
  suite pase.
- No cambies el modelo de datos ni los esquemas. Esto es exclusivamente
  autenticación y autorización.
- Si al gatear un endpoint se rompe un flujo del front que hoy funciona,
  **no lo dejes roto ni relajes el gate en silencio**: arreglá el llamador, o
  si el conflicto es de producto (como el del veterinario que factura),
  documentalo en el código y decímelo.
- Commits por unidad de trabajo, con la skill `work-unit-commits`.

## Al terminar

Decime, en concreto:

1. Qué endpoints estaban abiertos, con el código de respuesta real que devolvían
   antes y después.
2. Cuáles de los 22 routers tenían gates parciales y qué rutas se les escapaban.
3. Qué decisiones de rol tomaste donde la matriz y el flujo real no coincidían.
4. El resultado de la suite completa.

Si en el camino encontrás que el problema es más grande de lo que dice este
enunciado —por ejemplo, que `require_roles` en sí tiene un bug— **paralo y
decímelo antes de seguir arreglando**.
