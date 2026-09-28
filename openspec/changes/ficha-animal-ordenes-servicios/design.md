# Design

## Context

**Estructura actual `sec-consultorio` (index.html líneas 1438-1572):**
- Layout de dos columnas: `patient-list-sidebar` (izquierda, width fijo) + `patientWrapper` (derecha, flex: 2)
- Sidebar: buscador + `consultorioMascotasList` (lista de pacientes)
- Derecha: `patientWrapper` (oculto inicialmente) → `pet-profile-container` → sidebar vertical de tabs (Resumen, Consultas, Servicios, Recetas, Notas, Facturación) + `pet-content-body` (contenido dinámico)
- `consultorio.js`: `initConsultorio()` carga lista inicial (50 mascotas), `seleccionarMascota()` muestra `patientWrapper` y carga tabs, `renderMascotasList()` pinta items con `onclick="seleccionarMascota(...)"`

**Endpoints existentes que ya soportan filtrado por mascota:**
- `GET /api/ordenes/?mascota_id={id}` — órdenes del animal. Filtros ya existentes: `estado` (csv), `numero` (ilike parcial), `veterinario_id`, `propietario_id`, `fecha_desde`/`fecha_hasta`, `por_cobrar`. **Nuevo**: `search` (ilike sobre `numero` OR `motivo_visita` OR `Usuario.username` del veterinario asignado — join a `Usuario` solo cuando `search` viene).
- `GET /api/servicios/?mascota_id={id}&alcance=todos` — servicios e insumos del animal. Filtros ya existentes: `tipo_servicio`, `estado`, `facturado`, `fecha_desde`/`fecha_hasta`. **Nuevo**: `search` (ilike sobre `nombre_servicio`).
- `GET /api/notas/mascota/{id}` — notas del animal, orden cronológico **ascendente** (más antigua primero). El tab pinta la lista invertida en el cliente (igual que ya hace `_cargarNotasConsultaAbierta`).
- `GET /api/facturas/mascota/{id}` — facturas del animal (en `facturacion.js::cargarFacturasMascota`). **Gap real encontrado**: hoy solo hace `JOIN Consulta ON Factura.consulta_id == Consulta.id WHERE Consulta.mascota_id = {id}` — una factura de una orden SIN línea de consulta (venta de mostrador, servicio directo/estética) se vincula solo por `FacturaOrden.orden_id`, y esa factura nunca aparece acá. Se corrige agregando un `UNION`/`OR` con `FacturaOrden JOIN OrdenServicio ON OrdenServicio.mascota_id = {id}`, deduplicado por `Factura.id`. **Nuevo**: filtro `estado` opcional (csv, ej. `PAGADA` o `PENDIENTE,PARCIAL`) — hoy no existe ninguno.
- `GET /api/consultas/?mascota_id={id}` — consultas del animal (sin cambios; se sigue usando solo en los flujos de consulta que se mantienen, no en el tab de órdenes)
- `GET /mascotas/{id}/peso-history` — histórico de peso

**Modelos relevantes:**
- `Mascota`: id, nombre, especie, raza, sexo, fecha_nacimiento, color, peso, observaciones, activo, propietario_id, codigo_historia
- `OrdenServicio`: id, numero, mascota_id, veterinario_id, estado, fecha_apertura, total (computed), origen
- `ServicioConsulta`: id, orden_id, mascota_id, tipo_servicio, nombre_servicio, cantidad, precio_unitario, estado, facturado, created_at, asignado_a_id (quien ejecutó)
- `Factura`: id, numero_factura, propietario_id, consulta_id, estado, total, total_pagado, saldo_pendiente, metodo_pago
- `NotaClinica`: id, mascota_id, categoria, texto, fecha_creacion, creado_por_id

## Goals / Non-Goals

**Goals:**
1. Navegación de dos niveles (Lista ↔ Ficha) con estado persistente
2. Header de ficha rico con datos del animal + acciones
3. 6 tabs integrados (Resumen, Órdenes, Servicios, Notas, Facturación, Peso)
4. Tab Órdenes: tabla completa con filtros, crear orden desde ficha
5. Tab Servicios: vista plana con filtros combinados
6. Tab Notas: lista + formulario agregar
7. Tab Facturación: pagadas + pendientes con acciones
8. Tab Resumen: dashboard informativo
9. Eliminar los botones "Agregar consulta" del header/landing de la ficha, usar "+ Orden de servicio" (panel inline, sin modal nuevo). Los demás usos de "agregar consulta" (Panel del día, Citas pendientes) no se tocan.

