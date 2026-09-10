# Diseño — Inventario de materiales con consumo fraccionado

Propuesta de diseño para la Tarea 07. Cada una de las 8 decisiones está **tomada y
justificada**; no es un menú de opciones. Base fáctica: `docs/tecnico/inventario-actual.md`.

> **Punto de parada.** Este documento es para revisión. No hay código, ni
> migraciones, ni cambios de modelo hasta que apruebes las 8 decisiones.

---

## Las 8 decisiones en una línea

1. **Unidad de stock** → se guarda **siempre en unidad base** (`ml`, `g`, `unidad`); los envases son solo presentación.
2. **Tipo numérico** → **`Numeric(12, 3)`** (DECIMAL), nunca `Float`; se redondea cada movimiento a 3 decimales.
3. **Momento del descuento** → **al aplicar el servicio** (`ServicioConsulta` → `Aplicado`), no al facturar; el doble descuento se evita partiendo responsabilidades: materiales-por-servicio descuentan al aplicar y **no** generan línea de factura con `producto_id`; ventas directas de producto siguen descontando al facturar.
4. **Sin stock suficiente al aplicar** → **se permite, se avisa y se registra** (el stock puede quedar en negativo con `MovimientoInventario` marcado); bloquear queda detrás del flag `STRICT_INVENTORY` (hoy dormido), apagado por defecto. No depende del rol.
5. **Materiales vs productos** → **misma tabla `inventario`** con discriminador `tipo_item` (`MATERIAL` / `PRODUCTO`); evita duplicar el ledger, las alertas y la maraña de FKs.
6. **Receta del servicio** → **valor por defecto editable al aplicar**: la receta declara la cantidad estándar, el veterinario ajusta la real, y contra el stock va la **real**.
7. **Fracción sobrante** → por defecto **no hay merma** (media botella usada = media botella usable); se agrega un booleano `merma_al_abrir` por material (default `false`) que, cuando está activo, genera un `MovimientoInventario` tipo `MERMA` por el resto del envase.
8. **Migración de datos** → `Integer → Numeric(12,3)` preservando valores (10 → 10.000); columnas nuevas con `server_default` seguro; `unidad_medida` y `contenido_por_envase` quedan **NULL** en todo lo existente (no se inventa lo que nadie declaró); tabla `recetas_servicio` nace vacía. Alembic manual con guardas de idempotencia, `downgrade()` implementado.

---

## Detalle y fundamento

### Decisión 1 — ¿En qué unidad se guarda el stock?

**Unidad base siempre** (`ml`, `g`, `unidad`). Nunca envases.

Modelo:

- `Inventario.unidad_medida` — `String(12)`, valores validados en Pydantic:
  `'ml' | 'g' | 'unidad'` (extensible, pero cerrado en el schema para no volver a
  caer en texto libre como el `categoria` actual).
- `Inventario.contenido_por_envase` — `Numeric(12, 3)`, nullable. Para
  `unidad_medida == 'unidad'` vale `1` o `NULL`. Para "botella de alcohol de 1 L"
  vale `1000`.
- La compra se ingresa en envases en la UI y se multiplica a unidad base al
  guardar: 2 botellas → `+2000 ml`. El uso se ingresa/registra en unidad base:
  media botella → `-500 ml`.
- La presentación convierte para el humano: `"2,5 botellas · 2.500 ml"`. Eso es
  render, no dato almacenado.

**Por qué, y no la alternativa (guardar 2,5 envases como decimal):**

- El consumo clínico se piensa en unidad base ("500 ml de alcohol", "2 gasas"),
  no en fracción de envase. Guardar envases obliga a una división en **cada**
  consumo.
- "Medio envase" significa distinto para una botella de 1 L y una de 250 ml. "500
  ml" no es ambiguo.
- Si el proveedor cambia el tamaño del envase, con unidad base **no se recalcula
  nada** histórico; con envases-decimal hay que reinterpretar todas las
  cantidades pasadas.
