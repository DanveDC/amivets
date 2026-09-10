# Inventario y consumo de materiales — estado actual

Foto del código tal como está hoy (branch `redesign/minimalist-ui`), como base para
la Tarea 07. Todo lo que sigue está verificado contra el código; cada punto cita
`archivo:línea`.

## Resumen en tres frases

1. El inventario guarda **solo enteros** y **no tiene unidad de medida ni tamaño de
   envase**: "media botella" no tiene dónde vivir.
2. **No existe ninguna relación entre un servicio del catálogo y los materiales que
   consume** — `CatalogoServicio` es una lista de precios aislada.
3. El stock se mueve en **~7 rutas distintas** con convenciones de signo
   inconsistentes; el consumo por `INSUMO` en la consulta ya existe y ya acepta
   fracciones en la UI, pero choca contra la columna `Integer`.

---

## 1. Modelos (`backend/app/models/models.py`)

### `Inventario` (`inventario`, líneas 253-275)

| Campo | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| id | Integer PK | — | — | |
| codigo | String(50) | no | — | único, indexado |
| nombre | String(200) | no | — | |
| descripcion | Text | sí | — | |
| categoria | String(50) | sí | — | texto libre ("Medicina", "Vacuna", "Alimento"…) |
| precio_unitario | Float | no | — | |
| **stock_actual** | **Integer** | no | 0 | |
| **stock_minimo** | **Integer** | no | 5 | |
| fecha_vencimiento | Date | sí | — | |
| proveedor | String(200) | sí | — | |
| ubicacion | String(100) | sí | — | estante físico, **no** es unidad de medida |
| fecha_registro | DateTime(tz) | — | `now()` | |
| activo | Boolean | — | True | |

**No hay** campo de unidad de medida, ni de contenido/tamaño de envase, ni
discriminador material/producto.

### `MovimientoInventario` (`movimientos_inventario`, 424-441)

| Campo | Tipo | Nulo | Nota |
|---|---|---|---|
| id | Integer PK | — | |
| producto_id | Integer | no | → `inventario.id` |
| tipo_movimiento | **String(20)** | no | comentario: `ENTRADA, SALIDA, MERMA` |
| **cantidad** | **Integer** | no | |
| costo_unitario | Float | no | |
| lote | String(50) | sí | |
| fecha_vencimiento | Date | sí | |
| origen_destino | String(255) | sí | texto libre ("ID de factura", "proveedor"…) |
| fecha_registro | DateTime(tz) | — | `now()` |
| usuario_responsable_id | Integer | sí | → `usuarios.id` |

- `tipo_movimiento` es **String plano, no `Enum`**. No hay clase enum en Python.
- **`MERMA` no se escribe nunca** en todo el código — solo aparece en el comentario.
- **Nadie lee esta tabla**: no hay endpoint GET, ni schema, ni reporte, ni Kardex.
  Es puramente append-only hoy.

### `CatalogoServicio` (`catalogo_servicios`, 631-642)

Exactamente 8 columnas: `id, nombre, categoria, precio_ref, precio_variable,
unidad, activo, created_at`.

- `unidad` es **texto libre** (String(100), etiqueta tipo "por pieza"); **sin
  vínculo semántico** con inventario.
- **Ninguna FK a `inventario`. No existe tabla de receta / lista de materiales.**
- `ServicioConsulta` **no tiene** `catalogo_servicio_id`: el catálogo ni siquiera
  está referenciado desde la consulta.

### `ServicioConsulta` (`servicios_consulta`, 178-197)

| Campo | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| id | Integer PK | — | — | |
| consulta_id | Integer | no | — | → `consultas.id` |
| tipo_servicio | String(50) | no | — | `VACUNACION, CIRUGIA, HOSPITALIZACION, LABORATORIO, INSUMO, ESTETICA` |
| referencia_id | Integer | sí | — | **soft ref, sin FK** — apunta a tabla clínica **o** a `Inventario.id` según `tipo_servicio` |
| nombre_servicio | String(255) | sí | — | |
| **cantidad** | **Float** | no | 1.0 | **la única cantidad `Float` del esquema** |
| precio_unitario | Float | no | 0.0 | |
| estado | String(50) | sí | `"Pendiente"` | `Pendiente`, `Aplicado`; `Cancelado` al borrar |
| detalles_clinicos | Text | sí | — | |
| facturado | Boolean | — | False | |
| is_deleted | Boolean | — | False | soft delete |

