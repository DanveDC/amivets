# areas-y-gestores Specification

## Purpose
El administrador crea las cuentas de los encargados, define las áreas de trabajo, asigna gestores y servicios a cada área y fija qué dato exige el resultado, para que el trabajo llegue a la bandeja correcta.

## Requirements

### Requirement: Roles completos al crear usuarios

The user creation and edit forms SHALL offer the roles admin, veterinario, recepcionista and gestor.

#### Scenario: Crear un gestor
- **WHEN** el admin crea un usuario eligiendo el rol "Gestor de área"
- **THEN** el usuario queda con rol gestor y al iniciar sesión entra a su bandeja

### Requirement: Administrar áreas

The system SHALL offer the admin an "Áreas y gestores" screen to create areas (name, code, whether a result attachment is required), edit them and deactivate them.

#### Scenario: Crear un área
- **WHEN** el admin crea el área "Laboratorio" con código "LAB" que exige adjunto
- **THEN** el área aparece en la lista, activa y con adjunto obligatorio

### Requirement: Asignar gestores a un área

The screen SHALL list the managers of each area and let the admin add an active gestor or veterinarian and remove one. The system SHALL expose `GET /api/areas/{id}/gestores`.

#### Scenario: Asignar un gestor
- **WHEN** el admin agrega un gestor al área "Laboratorio"
- **THEN** el gestor aparece en la lista del área y los servicios confirmados de esa área llegan a su bandeja

### Requirement: Servicios despachados por el área

The screen SHALL list the catalog services dispatched by each area and let the admin assign an unassigned service to the area or remove it.

#### Scenario: Asignar un servicio al área
- **WHEN** el admin asigna el servicio "Hemograma" al área "Laboratorio"
- **THEN** al confirmar una orden con "Hemograma", el servicio queda asignado a los gestores de Laboratorio

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

### Requirement: Gestores elegibles de un área

The system SHALL expose `GET /api/areas/{id}/gestores-activos` to `admin` and `veterinario`, returning only the active users who manage that area (id and username), ordered by username. It MUST return 404 for an area that does not exist and 403 for any other role.

#### Scenario: Listar candidatos
- **WHEN** un veterinario consulta los gestores activos del área "Imagen", que tiene un gestor activo A y un gestor inactivo B
- **THEN** recibe solo a A

#### Scenario: Rol sin permiso
- **WHEN** un gestor o un recepcionista consulta `GET /api/areas/{id}/gestores-activos`
- **THEN** la respuesta es 403

### Requirement: Servicio asignado directamente a un gestor

A service dispatched directly to a manager SHALL appear only in that manager's queue among the area's managers: the other managers of the area MUST NOT see it in their queue and MUST NOT be able to take it. Only the assigned manager or an admin SHALL be able to take it, and the check MUST hold under concurrent requests (two simultaneous take attempts never both succeed, and a non-assigned manager never succeeds). An admin SHALL keep seeing and taking any service.

#### Scenario: Solo el asignado lo ve
- **WHEN** un servicio del área "Imagen" se despachó directamente al gestor A, y B también gestiona "Imagen"
- **THEN** el servicio aparece en la bandeja de A
- **AND** no aparece en la bandeja de B

#### Scenario: Otro gestor intenta tomarlo
- **WHEN** B envía `POST /api/servicios/{id}/tomar` sobre ese servicio
- **THEN** la respuesta es 409 con un mensaje que indica que está asignado a otro gestor
- **AND** el servicio sigue `ASIGNADO`, sin tomar y asignado a A

#### Scenario: El asignado lo toma
- **WHEN** A envía `POST /api/servicios/{id}/tomar` sobre ese servicio
- **THEN** el servicio pasa a `EN_PROCESO` tomado por A y A puede cargar su resultado

#### Scenario: El admin conserva sus poderes
- **WHEN** un admin consulta la bandeja del área o toma ese servicio
- **THEN** lo ve y puede tomarlo

#### Scenario: Servicio despachado al área sigue igual
- **WHEN** un servicio del área se despachó sin elegir gestor
- **THEN** aparece en la bandeja de todos los gestores del área y lo toma el primero que lo pida

### Requirement: Liberar un servicio asignado directamente lo devuelve al área

When the manager to whom a service was dispatched directly (or an admin) releases it with `POST /api/servicios/{id}/liberar`, the system SHALL clear the direct assignment, so the service returns to `ASIGNADO` available to any manager of its area, and SHALL keep recording who released it and when.

#### Scenario: El asignado libera
- **WHEN** A, a quien se le asignó directamente el servicio y lo tomó, lo libera
- **THEN** el servicio queda `ASIGNADO`, sin gestor asignado y sin asignación directa
- **AND** aparece en la bandeja de B y B puede tomarlo
- **AND** el servicio registra la fecha de liberación y que lo liberó A

### Requirement: Asignado frente a tomado en la interfaz

Every service response SHALL include the directly assigned manager (`asignado_directo_a_id`, `asignado_directo_a_nombre`) when there is one, and `estado_toma` SHALL be `asignada` for an `ASIGNADO` service with a direct assignment that nobody has taken yet. The open order, the day panel's expandable order rows and the manager's queue SHALL show "Asignado a <gestor>" for a directly assigned service (pending or in progress by that manager) and "Tomada por <gestor>" for a service a manager took from the area's pool. Names coming from the server MUST be escaped.

#### Scenario: Badge de asignación directa
- **WHEN** se abre una orden con un servicio despachado directamente al gestor "ana" y todavía no tomado
- **THEN** la línea del servicio muestra "Asignado a ana"

#### Scenario: Badge de toma libre
- **WHEN** un servicio despachado al área lo tomó el gestor "beto"
- **THEN** la línea del servicio muestra "Tomada por beto"

#### Scenario: El asignado ya lo está trabajando
- **WHEN** "ana" tomó el servicio que se le asignó directamente
- **THEN** la línea sigue mostrando "Asignado a ana", indicando que está en proceso

#### Scenario: Elegir gestor en la orden abierta
- **WHEN** un veterinario abre una orden con un servicio `SOLICITADO` de un área
- **THEN** la línea ofrece elegir "Cualquier gestor del área" o uno de los gestores activos de esa área antes de "Confirmar servicios"
- **AND** al confirmar, el servicio queda asignado según lo elegido
