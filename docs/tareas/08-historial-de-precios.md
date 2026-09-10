# Tarea 08 — Historial de precios de materiales y servicios

> Prompt para pegar en Claude Code, desde la raíz del repo de AmiVets.
>
> Misma estructura que la tarea 07: **fase de diseño con punto de parada**, y
> recién después la implementación.

---

## PROMPT

### Lo que necesito

Que cada **material del inventario** y cada **servicio del catálogo** tengan
historial de precios. Hoy solo existe el precio actual: cuando se cambia, el
anterior se pierde. Necesito poder ver cómo evolucionó el precio de cada cosa a
lo largo del tiempo.

---

## FASE 1 — Diseño (sin escribir código)

### 1.1 Lo que ya está en el código

Confírmalo y complétalo antes de diseñar:

**Los precios actuales viven en dos campos sueltos, sin historia:**

- `Inventario.precio_unitario` — `Float`
- `CatalogoServicio.precio_ref` — `Float`, con un `precio_variable` booleano al
  lado

Cuando se hace `PUT /inventario/{id}` o `PUT /catalogo/{id}`, ese valor se
sobrescribe y no queda rastro.

**Pero el precio *cobrado* sí queda registrado en cada documento.** El sistema
ya congela el precio en el momento de la operación, en varios lugares:

| Dónde | Campo |
|---|---|
| `DetalleFactura` | `precio_unitario` |
| `ServicioConsulta` | `precio_unitario` |
| `Consulta` | `precio_consulta` |
| `Vacunacion`, `Desparasitacion`, `PruebaComplementaria`, `Cirugia`, `Hospitalizacion` | `precio_aplicado` |
| `Usuario` | `tarifa_consulta` (la del veterinario) |

**Y el costo de compra también, parcialmente:**
`MovimientoInventario.costo_unitario` guarda a qué costo entró cada lote.

Esto importa para el diseño: parte de la historia **ya es reconstruible** desde
las facturas y los movimientos. Lo que no existe es la historia de la **tarifa
de lista** — el precio que la clínica declara, independientemente de si alguien
compró ese día. Un material que no se vendió en tres meses no tiene ningún
registro de qué precio tenía en ese período.

### 1.2 Decisiones que tienes que tomar

Escribe tu propuesta en `docs/diseno/historial-precios.md`, con recomendación
propia en cada punto:

**1. ¿Precio de venta, costo de compra, o los dos?** Para un servicio solo hay
precio de venta. Para un material hay ambos, y el margen entre los dos es
justamente lo interesante. Decide el alcance y justifícalo.

**2. ¿Una tabla de historial o dos?** Materiales y servicios son entidades
distintas (`Inventario` y `CatalogoServicio`). Una tabla polimórfica con
`tipo_entidad` + `entidad_id` es compacta pero pierde la integridad
referencial; dos tablas son más verbosas pero cada una con su clave foránea
real. Decide.

**3. ¿Rangos de vigencia o solo eventos de cambio?** Guardar
`(precio, fecha_desde, fecha_hasta)` permite preguntar "¿cuánto costaba el 15
de marzo?" con una consulta directa, pero exige mantener consistente el cierre
de cada período. Guardar solo `(precio_nuevo, precio_anterior, fecha_cambio)` es
más simple de escribir pero obliga a reconstruir la vigencia al leer. Decide.

**4. ¿Se conserva `precio_unitario` / `precio_ref` en la tabla original?**
Tenerlo duplicado (el actual en la entidad, más el historial) es redundante pero
rápido de leer y no rompe nada del código existente. Derivarlo siempre del
historial es más limpio pero toca todos los lugares que hoy lo leen. Decide, y
si eliges duplicar, define quién garantiza que no se desincronicen.

**5. ¿Qué se registra además del precio?** Como mínimo: quién lo cambió y
cuándo. Evalúa si hace falta un motivo (ajuste por inflación, cambio de
proveedor, corrección de error) — en un contexto de precios en dólares que se
mueven seguido, saber *por qué* subió puede valer más que el número.

**6. ¿Se puede corregir o borrar un registro del historial?** Un historial que
se puede editar no es un historial. Pero un error de tipeo que multiplica un
precio por diez y queda ahí para siempre tampoco sirve. Decide (una corrección
puede ser un registro nuevo que anula al anterior, en lugar de un `UPDATE`).

**7. ¿Qué hacer con los precios que ya existen?** Al crear el historial, cada
material y servicio tiene un precio actual sin fecha de inicio conocida. Define
el registro inicial y de qué fecha lo datas, sin inventar datos.

**8. ¿`Float` o `Numeric`?** Son montos de dinero. La respuesta correcta es la
misma que en la tarea 07, y aquí importa más: `Float` en precios produce totales
que no cuadran por centavos. Nota que el código ya es inconsistente — `Float` en
`Inventario.precio_unitario` y `Numeric(10,2)` en `Usuario.tarifa_consulta` y en
`Abono.monto`. Decide si esta tarea unifica eso o lo deja documentado como deuda.

### 1.3 Punto de parada

Muéstrame las ocho decisiones resumidas en una línea cada una. No toques
modelos ni migraciones hasta que apruebe.

---

## FASE 2 — Implementación (tras aprobación)

- Migración en `backend/alembic/`, reversible.
- El registro en el historial se crea **automáticamente** al cambiar el precio,
  en la capa de servicio o en el router — nunca dependiendo de que el front se
  acuerde de llamar a un endpoint aparte.
- Endpoint de consulta del historial de una entidad, con rango de fechas
  opcional.
- En el front: desde la ficha de un material o de un servicio, ver su historial
  —tabla con fecha, precio, variación respecto al anterior y quién lo cambió.
  Si vas a graficar la evolución, **lee antes la skill `dataviz`**: es una serie
  temporal, no un gráfico de barras de colores.
- Permisos: quién puede cambiar precios y quién puede ver el historial. Hoy los
  roles son `admin`, `veterinario` y `recepcionista`. Decide y aplícalo en el
  backend, no solo escondiendo botones en la interfaz.

### Restricciones

- **No reescribas los precios ya congelados en documentos históricos.** Una
  factura de marzo tiene que seguir mostrando el precio de marzo. Si en algún
  punto se te ocurre "recalcular" facturas viejas con el precio del historial,
  eso es un error, no una mejora.
- Nada de dependencias nuevas.
- Sin romper la suite `e2e/`: actualiza selectores, no debilites aserciones.

### Pruebas

- Cambiar el precio de un material crea exactamente un registro de historial.
- Cambiarlo dos veces el mismo día no colapsa los registros ni los pierde.
- Guardar el mismo precio que ya tenía **no** crea un registro (no es un cambio).
- Consultar el precio vigente en una fecha pasada devuelve el correcto, incluido
  el caso de una fecha anterior al primer registro.
- Una factura emitida antes de un cambio de precio sigue mostrando el precio
  viejo después del cambio.
- Un usuario sin permiso no puede cambiar precios ni por API directa.

### Al terminar

Resume las decisiones implementadas, la migración y cómo se revierte, y cómo
verlo funcionando a mano: cambiar un precio dos veces y ver el historial.