**Non-Goals:**
- Cambiar APIs backend (ya tienen filtros por mascota_id)
- Cambiar modelo de datos
- Implementar cita/agenda en la ficha (existe en sec-agenda)
- Recetas médicas (tab existente se mantiene o se integra en Servicios)

## Decisions

### 1. Arquitectura de vistas — State management

```javascript
// En consultorio.js - nuevo state
let currentView = 'lista'; // 'lista' | 'ficha'
let currentMascotaId = null;
let currentTab = 'resumen'; // resumen | ordenes | servicios | notas | facturacion | peso
let listaScrollPosition = 0; // preservar scroll al volver
let listaFiltros = { especie: '', search: '', ... }; // preservar filtros
```

**Transiciones:**
- `mostrarLista()`: `currentView = 'lista'`, oculta `patientWrapper`, muestra `consultorioMascotasList`, restaura scroll/filters
- `mostrarFicha(mascotaId)`: `currentView = 'ficha'`, `currentMascotaId = mascotaId`, oculta lista, muestra `patientWrapper`, carga header + tabs, activa tab por defecto 'resumen'

### 2. Header de ficha — Component composition

```html
<div class="ficha-header">
  <button class="btn-back" onclick="mostrarLista()">
    <svg>←</svg> Volver a la lista
  </button>
  <div class="ficha-patient-info">
    <div class="avatar">{{iniciales}}</div>
    <div>
      <h2>{{nombre}} <span class="codigo">#{{codigo_historia}}</span></h2>
      <p class="meta">{{especie}} · {{raza}} · {{sexo}} · {{edad}}</p>
    </div>
    <div class="ficha-actions">
      <button onclick="abrirEditarMascota()">Editar</button>
      <button onclick="abrirTransferirMascota()">Transferir</button>
      <button class="danger" onclick="confirmEliminarMascota()">Eliminar</button>
    </div>
    <div class="ficha-owner">
      <span class="label">Tutor:</span>
      <strong>{{propietario_nombre}}</strong>
      <a href="tel:{{telefono}}">{{telefono}}</a>
      <button onclick="irATutor()">Ver tutor</button>
    </div>
    <span class="badge {{activo ? 'ok' : 'muted'}}">{{activo ? 'Activo' : 'Inactivo'}}</span>
  </div>
</div>
```

### 3. Tabs verticales — Responsive layout

**CSS Grid para layout de ficha:**
```css
.ficha-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 1rem;
  min-height: calc(100vh - 200px);
}
.ficha-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0.5rem;
  background: var(--surface);
  border-radius: var(--radius-md);
  height: fit-content;
  position: sticky;
  top: 1rem;
}
.ficha-tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.ficha-tab.active {
  background: var(--primary);
  color: white;
}
.ficha-tab:hover:not(.active) {
  background: var(--surface-hover);
}
.ficha-content {
  background: var(--surface);
  border-radius: var(--radius-md);
  min-height: 500px;
}
```

### 4. Tab "Órdenes de servicio" — Data table con filtros

**Estrategia de carga:**
- Carga inicial: `GET /api/ordenes/?mascota_id={id}&limit=200&estado=ABIERTA,EN_ATENCION,CERRADA,FACTURADA` (excluye ANULADA por defecto)
- Filtros server-side para búsqueda/estado/fechas: agregar params a la query
- Debounce 300ms en buscador

**Columnas y renderizado:**
```javascript
const columnas = [
  { key: 'numero', label: 'Orden', render: o => `<a onclick="abrirOrden(${o.id})">${o.numero}</a>` },
  { key: 'estado', label: 'Estado', render: o => `<span class="status-pill status-pill--${estadoClass(o.estado)}">${o.estado}</span>` },
  { key: 'fecha_apertura', label: 'Fecha', render: o => formatDate(o.fecha_apertura) },
  { key: 'veterinario_nombre', label: 'Veterinario' },
  { key: 'total', label: 'Total', render: o => money(o.total), align: 'right' },
  { key: 'acciones', label: '', render: o => renderAccionesOrden(o) },
];
```