- Las alertas de `stock_minimo` viven en la misma unidad → consistencia.

**Costo:** la UI de alta/compra necesita un paso de conversión y un selector de
unidad. Es el precio correcto a pagar.

---

### Decisión 2 — ¿`Float` o `Numeric`?

**`Numeric(12, 3)`** en Postgres (SQLAlchemy `Numeric(12, 3)` → `Decimal` en
Python). Aplica a: `Inventario.stock_actual`, `Inventario.stock_minimo`,
`Inventario.contenido_por_envase`, `MovimientoInventario.cantidad`,
`RecetaServicio.cantidad`, y la cantidad consumida real por línea.

**Por qué:**

- El stock se suma y resta cientos de veces. Con `Float` el error de redondeo se
  acumula: cuatro consumos de `500 ml` sobre `2000` terminan en `0.00000001`, no
  en `0`. `Numeric` es aritmética decimal exacta.
- Requisito explícito de la tarea: "aplicar el mismo servicio cuatro veces deja el
  stock en cero exacto".

**Precisión — 3 decimales:**

- Cubre mililitro sobre litros y gramo sobre kilos, y dosis tipo `0.125` de un
  frasco.
- `12` dígitos totales = hasta `999.999.999,999` unidades base: sobra para una
  clínica.
- Cada `MovimientoInventario` se redondea a 3 decimales
  (`Decimal.quantize(Decimal('0.001'))`) antes de persistir, para que el ledger no
  arrastre colas.
- Todo el código de stock trabaja con `Decimal`; prohibido coercionar a `float` en
  el camino (revisar `facturacion_service` y `consultas.py`).

---

### Decisión 3 — ¿Cuándo se descuenta: al aplicar o al facturar?

**Al aplicar el servicio.** El momento es la transición de `ServicioConsulta`
a `estado == "Aplicado"` (que es como ya funciona la ruta `INSUMO` hoy).

**Por qué:** clínicamente el material se gasta al usarlo, y hay consultas que se
aplican y no se cobran nunca. Descontar al facturar deja el inventario mintiendo
en todo el intervalo entre atención y cobro, y para siempre si no hay cobro.

**Cómo se evita el doble descuento con lo que ya existe en `facturacion_service.py`:**

Se parte la responsabilidad por tipo de línea, de forma que nunca haya dos
sistemas tocando el mismo stock:

| Origen | Cuándo descuenta | Línea de factura |
|---|---|---|
| Material consumido por un servicio (vía receta o `INSUMO` manual) | al aplicar el servicio | la línea lleva **solo `servicio_id`** (precio), **nunca `producto_id`** → `crear_factura` no entra al branch de inventario |
| Venta directa de producto (collar, bolsa de alimento) | al facturar (comportamiento actual intacto) | la línea lleva `producto_id` |

Además, el guard `ya_descontado` deja de ser un booleano frágil. La fuente de
verdad pasa a ser el **ledger**: "¿este `servicio_consulta_id` ya generó
movimientos de consumo?". Concretamente:

- `MovimientoInventario` gana una columna `servicio_consulta_id` (nullable, FK a
  `servicios_consulta.id`).
- `crear_factura`, antes de descontar por una línea con `producto_id`, verifica
  que esa línea **no** provenga de un servicio con consumo ya registrado en el
  ledger. Si proviene, salta (igual que hoy, pero sobre evidencia real y
  soportando consumo parcial / múltiple).
- `obtener_items_pendientes_consulta` deja de mapear `INSUMO.referencia_id →
  producto_id`: los materiales ya no son ítems facturables de inventario, son
  parte del precio del servicio.

**Efecto sobre `flujo-clinico.spec.js`:** ese spec arma la factura sin
`producto_id` y no asme stock → **no se toca**. La red real de descuento
(`clinico.spec.js`, vacunación `-1`) sigue verde porque el momento no cambia para
esa ruta (ya descuenta al crear la vacunación = al aplicar).

