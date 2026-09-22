# Matriz de endpoints — auditoría de autenticación (Tarea 10)

> Inventario completo, endpoint por endpoint, de los 22 routers en
> `backend/app/routers/`. Nace de la Tarea 10 ("Routers sin autenticación"),
> que encontró que el fix de `facturas.py` (commit `96484b0`) era un caso
> aislado de un agujero mucho más ancho: 8 de los 22 routers tenían al menos
> un endpoint sin ninguna dependencia de autenticación, y 2 más tenían sesión
> exigida pero sin chequeo de rol donde la matriz de permisos lo pedía.
>
> `backend/app/main.py:160-181` monta los 22 routers con
> `app.include_router(...)` sin `dependencies=` global — no hay ninguna capa
> por detrás que los cubra. Lo que no está gateado en el propio endpoint,
> queda abierto de verdad.
>
> Este documento es el entregable que evita que esto vuelva a pasar: cada vez
> que se agregue un router o un endpoint nuevo, se audita acá.

## Cómo leer la tabla

- **Gate antes** / **Gate después**: la dependencia de auth que tenía el
  endpoint antes y después de la Tarea 10. `ninguno` = sin `Depends` de auth
  de ningún tipo (accesible sin token). `login` = `get_current_user` (exige
  sesión válida, cualquier rol). `admin` = `get_current_admin`. `roles(...)`
  = `require_roles(...)` con la lista de roles habilitados.
- **Código antes / después**: el código HTTP real que devuelve una petición
  **sin token** contra ese endpoint. Confirmado con `curl` contra el stack
  real para los casos marcados ✅; el resto se infiere del código (mismo
  patrón `require_roles`/`get_current_user`, ya verificado en runtime para
  decenas de estos endpoints durante la Tarea 06 y esta tarea).
- **Hallazgo**: por qué cambió (o por qué no).

---

