# Spec Delta

## ADDED Requirements

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
