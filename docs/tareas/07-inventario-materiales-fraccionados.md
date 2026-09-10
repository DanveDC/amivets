# Tarea 07 — Inventario de materiales con consumo fraccionado desde los servicios

> Prompt para pegar en Claude Code, desde la raíz del repo de AmiVets.
>
> **Esta tarea tiene dos fases con un punto de parada obligatorio entre ellas.**
> La fase 1 es auditoría y diseño; no se escribe código hasta que yo apruebe el
> diseño.

---

## PROMPT

### Lo que necesito, en lenguaje de la clínica

El inventario tiene que poder guardar **materiales** —alcohol, gasas, suero,
jeringas, anestésico— y no solo productos que se venden.

Esos materiales se consumen **al aplicar un servicio**, y muchas veces **en
fracciones**: una consulta usa media botella de alcohol, un tercio de un frasco
de anestésico, dos gasas de un paquete de cincuenta. Hoy no hay forma de
expresar eso.

Y el consumo no se registra a mano: **los servicios "llaman" a sus materiales.**
Cada servicio del catálogo debe saber qué materiales consume y en qué cantidad,
de modo que al aplicarlo el stock baje solo.

---

## FASE 1 — Auditoría y diseño (sin escribir código)

### 1.1 Levanta cómo funciona hoy

Lee y documenta el estado actual en `docs/tecnico/inventario-actual.md`:

- `backend/app/models/models.py` — modelos `Inventario`,
  `MovimientoInventario`, `CatalogoServicio`, `ServicioConsulta`,
  `DetalleFactura`, y los que referencian inventario:
  `DetalleReceta.medicamento_id`, `Vacunacion.vacuna_id`,
  `Desparasitacion.producto_id`, `HojaTratamiento.medicamento_id`
- `backend/app/routers/inventario.py` y `backend/app/routers/catalogo.py`
- `backend/app/services/facturacion_service.py` — es donde se mueve el stock
- El front: sección `sec-inventario` y `sec-catalogo` en
  `static/templates/index.html`, y su lógica en `static/js/app.js`

Estos son los hallazgos que ya tengo verificados; confírmalos y complétalos, no
los repitas sin revisar:

**a) El esquema no admite fracciones.** `Inventario.stock_actual` y
`stock_minimo` son `Integer`. `MovimientoInventario.cantidad` es `Integer`.
`DetalleFactura.cantidad` es `Integer`. El único campo que ya es `Float` es
`ServicioConsulta.cantidad`.

**b) No existe unidad de medida.** `Inventario` no tiene ningún campo que diga
si algo se mide en mililitros, gramos o unidades, ni cuánto contiene un envase.
"Media botella de alcohol" no tiene dónde vivir: no se sabe qué es una botella.

**c) No hay relación entre servicios y materiales.** `CatalogoServicio` tiene
ocho campos (nombre, categoria, precio_ref, precio_variable, unidad, activo,
created_at, id) y **ninguna** referencia a inventario. No hay tabla de receta o
lista de materiales. Esto es lo central de la tarea: no es extender algo, es
crear algo que no existe.

**d) El stock se mueve en dos únicos lugares:**

1. `POST /inventario/{producto_id}/movimiento` — ajuste manual
   (`inventario.py:101`)
2. `facturacion_service.py` — al **facturar**, si el `DetalleFactura` trae
   `producto_id`: valida stock, descuenta con `with_for_update()` (bien hecho,
   hay row-locking) y registra el `MovimientoInventario`. Al anular la factura,
   lo devuelve (línea ~281).

Es decir: **el stock baja cuando se cobra, no cuando se usa.** Ese es el
supuesto que esta tarea rompe, y hay que romperlo con cuidado.

**e) `ServicioConsulta` ya tiene `tipo_servicio = 'INSUMO'` y un
`referencia_id`** que puede apuntar a inventario. Averigua si eso se usa de
verdad hoy y cómo, porque puede ser el punto de anclaje natural o un camino
muerto que hay que limpiar.

### 1.2 Preguntas de diseño que tienes que responder

Escribe tu propuesta en `docs/diseno/inventario-fraccionado.md`. **Decide tú** y
justifica cada punto; no me devuelvas una lista de opciones sin recomendación.

**1. ¿En qué unidad se guarda el stock?**

Mi inclinación, para que la contrastes o la mejores: guardar el stock **siempre
en la unidad base** (ml, g, unidad) y no en envases. Un material tendría
`unidad_medida` ('ml') y `contenido_por_envase` (1000). Comprar dos botellas
suma 2000 ml; usar media botella resta 500 ml; la interfaz muestra "2,5
botellas" como presentación, no como dato almacenado.

La alternativa —guardar 2,5 envases como decimal— es más directa de leer pero
arrastra el problema de que "medio envase" significa distinto para una botella
de 1 litro que para una de 250 ml, y obliga a recalcular todo si cambia el
tamaño del envase que vende el proveedor. Evalúala y decide.

**2. ¿`Float` o `Numeric`?** El stock se va a sumar y restar cientos de veces.
Con `Float` los errores de redondeo se acumulan y un frasco vacío termina con
`0.0000001` restante. Justifica el tipo que elijas y su precisión.

**3. ¿Cuándo se descuenta el stock: al aplicar el servicio o al facturar?**