## 1. `mascotas.py` — prefix `/api/mascotas` (7 rutas, 0 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 201 | 401 |
| GET | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 ✅ (confirmado antes del fix) | 401 ✅ |
| POST | `/{id}/transferir` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/{id}/peso-history` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| PUT | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| DELETE | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 204 ✅ (confirmado con curl: creó y borró una mascota real sin token) | 401 ✅ |

**Hallazgo:** router completo sin ninguna dependencia de auth desde siempre.
Expone el padrón completo de 318 pacientes reales, incluida la transferencia
de propiedad y el borrado. Roles = `MASCOTAS_ROLES` del front
(`static/js/core/router.js:49`).

## 2. `propietarios.py` — prefix `/api/propietarios` (5 rutas, 0 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 201 | 401 |
| GET | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 ✅ | 401 ✅ |
| PUT | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| DELETE | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 204 | 401 |

**Hallazgo:** mismo agujero que mascotas.py. Expone el padrón completo de 264
tutores, incluida la cédula.

## 3. `reportes.py` — prefix `/api/reportes` (6 rutas, 0 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| GET | `/kpi/servicios` | ninguno | `roles(admin)` | 200 | 401 |
| GET | `/kpi/rendimiento` | ninguno | `roles(admin)` | 200 (ingresos por médico) | 401 |
| GET | `/consultas-por-veterinario` | ninguno | `roles(admin)` | 200 | 401 |
| GET | `/kpi/consultas` | ninguno | `roles(admin)` | 200 | 401 |
| GET | `/finanzas/ingresos` | ninguno | `roles(admin)` | 200 ✅ | 401 ✅ |
| GET | `/finanzas/cuentas-por-cobrar` | ninguno | `roles(admin)` | 200 | 401 |

**Hallazgo:** los seis exponen datos financieros o de desempeño por médico
sin ningún control. `admin` únicamente: la sección "Informes" del front ya
está restringida a admin (`router.js:75`) y ningún otro rol tiene pantalla
que llegue a estos endpoints — sin tensión con ningún flujo real.

## 4. `citas.py` — prefix `/api/citas` (6 rutas, 0 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 201 | 401 |
| GET | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| PUT | `/{id}/checkin` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| PUT | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| DELETE | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 204 | 401 |

**Hallazgo + corrección de una suposición previa:** el enunciado de esta
tarea y `docs/diseno/ordenes-de-servicio.md` §9.4 asumían que `POST /api/citas/`
era el agendamiento público por QR y por eso debía quedar anónimo. Verificado
en vivo, **es falso**: `static/agendar.html` no llama a `/api/citas/` en
ningún lado — llama a `/api/admin/supabase/citas-qr`
(`supabase_admin.py:227-257`), que ya es público a propósito (documentado,
con rate limit de `slowapi`). Además `CitaCreate` exige `mascota_id` y
`propietario_id` que ya existen en Postgres — un visitante anónimo del QR no
puede conocerlos. El único caller real de `POST /api/citas/` es
`agenda.js:231`, dentro de la sección "Agenda" del shell (ya restringida a
`ADMISION_ROLES` en el front). Los 6 endpoints se gatearon igual, sin
excepción.

## 5. `consultas.py` — prefix `/api/consultas` (12 rutas, 6 gateadas antes / gate parcial)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | `roles(admin,recepcionista,veterinario)` | sin cambio | 401 | 401 |
| GET | `/{id}` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| PUT | `/{id}` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| DELETE | `/{id}` | `admin` | sin cambio | 401 | 401 |
| POST | `/{id}/recetas` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/{id}/recetas` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/{id}/recetas/{receta_id}/pdf` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 (PDF de receta) | 401 |
| POST | `/{id}/servicios` | `roles(admin,recepcionista,veterinario)` | sin cambio | 401 | 401 |
| PATCH | `/servicios/{id}` | `roles(admin,recepcionista,veterinario,gestor)` | sin cambio | 401 | 401 |
| GET | `/{id}/pdf` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 (PDF de consulta) | 401 |
| DELETE | `/servicios/{id}` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |

**Hallazgo (gate parcial no listado en la heurística del enunciado ni en la
matriz de permisos):** 5 de los 12 endpoints quedaron sin ninguna dependencia
de auth mientras los otros 7 sí la tenían — exactamente el patrón que el
enunciado advertía con `inventario.py` como ejemplo, pero en un router que ni
la tabla heurística ni la matriz señalaban. Se encontró barriendo endpoint
por endpoint. Los 5 exponen la lista y el detalle completo de consultas
clínicas, incluidas recetas y PDFs, sin sesión.

## 6. `servicios.py` — prefix `/api/servicios` (6 rutas, 5 gateadas antes / gate parcial)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | `roles(admin,recepcionista,veterinario)` | sin cambio | 401 | 401 |
| GET | `/` | **ninguno** | `roles(admin,recepcionista,veterinario)` | 200 ✅ | 401 ✅ |
| PATCH | `/{id}` | `roles(admin,recepcionista,veterinario,gestor)` | sin cambio | 401 | 401 |
| DELETE | `/{id}` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| POST | `/{id}/tomar` | `roles(admin,veterinario,gestor)` | sin cambio | 401 | 401 |
| GET | `/bandeja` | `roles(admin,veterinario,gestor)` | sin cambio | 401 | 401 |

**Hallazgo:** `listar_servicios_mascota` (feed de servicios de una mascota)
era el único endpoint del router sin gate.

## 7. `clinico.py` — prefix `/api/clinico` (10 rutas, 5 gateadas antes / gate parcial)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| GET | `/vacunaciones/{mascota_id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| POST | `/vacunacion` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/desparasitaciones/{mascota_id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| POST | `/desparasitacion` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/hospitalizaciones/{mascota_id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| POST | `/hospitalizacion` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/cirugias/{mascota_id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| POST | `/cirugia` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/pruebas_complementarias/{mascota_id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| POST | `/prueba_complementaria` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |

**Hallazgo:** contaba con 6 referencias a `require_roles` en 10 rutas (como
anticipaba la tabla heurística del enunciado) — los 5 POST estaban gateados,
los 5 GET de historial no. Se gatearon con `admin+veterinario` (no se sumó
`recepcionista` — ver la nota de tensión con la matriz más abajo).

## 8. `cirugias.py` — prefix `/api/cirugias` (2 rutas, 1 gateada antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/mascota/{id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |

## 9. `hospitalizaciones.py` — prefix `/api/hospitalizaciones` (3 rutas, 2 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| PUT | `/{id}/dar-alta` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |

## 10. `pruebas.py` — prefix `/api/pruebas` (5 rutas, 3 gateadas antes)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| GET | `/` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| GET | `/{id}` | **ninguno** | `roles(admin,veterinario)` | 200 | 401 |
| PUT | `/{id}` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |
| DELETE | `/{id}` | `roles(admin,veterinario)` | sin cambio | 401 | 401 |

**Nota de tensión (7-10):** la fila 15 de la matriz de permisos
(`docs/diseno/ordenes-de-servicio.md`, decisión 9, §9.3) le da a
`recepcionista` una vista RECORTADA de la historia clínica ("sin diagnóstico
ni tratamiento") vía un schema de respuesta propio. Ese schema recortado no
existe todavía y está fuera de alcance de esta tarea ("exclusivamente
autenticación y autorización", sin tocar esquemas). Estos endpoints
devuelven el detalle clínico crudo sin ningún recorte posible con el schema
actual, así que sumar `recepcionista` ahora le daría más acceso del que la
matriz pide para esa fila. Queda anotado como deuda pendiente para cuando
exista el schema recortado, no resuelto adivinando.

## 11. `inventario.py` — prefix `/api/inventario` (9 rutas, 0 gateadas / 2 con login sin rol)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| POST | `/` | ninguno | `roles(admin)` | 201 | 401 |
| GET | `/` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/alertas-stock` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| GET | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario)` | 200 | 401 |
| PUT | `/{id}` | login (cualquier rol) | **sin cambio** (login, cualquier rol) | 200 con cualquier sesión | 200 con cualquier sesión (sin cambio) |
| GET | `/{id}/historial-precios` | **login (cualquier rol)** | `roles(admin)` | 200 con cualquier sesión | 401 sin token / 403 no-admin |
| GET | `/{id}/movimientos` | **login (cualquier rol)** | `roles(admin)` | 200 con cualquier sesión | 401 sin token / 403 no-admin |
| DELETE | `/{id}` | ninguno | `roles(admin)` | 204 | 401 |
| POST | `/{id}/movimiento` | ninguno | `roles(admin)` | 200 | 401 |

**Hallazgo (el ejemplo del propio enunciado — confirmado):** 4 referencias a
auth en 9 rutas. 6 endpoints sin ninguna dependencia; `historial-precios` y
`movimientos` exigían sesión pero **sin chequear `role`**.

**`PUT /{id}` se deja sin cambios a propósito.** En un primer paso se lo
subió a admin-only junto con el resto de la escritura, pero
`e2e/historial-precios.spec.js` (Tarea 08, ya existente) prueba
explícitamente y contra la API directa que un **veterinario** recibe `200`
al editar un campo no-precio (`descripcion`, `proveedor`) y `403` solo al
intentar cambiar `precio_unitario` — es un contrato ya probado, no un
agujero de esta tarea: el endpoint siempre exigió sesión
(`get_current_user`, 401 sin token), y el chequeo interno
`current_user.role != "admin"` ya protegía específicamente el campo de
precio. Subirlo a admin-only habría roto ese contrato ya en producción/tests.
Queda como estaba.

**Lectura vs. escritura administrativa:** la sección "Inventario" del front
es admin-only de punta a punta (`router.js:73`), pero `GET /api/inventario/`
tiene otros dos consumidores reales fuera de esa pantalla — `consultorio.js`
(selector de medicamentos, alcanzable por recepción y veterinario) y
`catalogo.js` (selector de materiales de receta, alcanzable por
veterinario). Restringir la lectura a admin-only habría roto esos dos flujos
en uso; crear/borrar/mover stock y el historial de precios/movimientos sí
quedan admin-only — coincide con la fila 25 de la matriz y con que ningún
otro rol tiene pantalla que llegue a esas acciones.

## 12. `catalogo.py` — prefix `/api/catalogo` (11 rutas, 0 gateadas / 7 con login sin rol)

| Método | Ruta | Gate antes | Gate después | Código antes | Código después |
|---|---|---|---|---|---|
| GET | `/categorias` | ninguno | `roles(admin,recepcionista,veterinario,gestor)` | 200 | 401 |
| GET | `/` | ninguno | `roles(admin,recepcionista,veterinario,gestor)` | 200 | 401 |
| POST | `/` | **login (cualquier rol)** | `roles(admin,veterinario)` | 201 con cualquier sesión | 401 sin token / 403 recepción-gestor |
| GET | `/{id}` | ninguno | `roles(admin,recepcionista,veterinario,gestor)` | 200 | 401 |
| PUT | `/{id}` | **login (cualquier rol)** | `roles(admin,veterinario)` | 200 con cualquier sesión | 401 sin token / 403 recepción-gestor |
| GET | `/{id}/historial-precios` | **login (cualquier rol)** | `roles(admin,recepcionista,veterinario,gestor)` | 200 con cualquier sesión | 401 |
| DELETE | `/{id}` | **login (cualquier rol)** | `roles(admin,veterinario)` | 204 con cualquier sesión | 401 sin token / 403 recepción-gestor |
| GET | `/{id}/recetas` | ninguno | `roles(admin,recepcionista,veterinario,gestor)` | 200 | 401 |
| POST | `/{id}/recetas` | **login (cualquier rol)** | `roles(admin,veterinario)` | 201 con cualquier sesión | 401 sin token / 403 recepción-gestor |
| PUT | `/recetas/{id}` | **login (cualquier rol)** | `roles(admin,veterinario)` | 200 con cualquier sesión | 401 sin token / 403 recepción-gestor |
| DELETE | `/recetas/{id}` | **login (cualquier rol)** | `roles(admin,veterinario)` | 204 con cualquier sesión | 401 sin token / 403 recepción-gestor |

**Hallazgo:** 4 endpoints de lectura sin ninguna dependencia; los otros 7
(todos de escritura) exigían sesión pero sin chequear rol — contradice la
fila 23 de la matriz ("Editar catálogo, precios, áreas, `requiere_adjunto`" —
admin solo).

**Decisión de rol / tensión con la matriz (misma lógica que `facturas.py`,
commit `96484b0`):** escritura se gateó `admin + veterinario`, no admin-only
como pide la fila 23. La pestaña "Catálogo" del front ya deja entrar a
veterinario (`router.js:59`, `roles: ['admin','veterinario']`), y
`catalogo.js:232` lo confirma en un comentario existente ("Tarea 08: alta ->
precio editable por cualquiera"): el alta de un servicio nuevo no bloquea el
campo precio para veterinario, y en la edición el candado de precio
(`gatePrecioInput`, `historial-precios.js:344`) es puramente de UI — el
veterinario sí puede enviar el PUT, solo se le oculta el input. Restringir el
router a admin-only habría roto ese flujo real ya en uso. El chequeo interno
`current_user.role != "admin"` que ya protegía `precio_ref` / `area_id` /
`requiere_adjunto` (más estricto que el gate del endpoint) queda intacto.

Lectura se amplió a `admin + recepcionista + veterinario + gestor`: es la
unión real de quien consume estos endpoints hoy — `orden-abierta.js` y
`consultorio.js` (`MASCOTAS_ROLES`) y `bandeja-gestor.js`
(`SERVICIOS_ROLES`, resuelve el área de un ítem vía `GET /catalogo/{id}`).

## 13. `facturas.py` — prefix `/api/facturas` (11 rutas) — arreglado en `96484b0` (fuera de esta tarea)

Ya documentado en el commit `96484b0` y su propio comentario de cabecera en
el archivo. `admin + recepcionista + veterinario` en general,
`anular_factura` admin-only. Incluido acá solo por completitud del
inventario de los 22 routers.

## 14. Routers que ya estaban correctamente gateados (sin cambios)

| Router | Rutas | Gate | Notas |
|---|---:|---|---|
| `ordenes.py` | 9 | `require_roles`/`get_current_admin` en las 9 | Fila 4 de la matriz (gestor con alcance recortado) queda pendiente de un schema propio, ya anotado en el código existente. |
| `areas.py` | 5 | `require_roles` en las 5 | — |
| `adjuntos.py` | 4 | `require_roles` en las 4 | — |
| `usuarios.py` | 7 | `get_current_user`/`get_current_admin` en las 7 | `crear_usuario` valida admin con un `if` interno en vez de `require_roles`, pero exige sesión igual (401 sin token). |
| `liquidaciones.py` | 5 | `get_current_admin` en las 5 | Filas 19-21 de la matriz, ya así desde antes de esta tarea. |
| `notas.py` | 4 | `get_current_user` en las 4 | Exige sesión pero sin restricción de rol — no hay fila de la matriz que la pida; se deja como está. |
| `notificaciones.py` | 3 | `get_current_user` en las 3 | Recurso propio del usuario autenticado (sus notificaciones); no hay restricción de rol que aplicar. |
| `auth.py` | 1 | público (login) | Correcto por diseño: es el endpoint que emite el token. |
| `supabase_admin.py` | 9 | 6 con `get_current_admin`; 3 públicos **a propósito** | `GET /veterinarios`, `GET /horarios` y `POST /citas-qr` alimentan el formulario público de `static/agendar.html` (QR sin login). `POST /citas-qr` ya tiene rate limit de `slowapi` (`@limiter.limit("5/minute")`) y un comentario en el código que documenta la decisión. No se tocó nada acá. |

---

## Resumen ejecutivo

- **22/22 routers auditados endpoint por endpoint** (no solo por conteo de
  `grep`, como pedía el punto 2 de la tarea).
- **8 routers** tenían al menos un endpoint sin ninguna dependencia de auth:
  `mascotas`, `propietarios`, `reportes`, `citas` (0% gateados los cuatro),
  `inventario`, `catalogo` (0% en parte de sus rutas), `consultas`,
  `servicios`, `clinico`, `cirugias`, `hospitalizaciones`, `pruebas` (gate
  parcial — algunas rutas sueltas).
- **2 routers** (`inventario`, `catalogo`) tenían endpoints con sesión
  exigida pero **sin chequeo de rol**, contradiciendo la matriz de permisos.
- **1 suposición previa corregida**: `POST /api/citas/` no es el
  agendamiento público por QR (ver sección 4).
- **0 bugs encontrados en `require_roles` en sí** — el guard funciona como
  documenta `docs/diseno/ordenes-de-servicio.md` §9.1: sin token es 401, con
  rol equivocado es 403. El problema en los 8 routers de arriba nunca fue el
  guard — fue no usarlo.
