# Design

## Context

La orden ya existe en el backend y funciona así:

- `OrdenServicio` guarda el estado de la orden (CHECK: `ABIERTA`, `EN_ATENCION`, `CERRADA`, `FACTURADA`, `ANULADA`).
- Los servicios son filas de `ServicioConsulta`, con `orden_id NOT NULL` y `consulta_id` opcional.
- La consulta no tiene `orden_id`, a propósito: la orden se deriva de su línea de tipo `CONSULTA` con `orden_service.orden_de_consulta`.

Hoy:

- `crear_servicio_en_orden` deja `SOLICITADO` si el catálogo tiene área y `EJECUTADO` si no; en ese último caso consume inventario ahí mismo. Además llama a `marcar_en_atencion`.
- `confirmar_servicios` hace `SOLICITADO → ASIGNADO` (y notifica a los gestores) o `SOLICITADO → EJECUTADO` (y consume inventario). No toca el estado de la orden.
- La bandeja del gestor lista solo servicios `ASIGNADO` y `EN_PROCESO`, y `tomar` exige `ASIGNADO`.
- Facturación no conoce la orden: la factura tiene `consulta_id`, pero no `orden_id`. Los detalles apuntan a `servicio_id`. La orden nunca pasa a `FACTURADA`.
- El front de la orden (`orden-abierta.js`) arma la factura en el cliente con `POST /facturas/`. `facturacion.js` y `consultorio.js` facturan por consulta.
- Hay un diff sin commitear en `models.py` (estado `CARROLA`, columna `total`) y en `orden_service.py` (`anadir_servicio_carrito`, que referencia `GestorArea` sin importarlo).

## Goals / Non-Goals

**Goals:**
- Que la orden se comporte como carrito/presupuesto: todo servicio entra `SOLICITADO`, la orden sigue `ABIERTA` hasta confirmar y el total se ve en el API.
- Que la orden se facture completa desde el servidor y termine `FACTURADA`.
- Que el front tenga a la orden como flujo principal en Facturación, Orden abierta e Historia clínica.

**Non-Goals:**
- Facturación parcial de una orden (queda para otro cambio).
- Quitar `POST /api/facturas/from-consulta/{id}` del backend: se mantiene por compatibilidad, pero el front deja de usarlo.
- Cambiar cómo se cargan servicios clínicos dentro de una consulta en Historia clínica: la consulta se abre sobre una orden que ya está `EN_ATENCION`.
- Rediseñar visualmente las pantallas: se reutilizan componentes y estilos existentes.

## Decisions

1. **Descartar el diff sin commitear.** `models.py` y `orden_service.py` se revierten a `HEAD` (`git checkout -- <archivo>`). `CARROLA` no es un estado real de la orden, la columna `total` no tiene migración y contradice el comentario de `models.py` ("sin total guardado para evitar que orden y factura se desincronicen"), y la función no está conectada y rompe. *Alternativa descartada:* arreglar el import y agregar la migración. Sería mantener una segunda fuente de verdad del total.

2. **El total se calcula al leer, no se guarda.** Los schemas de respuesta de la orden (detalle y listado) suman un campo `total` que se calcula como Σ `cantidad × precio_unitario` sobre los servicios vivos que no están `CANCELADO`. Así no hay migración ni desincronización posible. En el listado se calcula en Python sobre los servicios ya cargados; si aparece un problema de rendimiento, se pasa a una subconsulta agregada. *Alternativa descartada:* una columna que se actualiza en cada alta. Exige mantenerla sincronizada en editar, borrar, cancelar y anular.

3. **Todo servicio entra `SOLICITADO`.** `crear_servicio_en_orden` pone siempre `estado_inicial = "SOLICITADO"`, no consume inventario y ya no llama a `marcar_en_atencion`. El atajo "sin área → `EJECUTADO`" pasa a resolverse al confirmar, donde ya existe la rama sin área.

4. **Despacho al confirmar, no al agregar.** Se mantiene `confirmar_servicios` como único punto de despacho. Despachar al agregar dejaría el servicio en `SOLICITADO`, invisible en la bandeja (que filtra `ASIGNADO`/`EN_PROCESO`) y sin poder tomarse. Esto corrige una contradicción de la spec anterior.

