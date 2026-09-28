# Tasks

## 1. Migración de base de datos

- [x] 1.1 Crear migración Alembic para agregar `liberado_at` (DateTime, nullable) y `liberado_por_id` (Integer, FK usuarios, nullable) a tabla `servicios_consulta`
- [x] 1.2 Agregar índice en `liberado_at` para consultas de auditoría
- [x] 1.3 Verificar migración en base local: `alembic upgrade head` y comprobar columnas — aplicada contra `veterinaria_db` (docker), columnas e índice confirmados con `\d servicios_consulta`

## 2. Backend - Endpoint de liberación

- [x] 2.1 Agregar endpoint `POST /api/servicios/{id}/liberar` en `servicios.py`:
  - Permisos: `require_roles("admin", "gestor", "veterinario")` (veterinario por si tiene área)
  - Validar: servicio existe, `estado == 'EN_PROCESO'`, usuario es `asignado_a_id` O admin
  - UPDATE condicional: `WHERE id=? AND estado='EN_PROCESO' AND (asignado_a_id=? si no admin)` → `estado='ASIGNADO', asignado_a_id=NULL, liberado_at=now(), liberado_por_id=current_user.id`
  - Si 0 filas → 409, distinguiendo el motivo por relectura: "Solo se pueden liberar servicios en proceso" vs "No se puede liberar: el servicio no es tuyo"
  - Commit, refresh, devolver `ServicioConsultaResponse`
  - Notificación `SERVICIO_LIBERADO` a veterinario de la orden (si existe y != current_user)
- [x] 2.2 Test unitario: liberación exitosa, liberación por admin, error 409 por estado incorrecto, error 409 por no ser dueño, error 403 por rol (cubierto en e2e por decisión del usuario — no hay infraestructura de tests unitarios de backend en este repo)

## 3. Backend - Campo estado_toma en esquemas

- [x] 3.1 Agregar `estado_toma` en `ServicioConsultaResponse` (`schemas.py`) como `@computed_field` (no `@property` sola: en pydantic 2 no se serializa sin el decorador):
  - Lógica: mapear `estado` + `asignado_a_id` + `liberado_at` a `"disponible" | "tomada" | "completada" | "liberada"`
- [x] 3.2 Verificar que `OrdenServicioDetalleResponse.servicios[]` lo incluye automáticamente (hereda de `ServicioConsultaResponse`)
- [x] 3.3 Test: orden con servicios en cada estado devuelve `estado_toma` correcto (cubierto en e2e por decisión del usuario)

## 4. Backend - Notificación al veterinario al tomar servicio

- [x] 4.1 En `tomar_servicio` (tras el UPDATE condicional exitoso, misma transacción antes del commit), agregar `notificacion_service.notificar_toma(db, servicio, current_user)`. `notificacion_service.crear_notificacion` NO existe en este repo (el módulo usa una función por evento, sin commitear); se siguió ese patrón. El cuerpo se armó defensivamente (`_cuerpo_orden`) contra relaciones `None` (mascota/orden/propietario)
- [x] 4.2 Test: notificación se crea solo si hay veterinario asignado y es distinto al tomador (cubierto en e2e por decisión del usuario)

## 5. Backend - Notificación al liberar (opcional)

- [x] 5.1 En endpoint `/liberar`, si hay veterinario asignado y es distinto del liberador, crear notificación `SERVICIO_LIBERADO` (`notificacion_service.notificar_liberacion`)

## 6. Frontend - Reflejar estado_toma en Panel del día / Orden abierta

- [x] 6.1 (redefinida tras aprobación del usuario) En `hoy.js` (Panel del día): cada fila de orden suma un toggle (chevron, `aria-expanded`/`aria-controls`, separado del click-to-abrir-orden con `stopPropagation`) que expande una fila con el detalle de sus servicios — nombre + badge de `estado_toma` ("Disponible" | "Tomada por &lt;asignado_a_nombre&gt;" | "Completada" | "Liberada"). Reusa el detalle de orden que `hoy.js` ya pedía por N+1 (sin request nuevo). Colapsada por defecto. Asignación directa a un gestor específico queda fuera de alcance (ver design.md, decisión 6) — es un change separado
- [x] 6.2 En `orden-abierta.js`: badge de `estado_toma` en la última columna (ya vacía) de cada línea de servicio, con `ESTADO_TOMA_PILL`/`estadoTomaLabel` (`core/format.js`, compartido con `hoy.js`; clases `av-pill` existentes, sin CSS nuevo). Muestra "Tomada por &lt;asignado_a_nombre&gt;" cuando corresponde
- [x] 6.3 `core/notificaciones.js` detecta `SERVICIO_TOMADO`/`SERVICIO_LIBERADO` nuevos en su polling de 60s (sin WebSockets) y emite `av:notificacion-empuje`; `consultorio.js` lo escucha y muestra un toast con el cuerpo. No hay una vista de "mis órdenes" propia de `consultorio.js` para refrescar (esa es el Panel del día filtrado por `veterinario_id` en `hoy.js`) — se documentó como límite, no se inventó una

## 7. Frontend - Botón de liberación en bandeja del gestor

- [x] 7.1 El botón "Liberar" vive en `bandeja-gestor.js` (pantalla-encargado real), no en `hoy.js` (que no tiene botones por servicio) — corrección del orquestador aplicada. Se muestra junto a "Cargar resultado" cuando `estado === 'EN_PROCESO' && asignado_a_id === current_user.id`
- [x] 7.2 Click → `POST /api/servicios/{id}/liberar` → `loadBandejaGestor()` refresca bandeja (badge, filtros, cola, detalle)

## 8. Tests E2E

- [x] 8.1 Crear `e2e/toma-exclusiva-servicio-gestor.spec.js`:
  - Gestor A toma servicio → estado_toma = "tomada", asignado_a_id = A
  - Gestor B intenta tomar → 409
  - Gestor A libera → estado_toma = "liberada", asignado_a_id = NULL
  - Gestor B toma → estado_toma = "tomada", asignado_a_id = B
  - Admin libera → ok
  - Veterinario recibe notificación al tomar (y no se autonotifica si toma su propia orden)
  - 409 liberar por no-dueño / por estado incorrecto, 403 por rol
  - `estado_toma` en `disponible|tomada|completada` vía `GET /api/ordenes/{id}` y la respuesta directa de los endpoints
  - `asignado_a_nombre` presente solo mientras está tomada (tarea 6.1)
  - UI: Panel del día expande una orden y muestra "Tomada por &lt;gestor&gt;" (tarea 6.1)
- [x] 8.2 Verificar que pasa completo — `npx playwright test e2e/toma-exclusiva-servicio-gestor.spec.js`: **13/13 passed**. También se corrieron `despacho.spec.js` (11/11), `ordenes.spec.js` + `orden-veterinario-y-tutores.spec.js` (36/36) e `inicio-marca.spec.js` (2/2) sin regresiones