**`referencia_id` tiene dos significados según quién creó la fila:**
- creada por `consultas.py` (INSUMO) → es un `Inventario.id`
- creada por `clinico.py` (VACUNACION/DESPARASITACION) → es el id de la fila
  clínica (`Vacunacion.id`), y el PATCH re-resuelve `Vacunacion.id → vacuna_id →
  Inventario`.

### `DetalleFactura` (`detalles_factura`, 348-369)

`cantidad` **Integer**; `producto_id` Integer **nullable** → `inventario.id`
("puede ser null para servicios"); `servicio_id` Integer nullable →
`servicios_consulta.id`.

### Otros consumidores de `Inventario`

| Modelo | Campo → inventario | ¿Mueve stock? |
|---|---|---|
| `DetalleReceta.medicamento_id` (212-224) | FK NOT NULL | **No** — solo informativo, sin cantidad |
| `Vacunacion.vacuna_id` (554-568) | FK NOT NULL | Sí, `-1` fijo |
| `Desparasitacion.producto_id` (570-584) | FK NOT NULL | Sí, `-1` fijo |
| `HojaTratamiento.medicamento_id` (469-483) | FK NOT NULL | **No** — completamente inerte, ningún endpoint lo descuenta |

`Vacunacion` y `Desparasitacion` **hardcodean consumo = 1**; no capturan dosis
real contra stock aunque el precio sí sea variable.

---

## 2. Mapa de movimientos de stock

Toda ruta viva que cambia `stock_actual` o escribe `MovimientoInventario`:

| # | Ubicación | Disparador | stock_actual | ¿Fila en ledger? | Notas |
|---|---|---|---|---|---|
| 1 | `inventario.py:116-118` `registrar_movimiento` | `POST /api/inventario/{id}/movimiento?cantidad=&tipo=` | `±= abs(cantidad)` (int) | **NO** | valida `tipo∈{ENTRADA,SALIDA}` y stock suficiente en SALIDA (400 si no). Warning si queda `<= stock_minimo`. |
| 2 | `inventario.py:22` `crear_producto` | `POST /api/inventario/` | fija stock inicial del payload | NO | |
| 3 | `inventario.py:80-81` `actualizar_producto` | `PUT /api/inventario/{id}` | `InventarioUpdate.stock_actual` es campo aceptado → `setattr` directo | NO | la UI no lo manda; la API sí lo permite |
| 4 | `facturacion_service.py:95,98-106` `crear_factura` | `POST /api/facturas/` | `-= detalle.cantidad` | **SÍ** SALIDA, `cantidad=-detalle.cantidad` (**negativo**), `origen_destino=f"VENTA_{numero}"`, `usuario_responsable_id=None` en la práctica | row-lock `.with_for_update()` (72-74). Condición: `if detalle.producto_id`. Salta si el `servicio_id` resuelve a `ServicioConsulta.estado=="Aplicado"` (`ya_descontado`, 80-87). 400 si `stock < cantidad`. **No** distingue presupuesto. |
| 5 | `facturacion_service.py:281` `anular_factura` | `POST /api/facturas/{id}/anular` | `+= detalle.cantidad` | **NO ledger** | sin row-lock, **sin simetría `ya_descontado`** → devolver de más si la línea ya estaba `ya_descontado` al crear |
| 6 | `facturacion_service.py:316-327` `facturar_y_descargar_stock` | **CÓDIGO MUERTO** — ningún endpoint lo llama | `-= detalle.cantidad` | SÍ | además tiene un `UnboundLocalError` latente (`db.add(nuevo_movimiento)` fuera del `if`) |
| 7 | `consultas.py:181-189` `agregar_servicio_consulta` | `POST /api/consultas/{id}/servicios` con `tipo∈{INSUMO,VACUNACION}` + `estado=="Aplicado"` + `referencia_id` | `-= servicio.cantidad` (**Float**, `referencia_id` usado como `Inventario.id`) | SÍ SALIDA, `cantidad=servicio.cantidad` (**positivo, Float**), `origen_destino=f"Consumo directo - Consulta #{id}"`, **sin usuario** | 400 si `stock < cantidad`. Sin row-lock. |
| 8 | `consultas.py:230-251` `actualizar_servicio_consulta` (PATCH) | `PATCH /api/consultas/servicios/{id}` | Pendiente→Aplicado: `-= cantidad`; Aplicado→otro: `+= old_cantidad` | SÍ en ambos sentidos | cambiar `cantidad` **quedándose** en Aplicado **no** ajusta stock |
| 9 | `consultas.py:296-303` `eliminar_servicio_consulta` (DELETE soft) | `DELETE /api/consultas/servicios/{id}` con `estado=="Aplicado"` | `+= servicio.cantidad` | SÍ ENTRADA | luego `is_deleted=True`, `estado="Cancelado"` |
| 10 | `clinico.py:50,80-88` `crear_vacunacion` | `POST /api/clinico/vacunacion` | `-= 1` | SÍ SALIDA `cantidad=1` | crea además `ServicioConsulta(tipo="VACUNACION", referencia_id=Vacunacion.id, estado="Aplicado")` |
| 11 | `clinico.py:122,149-156` `crear_desparasitacion` | `POST /api/clinico/desparasitacion` | `-= 1` | SÍ SALIDA `cantidad=1` | idem con `DESPARASITACION` |