5. **Confirmar pasa la orden a `EN_ATENCION`.** `confirmar_servicios` llama a `marcar_en_atencion(orden)` después de procesar las líneas (es idempotente). Tomar la orden y abrirle una consulta siguen llamándolo: son formas legítimas de empezar la atención.

6. **Facturar por orden en el servidor.**
   - Nuevo `FacturacionService.obtener_items_pendientes_orden(orden_id)`: servicios vivos de la orden, no `CANCELADO`, con `facturado = False`.
   - Nuevo `facturar_orden(orden_id, usuario, metodo_pago, total_pagado)`. Lock `FOR UPDATE` sobre la orden y, adentro, delega en `crear_factura` con los detalles armados en el servidor y `consulta_id` = la consulta de la orden, si existe. Así hereda el lock determinista existente (`ServicioConsulta` por id, después `Inventario` por id) y el chequeo `facturado`, que evita cobrar dos veces. Después pone `orden.estado = "FACTURADA"`.
   - Endpoints en `routers/ordenes.py`: `GET /{id}/pendientes-facturar` y `POST /{id}/facturar`, con los mismos roles que `POST /api/facturas/` (admin, recepcionista).
   - Se valida que la orden esté `CERRADA` (si no, 409) y que haya ítems (si no, 409).

7. **Anular factura revierte la orden.** En `anular_factura`, después de desmarcar los servicios: si todos los servicios de la factura pertenecen a una orden `FACTURADA`, esa orden vuelve a `CERRADA`. La orden se obtiene por `DetalleFactura.servicio_id → ServicioConsulta.orden_id`, sin agregar `Factura.orden_id`.

8. **Front de Facturación.** `facturacion.js` suma una vista "Órdenes por cobrar", que carga `GET /api/ordenes/?estado=CERRADA` y es la vista por defecto. La vista "Historial" queda en una segunda pestaña o toggle dentro de la misma sección. "Cobrar" abre `sec-orden-abierta` sobre esa orden. Se quita `facturarConsulta` y su modal de ítems pendientes por consulta; queda el resto (abonos, PDF, historial). Se ajusta el copy del módulo en `router.js` si hace falta.

9. **Front de Orden abierta.** `pintarServicios` suma la columna Subtotal. `pintarResumen` usa `orden.total` del API (sigue `totalServicios` como fallback). `confirmarFacturarOrden` pasa a llamar a `POST /ordenes/{id}/facturar` con `metodo_pago`/`total_pagado` y solo se ofrece con la orden `CERRADA`. Después de agregar, confirmar o borrar se vuelve a llamar a `cargarOrden()`, que ya repinta todo.

10. **Front de Historia clínica.** En `consultorio.js` se quitan el botón "Facturar" de la tabla y `cerrarYFacturarConsulta` (con su botón). Se agrega "Ir a la orden", que navega a `sec-orden-abierta` con el id de la orden. El id sale de un campo `orden_id` derivado que se suma a la respuesta de la consulta (vía `orden_de_consulta`, sin columna nueva). Si la respuesta ya lo trae, se reutiliza.

11. **Tests.** El proyecto no tiene pytest; los tests son Playwright e2e contra el stack local (`npm run test:e2e`, helpers REST en `e2e/helpers.js`). Cada grupo de trabajo actualiza o agrega sus tests en `e2e/ordenes.spec.js`, `e2e/despacho.spec.js` y `e2e/servicios-desde-consulta.spec.js`, y suma helpers `facturarOrden`/`pendientesFacturarOrden`.

## Risks / Trade-offs

- [Cambio de comportamiento] Los flujos que esperaban `EJECUTADO` inmediato ahora necesitan confirmar. → El front de orden abierta ya muestra "Confirmar"; se revisa que `hoy.js` no dependa del estado `EN_ATENCION` al agregar.
- [Órdenes existentes] Las órdenes históricas ya en `EN_ATENCION` o con líneas `EJECUTADO` no cambian: la regla aplica solo a las altas nuevas.
- [Rendimiento del total en el listado] Calcularlo en Python puede disparar N+1. → Se hace con los servicios precargados (`selectinload`) o con una subconsulta agregada.
- [Anulación con varias órdenes] Una factura vieja creada a mano con servicios de más de una orden. → Solo se revierte la orden si está `FACTURADA`; el resto se ignora.
- [Tests e2e] Dependen del stack Docker levantado; si no está disponible, se reporta y los tests quedan escritos sin correr.