**Acciones por estado:**
```javascript
function renderAccionesOrden(o) {
  const btns = [];
  btns.push(`<button onclick="abrirOrden(${o.id})" class="btn-sm">Ver</button>`);
  if (['ABIERTA', 'EN_ATENCION'].includes(o.estado)) {
    btns.push(`<button onclick="anexarEnOrden(${o.id})" class="btn-sm btn-primary">+ Servicio</button>`);
  }
  if (o.estado === 'CERRADA') {
    btns.push(`<button onclick="facturarOrdenDesdeFicha(${o.id})" class="btn-sm btn-success">Facturar</button>`);
  }
  if (o.estado === 'FACTURADA') {
    // buscar factura vinculada
    btns.push(`<button onclick="verFacturaOrden(${o.id})" class="btn-sm">Factura</button>`);
  }
  return btns.join(' ');
}
```

### 5. Tab "Servicios e insumos" — Vista plana con filtros compuestos

**Query params compuestos:**
```javascript
const params = new URLSearchParams({
  mascota_id: currentMascotaId,
  alcance: 'todos',
  limit: 500,
});
if (search) params.set('search', search);
if (tipo) params.set('tipo_servicio', tipo);
if (estado) params.set('estado', estado);
if (fecha_desde) params.set('fecha_desde', fecha_desde);
if (fecha_hasta) params.set('fecha_hasta', fecha_hasta);
if (solo_facturados) params.set('facturado', 'true');
```

**Totales dinámicos:** recalcular al filtrar (client-side sobre data ya cargada o refetch server-side)

### 6. Tab "Notas" — Lista + formulario

**Estructura:**
```html
<div class="notas-form">
  <textarea id="notaTexto" placeholder="Escriba una nota..."></textarea>
  <div class="form-row">
    <select id="notaCategoria">
      <option value="general">General</option>
      <option value="seguimiento">Seguimiento</option>
      <option value="llamada">Llamada</option>
      <option value="incidencia">Incidencia</option>
    </select>
    <button class="btn-primary" onclick="guardarNota()">Guardar nota</button>
  </div>
</div>
<div class="notas-list" id="notasList"></div>
<button class="btn-load-more" onclick="cargarMasNotas()">Cargar más</button>
```

**Paginación:** offset/limit (20 por página), botón "Cargar más" incrementa offset

### 7. Tab "Facturación" — Dos secciones

```javascript
async function cargarFacturacionTab() {
  const [pagadas, pendientes] = await Promise.all([
    fetchAPI(`/facturas/mascota/${currentMascotaId}?estado=PAGADA&limit=100`),
    fetchAPI(`/facturas/mascota/${currentMascotaId}?estado=PENDIENTE,PARCIAL&limit=100`),
  ]);
  renderFacturasSection('pagadas', pagadas, true);
  renderFacturasSection('pendientes', pendientes, false);
}

function renderFacturasSection(sectionId, facturas, esPagada) {
  // tabla con columnas: numero, fecha, total, total_pagado, saldo, metodo_pago, acciones
  // acciones: "Abonar" (si !esPagada), "PDF"
}
```

**Modal Abono:** Reusar `facturacion.js::abrirModalAbono(facturaId, saldoPendiente, propietarioId)` pasando `orden_id` si la factura tiene `FacturaOrden`.

### 8. Tab "Resumen" — Dashboard cards

```javascript
async function cargarResumenTab() {
  const [ordenes, citas, peso, vacunas] = await Promise.all([
    fetchAPI(`/ordenes/?mascota_id=${id}&limit=1&estado=ABIERTA,EN_ATENCION,CERRADA,FACTURADA`),
    fetchAPI(`/citas/?mascota_id=${id}&estado=PENDIENTE,EN_ESPERA&limit=1`),
    fetchAPI(`/mascotas/${id}/peso-history`),
    fetchAPI(`/planes_salud/?mascota_id=${id}&tipo_preventivo=VACUNA`),
  ]);
  
  // Cards:
  // - Última orden: ordenes[0] → mostrar numero, estado, total, btn "Ver"
  // - Próxima cita: citas[0] → fecha, tipo, btn "Ver en agenda"
  // - Peso: peso[0] → kg, fecha, btn "Ver gráfica"
  // - Alertas: mascota.observaciones, vacunas vencidas, citas pasadas sin atender
  // - Totales: sumar ordenes.total donde facturada
}
```

### 9. Botón "+ Orden de servicio" — Panel inline (NO modal)

