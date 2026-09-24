# Tarea 09 — Los servicios se anexan desde la consulta, no desde pestañas aparte

> Prompt para pegar en Claude Code, desde la raíz del repo de AmiVets.
>
> **Relación con otras tareas — lee esto primero.** La tarea 06 (rediseño del
> front con la propuesta 1A) da libertad para rearmar la navegación y los
> flujos. Esta tarea 09 es la instrucción concreta de **cómo** debe quedar ese
> flujo. Si vas a hacer las dos, hazlas juntas o haz primero la 06 y luego esta
> encima; lo que no sirve es hacer la 09 y que después la 06 rediseñe la
> navegación ignorándola. Si estás ejecutando la 06 ahora mismo, incorpora este
> documento como requisito de esa tarea.

---

## PROMPT

### Lo que necesito

Hoy cada tipo de servicio vive en su propia sección del menú lateral, y el
trabajo real de la clínica queda partido entre pestañas que no se hablan.

Quiero que **la consulta sea el centro**. Desde la pantalla principal:

- **Agregar consulta** — el flujo normal: llega el paciente, se abre su consulta,
  y desde ahí se le van anexando los servicios que se le van haciendo
  (vacunación, laboratorio, cirugía, hospitalización, estética, insumos).
- **Agregar servicio directo** — para lo que no amerita consulta: viene alguien
  solo a que le corten las uñas al perro, o solo a comprar un antipulgas.

En general, todo servicio se anexa **a partir de la consulta**. El servicio
directo es la excepción, no el camino principal.

---

## FASE 1 — Diseño (sin escribir código)

### 1.1 Lo que ya está en el código

Confírmalo antes de diseñar, porque cambia bastante el tamaño del trabajo:

**El modelo de datos ya unifica los servicios.** `ServicioConsulta` existe y
tiene `tipo_servicio` con los valores `VACUNACION`, `CIRUGIA`,
`HOSPITALIZACION`, `LABORATORIO`, `INSUMO`, `ESTETICA`, más `referencia_id`
apuntando a la tabla clínica específica, `cantidad` (ya es `Float`),
`precio_unitario`, `estado` (`Pendiente` / `Aplicado`), `facturado` y
`detalles_clinicos`.

O sea: **la fragmentación es de la interfaz, no del modelo.** El backend ya
está pensado para que una consulta tenga una lista heterogénea de servicios.

**Pero `ServicioConsulta.consulta_id` es `nullable=False`.** Eso significa que
hoy **un servicio no puede existir sin una consulta**, y es exactamente el
obstáculo del "agregar servicio directo". Lo mismo pasa con
`Vacunacion.consulta_id` y `Desparasitacion.consulta_id`. En cambio
`PruebaComplementaria`, `Cirugia` y `Hospitalizacion` sí aceptan
`consulta_id = NULL`. La inconsistencia ya está ahí.

**La `Consulta` tiene ocho relaciones separadas** hacia `pruebas`, `recetas`,
`vacunaciones`, `desparasitaciones`, `cirugias`, `hospitalizaciones`,
`servicios` y `facturas`. Averigua cuáles se llenan de verdad hoy y cuáles
quedaron sin uso — puede haber dos caminos paralelos para lo mismo
(`Vacunacion` como tabla propia y `ServicioConsulta` con
`tipo_servicio='VACUNACION'`), y hay que decidir cuál manda.

**En el front**, las secciones son `sec-consultorio`, `sec-agenda`,
`sec-propietarios`, `sec-inventario`, `sec-facturacion`, `sec-reportes`,
`sec-ordenes-medico`, `sec-citas-web`, `sec-catalogo`, `sec-usuarios` y
`sec-perfil`, más unos 25 modales (`modalConsulta`, `modalDetalleConsulta`,
`modalReceta`, `modalCita`, `modalResumenDia`, etc.).

### 1.2 Decisiones que tienes que tomar

En `docs/diseno/flujo-consulta-servicios.md`, con recomendación propia:

**1. ¿Cómo se representa un servicio sin consulta?** Dos caminos: hacer
`consulta_id` nullable, o crear siempre una consulta "ligera" implícita que
agrupe el servicio suelto. La segunda mantiene un solo camino en todo el
sistema —facturación, liquidaciones, reportes e historial de la mascota ya
cuelgan de la consulta— a costa de crear consultas que clínicamente no lo son.
La primera es más honesta con la realidad pero obliga a revisar cada consulta
SQL y cada reporte que asume que todo servicio tiene consulta. **Revisa el
impacto en `facturacion_service.py`, en `LiquidacionDetalle` (que tiene
`consulta_id` único y no nulo) y en los reportes antes de decidir.**

