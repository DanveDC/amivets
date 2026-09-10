# Diseño — Historial de precios de materiales y servicios

Propuesta de diseño para la Tarea 08. Cada una de las 8 decisiones está **tomada y
justificada**; no es un menú de opciones. Base fáctica: verificada contra el
código en `backend/app/models/models.py`, `backend/app/routers/`,
`backend/alembic/versions/` (branch `redesign/minimalist-ui`).

> **Punto de parada.** Este documento es para revisión. No hay código, ni
> migraciones, ni cambios de modelo hasta que apruebes las 8 decisiones.

---

## 1.1 — Lo que ya está en el código (confirmado y completado)

**Los precios actuales viven en campos sueltos, sin historia:**

- `Inventario.precio_unitario` — `Float`, `NOT NULL` (`models.py:285`).
- `CatalogoServicio.precio_ref` — `Float`, `default 0.0`, nullable
  (`models.py:684`), con `precio_variable` `Boolean` al lado (`models.py:685`).

**El precio se sobrescribe en el router, sin capa de servicio y sin auth:**

- `PUT /api/inventario/{id}` → `actualizar_producto` (`inventario.py:71-87`):
  loop genérico `for key, value in producto_update.model_dump(exclude_unset=True).items(): setattr(producto, key, value)`.
  `precio_unitario` es un campo más de `InventarioUpdate` (`schemas.py:378`).
- `PUT /api/catalogo/{id}` → `actualizar_servicio` (`catalogo.py:79-95`): mismo
  patrón, `precio_ref` / `precio_variable` son campos de `CatalogoServicioUpdate`
  (`schemas.py:712-713`).
- **Ninguno de los dos routers tiene dependencia de autenticación.** Hoy
  cualquiera con la URL cambia un precio.

**El precio *cobrado* sí queda congelado en cada documento** (confirmado, todos
`Float`):

| Dónde | Campo | Línea |
|---|---|---|
| `DetalleFactura` | `precio_unitario` | `models.py:393` |
| `ServicioConsulta` | `precio_unitario` | `models.py:207` |
| `Consulta` | `precio_consulta` | `models.py:155` |
| `Vacunacion` | `precio_aplicado` | `models.py:610` |
| `Desparasitacion` | `precio_aplicado` | `models.py:626` |
| `PruebaComplementaria` | `precio_aplicado` | `models.py:260` |
| `Cirugia` | `precio_aplicado` | `models.py:548` |
| `Hospitalizacion` | `precio_aplicado` | `models.py:504` |
| `Usuario` | `tarifa_consulta` — `Numeric(10,2)` | `models.py:331` |

**El costo de compra ya tiene historial parcial:**
`MovimientoInventario.costo_unitario` — `Float`, `NOT NULL` (`models.py:474`) —
guarda a qué costo entró cada lote en cada `ENTRADA`. Pero **esa tabla no tiene
ningún lector**: no hay endpoint GET, ni schema, ni Kardex. Es append-only ciego.

**Inconsistencia de tipos ya presente en el repo:** de 24 columnas de dinero,
**20 son `Float`** (toda facturación y clínica) y **4 son `Numeric(10,2)`**
(`Usuario.tarifa_consulta`, `Abono.monto`, `Liquidacion.total`,
`LiquidacionDetalle.tarifa_aplicada` — todas de features nuevas: abonos y
liquidaciones).

**Estado de la Tarea 07:** su *slice A* **ya está mergeado**. `Inventario` ya
tiene `tipo_item` (`MATERIAL | PRODUCTO`, `models.py:297`), `unidad_medida`,
`contenido_por_envase`, `merma_al_abrir`; existen `RecetaServicio` y
`ConsumoMaterial`. **HEAD de Alembic = `b8c9d0e1f2a3`**
(`b8c9d0e1f2a3_inventario_fraccionado_fk_indexes.py`).

**Roles (corrección a la premisa de la tarea):** no hay framework de permisos.
`Usuario.role` es `String(20)` texto libre (`models.py:326`). Los valores que el
código realmente usa son **`"admin"`, `"veterinario"` y el default `"user"`**.
**`"recepcionista"` no aparece en ningún lado del backend.** El único gate es
`get_current_admin` (`usuarios.py:58-64`); el resto son comparaciones inline
`if current_user.role != "admin"`.

**Convención de auditoría:** no hay mixin ni `updated_at` en ningún modelo. Cada
modelo declara su propio timestamp de creación con nombre distinto: `Inventario`
usa `fecha_registro` (`models.py:305`), `CatalogoServicio` usa `created_at`
(`models.py:688`). Ambos con `DateTime(timezone=True), server_default=func.now()`.