El usuario rechaza modales nuevos. El botón "+ Orden de servicio" (header de ficha y tab "Órdenes de servicio") **reemplaza únicamente** la llamada a `abrirFormularioConsulta()` que hoy dispara `btnActionAdd` en el header de la ficha (y el botón "+ Nueva Consulta" del tab, hoy `consultas`). `abrirFormularioConsulta()` en sí **no se borra**: la siguen usando Panel del día y Citas pendientes.

**Patrón visual**: panel inline dentro del área de contenido de la ficha (`pet-content-body`/`petTabContent`), ancho completo de la columna — mismo lenguaje visual que `#oaAnexarPanel` de `orden-abierta.js` (cabecera + cuerpo con borde) pero sin ser un aside lateral. Se muestra/oculta con el atributo `hidden`; como el panel usa `display:flex`, hace falta la regla explícita `.ficha-nueva-orden-panel[hidden] { display: none; }` (mismo hallazgo que `.oa-anexar-panel`, `.av-search`, `#catalogoCargarMas`).

**Referencia de payload real**: `OrdenServicioCreate` (`backend/app/schemas/schemas.py`) exige `propietario_id` (obligatorio) además de `mascota_id`/`veterinario_id`/`motivo_visita` — el borrador anterior de este documento omitía `propietario_id` y hubiera fallado con 422. El flujo ya probado de "Nueva orden" en `hoy.js` (`abrirNuevaOrdenFlow`/`confirmarAbrirOrden`, usado por Panel del día) resuelve `propietario_id` desde el paciente elegido; la ficha ya tiene ese dato disponible vía `GET /mascotas/{id}` (usado en `seleccionarMascota`).

**`abrirPanelNuevaOrden()` (en `consultorio.js`, reemplaza el wiring de `abrirFormularioConsulta` en `btnActionAdd`):**
```javascript
const abrirPanelNuevaOrden = async () => {
    if (!currentMascotaId) return;
    const panel = document.getElementById('fichaNuevaOrdenPanel');
    if (!panel) return;
    document.getElementById('fnoMotivo').value = '';
    panel.hidden = false;
    try {
        const vets = await fetchAPI('/usuarios/veterinarios');
        const select = document.getElementById('fnoVeterinario');
        select.innerHTML = '<option value="">Seleccione veterinario</option>' +
            vets.map(v => `<option value="${v.id}">${escapeHtml(v.username)}</option>`).join('');
    } catch (e) {
        showNotification('No se pudieron cargar los veterinarios: ' + e.message, 'error');
    }
};

const cerrarPanelNuevaOrden = () => {
    const panel = document.getElementById('fichaNuevaOrdenPanel');
    if (panel) panel.hidden = true;
};

const confirmarNuevaOrdenDesdeFicha = async () => {
    if (!currentMascotaId) return;
    const veterinarioId = parseInt(document.getElementById('fnoVeterinario').value, 10);
    if (!veterinarioId) { showNotification('Elegí un veterinario.', 'warning'); return; }
    try {
        // La ficha ya conoce la mascota (seleccionarMascota la trae de /mascotas/{id});
        // se resuelve propietario_id igual que hoy.js::abrirNuevaOrdenFlow.
        const m = await fetchAPI(`/mascotas/${currentMascotaId}`);
        if (!m.propietario_id) {
            showNotification('Este paciente no tiene un propietario asociado; no se puede abrir la orden.', 'error');
            return;
        }
        const orden = await fetchAPI('/ordenes/', {
            method: 'POST',
            body: JSON.stringify({
                propietario_id: m.propietario_id,
                mascota_id: currentMascotaId,
                veterinario_id: veterinarioId,
                motivo_visita: document.getElementById('fnoMotivo').value || null,
            }),
        });
        cerrarPanelNuevaOrden();
        showNotification(`Orden ${orden.numero} creada.`, 'success');
        abrirOrden(orden.id); // navega a sec-orden-abierta para anexar servicios
    } catch (e) {
        showNotification('No se pudo crear la orden: ' + e.message, 'error');
    }
};
```