---

### Decisión 4 — ¿Qué pasa si no hay stock suficiente al aplicar?

**Se permite, se avisa y se registra.** El endpoint:

1. Descuenta igual (el stock puede quedar en negativo o en 0 con faltante).
2. Devuelve `200` con un bloque de advertencia en el body:
   `{ "advertencias": [{ "material": "Alcohol", "faltante": 300, "unidad": "ml" }] }`.
3. Crea el `MovimientoInventario` de todos modos, para que el déficit sea visible
   y reconciliable después.

**Por qué:** en medio de una consulta o una cirugía, un `400` que corta el
registro es peor que un stock negativo con alerta. El sistema debe reflejar la
realidad (el material se usó), no impedir que se registre. El negativo es una
señal accionable para compras, no un estado prohibido.

**¿Depende del rol?** No, para simplicidad y porque cualquier rol que aplica un
servicio está frente al paciente. Lo que **sí** queda estricto:

- El endpoint manual `POST /inventario/{id}/movimiento` en `SALIDA`: no se puede
  retirar más de lo que hay (comportamiento actual, sin cambios).
- Un flag `settings.STRICT_INVENTORY` (hoy existe como no-op en `clinico.py:43`) se
  cablea de verdad: si está en `true`, el consumo al aplicar vuelve a bloquear con
  `400`. **Default: `false`** (permisivo).

---

### Decisión 5 — ¿Materiales y productos son lo mismo?

**Misma tabla `inventario`, con discriminador.** Nueva columna
`Inventario.tipo_item` — `String(12)`, valores `'MATERIAL' | 'PRODUCTO'`,
`server_default='PRODUCTO'`.

- `MATERIAL`: se consume vía servicios; puede tener `unidad_medida` /
  `contenido_por_envase` / `merma_al_abrir`.
- `PRODUCTO`: se vende directo; esas columnas quedan `NULL`.

**Por qué no separar en dos tablas:**

- Comparten casi todo: `codigo`, `nombre`, `stock`, `precio`, `proveedor`,
  `vencimiento`, alertas de bajo stock, el ledger de movimientos, el CRUD.
- Hay **cinco** referencias a `inventario` desde otros modelos
  (`DetalleReceta`, `Vacunacion`, `Desparasitacion`, `HojaTratamiento`,
  `DetalleFactura`, más el soft-ref de `ServicioConsulta`). Separar obliga a
  duplicar cada FK o a un esquema polimórfico. No vale la pena.
- El `categoria` (texto libre) sigue existiendo como subclasificación fina
  ("Antibiótico", "Sutura") **dentro** de cada `tipo_item`.

---

### Decisión 6 — ¿La receta del servicio es fija o ajustable en el momento?

**Valor por defecto editable al aplicar.**

- `RecetaServicio` declara la cantidad **estándar** ("500 ml de alcohol") — es
  una plantilla.
- Al aplicar el servicio en el consultorio, cada material aparece precargado con
  la cantidad de la receta, y el veterinario puede ajustarla por aplicación.
- Contra el stock y en el `MovimientoInventario` va la cantidad **real
  consumida**, no la de la receta.

**Por qué:** el uso real varía (un paciente chico usa menos), y la tarea lo pide
explícito ("el veterinario quizá usó menos"). Además calza con lo que la UI ya
hace: `#addServicioCantidad` ya es un input editable.

**Dónde se guarda la cantidad real:** por cada material consumido en una
aplicación se crea una fila en una tabla hija `consumo_material` (o se reusa el
patrón `ServicioConsulta` hijo), con FK al `servicio_consulta_id`, al
`inventario_id`, la `cantidad` real (`Numeric(12,3)`) y la `unidad_medida`. Esa
fila es la que dispara el `MovimientoInventario` y la que se revierte.

---

### Decisión 7 — ¿Qué se hace con la fracción sobrante?