---

## Las 8 decisiones en una línea

1. **Alcance (venta / costo / ambos)** → historial explícito **solo del precio de lista (venta)** de materiales y servicios, que es lo que hoy se pierde; el **costo de compra ya está historizado** por lote en `MovimientoInventario.costo_unitario` y solo se le agrega un lector — no se crea una segunda serie.
2. **Una tabla o dos** → **dos tablas** (`historial_precio_inventario`, `historial_precio_servicio`), cada una con su FK real; nada de esquema polimórfico `tipo_entidad + entidad_id`.
3. **Vigencia o eventos** → **solo eventos de cambio** inmutables `(precio_nuevo, precio_anterior, fecha_cambio)`; la vigencia en una fecha se deriva al leer con `ORDER BY fecha_cambio DESC LIMIT 1`. Sin rangos, sin cierre de período.
4. **Conservar `precio_unitario` / `precio_ref`** → **sí, se conservan**; el historial es aditivo y no toca los ~20 lugares que leen el precio. Un **único helper transaccional** (`registrar_cambio_precio`) actualiza la columna y escribe el historial juntos; los `PUT` sacan el precio del loop genérico y lo pasan por el helper.
5. **Qué se registra además del precio** → `usuario_id` + `fecha_cambio` (mínimo) + **`motivo` `String(200)` nullable, texto libre opcional** (no un enum cerrado) + `precio_anterior` para la variación.
6. **Corregir o borrar un registro** → **nunca** `UPDATE`/`DELETE`; el endpoint de historial es GET-only. Una corrección es **un registro nuevo** con `corrige_id` (self-FK) apuntando al que anula.
7. **Precios que ya existen** → la migración crea **un registro inicial por entidad**: `precio_nuevo` = precio actual, `precio_anterior` = `NULL`, `usuario_id` = `NULL`, `motivo` = `"registro inicial (migración)"`, `fecha_cambio` = la fecha de nacimiento que la entidad ya declara (`Inventario.fecha_registro` / `CatalogoServicio.created_at`). No se inventa ninguna fecha.
8. **`Float` o `Numeric`** → las columnas nuevas del historial nacen **`Numeric(10, 2)`** (mismo precedente que `Abono.monto` / `Usuario.tarifa_consulta`). Esta tarea **no** unifica los 20 `Float` de facturación/clínica: es un refactor transversal sin relación con el historial. Queda **documentado como deuda técnica explícita** (mismo criterio que la Tarea 07 con `detalles_factura.cantidad`).

---

## Detalle y fundamento

### Decisión 1 — ¿Precio de venta, costo de compra, o los dos?

**Solo precio de venta (lista), historizado explícitamente. El costo se surface,
no se re-historiza.**

- **Servicios:** solo hay precio de venta (`precio_ref`). No hay nada que decidir.
- **Materiales:** hay dos números. El **precio de venta** (`precio_unitario`) es
  el que hoy se sobrescribe y se pierde → necesita historial nuevo. El **costo de
  compra** ya queda congelado en cada `ENTRADA` como
  `MovimientoInventario.costo_unitario` con su `fecha_registro` y su `lote`. Esa
  serie temporal **ya existe**; lo único que falta es leerla.
- **El margen** (venta − costo) se **deriva en lectura**: precio de lista vigente
  en la fecha X (del historial nuevo) menos el `costo_unitario` de la última
  `ENTRADA` ≤ X (del ledger que ya está).

**Por qué no crear también una tabla de historial de costo:**

- Duplicaría información que el ledger ya tiene, y con peor granularidad: el costo
  real es *por lote*, no un único valor de clase. Aplanarlo a "el costo del
  material" pierde el dato de que dos lotes entraron a precios distintos.
- La tarea lo dice: *"lo que no existe es la historia de la tarifa de lista"*. El
  costo sí existe.

**Alcance concreto que sí entra por el costo:** un endpoint
`GET /api/inventario/{id}/movimientos?tipo=ENTRADA&desde=&hasta=` que devuelve
`fecha`, `costo_unitario`, `cantidad`, `lote`. Hoy `MovimientoInventario` no
tiene lector ninguno; este es el mínimo para que la UI pueda dibujar la curva de
costo al lado de la de venta.

---

### Decisión 2 — ¿Una tabla de historial o dos?

**Dos tablas**, cada una con su clave foránea real:

