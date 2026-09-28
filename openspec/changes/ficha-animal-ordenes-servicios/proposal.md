# Proposal

## Why

La sección actual "Historia clínica" (sec-consultorio) tiene varios problemas de UX y arquitectura:

1. **Sidebar con lista de todos los pacientes**: La columna izquierda muestra un listado plano de todas las mascotas activas (hasta 50 sin paginación real). Al seleccionar una, el panel derecho muestra la ficha, pero no hay forma clara de "volver a la lista" — el usuario debe usar el buscador o recargar.

2. **Botones de "Agregar consulta" en el header/landing de la ficha**: El modelo de dominio actual ya exige que toda consulta nazca dentro de una orden de servicio (`orden_id` obligatorio en `ConsultaCreate`, `backend/app/schemas/schemas.py` línea ~144; `backend/app/routers/consultas.py` línea ~58) — "Agregar consulta" en la ficha en realidad abre la atención clínica dentro de una orden, no crea una consulta huérfana. El problema real de UX es que ese botón obliga a pensar en "consulta" cuando el contenedor de trabajo/cobro es la orden: la ficha debería ofrecer "+ Orden de servicio" como punto de entrada, y la atención clínica (consulta) se sigue abriendo, como hoy, una vez que existe una orden.

3. **Falta de vista centrada en órdenes de servicio**: El historial del animal debería mostrar las órdenes de servicio que ha tenido (cada una con sus servicios, facturas, pagos, notas), no solo las consultas clínicas. Las órdenes son el contenedor real de trabajo y cobro.

4. **Falta de búsqueda/filtrado de insumos y servicios aplicados**: No hay forma de filtrar qué servicios/insumos se aplicaron al animal, cuándo, por quién, en qué orden.

5. **Notas y facturas dispersas**: Las notas están en un accordion dentro de la consulta abierta, y las facturas se ven en otra sección (facturación). Deberían estar integradas en la ficha del animal.

## What Changes

### Rediseño de la sección "Ficha del animal" (sec-consultorio)

**Nueva estructura de dos vistas:**

#### Vista 1: Lista de pacientes (landing)
- Sidebar izquierda: lista de mascotas con buscador, filtros por especie/sexo/estado reproductivo/raza (igual que hoy)
- Columna derecha: estado vacío con mensaje "Seleccione un paciente para ver su ficha"
- Botón "+ Nueva mascota" en header

#### Vista 2: Ficha del animal (al hacer click en un paciente)
- **Header fijo** con:
  - Botón "← Volver a la lista" (regresa a Vista 1)
  - Avatar + nombre + código historia + especie/raza/sexo/edad
  - Botones: Editar mascota, Transferir, Eliminar
  - Info propietario (nombre, teléfono clickeable)
  - Badge estado (activo/inactivo)

- **Barra de navegación vertical (tabs)**:
  1. **Resumen** — Dashboard: última orden, próxima cita, peso actual, alertas
  2. **Órdenes de servicio** — Lista de TODAS las órdenes del animal (tabla con buscador/filtros)
  3. **Consultas** — Se conserva como tab propio (regresión restaurada): NO es un punto de alta (eso vive en "Órdenes de servicio"), solo ofrece por fila las acciones de reparación de datos legacy que ya existían (Facturar / Ir a la orden / Agregar honorario a la orden / Ver consulta) para consultas que quedaron sin orden o con la línea de honorario faltante
  4. **Servicios e insumos** — Vista plana de todos los servicios aplicados (buscador + filtros por tipo, fecha, estado, orden)
  5. **Notas** — Lista cronológica de todas las notas del animal (con formulario para agregar)
  6. **Facturación** — Facturas pagadas + pendientes/abiertas (con botones de acción)
  7. **Evolución peso** — Gráfica (ya existe, dentro del tab Resumen)

### Cambios en botones y acciones

