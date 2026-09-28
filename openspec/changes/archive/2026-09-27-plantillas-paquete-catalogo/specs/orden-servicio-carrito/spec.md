# Spec Delta

## ADDED Requirements

### Requirement: Un paquete del catálogo no se anexa como línea suelta

Every endpoint that creates or re-points a service line from the catalog — `POST /api/ordenes/{id}/servicios`, `POST /api/consultas/{id}/servicios`, `POST /api/servicios/` and `PATCH /api/servicios/{id}` when it changes `catalogo_servicio_id` — MUST reject with 422 a `catalogo_servicio_id` that is a catalog item flagged as package (`es_paquete = true`), without creating or changing any line, and the error MUST point to `POST /api/ordenes/{id}/paquetes`. Requests without `catalogo_servicio_id`, or with a catalog item that is not a package, SHALL behave as before, including `es_base` and `servicio_padre_id`.

#### Scenario: Anexar un paquete por el endpoint de servicios
- **WHEN** se envía `POST /api/ordenes/{id}/servicios` con el `catalogo_servicio_id` de un paquete
- **THEN** la respuesta es 422 y la orden no cambia

#### Scenario: Otros caminos de alta
- **WHEN** se envía el `catalogo_servicio_id` de un paquete a `POST /api/consultas/{id}/servicios`, a `POST /api/servicios/`, o en un `PATCH /api/servicios/{id}` de una línea existente
- **THEN** la respuesta es 422 y no se crea ni se modifica ninguna línea

#### Scenario: Paquete armado a mano sigue funcionando
- **WHEN** se anexa un servicio de catálogo que no es paquete con `es_base=true` y después otro con `servicio_padre_id` igual a esa base
- **THEN** ambos se crean como antes
