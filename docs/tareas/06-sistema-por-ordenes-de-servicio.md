# Tarea 06 — El sistema gira alrededor de la Orden de Servicio

> Prompt para pegar en Claude Code, desde la raíz del repo de AmiVets.
>
> **Reemplaza a la tarea 06 anterior** (rediseño con la propuesta 1A de Claude
> Design). Esa dirección queda descartada: el módulo de órdenes de servicio la
> deja obsoleta.
>
> **También absorbe la tarea 09** (servicios anexados desde la consulta). No
> ejecutes la 09 por separado; sus decisiones están resueltas aquí.
>
> Tiene **dos fases con un punto de parada obligatorio**. La fase 1 es diseño de
> modelo; no se escribe código de aplicación hasta que yo lo apruebe.

---

## PROMPT

### 1 · El flujo real de la clínica

Todo el sistema gira alrededor de la **Orden de Servicio**. Esta es la secuencia
que hay que soportar, tal como ocurre en el mostrador:

1. **Llega el animal.** Recepción abre una orden de servicio y **asigna un
   veterinario**.
2. **El veterinario toma la orden.** Registra los datos de la consulta y decide
   qué servicios se le van a aplicar al paciente.
3. **Cada servicio se despacha a quien lo ejecuta.** Al confirmar los servicios,
   a cada encargado le llega la notificación de lo que le toca: rayos X al
   encargado de imagen, el hemograma al de laboratorio, el baño al de estética.
4. **El gestor ejecuta y carga el resultado.** Entra a su bandeja, ve la orden
   que le asignaron, hace el trabajo y sube lo que corresponda — el informe de
   rayos X, el PDF del laboratorio, la foto del antes y después.
5. **La orden se cierra y se factura** con todo lo que se le hizo al paciente.

La consulta clínica **no es el contenedor**: es un servicio más dentro de la
orden. Eso importa porque hay órdenes sin consulta —vino solo a que le corten
las uñas, o solo a comprar un antipulgas— y hoy el sistema no las admite.

### 2 · Los roles

| Rol | Qué hace |
|---|---|
| **Administrador** | Todo. Usuarios, catálogo, precios, anulaciones. |
| **Recepción** | Abre órdenes, registra mascotas y tutores, asigna veterinario, cobra y factura. No registra datos clínicos. |
| **Veterinario** | Toma la orden asignada, registra la consulta, decide y confirma los servicios, ve la historia clínica completa. |
| **Gestor de servicio** | Recibe en su bandeja los servicios de su especialidad, los ejecuta y carga los resultados. No ve el resto de la orden más allá de lo que necesita para hacer su trabajo. |

Un gestor está ligado a **uno o varios tipos de servicio** (laboratorio, imagen,
estética, quirófano). El despacho del paso 3 usa esa relación: el servicio va a
quien tiene ese tipo asignado.

Una misma persona puede tener más de un rol — en una clínica chica el
veterinario a veces también es quien hace la ecografía. Contémplalo.

### 3 · Lo que ya está en el código

Verifícalo antes de diseñar; son los tres puntos que definen el tamaño del
trabajo:

**a) Los roles existen a medias.** `backend/app/routers/usuarios.py:71` define
`ROLES_VALIDOS = {"admin", "veterinario", "recepcionista", "user"}`. Falta
`gestor`, y no hay ninguna tabla que relacione un usuario con los tipos de
servicio que atiende.

**b) ⚠️ El guard de roles deja pasar a los anónimos.** `require_roles()`
(`usuarios.py:74`) depende de `get_optional_current_user` y su condición es:

```python
if current_user is not None and current_user.role not in roles:
    raise HTTPException(403, ...)
```

Una petición **sin token** tiene `current_user = None`, no entra en el `if`, y
pasa. Es decir: hoy ese decorador filtra a los usuarios logueados con el rol
equivocado, pero **no filtra a quien no está logueado en absoluto**. Montar un
sistema de roles encima de eso no sirve de nada. Arreglarlo es el requisito
cero de esta tarea — antes de agregar `gestor`, antes de las bandejas.

Revisa cada endpoint que usa `require_roles` para entender si alguno depende a
propósito de ese comportamiento permisivo (el agendamiento público por QR es el
candidato), y si lo hay, sepáralo en una dependencia propia y explícita en vez
de dejar el agujero abierto para todos.

