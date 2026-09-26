# Design

## Context

- `Factura.propietario_id` es `NOT NULL`. La factura, su PDF, el historial y los reportes dan por hecho que siempre hay un propietario.
- `OrdenServicio.mascota_id` ya es opcional: el comentario del modelo dice "NULL = venta de mostrador sin paciente". La orden tiene una columna `origen` (`String(20)`, sin CHECK) y su `numero` lo genera una SEQUENCE.
- `ServicioConsulta` exige `orden_id`, mientras que `mascota_id` y `consulta_id` son opcionales.
- `FacturacionService.crear_factura` bloquea las filas de `Inventario` en orden de id, descuenta stock, registra un `MovimientoInventario` de salida, protege contra el doble submit por `servicio.facturado` y hace `db.commit()` al final. Confía en el `precio_unitario` que recibe; solo usa el de lista si llega en 0. Si falta stock responde 400.
- `consumo_service.consumir_para_servicio` descuenta los materiales de la receta de un servicio. Con `STRICT_INVENTORY` responde 400 cuando falta stock; si no, deja advertencias.
- `anular_factura` devuelve el stock de los productos y, desde `orden-servicio-carrito`, devuelve a `CERRADA` una orden `FACTURADA`.
- `Inventario.tipo_item`: `PRODUCTO` se vende directo y `MATERIAL` se consume a través de servicios.
- `CatalogoServicio.area_id` indica la estación que ejecuta el servicio. Si es NULL, el servicio no se despacha.

## Goals / Non-Goals

**Goals:**
- Vender productos y servicios en el mostrador en una sola llamada, sin registrar al cliente, con la factura emitida y cobrada.
- No inventar un segundo camino de facturación: pasar por `crear_factura` para heredar locks, movimientos de stock y numeración.
- Que la venta sea atómica: o se registra entera o no queda nada.

**Non-Goals:**
- Pagos parciales o ventas a crédito: el consumidor final no tiene cuenta a la que cobrarle un saldo.
- Descuentos o impuestos por venta: se mandan en 0, como en el resto del front.
- Vender servicios con área de despacho: necesitan que un gestor los ejecute y siguen por una orden.
- Cierre o arqueo de caja por turno.
- Cambiar `Factura.propietario_id` a opcional.

## Decisions

1. **Cliente genérico "Consumidor final" en vez de `propietario_id` nullable.** Se identifica por una cédula fija de sistema (`CONSUMIDOR-FINAL`, dentro de los 20 caracteres de `cedula`) y se obtiene o crea en `caja_rapida_service` con `INSERT ... ON CONFLICT DO NOTHING` sobre la cédula única, seguido de un `SELECT`. Así, si dos ventas crean al mismo tiempo el primer consumidor final, no aparece un duplicado ni un error. *Alternativa descartada:* volver nullable `Factura.propietario_id`. Exige una migración y tocar cada join y lectura de `factura.propietario` (PDF, historial, reportes, liquidaciones, búsqueda global).

2. **Cada venta es una orden con `origen = "CAJA_RAPIDA"`, sin mascota.** Se crea en estado `CERRADA`, los servicios se registran como `ServicioConsulta` en `EJECUTADO` con `catalogo_servicio_id`, `area_id = NULL` y `origen = "CAJA_RAPIDA"`, y se consumen sus materiales con `consumir_para_servicio`. Al final la orden queda `FACTURADA`. Así los reportes de servicios, el consumo de materiales y la anulación (que reabre la orden) funcionan sin casos especiales. *Alternativa descartada:* facturar los servicios como líneas sueltas sin `ServicioConsulta`. Perdería el consumo de la receta y los reportes por servicio.

3. **Los productos van como líneas `producto_id` de la factura, no como servicios.** `crear_factura` ya descuenta el stock y registra la salida (`origen_destino = VENTA_<n>`). Anular la factura ya devuelve ese stock.

4. **Una sola transacción, con un único commit.** `caja_rapida_service.registrar_venta` valida todo y crea la orden y los servicios con `flush`, sin commit. Pone `orden.estado = "FACTURADA"` **antes** de llamar a `crear_factura`, cuyo `db.commit()` confirma todo junto. Si algo falla, `crear_factura` hace rollback de toda la sesión, así que no queda una orden huérfana. *Alternativa descartada:* reutilizar `facturar_orden`. Hace un segundo commit después de `crear_factura` y no sabe de líneas de producto.