**Por defecto no hay merma.** Media botella usada deja media botella usable: se
resta `500 ml` de `1000 ml`, quedan `500 ml`, siguen disponibles. El modelo de
unidad base (Decisión 1) ya lo resuelve sin nada extra.

**Excepción, opt-in por material:** `Inventario.merma_al_abrir` — `Boolean`,
`server_default=false`. Cuando está en `true` (viales monodosis, campos estériles
que se pierden al abrirse):

- Al consumir cualquier cantidad de ese material, además del `SALIDA` por lo
  usado, se genera un `MovimientoInventario` tipo `MERMA` por el **resto del
  envase** (redondeando hacia arriba al múltiplo de `contenido_por_envase`).
- Ej.: vial de `10 ml`, se usan `3 ml` → `SALIDA 3 ml` + `MERMA 7 ml`. Stock baja
  `10 ml` (un vial entero).

**Por qué así:** la mayoría de los materiales NO se comportan así, entonces
prender esto por defecto sería incorrecto. Pero para la minoría que sí, el
mecanismo es barato y `MovimientoInventario` ya tiene el tipo `MERMA` previsto
(aunque hoy nunca se escriba).

**De paso — formalizar `tipo_movimiento`:** hoy es `String(20)` con `MERMA`
fantasma. Se cierra el conjunto a `ENTRADA | SALIDA | MERMA | AJUSTE | REVERSA`
(enum Python o `CHECK` en DB; se decide en Fase 2 según el estilo de migración).

---

### Decisión 8 — Migración de los datos que ya existen

El padrón real ya está cargado con stock entero. La migración Alembic
(reversible, sin perder stock):

**Cambios de tipo (`Integer → Numeric(12, 3)`):**

| Tabla.columna | Antes | Después | Conversión |
|---|---|---|---|
| `inventario.stock_actual` | Integer | Numeric(12,3) | `10 → 10.000` (Postgres castea sin pérdida) |
| `inventario.stock_minimo` | Integer | Numeric(12,3) | idem |
| `movimientos_inventario.cantidad` | Integer | Numeric(12,3) | idem |

`detalles_factura.cantidad` **se deja `Integer` por ahora** — las ventas directas
de producto son enteras y tocarlo arrastra `crear_factura`, presupuestos y specs
sin beneficio para esta feature. Se anota como deuda, no como alcance.

**Columnas nuevas en `inventario`:**

| Columna | Tipo | Nullable | server_default | Nota |
|---|---|---|---|---|
| `tipo_item` | String(12) | no | `'PRODUCTO'` | todo lo existente queda como producto vendible (que es lo que son hoy) |
| `unidad_medida` | String(12) | **sí** | — | **NULL** en todo lo existente |
| `contenido_por_envase` | Numeric(12,3) | sí | — | **NULL** en todo lo existente |
| `merma_al_abrir` | Boolean | no | `false` | |

**Nada inventado:** `unidad_medida` y `contenido_por_envase` quedan `NULL` para
todas las filas actuales. Regla de interpretación documentada: un
`unidad_medida IS NULL` se trata como `'unidad'` con envase `1` para la
aritmética (es decir, se comporta idéntico a hoy), y la UI de inventario marca
esas filas como "unidad sin definir" e invita a completarlas. Ninguna migración
adivina que "botella" son 1000 ml.

**Tablas nuevas (nacen vacías):**

- `recetas_servicio` — `id`, `catalogo_servicio_id` (FK → `catalogo_servicios.id`),
  `inventario_id` (FK → `inventario.id`), `cantidad` (Numeric(12,3)),
  `unidad_medida` (String(12)). UNIQUE `(catalogo_servicio_id, inventario_id)`.
- `consumo_material` — `id`, `servicio_consulta_id` (FK), `inventario_id` (FK),
  `cantidad` (Numeric(12,3)), `unidad_medida`, `movimiento_id` (FK →
  `movimientos_inventario.id`, para trazabilidad y reversa).

