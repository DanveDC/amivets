# Spec Delta

## Purpose

El administrador puede armar cualquier servicio de la clínica desde el catálogo: nombre, categoría nueva o existente, área que lo ejecuta, exigencia de adjunto, insumos por defecto y un precio base calculado desde el costo de esos insumos.

## ADDED Requirements

### Requirement: Categoría nueva o existente

The service form SHALL let the admin choose an existing category or type a new one, and SHALL save the service under it.

#### Scenario: Crear un servicio en una categoría nueva
- **WHEN** el admin crea un servicio con la categoría nueva "HOSPITALIZACION FELINA"
- **THEN** el servicio queda guardado con esa categoría y la categoría aparece en el filtro del catálogo

### Requirement: Área y adjunto del servicio

The service form SHALL let the admin choose the executing area (or none) and whether a result attachment is required, and SHALL save both.

#### Scenario: Servicio con área
- **WHEN** el admin crea un servicio eligiendo el área "Laboratorio" y exigiendo adjunto
- **THEN** el servicio queda con esa área y con adjunto obligatorio

### Requirement: Costo de insumos y precio base

The system SHALL expose `GET /api/catalogo/{id}/costo`, returning the cost of the recipe materials (sum of recipe quantity × material price per base unit) and one line per material. The service detail SHALL show that cost and offer to use it as the base price.

#### Scenario: Costo de la receta
- **WHEN** un servicio tiene en su receta 50 ml de un material cuyo envase de 1000 ml cuesta 20
- **THEN** `GET /api/catalogo/{id}/costo` devuelve un costo total de 1.00

#### Scenario: Usar el costo como precio base
- **WHEN** el admin pulsa "Usar como precio base" en el detalle del servicio
- **THEN** el precio de referencia del servicio pasa a ser el costo de insumos
