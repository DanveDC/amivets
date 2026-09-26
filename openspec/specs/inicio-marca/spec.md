# inicio-marca Specification

## Purpose
La pantalla de inicio identifica al sistema con el logo y el nombre de AmiVets, y la cabecera superior nunca muestra textos de otra sección.

## Requirements

### Requirement: Marca en la pantalla de inicio

The launcher screen SHALL show the AmiVets logo and the text "AMIVETS" with the subtitle "Sistema integral de gestión".

#### Scenario: Ver la marca al iniciar sesión
- **WHEN** un usuario inicia sesión y ve la pantalla de inicio
- **THEN** ve el logo de AmiVets y los textos "AMIVETS" y "Sistema integral de gestión"

### Requirement: Cabecera sin texto de otra sección

When the launcher is shown, the header SHALL display "AMIVETS" as title and "Sistema integral de gestión" as subtitle, regardless of which section was visited before.

#### Scenario: Volver al inicio desde otra sección
- **WHEN** el usuario entra al Panel del día y después vuelve al inicio
- **THEN** la cabecera muestra "AMIVETS" y "Sistema integral de gestión", no "Panel del día" ni su fecha
