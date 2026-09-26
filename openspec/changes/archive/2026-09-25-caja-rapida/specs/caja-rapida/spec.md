# Spec Delta

## Purpose

La caja rápida permite vender en el mostrador productos de inventario y servicios del catálogo sin registrar al cliente, emitiendo la factura ya cobrada en un solo paso.

## ADDED Requirements

### Requirement: Venta rápida en un solo paso

The system SHALL expose `POST /api/caja-rapida/ventas`, which receives a list of items (each one either an inventory product or a catalog service, with a quantity), a payment method and an optional `propietario_id`, and in a single atomic operation issues an invoice with one line per item, fully paid (`total_pagado` equal to the total, state `PAGADA`) with the given payment method. If any item is rejected, nothing SHALL be persisted: no invoice, no stock movement, no order and no service.

#### Scenario: Venta de un producto y un servicio
- **WHEN** se envía una venta con un producto de inventario (cantidad 2) y un servicio del catálogo sin área (cantidad 1), con método de pago `EFECTIVO`
- **THEN** la respuesta es 201 con una factura `PAGADA` de dos líneas, `total_pagado` igual al total y `saldo_pendiente` 0
- **AND** el stock del producto baja en 2

#### Scenario: Venta sin ítems
- **WHEN** se envía una venta con la lista de ítems vacía
- **THEN** la respuesta es 422 y no se crea ninguna factura

#### Scenario: Falla un ítem y no queda nada a medias
- **WHEN** se envía una venta con un producto válido y otro sin stock suficiente
- **THEN** la respuesta es 409, no se crea ninguna factura y el stock del producto válido no cambia

#### Scenario: Método de pago obligatorio
- **WHEN** se envía una venta sin método de pago o con un método que no está entre los aceptados (`EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, `MULTIPLE`)
- **THEN** la respuesta es 422 y no se crea ninguna factura

### Requirement: Venta sin cliente registrado

The system SHALL bill a sale without `propietario_id` to a single system owner named "Consumidor final", creating it the first time it is needed and reusing it afterwards. When a valid `propietario_id` is sent, the invoice SHALL be issued to that owner instead.

#### Scenario: Venta sin cliente
- **WHEN** se envía una venta sin `propietario_id`
- **THEN** la factura queda a nombre de "Consumidor final"

#### Scenario: Siempre el mismo consumidor final
- **WHEN** se hacen dos ventas seguidas sin `propietario_id`
- **THEN** ambas facturas apuntan al mismo propietario "Consumidor final"

#### Scenario: Venta a un cliente existente
- **WHEN** se envía una venta con el `propietario_id` de un propietario existente
- **THEN** la factura queda a nombre de ese propietario

#### Scenario: Cliente inexistente
- **WHEN** se envía una venta con un `propietario_id` que no existe
- **THEN** la respuesta es 404 y no se crea ninguna factura

### Requirement: Solo ítems vendibles en mostrador

The system SHALL accept only active inventory items of type `PRODUCTO` with enough stock, and active catalog services without a dispatch area. Materials (`MATERIAL`), inactive items and catalog services that have an area SHALL be rejected with 409 and a message naming the item.

#### Scenario: Servicio con área rechazado
- **WHEN** se envía una venta con un servicio del catálogo que tiene área de despacho
- **THEN** la respuesta es 409 con un mensaje que nombra el servicio, y no se crea ninguna factura

#### Scenario: Material rechazado
- **WHEN** se envía una venta con un ítem de inventario de tipo `MATERIAL`
- **THEN** la respuesta es 409 y no se crea ninguna factura

#### Scenario: Stock insuficiente
- **WHEN** se envía una venta con un producto cuya cantidad supera su stock
- **THEN** la respuesta es 409 con un mensaje que nombra el producto y su stock disponible

### Requirement: Precios del maestro

The system SHALL price every line from the master data (the product's list price or the service's reference price) and SHALL ignore any price sent by the client, except for catalog services marked as variable-price, where a client price greater than 0 is required and used.

#### Scenario: Precio manipulado ignorado
- **WHEN** se envía una venta con un producto y un `precio_unitario` distinto del de lista
- **THEN** la línea de la factura usa el precio de lista del producto

#### Scenario: Servicio de precio variable
- **WHEN** se envía una venta con un servicio de precio variable y un `precio_unitario` de 3500
- **THEN** la línea de la factura usa 3500

#### Scenario: Servicio de precio variable sin precio
- **WHEN** se envía una venta con un servicio de precio variable sin `precio_unitario` o con 0
- **THEN** la respuesta es 422 y no se crea ninguna factura

### Requirement: Trazabilidad de la venta

The system SHALL record every quick sale as a service order in state `FACTURADA`, with the catalog services as executed lines consuming their materials, and each product sale as an inventory exit movement. Cancelling the invoice SHALL return the products to stock, as with any other invoice.

#### Scenario: Consumo de materiales del servicio
- **WHEN** se vende un servicio del catálogo que tiene una receta de materiales
- **THEN** el stock de esos materiales baja según la receta

#### Scenario: La venta queda como orden facturada
- **WHEN** se completa una venta rápida
- **THEN** existe una orden del propietario de la factura, en estado `FACTURADA`, con los servicios vendidos en estado facturado

#### Scenario: Anular devuelve el stock
- **WHEN** un admin anula la factura de una venta rápida
- **THEN** el stock de los productos vendidos vuelve a su valor anterior a la venta

### Requirement: Búsqueda de ítems vendibles

The system SHALL expose `GET /api/caja-rapida/items?q=<texto>`, returning in a single list the sellable products and services whose name or code match the text, each with its kind (product or service), name, price, whether the price is variable, and for products the available stock.

#### Scenario: Buscar por nombre
- **WHEN** se consulta `GET /api/caja-rapida/items?q=alim` y hay un producto "Alimento adulto" y un material "Alimento para sonda"
- **THEN** la respuesta incluye el producto con su precio y stock, y no incluye el material

#### Scenario: Servicio con área no aparece
- **WHEN** se busca por el nombre de un servicio del catálogo que tiene área
- **THEN** ese servicio no aparece en el resultado

### Requirement: Acceso restringido

Both quick-sale endpoints SHALL be available only to the `admin` and `recepcionista` roles.

#### Scenario: Veterinario sin acceso
- **WHEN** un usuario con rol `veterinario` envía una venta rápida
- **THEN** la respuesta es 403 y no se crea ninguna factura

#### Scenario: Sin sesión
- **WHEN** se llama a cualquiera de los dos endpoints sin token
- **THEN** la respuesta es 401

### Requirement: Pantalla de caja rápida

The Facturación module SHALL offer a "Caja rápida" screen, for `admin` and `recepcionista`, where the user searches products and services, adds them to a cart with editable quantities, sees each subtotal and the total, picks a payment method and, with one action, issues the paid invoice. The screen SHALL not require choosing a client, SHALL show the server error without clearing the cart when the sale is rejected, and SHALL offer to download the invoice PDF after a successful sale and then start a new empty sale.

#### Scenario: Cobrar desde la pantalla
- **WHEN** una recepcionista agrega un producto al carrito, elige `EFECTIVO` y pulsa "Cobrar y emitir"
- **THEN** ve la confirmación con el número de factura y la opción de descargar el PDF
- **AND** el carrito queda vacío para la venta siguiente

#### Scenario: Error sin perder el carrito
- **WHEN** la venta es rechazada, por ejemplo por stock insuficiente
- **THEN** la pantalla muestra el mensaje del servidor y el carrito conserva sus ítems