```
historial_precio_inventario
  id                 Integer PK
  inventario_id      Integer  NOT NULL  FK -> inventario.id
  precio_nuevo       Numeric(10,2)  NOT NULL
  precio_anterior    Numeric(10,2)  NULL
  motivo             String(200)    NULL
  usuario_id         Integer        NULL  FK -> usuarios.id
  corrige_id         Integer        NULL  FK -> historial_precio_inventario.id
  fecha_cambio       DateTime(tz)   NOT NULL  server_default now()
  INDEX (inventario_id, fecha_cambio DESC)

historial_precio_servicio
  id                     Integer PK
  catalogo_servicio_id   Integer  NOT NULL  FK -> catalogo_servicios.id
  precio_nuevo           Numeric(10,2)  NOT NULL
  precio_anterior        Numeric(10,2)  NULL
  motivo                 String(200)    NULL
  usuario_id             Integer        NULL  FK -> usuarios.id
  corrige_id             Integer        NULL  FK -> historial_precio_servicio.id
  fecha_cambio           DateTime(tz)   NOT NULL  server_default now()
  INDEX (catalogo_servicio_id, fecha_cambio DESC)
```

**Por qué dos y no una polimórfica:**

- `Inventario` y `CatalogoServicio` son entidades **realmente distintas**, tablas
  distintas. Una tabla con `tipo_entidad + entidad_id` **no puede tener FK** — la
  integridad referencial (borrar un material y que se vaya su historial) pasa a
  depender de código de aplicación, que es exactamente el tipo de deuda que el
  resto del esquema ya sufre (`ServicioConsulta.referencia_id` es un soft-ref con
  doble significado, ver Tarea 07).
- **Son solo dos.** El costo de la verbosidad es dos `create_table` casi
  idénticos y un endpoint con un `if entidad == "inventario"`. Barato.
- Comparten forma → un mismo schema Pydantic base (`HistorialPrecioBase`) y **un
  solo helper** de escritura parametrizado por entidad. La duplicación es de
  DDL, no de lógica.

**Por qué esta decisión es al revés que la Tarea 07 (que eligió *una* tabla para
materiales+productos):** allá las dos cosas eran la *misma* entidad de negocio
con 5+ FKs entrantes compartidas; separarlas duplicaba todo ese cableado. Acá son
dos entidades genuinamente separadas sin FKs cruzadas. El criterio —"una tabla
cuando comparten identidad y referencias, dos cuando no"— es el mismo; el
resultado cambia porque el caso cambia.

---

### Decisión 3 — ¿Rangos de vigencia o solo eventos de cambio?

**Solo eventos de cambio.** Cada fila es un hecho inmutable: "el DD/MM a las
HH:MM el precio pasó de A a B". Sin `fecha_desde` / `fecha_hasta`.

**Por qué no rangos:**

- Los rangos exigen, en cada cambio, **cerrar** el período anterior
  (`UPDATE ... SET fecha_hasta = now() WHERE fecha_hasta IS NULL`) y abrir el
  nuevo. Son dos escrituras que tienen que ser atómicas y consistentes; si una
  falla queda un solapamiento o un hueco, y hay que escribir código de
  reparación.
- Con eventos, escribir es **un solo `INSERT` append-only**. Nada que cerrar,
  nada que pueda quedar inconsistente. Encaja con cómo el repo ya trata
  `MovimientoInventario` (append-only puro).

**Cómo se responde "¿cuánto costaba el 15 de marzo?" sin rangos:**

```sql
SELECT precio_nuevo
FROM historial_precio_inventario
WHERE inventario_id = :id AND fecha_cambio <= :fecha
ORDER BY fecha_cambio DESC
LIMIT 1;
```

El índice `(inventario_id, fecha_cambio DESC)` la hace O(log n). Es la misma
consulta para "precio vigente hoy" (con `:fecha = now()`).

**Fecha anterior al primer registro:** la query de arriba no devuelve filas. En
ese caso se devuelve el `precio_anterior` del **primer** registro (que, por la
Decisión 7, es el precio con el que nació la entidad) — o `null` / "sin dato" si
ese material nunca tuvo un cambio y solo tiene el registro inicial con
`precio_anterior = NULL`. Nunca se inventa un número.

**`precio_anterior` es redundante a propósito.** Se puede calcular con un
self-join al registro previo, pero guardarlo explícito hace que **cada fila sea
autoexplicativa**: la UI de tabla muestra `fecha · precio · variación · quién`
leyendo una sola fila, sin ventana ni join. El costo es una columna `Numeric` de
más. Vale la pena.

