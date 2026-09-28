# orden-veterinario-y-tutores Specification (Delta)

## Purpose

Rediseñar la sección "Historia clínica" (`sec-consultorio`) como una "Ficha del animal" centrada en órdenes de servicio: navegación de dos niveles (lista → ficha), tabs integrados para órdenes, servicios, notas y facturación, y un único punto de entrada para abrir trabajo nuevo ("+ Orden de servicio", panel inline) en el header/landing de la ficha. Los flujos de consulta que ya existen (Panel del día, Citas pendientes, la pantalla de consulta abierta) no se modifican: "Agregar consulta" solo se retira del header/landing de la ficha, no de la aplicación.

## ADDED Requirements

### Requirement: Ficha del animal — navegación de dos niveles Lista → Ficha

El sistema SHALL presentar, dentro de `sec-consultorio`, dos vistas: un listado de pacientes (buscador, filtros por especie/sexo/estado reproductivo/raza) y la ficha del paciente seleccionado. Al no haber ningún paciente seleccionado, la columna de la ficha SHALL mostrar un estado vacío invitando a elegir un paciente. Al seleccionar un paciente desde la lista, la ficha SHALL cargar sus datos y activar el tab "Resumen" por defecto.

#### Scenario: Seleccionar un paciente desde la lista
- **WHEN** el usuario hace click en un paciente del listado de `sec-consultorio`
- **THEN** la columna derecha muestra el header de la ficha (nombre, código, especie/raza/sexo, dueño) y el tab "Resumen" activo
- **AND** el listado de la izquierda sigue visible para elegir otro paciente sin recargar la sección

#### Scenario: Sin paciente seleccionado
- **WHEN** el usuario entra a `sec-consultorio` sin haber elegido un paciente todavía
- **THEN** la columna derecha muestra el mensaje "Seleccione un paciente de la lista para ver su historial médico"

### Requirement: Header de la ficha con datos del animal y acciones

En la ficha, el header SHALL mostrar el nombre de la mascota, especie/raza/sexo/estado reproductivo, código de historia clínica, y los botones Editar, Transferir y Eliminar mascota. Estos tres botones SHALL estar sujetos a las mismas reglas de autorización que ya aplica el backend: `PUT /api/mascotas/{id}`, `DELETE /api/mascotas/{id}` y `POST /api/mascotas/{id}/transferir` requieren rol `admin`, `recepcionista` o `veterinario` (`_ROLES_MASCOTAS` en `backend/app/routers/mascotas.py`). El frontend no SHALL introducir un ocultamiento de estos botones por rol que no exista ya en el resto de la aplicación; el backend sigue siendo la autoridad de permisos.

El header SHALL además mostrar un botón "+ Orden de servicio" que abre el panel inline descripto en el siguiente requisito, en reemplazo del botón que hoy dispara `abrirFormularioConsulta()` desde el header de la ficha.

#### Scenario: Ver los datos del animal en el header
- **WHEN** el usuario selecciona un paciente
- **THEN** el header muestra su nombre, código de historia, especie/raza/sexo y los botones Editar/Transferir/Eliminar/"+ Orden de servicio"

#### Scenario: Un rol sin permiso intenta editar la mascota
- **WHEN** un usuario autenticado con un rol distinto de `admin`/`recepcionista`/`veterinario` (si existiera) llama a `PUT /api/mascotas/{id}`
- **THEN** el backend responde 403, igual que hoy para el resto de los endpoints de `_ROLES_MASCOTAS`

### Requirement: Tab "Órdenes de servicio" (reemplaza al tab "Consultas" en la ficha)

El tab, antes llamado "Consultas" y que mostraba `GET /api/consultas/?mascota_id={id}`, SHALL pasar a mostrar las órdenes de servicio del animal vía `GET /api/ordenes/?mascota_id={id}&limit=200`, con columnas Número, Estado, Fecha de apertura, Veterinario y Total, y con las acciones que ya ofrece la pantalla de la orden (`abrirOrden`, anexar servicio, facturar, ver factura) según su estado.

El tab SHALL ofrecer un buscador que use el parámetro `search` de `GET /api/ordenes/` (ver Requirement "Búsqueda de órdenes por texto libre"), un select de estado y un rango de fechas sobre `fecha_apertura`.