**HTML del panel (nuevo en `index.html`, dentro de `sec-consultorio`, hermano de `pet-layout`, no un `.modal`):**
```html
<div id="fichaNuevaOrdenPanel" class="ficha-nueva-orden-panel" hidden>
  <div class="ficha-nop-head">
    <strong>Nueva orden de servicio</strong>
    <span class="av-muted">Paciente: <span id="fnoPacienteLabel"></span></span>
  </div>
  <div class="ficha-nop-body">
    <label>Veterinario <span class="required">*</span>
      <select id="fnoVeterinario" required></select>
    </label>
    <label>Motivo de visita
      <textarea id="fnoMotivo" rows="2"></textarea>
    </label>
  </div>
  <div class="ficha-nop-actions">
    <button type="button" class="btn-secondary" id="btnFnoCancelar">Cancelar</button>
    <button type="button" class="btn-primary" id="btnFnoCrear">Crear orden</button>
  </div>
</div>
```

### 10. Reemplazo del botón "Agregar consulta" del header/landing

`abrirFormularioConsulta()`, `handleConsultaSubmit()`, `verConsultaCompleta()`, `initConsultaAbierta()`, `modalConsulta`, `cargarConsultas()` y `btnNuevaRecetaCA` **se mantienen sin cambios** — los usan Panel del día (`hoy.js` líneas ~158/388), Citas pendientes (`citas-pendientes.js` línea ~42), Reportes (`reportes.js` línea ~515) y Facturación (`facturacion.js` línea ~511), además de `app.js`.

**En `consultorio.js`:**
- En `seleccionarMascota()`, cambiar el wiring de `btnAction.onclick` (hoy llama `abrirFormularioConsulta()`) por `abrirPanelNuevaOrden()`.
- En el tab (hoy `consultas`, pasa a llamarse `ordenes`), cambiar el botón de acción de "+ Nueva Consulta" (`btnRegistrarConsulta`, que llama `abrirFormularioConsulta()`) por "+ Orden de servicio" (`abrirPanelNuevaOrden()`).
- Mantener `consultas` como alias de tab legacy hacia `ordenes` en `PET_TAB_LEGACY` (mismo patrón que ya usa el mapa para `historia`/`peso`/etc.), por si queda algún `switchPetTab('consultas')` colgado en HTML generado dinámicamente.

**En HTML (index.html):**
- `#modalConsulta` (línea ~320) y `#modalCita` (línea ~400) son `<div>` de nivel superior, no están anidados dentro de `sec-consultorio` — no hay nada que remover ahí; ambos siguen en uso por los flujos que se mantienen.
- Se agrega el panel `#fichaNuevaOrdenPanel` (ver decisión 9) dentro de `sec-consultorio`, no un modal nuevo.

### 11. Integración con `orden-abierta.js`

Al crear orden desde ficha → `abrirOrden(orden_id)` navega a `sec-orden-abierta` (ya existe). El usuario anexa servicios ahí. Al terminar, puede volver a la ficha con botón "← Volver a la ficha" en `orden-abierta.js` (nuevo).

## Risks / Trade-offs

- **Estado de tabs al volver**: Decisión: al volver a la lista, resetear `currentTab = 'resumen'` para próxima ficha. Si se quiere preservar tab por mascota, usar `Map<mascotaId, tab>`.
- **Carga lazy vs eager**: Tabs cargan datos solo al activarse (lazy). Cache en memoria por `mascotaId` para no refetchear al cambiar tab.
- **Panel Nueva Orden vs flujos de consulta existentes**: `abrirFormularioConsulta()` sigue existiendo y se sigue usando desde Panel del día y Citas pendientes; el panel inline nuevo solo reemplaza su uso en el header/tab de la ficha. `modalCita` (`sec-agenda`) y `modalConsulta` (`sec-consulta-abierta`) no se tocan.
- **Performance listas grandes**: `limit=200` en órdenes, `limit=500` en servicios. Virtual scrolling en tablas si >100 rows (opcional, fase 2).
- **Permisos (verificados contra el backend real, no supuestos)**: `PUT/DELETE /mascotas/{id}` y `PUT .../transferir` usan `require_roles(*_ROLES_MASCOTAS)` con `_ROLES_MASCOTAS = ("admin", "recepcionista", "veterinario")` (`backend/app/routers/mascotas.py`) — **no** son admin-only. `POST /ordenes/` usa `require_roles("admin", "recepcionista", "veterinario")` (`backend/app/routers/ordenes.py`). El frontend no tiene hoy ningún mecanismo genérico de ocultar botones por rol (no existe un `data-roles`/gating equivalente en el resto de la app); los botones "Editar/Transferir/Eliminar" y "+ Orden de servicio" quedan visibles para cualquier rol autenticado igual que hoy, y el backend sigue siendo el gate real (403 si corresponde) — consistente con el resto de la aplicación.