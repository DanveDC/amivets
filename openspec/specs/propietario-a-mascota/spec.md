# propietario-a-mascota Specification

## Purpose
Después de dar de alta un propietario, el sistema lleva directamente al alta de su mascota con el propietario ya elegido.

## Requirements

### Requirement: Del propietario nuevo a su mascota

After a new owner is saved, the system SHALL open the new-pet form with that owner preselected.

#### Scenario: Crear propietario y seguir con la mascota
- **WHEN** la recepcionista guarda un propietario nuevo
- **THEN** se abre el formulario de nueva mascota con ese propietario elegido
- **AND** al guardar la mascota queda asociada a ese propietario
