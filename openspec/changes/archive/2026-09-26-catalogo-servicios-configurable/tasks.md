# Tasks

## 1. Formulario de servicio

- [x] 1.1 Sumar al modal de servicio la categoría "Otra…" con texto libre, el select de área y el de adjunto, y mandarlos en el alta y la edición; verificar con el test de 2.3

## 2. Costo y precio base

- [x] 2.1 Agregar `GET /api/catalogo/{id}/costo` en `routers/catalogo.py`; verificar con el test de 2.3
- [x] 2.2 Mostrar el costo de insumos en el detalle del servicio con el botón "Usar como precio base"; verificar con el test de 2.3
- [x] 2.3 Crear `e2e/catalogo-servicios-configurable.spec.js`: categoría nueva, área y adjunto guardados, costo de receta calculado por unidad base, y precio base aplicado desde la UI; verificar que pasa