---

### Decisión 4 — ¿Se conserva `precio_unitario` / `precio_ref` en la tabla original?

**Sí. El historial es aditivo; la columna actual se queda donde está.**

**Por qué no derivar el precio actual del historial:**

- Hay ~20 lugares que leen `precio_unitario` / `precio_ref` hoy (facturación,
  presupuestos, consultas, catálogo, clínico). Derivar el precio en cada lectura
  significa tocar todos, más el riesgo de una query de más por cada factura.
- Beneficio funcional de derivarlo: **cero**. El único argumento es estético
  ("no duplicar"). No alcanza.

**Quién garantiza que no se desincronicen — un único punto de escritura:**

```python
def registrar_cambio_precio(db, *, entidad, entidad_id, precio_nuevo,
                            usuario_id, motivo=None):
    entidad_row = db.get(Modelo, entidad_id)               # Inventario o CatalogoServicio
    precio_anterior = entidad_row.precio_actual            # precio_unitario / precio_ref
    if _cuantiza(precio_nuevo) == _cuantiza(precio_anterior):
        return None                                        # no es un cambio (Decisión: tests)
    entidad_row.precio_actual = precio_nuevo               # actualiza la columna viva
    hist = HistorialPrecio(entidad_id=entidad_id,
                           precio_nuevo=_cuantiza(precio_nuevo),
                           precio_anterior=_cuantiza(precio_anterior),
                           usuario_id=usuario_id, motivo=motivo)
    db.add(hist)
    # una sola transacción: commit lo hace el caller
    return hist
```

- Los routers `PUT /inventario/{id}` y `PUT /catalogo/{id}` **sacan el precio del
  loop genérico** `for key, value in model_dump().items()` y, si el payload trae
  un precio distinto, llaman a este helper. El resto de los campos siguen por
  `setattr`.
- Un solo lugar escribe precio ⇒ imposible actualizar la columna sin escribir el
  historial, o viceversa.

---

### Decisión 5 — ¿Qué se registra además del precio?

**Mínimo obligatorio:** `usuario_id` (FK → `usuarios.id`, nullable para el
registro de migración) y `fecha_cambio` (`server_default now()`).

**Más: `motivo` — `String(200)`, nullable, texto libre opcional.** No un enum.

**Por qué texto libre y no un catálogo cerrado
(`INFLACION | CAMBIO_PROVEEDOR | CORRECCION | OTRO`):**

- La tarea lo argumenta sola: *"en un contexto de precios en dólares que se mueven
  seguido, saber por qué subió puede valer más que el número"*.
- Un enum se queda corto rápido ("ajuste de fin de año", "promoción",
  "redondeo tras dolarización") y cada valor nuevo es una migración. Texto libre
  opcional no cuesta nada; el que quiera contexto lo escribe, el que no, lo deja
  vacío.
- Si más adelante se ve que el 90% cae en 3 categorías, se formaliza entonces con
  datos reales. Hoy no los hay.

La UI de cambio de precio muestra un input "Motivo (opcional)". El `precio_anterior`
(Decisión 3) también vive acá y es lo que la tabla usa para la columna "variación".

---

### Decisión 6 — ¿Se puede corregir o borrar un registro del historial?

**No. Ni `UPDATE` ni `DELETE`, nunca. El endpoint de historial es GET-only.**

Un historial editable no es un historial — es un campo más que se puede
maquillar.

**El error de tipeo (precio ×10) se arregla con un registro nuevo:**

- Se vuelve a registrar el precio correcto. La curva muestra el pico y su
  corrección — que es **la verdad de lo que pasó** (alguien se equivocó y lo
  arregló 5 minutos después).
- Para que ese pico no ensucie la lectura, el registro de corrección lleva
  `corrige_id` (self-FK) apuntando al registro erróneo. La UI puede entonces:
  - marcar visualmente el par error → corrección,
  - ofrecer un toggle "ocultar correcciones" que filtra ambos de la tabla y del
    gráfico,
  - calcular la variación "real" salteando los anulados.
- `motivo` del registro de corrección: `"corrección de #<id>"` (lo puede
  autocompletar la UI).

A nivel API: el router expone `GET /api/.../historial-precios` y **nada más**.
No hay `PUT` ni `DELETE` de registros individuales. Un `admin` que quiera
"arreglar" el historial tiene que hacerlo registrando, como todos.

---

### Decisión 7 — ¿Qué hacer con los precios que ya existen?