El botón de acción del tab (antes "+ Nueva Consulta", que llamaba a `abrirFormularioConsulta()`) SHALL pasar a ser "+ Orden de servicio" y abrir el mismo panel inline que el botón del header.

Por compatibilidad, un `switchPetTab('consultas')` residual SHALL seguir resolviendo al tab de órdenes (alias en `PET_TAB_LEGACY`), sin que esto implique mantener contenido de consultas en ese tab.

#### Scenario: Ver las órdenes del animal
- **WHEN** el usuario abre el tab "Órdenes de servicio" de la ficha
- **THEN** ve una tabla con las órdenes de esa mascota, ordenadas por fecha de apertura descendente
- **AND** cada fila ofrece "Ver" y, según el estado de la orden, "+ Servicio", "Facturar" o "Ver factura"

#### Scenario: Ya no hay botón de "Agregar consulta" en este tab
- **WHEN** el usuario abre el tab "Órdenes de servicio"
- **THEN** el botón de acción del tab dice "+ Orden de servicio", no "+ Nueva Consulta"

### Requirement: Botón "+ Orden de servicio" — panel inline, no modal

El sistema SHALL ofrecer, en el header de la ficha y en el tab "Órdenes de servicio", un botón "+ Orden de servicio" que abre un **panel inline** dentro del área de contenido de la ficha (mismo ancho que la columna de contenido), no un modal nuevo. El panel SHALL pedir el veterinario (obligatorio, select poblado desde `GET /usuarios/veterinarios`) y un motivo de visita opcional; el paciente queda preseleccionado (el de la ficha abierta) y no es editable en el panel.

Al confirmar, el sistema SHALL enviar `POST /api/ordenes/` con `propietario_id` (resuelto desde `GET /api/mascotas/{id}`, ya que `OrdenServicioCreate.propietario_id` es obligatorio), `mascota_id`, `veterinario_id` y `motivo_visita`. Si la creación es exitosa, el panel SHALL cerrarse y la aplicación SHALL navegar a `sec-orden-abierta` con la orden recién creada.

`abrirFormularioConsulta()` y los flujos de consulta que dependen de ella (Panel del día, Citas pendientes, `app.js`) NO SHALL modificarse ni eliminarse: este requisito solo reemplaza su uso puntual en el header/landing de la ficha.

#### Scenario: Crear una orden desde la ficha
- **WHEN** el usuario hace click en "+ Orden de servicio" (header o tab), elige un veterinario y confirma
- **THEN** se crea la orden en estado `ABIERTA` con ese veterinario y el paciente de la ficha
- **AND** la aplicación navega a `sec-orden-abierta` mostrando la orden creada
- **AND** en ningún momento se abrió un elemento con clase `modal`

#### Scenario: Sin veterinario no se crea la orden
- **WHEN** el usuario confirma el panel sin elegir veterinario
- **THEN** el panel muestra un aviso y no se envía la petición de creación

#### Scenario: Paciente sin propietario asociado
- **WHEN** la mascota de la ficha no tiene `propietario_id` (caso de datos inconsistente)
- **THEN** el panel avisa que no se puede abrir la orden y no llama a `POST /api/ordenes/`

### Requirement: Facturas del animal — incluir las vinculadas solo por orden

`GET /api/facturas/mascota/{id}` SHALL devolver toda factura vinculada a la mascota, ya sea a través de `Factura.consulta_id -> Consulta.mascota_id` (como hoy) o a través de `FacturaOrden.orden_id -> OrdenServicio.mascota_id` (caso no cubierto hasta ahora: ventas de mostrador o servicios directos facturados sin línea de consulta), sin duplicados. El endpoint SHALL aceptar además un parámetro opcional `estado` (uno o varios estados separados por coma) para acotar el resultado.

#### Scenario: Factura de una orden sin consulta
- **WHEN** una mascota tiene una orden CERRADA sin ninguna línea de tipo CONSULTA, facturada mediante `POST /api/ordenes/{id}/facturar`
- **THEN** esa factura aparece en `GET /api/facturas/mascota/{id}`

#### Scenario: Filtrar por estado
- **WHEN** se llama a `GET /api/facturas/mascota/{id}?estado=PAGADA`
- **THEN** solo se devuelven las facturas de esa mascota en estado PAGADA

### Requirement: Búsqueda de órdenes por texto libre