**c) No existe carga de archivos.** No hay un solo `UploadFile` en el backend.
`PruebaComplementaria.archivo_url` y `ConsentimientoInformado.archivo_adjunto_url`
son columnas de texto que nadie escribe. El `.gitignore` ya reserva
`static/uploads/`, así que alguien lo anticipó, pero no está hecho.

**d) El modelo de servicios ya está unificado, la interfaz no.**
`ServicioConsulta` tiene `tipo_servicio` (VACUNACION, CIRUGIA, HOSPITALIZACION,
LABORATORIO, INSUMO, ESTETICA), `referencia_id` a la tabla clínica específica,
`cantidad` (ya `Float`), `precio_unitario`, `estado` (`Pendiente` / `Aplicado`),
`facturado` y `detalles_clinicos`. Pero `consulta_id` es `NOT NULL`, igual que
en `Vacunacion` y `Desparasitacion`.

---

## FASE 1 — Diseño de modelo (sin escribir código de aplicación)

Escribe tu propuesta en `docs/diseno/ordenes-de-servicio.md`, con recomendación
propia y justificada en cada punto.

**1. La tabla de órdenes.** Campos mínimos: número, mascota, tutor, estado,
veterinario asignado, quién la abrió, apertura y cierre. Define el estado y sus
transiciones legales — `Abierta → En atención → Cerrada → Facturada`, más
`Anulada` — y quién puede provocar cada una.

**2. Migrar lo que ya existe.** Cada `Consulta` actual tiene que quedar dentro
de una orden, sin perder nada. Define cómo se generan esas órdenes históricas y
con qué fecha y responsable.

**3. `ServicioConsulta` pasa a colgar de la orden.** Decide si se renombra, si
`consulta_id` se vuelve nulo, o si la consulta se convierte en un servicio con
su propia tabla de detalle. Revisa el impacto en `facturacion_service.py` y en
`LiquidacionDetalle`, que tiene `consulta_id` único y no nulo.

**4. El estado de un servicio.** `Pendiente`/`Aplicado` no alcanza para el flujo
de despacho. Necesita algo como `Solicitado → Asignado → En proceso → Ejecutado
→ Facturado`, más `Cancelado`. Define quién mueve cada transición y qué pasa con
el inventario en cada una — el consumo de insumos de la tarea 07 se dispara en
una de ellas, elige cuál y sé consistente con lo que decida esa tarea.

**5. Asignación y despacho.** Cómo se relaciona un gestor con los tipos de
servicio que atiende, y qué pasa cuando hay varios gestores para un tipo, o
ninguno. Un servicio sin gestor disponible no puede desaparecer en silencio.

**6. Notificaciones.** Qué se guarda, cuándo se marca como leída, y si además
del aviso dentro de la aplicación hace falta algo más. **No** implementes correo
ni WhatsApp en esta tarea: define el modelo de forma que se pueda agregar
después, y deja el aviso dentro de la aplicación.

**7. Documentos adjuntos.** Una tabla de adjuntos ligada al servicio —nombre
original, tipo, tamaño, quién lo subió, cuándo, ruta— en vez de una columna de
texto por cada tabla clínica. Define qué tipos de servicio **exigen** un adjunto
para pasar a `Ejecutado` (rayos X sí, baño no) y cómo se configura eso sin
tocar código.

**8. Dónde se guardan los archivos.** Disco local bajo `static/uploads/` es lo
más simple y es lo que el `.gitignore` anticipa, pero hay que resolver: que la
ruta no sea adivinable ni permita salirse del directorio, que se valide tipo y
tamaño reales (no la extensión), que el archivo no se sirva sin verificar quién
lo pide, y que entre en el respaldo. Si propones otra cosa, justifícala contra
el despliegue real: Docker en un servidor de la oficina, con la base en un
volumen.

**9. La matriz de permisos.** Rol por rol y acción por acción, aplicada **en el
backend**. Esconder botones no es un permiso.

### Punto de parada

Muéstrame las nueve decisiones resumidas en una línea cada una, más el diagrama
de estados de la orden y del servicio. No toques modelos ni migraciones hasta
que apruebe.

---

## FASE 2 — Implementación (tras aprobación)

### Las pantallas

Están diseñadas y son la referencia visual: **`docs/diseno/pantallas/`**, nueve
archivos HTML autocontenidos que se abren en el navegador. Su `README.md` trae
los tokens exactos —colores, tipografías, radios, sombras, alturas de control—
y `docs/diseno/arquitectura-informacion-v2.md` explica la estructura.

