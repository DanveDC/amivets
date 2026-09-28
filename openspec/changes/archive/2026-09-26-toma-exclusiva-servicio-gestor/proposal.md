# Proposal

## Why

- Cuando un gestor toma una orden en `tomar_orden`, no hay bloqueo exclusivo: varios gestores del mismo área pueden ver la orden como disponible y tomarla simultáneamente, generando conflictos de asignación.
- No existe un estado "tomada" visible en el router de órdenes: la respuesta no refleja que la orden ya fue asignada a un gestor.
- No hay forma de liberar una orden tomada: si un gestor toma una orden por error o necesita reasignarla, no existe endpoint para resetear `asignado_a_id` a NULL y permitir nueva toma.
- El veterinario asignado no recibe automáticamente los datos de la orden tomada para comenzar a trabajar.

## What Changes

- **Toma exclusiva en `tomar_orden`:** al tomar una orden, el endpoint bloquea `asignado_a_id` para los demás gestores del mismo área. Solo el gestor que la tomó (o un admin) puede liberarla.
- **Estado "tomada" en respuesta:** el router de órdenes devuelve `estado: "tomada"` y `asignado_a_id` cuando la orden ya tiene gestor asignado.
- **Endpoint de liberación:** nuevo `POST /api/servicios/{id}/liberar` que resetea `asignado_a_id` a NULL, cambia el estado a `ASIGNADO` (disponible) y permite nueva toma por cualquier gestor del área.
- **Transición CANCELADA/LIBERADA:** se agrega campo `liberado` (boolean) o transición de estado `CANCELADA` en el servicio para auditoría.
- **Datos al veterinario:** al tomar la orden, el veterinario asignado recibe la orden completa con datos del paciente, tutor, motivo y servicios.

## Capabilities

### New Capabilities
- `toma-exclusiva-servicio-gestor`: lógica de toma exclusiva por gestor, liberación de órdenes, y notificación al veterinario.

### Modified Capabilities
- `orden-servicio-carrito`: el router de órdenes ahora refleja estado "tomada" y `asignado_a_id`.
- `areas-y-gestores`: validación de pertenencia al área al tomar/liberar.

## Impact

- Frontend: `hoy.js` (tomar orden), `orden-abierta.js` (mostrar estado tomada), `consultorio.js` (veterinario recibe orden).
- Backend: nuevo endpoint `POST /api/servicios/{id}/liberar`, cambios en `tomar_orden`, nuevos campos en respuesta de órdenes.
- Base de datos: posible migración para campo `liberado` o estado `CANCELADA` en servicios/órdenes.
- Tests: `e2e/toma-exclusiva-servicio-gestor.spec.js`.