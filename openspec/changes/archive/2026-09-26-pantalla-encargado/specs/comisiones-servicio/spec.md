# Spec Delta

## ADDED Requirements

### Requirement: El encargado lista sus liquidaciones

The system SHALL expose `GET /api/comisiones/mias/liquidaciones` to `veterinario` and `gestor`, returning only the current user's commission liquidations, newest first, with their number, period, totals and lines.

#### Scenario: Ver mis liquidaciones
- **WHEN** un gestor con dos liquidaciones consulta `GET /api/comisiones/mias/liquidaciones`
- **THEN** recibe esas dos, de la más reciente a la más antigua

#### Scenario: No ve las de otro
- **WHEN** otro encargado tiene liquidaciones
- **THEN** ninguna aparece en la respuesta del primer gestor

#### Scenario: Sin permiso
- **WHEN** un usuario con rol `recepcionista` llama al endpoint
- **THEN** la respuesta es 403
