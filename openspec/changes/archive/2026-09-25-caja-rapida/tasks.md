# Tasks

## 1. Venta rápida (backend)

- [x] 1.1 Agregar a `backend/app/schemas/schemas.py` los schemas `VentaRapidaItem` (`tipo: Literal["PRODUCTO","SERVICIO"]`, `id`, `cantidad: conint(ge=1)`, `precio_unitario` opcional), `VentaRapidaCreate` (`propietario_id` opcional, `metodo_pago: Literal[...]`, `items` con `min_length=1`) e `ItemCajaResponse`; verificar que el backend recarga sin errores (`docker logs veterinaria_backend`)
- [x] 1.2 Crear `backend/app/services/caja_rapida_service.py` con `obtener_consumidor_final` (get-or-create por cédula `CONSUMIDOR-FINAL` con `ON CONFLICT DO NOTHING`) y `registrar_venta`: validación previa con 409 (producto activo `PRODUCTO` con stock, bloqueado en orden de id y sumando repetidos; servicio activo sin área), precios del maestro (precio del cliente solo con `precio_variable`, obligatorio > 0 o 422), orden `origen="CAJA_RAPIDA"` sin mascota, servicios `EJECUTADO` con `consumir_para_servicio`, `orden.estado="FACTURADA"` antes de delegar en `crear_factura` con `total_pagado = total` (un solo commit); verificar con los tests de 1.4
- [x] 1.3 Crear `backend/app/routers/caja_rapida.py` (prefijo `/api/caja-rapida`, roles admin/recepcionista) con `POST /ventas` (201, `FacturaResponse`) y `GET /items?q=&limit=`, y registrarlo en `backend/app/main.py`; verificar que `/docs` lista ambos endpoints
- [x] 1.4 Sumar los helpers `ventaRapida` y `buscarItemsCaja` a `e2e/helpers.js` y crear `e2e/caja-rapida.spec.js` con los escenarios de la spec: venta de producto + servicio (factura `PAGADA`, stock baja, orden `FACTURADA` con origen `CAJA_RAPIDA`), sin ítems (422), método inválido (422), atomicidad con un producto sin stock (409, nada persistido), consumidor final reutilizado, cliente existente, cliente inexistente (404), servicio con área y material rechazados (409), precio manipulado ignorado, precio variable (usado y faltante → 422), consumo de receta, anular devuelve stock, búsqueda (incluye producto, excluye material y servicio con área) y roles (veterinario 403, sin token 401); verificar que `npx playwright test e2e/caja-rapida.spec.js` pasa

## 2. Pantalla de caja rápida (frontend)

- [x] 2.1 Agregar `sec-caja-rapida` a `static/templates/index.html` (buscador, resultados, carrito con cantidad/subtotal/total, radios de método de pago, botón "Cobrar y emitir" y panel de confirmación con número de factura y PDF), reutilizando las clases de estilo existentes; verificar que la sección existe en el DOM
- [x] 2.2 Crear `static/js/sections/caja-rapida.js`: búsqueda con `debounce` contra `/caja-rapida/items`, carrito en memoria, precio editable solo en servicios de precio variable, "Cobrar y emitir" con `submitWithLoading` contra `POST /caja-rapida/ventas`, éxito (confirmación, `exportarFacturaPDF`, carrito vacío) y error (mensaje escapado, el carrito se conserva); todo texto del servidor pasa por `escapeHtml`; verificar con el test de 2.4
- [x] 2.3 Registrar la sección en `static/js/core/router.js` (`SECTIONS` con roles admin/recepcionista y `init`, `sectionIds` y `cta` del módulo Facturación) y exponer en `app.js` lo que usen los `onclick`; verificar que el lanzador de Facturación muestra "Caja rápida" a una recepcionista y no a un veterinario
- [x] 2.4 Sumar a `e2e/caja-rapida.spec.js` un test de UI: la recepcionista busca un producto, lo agrega, cobra en efectivo, ve el número de factura y el carrito queda vacío; y otro donde la venta falla por stock y el carrito conserva el ítem; verificar que `npx playwright test e2e/caja-rapida.spec.js` pasa

## 3. Integración

- [x] 3.1 Correr la suite e2e completa en dos tandas (para evitar flakes por recursos del host) y verificar que no hay regresiones, sobre todo en `shell.spec.js`, `ordenes.spec.js` y los specs de facturación e inventario
