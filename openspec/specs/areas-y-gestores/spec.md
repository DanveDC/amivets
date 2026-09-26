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