**Copia los valores literales de esos archivos.** No los redondees a una
cuadrícula de 4/8 px ni los sustituyas por los de un framework.

Dos pantallas del flujo **todavía no están diseñadas** y las vas a necesitar:

- **Inicio — los seis módulos.** La pantalla de entrada es el lanzador de
  módulos del boceto: seis tarjetas grandes (1 Admisión · 2 Servicios ·
  3 Mascotas/Tutores · 4 Insumos · 5 Facturación · 6 KPI/Reportes), no un
  tablero de indicadores. El "Panel del día" que ves en `Main.html` es la
  portada **del módulo 1**, no la del sistema. Las tarjetas que el rol del
  usuario no puede usar no se muestran.
- **Bandeja del gestor.** La cola de trabajo de un gestor: los servicios que le
  asignaron, con el paciente, la orden de origen, desde cuándo espera, y el
  botón para ejecutar y cargar el resultado.

Diséñalas siguiendo exactamente el mismo sistema visual de las otras nueve.

### Orden de trabajo

Commitea cada etapa por separado, en una rama propia:

1. **El arreglo de `require_roles`** y el rol `gestor`. Nada más. Que la suite
   pase antes de seguir.
2. Migración: órdenes de servicio, estados, asignación, adjuntos,
   notificaciones. Reversible.
3. Migración de datos: las consultas existentes quedan dentro de órdenes.
4. Endpoints de orden: abrir, asignar veterinario, tomar, anexar servicio,
   confirmar servicios, cerrar.
5. Despacho y bandejas: notificación al gestor, su cola, ejecutar, cargar
   resultado.
6. Carga de archivos, con validación y control de acceso.
7. Pantallas: inicio de módulos, panel del día, orden abierta, anexar servicio,
   bandeja del gestor.
8. Resto de pantallas y limpieza del menú viejo.

Después de cada etapa, dime en una línea qué quedó listo.

### Restricciones

- **Ningún dato clínico se pierde.** Consultas, vacunaciones, cirugías y pruebas
  que ya existen siguen visibles en la historia de cada mascota después de la
  migración.
- La facturación tiene que seguir cuadrando, y las liquidaciones de veterinarios
  también.
- No implementes correo ni mensajería externa en esta tarea.
- Sin dependencias nuevas de front. En el backend, si necesitas algo para
  manejar archivos, justifícalo.
- Todo el texto de UI en español, con la terminología de la clínica: tutor,
  paciente, orden de servicio, gestor.

### Pruebas

`e2e/` tiene 13 specs; `flujo-clinico.spec.js` y `clinico.spec.js` cubren
justo lo que estás cambiando. Actualiza selectores, **no debilites aserciones**,
no marques nada como `skip`.

Pruebas nuevas, en orden de importancia:

- **Un endpoint protegido rechaza la petición sin token.** Esta es la primera
  que tiene que existir y la que no puede fallar nunca.
- Recepción abre una orden y asigna veterinario; el veterinario la ve en su lista.
- El veterinario anexa tres servicios de tipos distintos y al confirmarlos se
  crea una notificación para el gestor de cada tipo.
- El gestor solo ve en su bandeja los servicios de los tipos que tiene
  asignados, y no puede ejecutar uno de otro tipo ni llamando a la API directo.
- Un servicio que exige adjunto no pasa a `Ejecutado` sin él.
- Un archivo con extensión permitida pero contenido de otro tipo se rechaza.
- Un usuario sin permiso no puede descargar el adjunto de otra orden.
- Recepción no puede registrar un diagnóstico; el veterinario sí.
- Una orden sin consulta —solo estética— se crea, se ejecuta y se factura.
- Las consultas cargadas antes de la migración siguen visibles en la historia.
- Facturar una orden con servicios de varios gestores produce una factura con
  todas las líneas y el total correcto.

### Al terminar

Resume: las nueve decisiones tal como quedaron, la migración y cómo se revierte,
qué endpoints y pantallas se crearon, el estado del arreglo de `require_roles` y
qué endpoints dependían del comportamiento viejo, y un recorrido a mano de punta
a punta — llega el paciente, recepción abre y asigna, el veterinario carga la
consulta y tres servicios, el gestor de laboratorio recibe el suyo y sube el
PDF, recepción factura.
