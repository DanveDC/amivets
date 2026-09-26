# Revisión de la rama `feature/ordenes-caja-comisiones-encargado`

Estado al 2026-09-26. La rama tiene 4 features (orden como carrito, caja rápida, comisiones por servicio, pantalla del encargado) y 3 tandas de arreglos que salieron de 3 revisiones de código. Suite e2e completa: **215 passed, 2 skipped, 0 failed**. La rama **no está subida** (sin push).

Una cuarta revisión encontró los puntos de abajo. **No están arreglados.** Quedan registrados para retomarlos antes de subir la rama o de desplegar a producción.

## Pendientes de la cuarta revisión

### Concurrencia

1. **Deadlock al vender en caja rápida.** La venta bloquea los productos en orden ascendente (`caja_rapida_service.py`, validación previa) y recién después bloquea los materiales, dentro de `consumir_para_servicio`. La anulación ya bloquea productos y materiales juntos en orden ascendente. Una venta y una anulación simultáneas que comparten producto y material pueden deadlockear, y Postgres aborta una de las dos con un 500.
   - **Arreglo:** en la venta, bloquear productos ∪ materiales de receta en una sola consulta ascendente antes de consumir.
2. **Anulación doble de la misma factura.** `anular_factura` verifica `estado != 'ANULADA'` sin bloquear la factura. Dos anulaciones simultáneas pueden devolver dos veces el stock de los productos.
   - **Arreglo:** `SELECT ... FOR UPDATE` sobre la factura y volver a chequear el estado después del lock.
3. **Carrera en "Agregar honorario a la orden".** `POST /api/consultas/{id}/honorario-en-orden` lee la orden sin `FOR UPDATE`. Si la orden se factura en ese instante, la línea del honorario queda en una orden FACTURADA y ya no se puede cobrar.
   - **Arreglo:** bloquear la orden, igual que `facturar_orden`.
4. **Doble clic en "Agregar honorario".** El endpoint no captura el `IntegrityError` del índice `uq_orden_una_consulta`, así que el segundo clic da 500 en lugar de 409.
   - **Arreglo:** capturarlo como hace `consulta_service` y responder con `orden_service.error_una_consulta_por_orden`.

### Honorario en la orden

5. **El botón aparece cuando no sirve.** "Agregar honorario a la orden" solo mira `honorario_en_orden` y el precio. Aparece aunque la orden esté FACTURADA o ANULADA, o ya tenga el honorario de otra consulta, y en esos casos siempre da 409.
   - **Arreglo:** que la respuesta exponga un flag `puede_agregar_honorario` con las mismas condiciones que el endpoint.
6. **Consulta con servicios en más de una orden.** El endpoint elige la orden con `.first()` sin orden definido, y `ConsultaResponse` la deriva con su propio recorrido. Pueden quedar apuntando a órdenes distintas.
   - **Arreglo:** una sola función de derivación, con criterio fijo, usada en los dos lados.

### Stock

7. **Servicio con producto, cantidad fraccionaria y sin receta.** `linea_factura` le saca el `producto_id` a toda línea fraccionaria que tiene servicio. Para una desparasitación sin receta el stock no lo mueve ningún consumo, así que no se descuenta.
   - **Propuesta:** rechazar con un mensaje claro las cantidades fraccionarias en servicios con producto y sin receta.
   - **De fondo:** pasar `DetalleFactura.cantidad` a decimal. Es un cambio de esquema sobre una tabla existente, así que va en el change de facturación de abajo.

### Limpiezas

8. **La lógica del honorario está en el router.** Habría que moverla a `orden_service.agregar_honorario` y reusar `error_una_consulta_por_orden`; hoy el mensaje de ese 409 está duplicado.
9. **Condición repetida en `anular_factura`.** `es_caja` se calcula y después se vuelve a escribir a mano en la rama final. Si una edición futura cambia una y no la otra, vuelve el deadlock.
   - **Arreglo:** usar `es_caja` en los dos lugares.

## Pendientes de fondo, para changes aparte

- **`crear_factura` con `consulta_id` marca como facturados todos los servicios de la consulta**, aunque no estén en esa factura, y anularla los desmarca a todos. Esto rompe el cobro por orden si el honorario se factura aparte.
- **Zona horaria de toda la app.** El backend filtra los rangos de fecha en UTC, y en Venezuela (UTC-4), a partir de las 20:00, "hoy" ya es mañana. Además, varios campos de solo fecha se muestran un día antes: vencimiento en inventario, refuerzo de vacunas y las liquidaciones de tarifa fija en reportes.
- **Nombre del paciente en la bandeja del gestor.** El gestor ve "Paciente #N" porque no puede leer `/api/mascotas/`.
- **Las ventas de caja rápida solo con productos anteriores a la migración `c8d7e6f5a4b3`** no tienen vínculo con su orden, porque no hay de dónde deducirla. Si se anulan, la orden queda FACTURADA.