`GET /api/ordenes/` SHALL aceptar un parámetro opcional `search` que, si viene, filtra por coincidencia parcial (case-insensitive) contra el número de orden, el motivo de visita o el nombre de usuario del veterinario asignado, sin alterar el comportamiento de los parámetros `numero`, `estado`, `veterinario_id`, `mascota_id`, `propietario_id`, `fecha_desde`, `fecha_hasta` y `por_cobrar` ya existentes.

#### Scenario: Buscar por motivo de visita
- **WHEN** se llama a `GET /api/ordenes/?mascota_id={id}&search=control` y existe una orden de esa mascota con `motivo_visita` "Control post-cirugía"
- **THEN** esa orden aparece en el resultado

#### Scenario: Buscar por nombre de veterinario
- **WHEN** se llama a `GET /api/ordenes/?mascota_id={id}&search=gomez` y hay una orden asignada a un veterinario cuyo `username` contiene "gomez"
- **THEN** esa orden aparece en el resultado

### Requirement: Búsqueda de servicios por nombre

`GET /api/servicios/` (`listar_servicios_mascota`) SHALL aceptar un parámetro opcional `search` que filtra por coincidencia parcial (case-insensitive) sobre `nombre_servicio`, combinable con `alcance`, `tipo_servicio`, `estado`, `facturado`, `fecha_desde` y `fecha_hasta`.

#### Scenario: Buscar servicios por nombre
- **WHEN** se llama a `GET /api/servicios/?mascota_id={id}&alcance=todos&search=vacuna`
- **THEN** solo se devuelven los servicios de esa mascota cuyo nombre contiene "vacuna"

### Requirement: Tab "Servicios e insumos" en la ficha

La ficha SHALL ofrecer un tab con la vista plana de servicios/insumos aplicados al animal (`GET /api/servicios/?mascota_id={id}&alcance=todos`), con buscador (usa el `search` del requisito anterior), filtro por tipo, por estado, por facturado y por rango de fechas.

#### Scenario: Filtrar servicios de un tipo en un rango de fechas
- **WHEN** el usuario selecciona tipo CIRUGIA y un rango de fechas
- **THEN** la tabla muestra solo los servicios de ese tipo dentro de ese rango

### Requirement: Tab "Notas" en la ficha

La ficha SHALL ofrecer un tab con un formulario para agregar notas (`POST /api/notas/` con `mascota_id`, `categoria`, `texto`) y la lista de notas de la mascota en orden cronológico inverso (más reciente primero), invertida en el cliente a partir de `GET /api/notas/mascota/{id}` (que devuelve orden ascendente).

#### Scenario: Agregar una nota desde la ficha
- **WHEN** el usuario escribe una nota y confirma
- **THEN** la nota se guarda y aparece primera en la lista del tab

### Requirement: Tab "Facturación" en la ficha

La ficha SHALL ofrecer un tab que muestre las facturas del animal (`GET /api/facturas/mascota/{id}`, incluyendo las vinculadas solo por orden) separadas en pagadas y pendientes/parciales, con la acción de abonar (reutilizando el modal de abono ya existente en `facturacion.js`) para las no pagadas.

#### Scenario: Ver facturas pendientes y abonar
- **WHEN** el usuario abre el tab "Facturación" de una mascota con una factura PARCIAL
- **THEN** la ve en la sección de pendientes con la acción "Abonar" disponible

## Acceptance Criteria

1. El header y el landing de la ficha ya no ofrecen un botón "Agregar consulta"/"Nueva consulta"; en su lugar ofrecen "+ Orden de servicio", que abre un panel inline (no un modal).
2. `abrirFormularioConsulta`, `handleConsultaSubmit`, `verConsultaCompleta`, `initConsultaAbierta`, `modalConsulta` y `cargarConsultas` siguen funcionando sin cambios para Panel del día, Citas pendientes, Reportes y Facturación.
3. El tab "Órdenes de servicio" (antes "Consultas") muestra las órdenes del animal, no sus consultas.
4. `GET /api/ordenes/` y `GET /api/servicios/` aceptan `search`; `GET /api/facturas/mascota/{id}` incluye facturas vinculadas solo por orden y acepta `estado`.
5. Los permisos de Editar/Transferir/Eliminar mascota y de crear orden coinciden con las reglas reales del backend (`admin`/`recepcionista`/`veterinario`), sin restricciones de UI inventadas.
