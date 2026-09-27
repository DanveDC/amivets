# Proposal

## Why

Hoy el despacho de un servicio va solo al ÁREA: `orden_service.confirmar_servicios` deja el servicio `ASIGNADO` con `asignado_a_id` NULL, `notificacion_service.notificar_asignacion` avisa a todos los gestores activos del área y el primero que lo toma (`routers/servicios.py::tomar_servicio`) se lo apropia. Quien confirma la orden no tiene forma de decir "esto lo hace tal persona", aunque muchas veces ya lo sabe (el ecografista de turno, la peluquera que conoce a la mascota). El change anterior (`toma-exclusiva-servicio-gestor`, design.md decisión 6) dejó explícitamente fuera de alcance esta asignación directa y la derivó a un change separado: este.

## What Changes

- **Elección al confirmar**: `POST /api/ordenes/{id}/confirmar` acepta un cuerpo opcional con, por cada servicio `SOLICITADO` con área, un gestor destino. Sin cuerpo (o sin entrada para un servicio) el comportamiento es el actual: "área → cualquier gestor". Siguen confirmando los mismos roles (`admin`, `veterinario`).
- **Validación server-side**: el gestor elegido tiene que ser miembro del área del servicio (`GestorArea`) y estar activo (`Usuario.is_active`); si no, 422 y no se confirma nada (la confirmación es atómica).
- **Exclusividad del asignado**: un servicio asignado directamente solo aparece en la bandeja de ese gestor y solo él (o un admin) puede tomarlo; el resto del área no lo ve y recibe 409 si intenta tomarlo, con el mismo `UPDATE` condicional race-safe que `tomar_servicio`.
- **Notificación dirigida**: `SERVICIO_ASIGNADO` se crea solo para el gestor elegido, no para toda el área.
- **Liberar devuelve al área**: si el gestor asignado libera el servicio (`POST /api/servicios/{id}/liberar`, ya existente), la asignación directa se borra y el servicio queda disponible para cualquier gestor del área; se conserva la auditoría `liberado_at` / `liberado_por_id`.
- **Candidatos para el selector**: nuevo `GET /api/areas/{id}/gestores-activos` para `admin` y `veterinario` (hoy `GET /api/areas/{id}/gestores` es solo admin y el veterinario es quien confirma).
- **UI**: la orden abierta ofrece, por cada servicio pendiente con área, un selector "Cualquier gestor del área" / gestor concreto antes de "Confirmar servicios". Los badges distinguen "Asignado a <gestor>" (directo) de "Tomada por <gestor>" (auto-tomado) en orden abierta, Panel del día (filas expandibles) y la bandeja del gestor.
- **Fuera de alcance**: reasignar un servicio después del despacho (ni siquiera el admin, salvo liberando); cambios en roles o permisos fuera de lo descrito.

## Capabilities

### New Capabilities
- (ninguna)

### Modified Capabilities
- `orden-servicio-carrito`: "Confirmar la orden" pasa a aceptar un gestor destino por servicio y a notificar solo a ese gestor cuando lo hay.
- `areas-y-gestores`: se agregan la visibilidad/toma exclusiva de un servicio asignado directamente, su vuelta al área al liberarse, el listado de gestores activos elegibles y la distinción "Asignado a" / "Tomada por" en la UI.

## Impact

- Backend: `backend/app/models/models.py` (`ServicioConsulta`, columna nueva), migración Alembic nueva sobre `d3e4f5a6b7c8`, `backend/app/schemas/schemas.py` (`ServicioConsultaResponse`, schema del cuerpo de confirmar), `backend/app/services/orden_service.py::confirmar_servicios`, `backend/app/services/notificacion_service.py::notificar_asignacion`, `backend/app/routers/ordenes.py::confirmar_servicios`, `backend/app/routers/servicios.py` (`tomar_servicio`, `liberar_servicio`, `listar_bandeja`), `backend/app/routers/areas.py` (endpoint nuevo).
- Frontend: `static/js/sections/orden-abierta.js`, `static/js/core/format.js`, `static/js/sections/hoy.js`, `static/js/sections/bandeja-gestor.js`.
- Compatibilidad: el cuerpo de confirmar es opcional; clientes actuales (incluido `e2e/helpers.js::confirmarServiciosOrden`) siguen funcionando igual.
- Dependencia de orden: este change se apoya en `toma-exclusiva-servicio-gestor` (aún sin archivar); conviene archivar ese primero.
- Tests: `e2e/asignacion-directa-servicio-gestor.spec.js` (Playwright, API vía `request` + UI), sin pytest.