**2. ¿`ServicioConsulta` pasa a ser la única puerta de entrada?** Si sí, define
qué pasa con `Vacunacion`, `Desparasitacion`, `Cirugia`, `Hospitalizacion` y
`PruebaComplementaria`: siguen existiendo como tablas de detalle clínico
apuntadas por `referencia_id`, o se absorben. No las borres sin resolver qué
pasa con los datos que ya tienen.

**3. ¿Qué secciones del menú desaparecen y qué queda?** `sec-ordenes-medico`
existe porque las órdenes están sueltas; si todo cuelga de la consulta, quizá
sobre, o quizá deba convertirse en una bandeja de trabajo del veterinario.
Decide qué se elimina, qué se convierte en vista dentro de la consulta y qué se
mantiene como sección propia (inventario, facturación, reportes y catálogo
probablemente sí siguen).

**4. ¿Cómo se ve la consulta abierta?** Es la pantalla donde va a vivir la
clínica todo el día. Necesita: datos del paciente arriba, la lista de servicios
anexados con su estado, un botón para anexar uno nuevo, el total acumulado, y el
paso a facturación. Diséñala tú; si la propuesta 1A de Claude Design (tarea 06)
dice algo al respecto, manda 1A.

**5. ¿Anexar un servicio es un modal o algo mejor?** Hoy todo es modal. Anexar
tres servicios seguidos abriendo y cerrando tres modales es peor que un panel
lateral o una fila que se agrega en línea. Decide.

**6. ¿Qué pasa con las consultas abiertas?** Si una consulta queda a medias —el
paciente se fue, el veterinario no la cerró— tiene que haber forma de
retomarla. Define el estado de una consulta y quién la ve pendiente.

**7. ¿Permisos por rol en el flujo nuevo?** Una recepcionista puede abrir una
consulta y anexar un servicio directo; probablemente no puede anexar una cirugía
ni registrar un diagnóstico. Define la matriz y aplícala **en el backend**, no
solo escondiendo botones.

**8. ¿Cómo entra esto en facturación?** Hoy `facturacion_service.py` factura a
partir de `DetalleFactura` con `producto_id` o `servicio_id`. Si el flujo nuevo
concentra todo en `ServicioConsulta`, la factura de una consulta debería salir
de su lista de servicios casi sin intervención. Define cómo.

### 1.3 Punto de parada

Muéstrame las ocho decisiones en una línea cada una, más un boceto de cómo queda
el menú lateral (o lo que lo reemplace) y de la pantalla de consulta abierta. No
escribas código hasta que apruebe.

---

## FASE 2 — Implementación (tras aprobación)

Por etapas, commiteando cada una:

1. Migración de esquema (Alembic, reversible) con lo que haya salido de las
   decisiones 1 y 2.
2. Endpoints: abrir consulta, anexar servicio, cambiar estado de un servicio,
   quitarlo, crear servicio directo.
3. La pantalla de consulta abierta.
4. La entrada desde la pantalla principal: "Agregar consulta" y "Agregar
   servicio directo".
5. Limpieza del menú y de las secciones que dejaron de tener sentido.
6. Facturación desde la consulta.

### Restricciones

- **Ningún dato clínico se pierde.** Las consultas, vacunaciones y cirugías que
  ya existen tienen que seguir visibles en el historial de cada mascota después
  de la migración. Si una tabla se absorbe, sus datos se migran; no se
  abandonan.
- La facturación tiene que seguir cuadrando, y las liquidaciones de
  veterinarios también (`LiquidacionDetalle` cuelga de `consulta_id`, así que
  cualquier cambio en el modelo de consulta lo toca).
- Sin dependencias nuevas de front.
- Todo el texto de UI en español, con la terminología de la clínica.

### Pruebas

`e2e/flujo-clinico.spec.js` y `e2e/clinico.spec.js` cubren justo el flujo que
estás cambiando: son la red de seguridad. Actualiza selectores, **no debilites
aserciones**, no marques nada como `skip`. Si un test ya no aplica porque el
flujo cambió, reescríbelo para el flujo nuevo y explica por qué.

Agrega pruebas para:

- Abrir una consulta, anexarle tres servicios de tipos distintos, y que los tres
  queden asociados a esa consulta.
- Crear un servicio directo sin consulta, y que aparezca en el historial de la
  mascota y se pueda facturar.
- Facturar una consulta con servicios anexados produce una factura con todas las
  líneas y el total correcto.
- Una consulta a medias se puede retomar y completar.
- Una recepcionista no puede anexar los servicios que le prohibiste, ni llamando
  a la API directamente.
- Las consultas y servicios cargados **antes** de la migración siguen visibles
  en el historial.

### Al terminar

Resume: las decisiones implementadas, qué secciones del menú desaparecieron y
dónde quedó cada función, la migración y cómo se revierte, y un recorrido a mano
de principio a fin — paciente llega, consulta, tres servicios, factura.