**Columnas nuevas de anclaje:**

- `movimientos_inventario.servicio_consulta_id` — Integer, nullable, FK. Es la
  clave para el guard anti-doble-descuento basado en ledger (Decisión 3) y para la
  trazabilidad movimiento → consulta → mascota que pide la Fase 2.
- `servicios_consulta.catalogo_servicio_id` — Integer, nullable, FK. Ancla por fin
  el servicio de la consulta a su definición de catálogo (hoy huérfano). Backfill
  no requerido; se llena de acá en adelante.

**Estilo de la migración** (según `docs/tecnico/inventario-actual.md §5`):

- Manual, sin autogenerate.
- Guardas de idempotencia: `inspector = sa.inspect(op.get_bind())` +
  `if 'x' not in inspector.get_columns(...)` / `get_table_names()`.
- `op.alter_column(..., type_=sa.Numeric(12, 3), existing_type=sa.Integer())` para
  los cambios de tipo; sin `batch_alter_table` (target Postgres).
- `downgrade()` implementado: `Numeric → Integer` con `round()` explícito y
  comentario de que es **lossy** para fracciones creadas después de la migración;
  `drop` de columnas y tablas nuevas.
- Encadenar desde HEAD actual `f6a7b8c9d0e1`.

**Limpieza recomendada (decisión secundaria, marcar en revisión):** normalizar el
signo de `MovimientoInventario` — hoy `facturacion_service` escribe `SALIDA` con
`cantidad` negativa y el resto positiva. Propuesta: **magnitud siempre positiva,
el signo lo da `tipo_movimiento`**, con una migración de datos que voltee las
filas negativas existentes. Habilita sumar el ledger sin casos especiales. Si se
considera fuera de alcance, queda anotado como deuda explícita.

---

## Alcance de la Fase 2 (para contexto, no para aprobar ahora)

Tras tu OK a las 8 decisiones:

1. Migración Alembic (Decisión 8).
2. Modelos + schemas: `tipo_item`, unidad/envase/merma en `Inventario`;
   `RecetaServicio`, `ConsumoMaterial`; anclajes en `MovimientoInventario` y
   `ServicioConsulta`.
3. ABM de receta de servicio en `routers/catalogo.py` + UI en la sección catálogo.
4. Consumo al aplicar: descontar materiales de la receta (editable) al pasar el
   `ServicioConsulta` a `Aplicado`, un `MovimientoInventario` por material con
   `servicio_consulta_id` y `usuario_responsable_id`.
5. Reversa al anular / marcar no aplicado (simétrica, como facturación al anular).
6. Concurrencia: `with_for_update()` en toda ruta de consumo (hoy solo lo tiene
   `crear_factura`).
7. Front: inventario muestra unidad + presentación ("2,5 botellas · 2.500 ml"),
   alertas de mínimo con decimales; catálogo muestra la receta; consultorio
   muestra y permite ajustar los materiales al aplicar.
8. `facturacion_service`: dejar de descontar/mapear materiales; guard
   anti-doble-descuento sobre ledger.
9. Tests e2e nuevos (los 7 casos de la tarea) sin debilitar `flujo-clinico.spec.js`
   ni `clinico.spec.js`.

### Riesgos conocidos a vigilar en Fase 2

- **`referencia_id` con doble significado** en `ServicioConsulta` — no romper la
  resolución `Vacunacion.id → vacuna_id → Inventario` del PATCH.
- **`clinico.spec.js`** asme `stock - 1` para vacunación/desparasitación: el
  momento no cambia para esa ruta, pero cualquier refactor de la escritura de
  ledger tiene que mantener esa aserción verde.
- **`HojaTratamiento`** sigue inerte — no entra en esta tarea, se anota.
- **Postgres vs SQLite**: los tests corren contra Postgres real; `Numeric` se
  comporta distinto en SQLite si algún test unitario usa in-memory.