### Inconsistencias verificadas

- **Signo**: `facturacion_service` escribe SALIDA con `cantidad` **negativa**;
  `consultas.py` y `clinico.py` la escriben **positiva**. Cualquier reconciliación
  futura por suma del ledger tiene que discriminar por prefijo de `origen_destino`.
- **Row-lock**: solo en `crear_factura` (y en el código muerto). Ninguna ruta de
  consumo clínico bloquea fila.
- **`stock_actual` sin CHECK de no-negatividad** en DB. Solo `Field(ge=0)` en el
  input Pydantic de alta/edición y chequeos por-ruta. Las reversas hacen `+=`
  incondicional.
- `settings.STRICT_INVENTORY` se referencia una vez (`clinico.py:43`) dentro de un
  `if …: pass` — flag dormido, no hace nada.

---

## 3. Servicio ↔ inventario hoy

- **`CatalogoServicio` no tiene ninguna conexión con inventario.** `catalogo.py`
  expone CRUD sobre 6 campos (`nombre, categoria, precio_ref, precio_variable,
  unidad, activo`) y nada más. El formulario de catálogo del front
  (`static/js/sections/catalogo.js`) no tiene selector de inventario, ni campo de
  cantidad consumida, ni lista de materiales.
- **La ruta `INSUMO` + `referencia_id` SÍ está viva y cableada de punta a punta**
  (no es código muerto):
  - UI: `consultorio.js` formulario "Registrar Acción Clínica" (`#formAgregarServicio`,
    handler 910-964) → para `tipo∈{INSUMO,VACUNACION}` carga `/inventario/?limit=200`
    en un datalist y fija `#addServicioReferenciaId` al `Inventario.id` elegido.
    **El input de cantidad `#addServicioCantidad` ya es `min="0.1" step="0.1"`**
    (`index.html:491`) — la UI viva ya acepta fracciones.
  - Backend: `consultas.py` lo maneja en crear (#7), PATCH (#8) y DELETE (#9).
  - Facturación: `facturacion_service.py:358-359` `obtener_items_pendientes_consulta`
    mapea `INSUMO.referencia_id → producto_id`; el guard `ya_descontado` de
    `crear_factura` evita el segundo descuento.
- **Quién crea filas `INSUMO`**: solo el endpoint genérico
  `POST /api/consultas/{id}/servicios` desde el formulario del consultorio.
  `clinico.py` y los seeds nunca crean `INSUMO` → **sin datos de demo, sin
  cobertura e2e**.

---

## 4. Superficies de front

### Inventario (`static/js/sections/inventario.js`, `index.html #sec-inventario` 1146-1194)

- **Tabla** (7 columnas): Producto/Código · Categoría · **Stock Actual**
  (`${stock_actual}` + `/ min ${stock_minimo}`, en `var(--accent)` si
  `stock_actual <= stock_minimo`) · Precio Unit. · Vencimiento · Estado (pill
  "Bajo"/"OK") · Acciones. `#badgeStock` = conteo de bajo stock.
- **Alta** (`#formProducto` → `POST /inventario/`): código (auto `PROD-{ts}`),
  categoría `<select>` (incluye "Insumo"), nombre, descripción, `#prodStock`
  (`parseInt`, `min=0`), `#prodMinimo` (`parseInt`, def 5), precio (`parseFloat`),
  vencimiento, proveedor. **Sin campo de unidad ni de tamaño de envase.**
- **Edición** (`#formEditarProducto` → `PUT /inventario/{id}`): manda
  `nombre, descripcion, categoria, stock_minimo, precio_unitario,
  fecha_vencimiento, proveedor`. `#editProdCodigo` y `#editProdStock` son
  `readonly` — **la edición no toca `stock_actual` a propósito**.
- **Movimiento** (`#formMovimientoStock`): tipo `ENTRADA`/`SALIDA`, cantidad
  `parseInt` `min=1`. `POST /inventario/{id}/movimiento?cantidad=&tipo=`. Solo
  enteros, sin lote, sin motivo, sin opción MERMA.

### Catálogo (`static/js/sections/catalogo.js`, `index.html #sec-catalogo` 1657-1691)

- **Tabla** (8 columnas): ID · Nombre · Categoría · Precio Ref · Precio Variable ·
  Unidad · Activo · Acciones.
- **Formulario servicio** (`#formCatalogoServicio` → `POST/PUT /catalogo`):
  nombre, categoría `<select>`, precio ref (`parseFloat`), unidad (texto libre),
  precio variable (checkbox). **Sin selector de inventario, sin BOM, sin cantidad
  consumida.**
- `static/js/app.js` solo re-exporta handlers a `window` y cablea listeners; no
  hay lógica adicional de inventario/catálogo ahí.

---

## 5. Alembic

- `script_location = alembic`; `env.py` usa `settings.DATABASE_URL` y
  `target_metadata = Base.metadata`. **Sin `render_as_batch`, sin `compare_type`,
  sin autogenerate.**
- **10 migraciones, cadena lineal, HEAD = `f6a7b8c9d0e1`** (`add_notas_clinicas`).
  Base = `8ae206b11dda` (`down_revision=None`), que **parte de una DB ya poblada**
  y solo parchea columnas.
- **Estilo**: manuales, defensivas, apuntadas a Postgres. Sin
  `op.batch_alter_table`. `op.add_column` / `create_table` / `create_index` /
  `create_foreign_key` planos. **Guardas de idempotencia** con
  `inspector = sa.inspect(op.get_bind())` + `if 'x' not in inspector.get_columns(...)`.
  `server_default` en tablas nuevas (`'0.0'`, `sa.false()`, `sa.func.now()`).
  Construcciones Postgres (índice único parcial con `postgresql_where`).
  `downgrade()` implementado (`op.drop_*`).
- **Ninguna migración toca `inventario`, `movimientos_inventario`,
  `servicios_consulta.cantidad` ni `catalogo_servicios`** después de la base.
  `catalogo_servicios` y `movimientos_inventario` no los crea ninguna migración
  del `versions/` — vienen de `create_all` / preexisten a la cadena.

---

## 6. Red de seguridad e2e (`e2e/`)

| Spec | Qué cubre | Aserciones de stock |
|---|---|---|
| `inventario.spec.js` | solo `POST /inventario/{id}/movimiento` (API pura) | SALIDA 6 sobre 10 → `stock_actual == 4`; ENTRADA 5 sobre 10 → `15`; SALIDA 10 sobre 3 → `400` + `/stock insuficiente/i` |
| `gestion-inventario.spec.js` | CRUD de inventario por UI (`describe.serial`) | crea/edita/da de baja; verifica que `codigo` y `stock_actual` quedan **intactos** al editar; `?bajo_stock=true` y `/alertas-stock` devuelven solo `stock_actual <= stock_minimo` |
| `flujo-clinico.spec.js` | Propietario→Mascota→Cita→Consulta→Factura (`describe.serial`) | **Ninguna.** Comenta explícito: `tipo_servicio deliberadamente NO INSUMO/VACUNACION para no tocar stock`. La factura se arma **sin `producto_id`** → nunca entra al branch de inventario. |
| `clinico.spec.js` (fuera de alcance pero **carga la red real de descuento**) | vacunación/desparasitación por routers clínicos | `expect(despues.stock_actual).toBe(antes.stock_actual - 1)` (líneas 110, 143); verifica auto-creación de `ServicioConsulta` |

- **Selectores clave** (`gestion-inventario.spec.js`): login `#username`/`#password`/`#btnLogin`;
  `gotoSection(page, 'sec-inventario')`; `#btnNuevoProducto`, `#modalProducto`,
  `#prodCodigo`, `#prodTipo` (`selectOption('Insumo')`), `#prodNombre`,
  `#prodDescripcion`, `#prodStock`, `#prodMinimo`, `#prodPrecio`, `#prodProveedor`,
  `#formProducto button[type="submit"]`, `#searchInventario`, `#inventarioTableBody`,
  fila `#inventarioTableBody tr:has-text("${codigo}") button[title="Editar"]`.
- Helper `createTestProduct` (`e2e/helpers.js`) default
  `{categoria:'Medicamento', stock_actual:10, stock_minimo:5, precio_unitario:100}`.
- **Ningún e2e ejercita `INSUMO`, cantidades fraccionadas, la reversa por PATCH,
  ni el contenido de `MovimientoInventario`.**

---

## 7. Veredicto sobre los hallazgos previos del autor de la tarea

| # | Afirmación | Veredicto |
|---|---|---|
| a | `stock_actual`, `stock_minimo`, `MovimientoInventario.cantidad`, `DetalleFactura.cantidad` son `Integer`; `ServicioConsulta.cantidad` es el único `Float` | **Confirmado.** (También `Hospitalizacion.dias_cama` es Integer; `DetalleReceta` no tiene cantidad.) |
| b | `Inventario` no tiene unidad de medida ni contenido de envase | **Confirmado.** 13 columnas, ninguna es UoM ni envase. |
| c | `CatalogoServicio` tiene 8 campos y ninguna referencia a inventario; no hay tabla de receta | **Confirmado**, con matiz: `unidad` ya es uno de los 8 (texto libre sin semántica de stock). |
| d | El stock se mueve en exactamente 2 lugares (manual + facturación) | **Corregido.** Son ~7 rutas vivas (9 contando los dos writes de CRUD): manual (sin ledger), `crear_factura` (con ledger), `anular_factura` (sin ledger, sin simetría), `consultas.py` crear/PATCH/DELETE (con ledger), `clinico.py` vacunación/desparasitación (con ledger). Más `facturar_y_descargar_stock`, muerto y con bug. |
| e | `ServicioConsulta.tipo_servicio == 'INSUMO'` + `referencia_id` — ¿se usa? | **Corregido — SÍ se usa hoy**, cableado de punta a punta (UI datalist → `consultas.py` → guard de facturación). Lo que falta: sin seed, sin e2e, y el `MovimientoInventario` generado no se muestra en ningún lado. |

---

## 8. Otros hechos que importan para el consumo fraccionado

1. **El consumo fraccionado ya está a medio hacer y a medio romper.**
   `consultas.py:181` hace `inv.stock_actual -= servicio.cantidad` con
   `cantidad` **Float** contra columna **Integer**. En Postgres (el target real),
   asignar `9.5` a `INTEGER` trunca o rechaza según el path. El bloqueo es el
   **esquema**, no la lógica.
2. **La UI de consumo ya ofrece fracciones** (`#addServicioCantidad` `step="0.1"`).
   El usuario puede tipear `0.5` hoy; explota al aplicar.
3. **`MovimientoInventario` no tiene lector** — ninguna API, schema ni reporte.
   Un diseño que dependa de "reproducir el ledger" arranca de cero del lado de
   lectura.
4. **El guard `ya_descontado`** decide "ya consumido" con un booleano
   (`ServicioConsulta.estado == "Aplicado"`). Un modelo que parta un servicio en
   varios consumos parciales rompe ese booleano.
5. **`referencia_id` con doble significado** (ver §1) — cualquier BOM tiene que
   preservar o desambiguar ese overload.
6. **`DetalleFactura.cantidad` es Integer** — las líneas de factura no pueden
   llevar cantidad fraccionada aunque el servicio haya consumido una fracción.
7. **`CatalogoServicio` está huérfano del flujo clínico** — `ServicioConsulta` no
   guarda `catalogo_servicio_id`; el formulario del consultorio hace un lookup de
   sugerencias solo para autocompletar nombre/precio, nunca guarda el id.
   "Cada servicio del catálogo declara qué materiales consume" **no tiene columna
   de anclaje hoy en ninguno de los dos lados.**
8. **`HojaTratamiento`** (medicación en internación, FK `medicamento_id`) está
   inerte — una internación que consume materiales por días no se registra contra
   inventario.
9. **Sin triggers de DB, sin `@event.listens_for`** — todo el movimiento de stock
   es explícito en los handlers de request.
