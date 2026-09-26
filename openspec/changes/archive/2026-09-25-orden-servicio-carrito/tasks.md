# Tasks

## 1. Limpieza del intento previo

- [x] 1.1 Revertir a `HEAD` los cambios sin commitear de `backend/app/models/models.py` y `backend/app/services/orden_service.py` (sin `CARROLA`, sin columna `total`, sin `anadir_servicio_carrito`); verificar con `git diff --stat backend/` vacío y `rg -n "CARROLA|anadir_servicio_carrito" backend` sin resultados

## 2. Orden como carrito (backend)

- [x] 2.1 En `crear_servicio_en_orden`, dejar todo servicio en `SOLICITADO`, sin consumir inventario y sin llamar a `marcar_en_atencion`; verificar leyendo la función y con el test de 2.5
- [x] 2.2 En `confirmar_servicios`, llamar a `marcar_en_atencion(orden)` después de procesar las líneas (con o sin área), manteniendo el no-op cuando no hay `SOLICITADO`; verificar con el test de 2.5
- [x] 2.3 Agregar `total` (Σ cantidad × precio_unitario de servicios vivos no `CANCELADO`) a los schemas de respuesta de detalle y listado de la orden, sin N+1 en el listado; verificar con `GET /api/ordenes/{id}` y `GET /api/ordenes/` devolviendo `total`
- [x] 2.4 Revisar el resto de los llamados a `crear_servicio_en_orden`, `marcar_en_atencion` y el `hoy.js` que dependan de `EJECUTADO`/`EN_ATENCION` al agregar, y ajustarlos; verificar con `rg` que no queden supuestos del atajo sin área
- [x] 2.5 Actualizar `e2e/ordenes.spec.js` (reescribir el test "atajo sin despacho" de la línea ~493: el alta queda `SOLICITADO` y la orden `ABIERTA`, confirmar la pasa a `EJECUTADO` y la orden a `EN_ATENCION`; sumar escenarios de total acumulado y de servicio cancelado que no suma) y `e2e/despacho.spec.js` (recorrido feliz: alta sin notificación, confirmar notifica y pasa la orden a `EN_ATENCION`); verificar que `npx playwright test e2e/ordenes.spec.js e2e/despacho.spec.js` pasa

## 3. Facturar por orden (backend)

- [x] 3.1 Implementar `obtener_items_pendientes_orden` y `facturar_orden` en `facturacion_service.py`: lock de la orden, validación `CERRADA` e ítems (si no, 409), delegar en `crear_factura` con `consulta_id` de la orden si existe, y orden a `FACTURADA`; verificar con el test de 3.4
- [x] 3.2 Agregar `GET /api/ordenes/{id}/pendientes-facturar` y `POST /api/ordenes/{id}/facturar` (roles admin/recepcionista) con sus schemas; verificar con el test de 3.4
- [x] 3.3 En `anular_factura`, devolver a `CERRADA` la orden `FACTURADA` de los servicios de la factura; verificar con el test de 3.4
- [x] 3.4 Sumar helpers `pendientesFacturarOrden`/`facturarOrden` en `e2e/helpers.js` y tests en `e2e/ordenes.spec.js`: vista previa, facturar cerrada (queda `FACTURADA` y los servicios facturados), 409 sobre no cerrada, doble facturación (una sola factura) y anular que reabre a `CERRADA`; verificar que `npx playwright test e2e/ordenes.spec.js` pasa

## 4. Front: orden abierta como presupuesto

- [x] 4.1 En `orden-abierta.js`, sumar la columna Subtotal por línea, mostrar `orden.total` del API en el resumen y repintar tras agregar, confirmar o borrar; verificar en el navegador que agregar un servicio actualiza el total sin recargar
- [x] 4.2 Cambiar `confirmarFacturarOrden` para usar `POST /ordenes/{id}/facturar` y ofrecer "Facturar" solo con la orden `CERRADA`; verificar con un test e2e de UI (o de shell) que factura una orden cerrada desde la pantalla

## 5. Front: Facturación centrada en órdenes

- [x] 5.1 En `facturacion.js`, agregar la vista "Órdenes por cobrar" (`GET /ordenes/?estado=CERRADA`, con número, propietario, mascota, fecha y total) como vista por defecto, dejar el Historial como vista secundaria y hacer que "Cobrar" abra la orden; ajustar `router.js` (init/copy) si hace falta; verificar en el navegador que Facturación abre en órdenes por cobrar
- [x] 5.2 Quitar `facturarConsulta` y su modal de pendientes por consulta de `facturacion.js` (y sus exports/usos); verificar con `rg -n "facturarConsulta|pendientes/" static/js` sin usos
- [x] 5.3 Sumar un test e2e de UI: la orden cerrada aparece en "Órdenes por cobrar", se cobra y pasa al historial; verificar que corre en verde

## 6. Front: Historia clínica sin atajo de facturación

- [x] 6.1 Exponer `orden_id` derivado (vía `orden_de_consulta`) en la respuesta de la consulta, si todavía no lo trae; verificar con `GET /api/consultas/{id}`
- [x] 6.2 En `consultorio.js`, quitar el botón "Facturar" de la tabla y `cerrarYFacturarConsulta` con su botón, y agregar "Ir a la orden", que navega a `sec-orden-abierta`; verificar con `rg -n "from-consulta|facturarConsulta|cerrarYFacturar" static/js` sin usos
- [x] 6.3 Ajustar `e2e/servicios-desde-consulta.spec.js` y los demás specs que facturan una consulta desde la UI para que usen el flujo por orden, sin tocar los tests del endpoint de compatibilidad `from-consulta`; verificar que `npm run test:e2e` pasa completo

## 7. Integración

- [ ] 7.1 Recorrido completo en el navegador: abrir orden → agregar servicios (total en vivo) → confirmar → gestor toma y ejecuta → cerrar → cobrar desde "Órdenes por cobrar" → la orden queda `FACTURADA`; verificar sin errores en la consola