**La migración crea un registro inicial por cada material y cada servicio:**

| Campo | Valor |
|---|---|
| `precio_nuevo` | el precio actual (`Inventario.precio_unitario` / `CatalogoServicio.precio_ref`) |
| `precio_anterior` | `NULL` |
| `usuario_id` | `NULL` |
| `motivo` | `"registro inicial (migración)"` |
| `fecha_cambio` | `Inventario.fecha_registro` / `CatalogoServicio.created_at` |

**Por qué esa fecha y no otra:**

- Ambas entidades **ya declaran** su fecha de creación (`fecha_registro` /
  `created_at`, ambas con `server_default now()` desde siempre). Esa es la única
  fecha real disponible: *"este material tenía este precio al menos desde que se
  creó"*.
- **No se inventa** una `fecha_desde`. Si `fecha_registro` fuese `NULL` en alguna
  fila vieja (no debería, por el `server_default`, pero por las dudas), se usa
  `now()` de la migración y se anota en `motivo`.

**`precio_anterior = NULL` + `usuario_id = NULL`** son la firma inequívoca de "esto
es un ancla de migración, no un cambio hecho por alguien". La UI los muestra como
"precio inicial", sin flecha de variación.

**Consultar una fecha anterior a ese registro** devuelve "sin dato" — correcto,
porque no lo sabemos.

Este backfill corre dentro del `upgrade()` de la migración
(`INSERT ... SELECT ...`), es idempotente (guarda: no insertar si la tabla ya
tiene filas para esa entidad) y se revierte solo al hacer `drop_table` en
`downgrade()`.

---

### Decisión 8 — ¿`Float` o `Numeric`?

**Las columnas nuevas (`precio_nuevo`, `precio_anterior`) nacen `Numeric(10, 2)`.**

- Es el precedente correcto que el repo **ya tiene**: `Usuario.tarifa_consulta`,
  `Abono.monto`, `Liquidacion.total`, `LiquidacionDetalle.tarifa_aplicada` — las
  4 columnas de dinero de las features nuevas — son `Numeric(10, 2)`.
- `Float` en precios produce totales que no cuadran por centavos. Un historial
  que va a alimentar gráficos y cálculos de variación **no puede** arrastrar cola
  binaria.

**Esta tarea NO unifica los 20 `Float` de facturación y clínica.**

- Tocar `precio_unitario`, `precio_ref`, los 6 `precio_aplicado`, los 6 campos de
  `Factura`/`DetalleFactura`, `costo_unitario`, etc. es un refactor transversal
  que arrastra `crear_factura`, presupuestos, liquidaciones y **toda la suite
  `e2e/`** — sin ninguna relación con historizar precios.
- Meterlo acá haría la tarea imposible de revisar. Se documenta como **deuda
  técnica explícita**, exactamente como la Tarea 07 hizo con
  `detalles_factura.cantidad` (la dejó `Integer` y lo anotó).

**Borde de la conversión Float → Numeric:** cuando el helper lee
`Inventario.precio_unitario` (`Float`) para guardarlo como `precio_anterior`
(`Numeric`), se cuantiza:
`Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`. El
`str()` evita heredar la basura binaria del `float`. La misma cuantización se usa
para comparar "¿es el mismo precio?" en el guard de "no registrar si no cambió".

---

## Alcance de la Fase 2 (para contexto, no para aprobar ahora)

Tras tu OK a las 8 decisiones:

1. **Migración Alembic** encadenada desde HEAD `b8c9d0e1f2a3`. `create_table`
   plano ×2 con guardas de idempotencia (`inspector.get_table_names()`), índices,
   FKs (incluida la self-FK `corrige_id`). Backfill de registros iniciales
   (Decisión 7) en el mismo `upgrade()`. `downgrade()` = `drop_table` ×2.
   **Nota de deploy:** este repo **no corre `alembic upgrade` en el pipeline** —
   el esquema se materializa con `Base.metadata.create_all()` al arrancar
   (`main.py:29`), deuda ya documentada en `docs/tareas/04`. Por eso el backfill
   de la Decisión 7 se implementa **también** como una función idempotente
   (`WHERE NOT EXISTS`) que corre después de `create_all()` en `main.py` y en
   `scripts/init_db.py`. La migración queda como head registrado y como camino
   válido si alguien sí corre Alembic; el runtime no depende de ella.
