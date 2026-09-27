# areas-y-gestores Specification (Delta)

## Purpose
Extender la gestión de áreas y gestores con lógica de toma exclusiva de servicios, liberación de órdenes tomadas y notificación al veterinario asignado.

## ADDED Requirements

### Requirement: Toma exclusiva de servicio por gestor

Cuando un gestor toma un servicio en estado `ASIGNADO` de su área, el sistema SHALL bloquear `asignado_a_id` para los demás gestores de la misma área. Solo el gestor que tomó el servicio (o un admin) puede liberarlo o completarlo.

#### Scenario: Gestor toma un servicio disponible
- **WHEN** un gestor envía `POST /api/servicios/{id}/tomar` sobre un servicio en estado `ASIGNADO` de su área
- **THEN** el servicio pasa a estado `EN_PROCESO` con `asignado_a_id` = ID del gestor
- **AND** el servicio ya no aparece disponible para otros gestores del área
- **AND** la respuesta incluye `estado: "tomada"` y los datos completos de la orden

#### Scenario: Otro gestor del área intenta tomar el mismo servicio
- **WHEN** un segundo gestor del mismo área intenta `POST /api/servicios/{id}/tomar` sobre un servicio ya tomado
- **THEN** la respuesta es 409 con error "Servicio ya tomado por otro gestor"
- **AND** el servicio permanece con el `asignado_a_id` original

#### Scenario: Admin puede tomar cualquier servicio
- **WHEN** un admin toma un servicio `ASIGNADO` de cualquier área
- **THEN** el servicio pasa a `EN_PROCESO` con `asignado_a_id` = ID del admin

### Requirement: Liberación de servicio tomado

El sistema SHALL exponer `POST /api/servicios/{id}/liberar` que resetea el servicio a estado `ASIGNADO` con `asignado_a_id` = NULL, permitiendo nueva toma por cualquier gestor del área.

#### Scenario: Gestor libera su propio servicio
- **WHEN** el gestor que tomó el servicio envía `POST /api/servicios/{id}/liberar`
- **THEN** el servicio pasa a estado `ASIGNADO` con `asignado_a_id` = NULL
- **AND** el servicio vuelve a aparecer disponible para todos los gestores del área
- **AND** se registra la transición con timestamp y usuario (campo `liberado` o estado `CANCELADA`)

#### Scenario: Admin libera cualquier servicio
- **WHEN** un admin envía `POST /api/servicios/{id}/liberar` sobre un servicio tomado
- **THEN** el servicio pasa a `ASIGNADO` con `asignado_a_id` = NULL

#### Scenario: No se puede liberar servicio no tomado
- **WHEN** se intenta liberar un servicio que no está en `EN_PROCESO` (ej. `SOLICITADO`, `EJECUTADO`)
- **THEN** la respuesta es 409 con error "Solo se pueden liberar servicios en proceso"

### Requirement: Router de órdenes refleja estado "tomada"

El endpoint `GET /api/ordenes/{id}` SHALL incluir en cada servicio el campo `estado_toma` con valores: `disponible` (ASIGNADO sin asignado_a_id), `tomada` (EN_PROCESO con asignado_a_id), `completada` (EJECUTADO), `liberada` (vuelto a ASIGNADO tras liberación). El listado `GET /api/ordenes/` SHALL seguir devolviendo solo cabeceras de orden (sin `servicios[]`), por diseño: es liviano a propósito y el Panel del día consume el detalle por orden (`GET /api/ordenes/{id}`) cuando necesita ver `estado_toma` por servicio.

#### Scenario: Ver estado de toma en la orden
- **WHEN** se consulta `GET /api/ordenes/{id}` de una orden con servicios en diferentes estados de toma
- **THEN** cada servicio incluye `estado_toma` reflejando su situación actual

#### Scenario: El listado de órdenes no expone estado_toma
- **WHEN** se consulta `GET /api/ordenes/` (listado)
- **THEN** la respuesta contiene solo cabeceras de orden, sin el arreglo `servicios[]` ni `estado_toma`
- **AND** cualquier consumidor que necesite `estado_toma` por servicio debe pedir el detalle con `GET /api/ordenes/{id}`

### Requirement: Veterinario recibe datos de la orden tomada

Cuando un gestor toma un servicio que tiene un veterinario asignado (`veterinario_id` en la orden), el sistema SHALL notificar al veterinario con los datos completos de la orden (paciente, tutor, motivo, servicios) para que pueda comenzar la atención.

#### Scenario: Notificación al veterinario al tomar servicio
- **WHEN** un gestor toma un servicio de una orden con `veterinario_id` asignado
- **THEN** el veterinario recibe notificación (push/websocket/email) con: orden_id, paciente, tutor, motivo_visita, lista de servicios
- **AND** el veterinario ve la orden en su panel con estado actualizado