Clínicamente el material se gasta cuando se aplica, no cuando el dueño paga —
y hay consultas que se aplican y no se cobran nunca. Pero el sistema hoy
descuenta al facturar. Define el momento y, sobre todo, **cómo evitas el doble
descuento** con la lógica que ya existe en `facturacion_service.py`.

**4. ¿Qué pasa si no hay stock suficiente al aplicar?** Facturación hoy bloquea
con un 400. En medio de una consulta, bloquear puede ser peor que permitir y
avisar. Decide, y decide si depende del rol.

**5. ¿Materiales y productos son lo mismo?** Un material se consume vía
servicios; un producto (un collar, un alimento) se vende directo. Pueden
convivir en la misma tabla con un discriminador, o separarse. Decide.

**6. ¿La receta del servicio es fija o ajustable en el momento?** Un servicio
puede declarar "500 ml de alcohol", pero el veterinario quizá usó menos.
Define si la cantidad de la receta es un valor por defecto editable al aplicar,
o un valor cerrado.

**7. ¿Qué se hace con la fracción sobrante?** Media botella usada deja media
botella usable: no hay merma. Pero hay materiales que al abrirse se pierden
completos. Decide si hace falta marcar eso por material y cómo se registra
(`MovimientoInventario` ya tiene el tipo `MERMA`).

**8. Migración de los datos que ya existen.** El padrón real ya está cargado y
hay productos con stock entero. Define cómo se convierten a la nueva forma sin
perder nada y sin inventar contenidos de envase que nadie declaró.

### 1.3 Punto de parada

Cuando tengas `docs/tecnico/inventario-actual.md` y
`docs/diseno/inventario-fraccionado.md`, **para y muéstrame el diseño**.
Resúmeme en pantalla las ocho decisiones en una línea cada una. No escribas
código, no crees migraciones, no toques modelos hasta que yo apruebe.

---

## FASE 2 — Implementación (solo tras mi aprobación)

Lo que sigue es el alcance esperado; ajústalo a lo que quedó aprobado en el
diseño.

**Modelo y migración.** Los cambios de esquema van en una migración de Alembic
en `backend/alembic/`, no con `create_all`. La migración tiene que ser
reversible y no puede perder el stock existente.

**Receta de servicio.** Una tabla que relacione `CatalogoServicio` con
`Inventario` con cantidad y unidad, más su ABM en `routers/catalogo.py` y en la
sección de catálogo del front: al editar un servicio, poder agregar y quitar
materiales con su cantidad.

**Consumo al aplicar.** Cuando un `ServicioConsulta` pasa al estado que hayas
definido, se descuentan sus materiales y se registra un `MovimientoInventario`
por cada uno, con el `origen_destino` apuntando a la consulta y el
`usuario_responsable_id` de quien lo aplicó. Trazabilidad completa: desde un
movimiento se tiene que poder llegar a la consulta y a la mascota que lo
originó.

**Reversa.** Si el servicio se anula o se marca como no aplicado, el material
vuelve. Igual que ya hace facturación al anular.

**Concurrencia.** Usa `with_for_update()` como ya se hace en
`facturacion_service.py:301`. Dos veterinarios aplicando servicios a la vez no
pueden dejar el stock inconsistente.

**Front.** En inventario: mostrar la unidad y el stock en la presentación que
la gente entiende ("2,5 botellas · 2.500 ml"), y que las alertas de stock
mínimo sigan funcionando con decimales. En el catálogo: la receta de cada
servicio. Al aplicar un servicio en el consultorio: ver qué materiales va a
consumir y —si así lo decidiste— ajustar la cantidad.

### Restricciones

- No rompas lo que ya funciona: `DetalleReceta`, `Vacunacion`,
  `Desparasitacion` y `HojaTratamiento` también apuntan a `Inventario`. Revisa
  el impacto en cada uno antes de cambiar tipos.
- La facturación tiene que seguir cuadrando. Si el stock ya bajó al aplicar, el
  detalle de factura no puede volver a bajarlo.
- Sin dependencias nuevas.
- Todo el texto de UI en español, con la terminología de la clínica.

### Pruebas

La suite de Playwright en `e2e/` tiene `inventario.spec.js`,
`gestion-inventario.spec.js` y `flujo-clinico.spec.js`, y esta última verifica
que facturar descuenta stock. Esos tests son la red de seguridad:
actualiza los selectores si hace falta, **no debilites las aserciones**, y no
marques nada como `skip`.

Agrega pruebas para lo nuevo:

- Un servicio con receta de 500 ml de un material con 2.000 ml en stock, al
  aplicarse deja 1.500 ml.
- Aplicar el mismo servicio cuatro veces deja el stock en cero exacto, no en
  `0.0000001` ni en `-0.0000001`.
- Aplicar con stock insuficiente hace lo que definiste (bloquear o avisar), y lo
  hace de forma consistente.
- Anular el servicio devuelve exactamente lo que descontó.
- Facturar después de aplicar **no** descuenta dos veces.
- El stock mínimo alerta correctamente con valores decimales.
- La migración convierte un producto con stock entero sin perder cantidad.

### Al terminar

Resume: las ocho decisiones tal como quedaron implementadas, qué migración
creaste y cómo se revierte, qué archivos tocaste, qué quedó fuera de alcance, y
cómo probarlo a mano en el navegador con un caso concreto de principio a fin.