5. **Validación previa con 409 y precios del servidor.** Antes de escribir nada, el servicio:
   - carga y bloquea (`FOR UPDATE`, en orden de id) los `Inventario` pedidos, y valida `activo`, `tipo_item == "PRODUCTO"` y stock;
   - carga los `CatalogoServicio`, y valida `activo` y `area_id IS NULL`;
   - responde 409 nombrando el ítem, en vez del 400 que da `crear_factura`.

   Suma las cantidades si el mismo producto aparece dos veces. El `precio_unitario` de cada línea lo fija el servidor desde el maestro. El del cliente solo se usa en servicios con `precio_variable`, y ahí es obligatorio que sea mayor a 0 (si no, 422). El consumo de materiales usa el `STRICT_INVENTORY` vigente, igual que en una orden.

6. **Cobro completo obligatorio.** El schema `VentaRapidaCreate` exige `metodo_pago` (`Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MULTIPLE"]`, los mismos valores del front) y el servicio pone `total_pagado = total`. La factura sale `PAGADA`. Cantidades: `conint(ge=1)` y `min_length=1` en la lista de ítems.

7. **API.** Nuevo router `routers/caja_rapida.py` con prefijo `/api/caja-rapida`, roles `admin` y `recepcionista` (los mismos de `POST /api/facturas/`):
   - `POST /ventas` recibe `{propietario_id?, metodo_pago, items: [{tipo: "PRODUCTO"|"SERVICIO", id, cantidad, precio_unitario?}]}` y responde 201 con la `FacturaResponse` existente.
   - `GET /items?q=&limit=` responde una lista `[{tipo, id, nombre, codigo?, precio, precio_variable, stock?}]`: una query sobre `Inventario` y otra sobre `CatalogoServicio` con `ilike`, unidas en Python y ordenadas por nombre.

8. **Front: una sección nueva en el módulo Facturación.** `sec-caja-rapida` (`static/js/sections/caja-rapida.js`) se suma a `SECTIONS` y a los `sectionIds` del módulo 5 en `router.js`. La pantalla tiene:
   - un buscador con `debounce` contra `/caja-rapida/items`;
   - un carrito en memoria del módulo, con cantidad editable, subtotal y total;
   - radios de método de pago, reutilizando el patrón de `#modalFacturarOrden`;
   - "Cobrar y emitir" envuelto en `submitWithLoading`, contra el doble submit.

   Cuando la venta sale bien, muestra el número de factura, ofrece `exportarFacturaPDF` y vacía el carrito. Si hay error, muestra `e.message` escapado y no toca el carrito. Todo texto que viene del servidor pasa por `escapeHtml`. Un selector opcional de propietario queda fuera de la primera versión de la UI: el API lo acepta, pero la pantalla vende siempre a consumidor final.

9. **Tests.** Siguen el patrón del proyecto: Playwright e2e contra el stack local (`e2e/caja-rapida.spec.js`) y helpers REST en `e2e/helpers.js` (`ventaRapida`, `buscarItemsCaja`). Cubren los escenarios del API y uno de UI.

## Risks / Trade-offs

- [Reportes por cliente] "Consumidor final" acumula muchas facturas y aparece como un cliente más. → Se acepta. Los reportes pueden filtrarlo por su cédula si hace falta.
- [Anulación y materiales] `anular_factura` devuelve el stock de los productos, pero no revierte el consumo de materiales de los servicios. Es igual que hoy con cualquier orden. → Se deja documentado; no es una regresión.
- [Commit dentro de `crear_factura`] La atomicidad depende de que `crear_factura` siga haciendo un único commit y un rollback ante error. → Un test de venta con un ítem inválido verifica que no quede ninguna orden ni stock movido.
- [Cantidades enteras] `DetalleFactura.cantidad` es `Integer`, así que no se venden fracciones de producto. → Se acepta; es la misma deuda que ya tiene el resto de la facturación.
- [Servicios clínicos por recepción] `POST /api/servicios/` bloquea tipos clínicos para recepcionista, pero la caja rápida no pasa por ese endpoint. → Solo se venden servicios sin área, que en la práctica son estética y afines. Si hace falta, se agrega un filtro por categoría más adelante.