2. **Modelos + schemas:** `HistorialPrecioInventario`, `HistorialPrecioServicio`
   en `models.py`; `HistorialPrecioBase` / `HistorialPrecioRead` en `schemas.py`.
   Relaciones `Inventario.historial_precios` / `CatalogoServicio.historial_precios`.
3. **Helper `registrar_cambio_precio`** (Decisión 4) en un módulo de servicio
   nuevo (`services/precio_service.py`) — el repo ya tiene `services/`.
4. **Enganche en los `PUT`:** `inventario.py:71-87` y `catalogo.py:79-95` sacan el
   precio del loop genérico y lo pasan por el helper cuando cambió. Guard de
   "mismo precio → no registra".
5. **Endpoints de lectura:**
   - `GET /api/inventario/{id}/historial-precios?desde=&hasta=`
   - `GET /api/catalogo/{id}/historial-precios?desde=&hasta=`
   - `GET /api/inventario/{id}/movimientos?tipo=ENTRADA&desde=&hasta=` (curva de
     costo — hoy `MovimientoInventario` no tiene lector).
6. **Front:** desde la ficha de un material y de un servicio, un panel "Historial
   de precios" — tabla `fecha · precio · variación (±% y ±$) · motivo · quién`,
   con toggle "ocultar correcciones". Si se grafica la evolución: **leer antes la
   skill `dataviz`** — es una serie temporal (línea escalonada / step), no barras
   de colores. Para materiales, superponer la curva de costo.
7. **Permisos** (aplicados en el backend, no escondiendo botones) — **decidido**:
   - **Cambiar precios:** **solo `admin`**. El gate es **específico del cambio de
     precio**, no del endpoint entero: `PUT /inventario/{id}` y
     `PUT /catalogo/{id}` pasan a `Depends(get_current_user)` (hoy no tienen
     ninguna auth), y **solo si el payload cambia `precio_unitario` / `precio_ref`**
     se exige `current_user.role == "admin"` → si no, `403`. Así un
     `veterinario` sigue pudiendo editar nombre, `stock_minimo`, proveedor, etc.
     — no se regresiona la edición no-precio. (La tarea menciona `recepcionista`,
     rol que **no existe en el backend**; los roles reales son `admin`,
     `veterinario`, `user`.)
   - **Ver el historial:** cualquier usuario autenticado
     (`Depends(get_current_user)`).
   - **Riesgo e2e:** agregar `get_current_user` a endpoints hoy abiertos puede
     romper specs que peguen sin token (p. ej. `inventario.spec.js`, "API pura").
     Verificar y, si hace falta, que esos specs se logueen — sin debilitar
     aserciones.
8. **Tests e2e** (los 6 casos de la tarea) sin debilitar aserciones existentes;
   actualizar selectores si el panel nuevo mueve algo.

### Restricciones que se respetan

- **No se reescribe ningún precio ya congelado** en facturas, consultas,
  vacunaciones, etc. Una factura de marzo sigue mostrando el precio de marzo. El
  historial es una fuente **paralela**, nunca se usa para "recalcular" documentos
  viejos.
- **Cero dependencias nuevas.**
- **Nada de triggers de DB** — la escritura del historial es explícita en el
  helper, coherente con que todo el movimiento de stock del repo es explícito en
  los handlers.

### Riesgos conocidos a vigilar en Fase 2

- **`inventario.py` / `catalogo.py` sin auth hoy:** agregar `get_current_user`
  puede romper llamadas internas o tests que asumen endpoints abiertos. Revisar
  `e2e/` y seeds antes de cerrar.
- **`precio_ref` es nullable y `default 0.0`:** un servicio con `precio_ref = None`
  o `0.0` genera un registro inicial con `precio_nuevo = 0`. Aceptable, pero la
  UI debe distinguir "gratis" de "sin precio cargado".
- **`precio_variable = True`:** para esos servicios el `precio_ref` es solo
  orientativo. El historial lo registra igual (es lo que la clínica declara como
  referencia), pero el texto de la UI debe aclararlo. Cambios de `precio_variable`
  (el booleano) **no** entran al historial — el historial es de números; se anota
  como deuda menor.
- **Conversión `Float → Numeric` en el backfill:** `precio_unitario = 199.99`
  almacenado como `float` puede venir como `199.99000000000001`. El
  `Decimal(str(x)).quantize(...)` lo resuelve; verificar con un material de
  precio "feo" en los tests.
- **Doble cuantización:** el guard "mismo precio no registra" y el valor
  persistido tienen que usar **la misma** función de cuantización, o un cambio de
  `100.001` a `100.004` se registra pero se guarda dos veces `100.00`.
