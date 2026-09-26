# Proposal

## Why

Para armar los servicios que ofrece la clínica (hospitalización, cirugía, estética, etc.) hoy falta: crear categorías nuevas (la lista está fija en el formulario), elegir qué área ejecuta el servicio y si exige adjunto, y ver cuánto cuestan los insumos de la receta para fijar el precio. El backend ya acepta área y adjunto; la pantalla no los ofrece.

## What Changes

- El formulario de servicio permite elegir una categoría existente o escribir una nueva.
- El formulario permite elegir el área que ejecuta el servicio (o "Sin despacho") y si exige adjunto.
- Nuevo `GET /api/catalogo/{id}/costo`: costo de los insumos de la receta, calculado del precio de cada material por unidad base.
- El detalle del servicio muestra el costo de insumos y un botón "Usar como precio base" que lo carga en el precio de referencia (con registro en el historial de precios).

## Capabilities

### New Capabilities
- `catalogo-servicios-configurable`: armado completo de servicios del catálogo (categoría, área, adjunto, insumos por defecto y precio base desde el costo).

### Modified Capabilities
*(Ninguna.)*

## Impact

- Backend: `routers/catalogo.py` (`/costo`), schema de respuesta.
- Frontend: `catalogo.js`, modal de servicio en `index.html`.
- Test: `e2e/catalogo-servicios-configurable.spec.js`.