- **Eliminar** los botones "Agregar consulta" / "Nueva consulta" del header y del landing de la ficha (quedan reemplazados por "+ Orden de servicio"). El resto de los flujos de consulta (`abrirFormularioConsulta`, `handleConsultaSubmit`, `verConsultaCompleta`, `initConsultaAbierta`, `modalConsulta`, `cargarConsultas`, `btnNuevaRecetaCA`) **se mantienen intactos**: los usa Panel del día (`hoy.js`), Citas pendientes (`citas-pendientes.js`), Reportes y Facturación, y no forman parte de este cambio.
- **Agregar** botón "+ Orden de servicio" en header de ficha y en el tab "Órdenes de servicio"
- Al crear orden: **panel inline** (no modal) dentro del área de contenido de la ficha, con ancho completo de la columna de contenido — mismo patrón visual que el panel "Anexar servicio" de `orden-abierta.js` (`#oaAnexarPanel`) pero embebido en el flujo de la ficha, no como aside lateral. Campos: veterinario (obligatorio), motivo, paciente preseleccionado (solo lectura); botones "Crear orden" / "Cancelar".
- La orden se crea en estado `ABIERTA` → se pueden anexar servicios → confirmar → facturar

### Integración de datos existente

- **Órdenes**: `GET /api/ordenes/?mascota_id={id}&limit=200` (ya existe filtro `mascota_id`; ya existe además `numero` como búsqueda ilike parcial por número de orden). Se agrega un parámetro `search` opcional que también busca por `motivo_visita` y por nombre del veterinario asignado (ver Impact).
- **Servicios**: `GET /api/servicios/?mascota_id={id}&alcance=todos` (ya existe; ya soporta `tipo_servicio`, `estado`, `facturado`, `fecha_desde/hasta`). Se agrega `search` opcional (ilike sobre `nombre_servicio`) para el buscador del tab.
- **Notas**: `GET /api/notas/mascota/{id}` (ya existe, orden cronológico ascendente — el tab pinta la lista invertida en el cliente)
- **Facturas**: `GET /api/facturas/mascota/{id}` (ya existe en facturacion.js, pero **solo** encuentra facturas vinculadas por `Factura.consulta_id` — una orden sin línea de consulta, ej. una venta de mostrador o un servicio directo, factura por `FacturaOrden` y hoy no aparece en este endpoint. Se corrige el query para incluir también las facturas vinculadas por `FacturaOrden.orden_id -> OrdenServicio.mascota_id`, y se agrega un filtro `estado` opcional (csv) para separar pagadas/pendientes sin traer todo el historial dos veces.)
- **Consultas**: `GET /api/consultas/?mascota_id={id}` (ya existe; se sigue usando igual que hoy para los flujos de consulta que se mantienen)

## Capabilities

### Modified Capabilities
- `orden-veterinario-y-tutores`: La ficha del animal ahora es el centro de gravedad, mostrando órdenes en lugar de consultas sueltas
- `orden-servicio-carrito`: Crear orden desde la ficha del animal (no desde Panel del día)
- `historia-clinica`: Notas y evolución integradas en la ficha

### New Capabilities
- `ficha-animal-ordenes-servicios`: Vista unificada de órdenes, servicios, notas y facturas por animal

## Impact

- **Frontend**: `static/js/sections/consultorio.js` — reescritura mayor de `initConsultorio`, `seleccionarMascota`, `renderMascotasList`, nueva vista de ficha, nuevos tabs. Se conservan sin cambios los exports usados por otros módulos: `abrirFormularioConsulta`, `handleConsultaSubmit`, `verConsultaCompleta`, `initConsultaAbierta`, `cargarConsultas`.
- **Frontend**: `static/templates/index.html` — nuevo HTML para Vista 1 y Vista 2 (reemplazar consultorio-layout), nuevo panel inline "Nueva orden de servicio" (sin modal nuevo). Los modales reusados por la ficha (editar/transferir mascota, abonar) quedan fuera de alcance, sin cambios.
- **Backend**: cambios menores y acotados en `backend/app/routers/ordenes.py` (parámetro `search` en `listar_ordenes`), `backend/app/routers/servicios.py` (parámetro `search` en `listar_servicios_mascota`) y `backend/app/routers/facturas.py` (`obtener_facturas_mascota` incluye facturas vinculadas por orden y agrega filtro `estado`). No hay cambios de modelo de datos ni migraciones.
- **Tests E2E**: `e2e/ficha-animal-ordenes-servicios.spec.js`