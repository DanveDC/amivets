# comisiones-servicio Specification (Delta)

## MODIFIED Requirements

### Requirement: Encargado de cada servicio

The system SHALL determine the encargado of a billed service line as follows: for the consultation-fee line (`CONSULTA`), the consultation's veterinarian, or, when the line has no clinical consultation behind it (added directly to the order), the veterinarian who executed it (`asignado_a_id`); for any other line, the user who took it (`asignado_a_id`). A line without an encargado (services without area, quick-sale services) and product lines SHALL generate no commission: 100% goes to AmiVets.

#### Scenario: Servicio de área
- **WHEN** un gestor toma, ejecuta y se cobra un servicio de su área
- **THEN** la comisión de esa línea es para ese gestor

#### Scenario: Honorario de la consulta
- **WHEN** se cobra una orden con la consulta de un veterinario
- **THEN** la comisión de la línea de la consulta es para ese veterinario

#### Scenario: Honorario de una CONSULTA anexada directo
- **WHEN** se cobra una orden con una línea CONSULTA anexada directo, ejecutada por un veterinario distinto al de la orden
- **THEN** la comisión de esa línea es para el veterinario que la ejecutó
- **AND** no aparece en el control del veterinario de la orden

#### Scenario: Sin encargado
- **WHEN** se cobra un servicio sin área o un servicio vendido en caja rápida
- **THEN** esa línea no genera comisión y no aparece en el control de ningún encargado
