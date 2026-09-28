// sections/orden-abierta.js — sec-orden-abierta (Tarea 06, etapa 7).
//
// La pantalla de trabajo de una orden de servicio: paciente/tutor, servicios
// anexados con su estado, total acumulado, y las acciones de ciclo de vida
// (confirmar, facturar, cerrar, anular). tab:false — se abre desde el panel
// del día, la bandeja del gestor o la ficha del paciente vía abrirOrden(id).
// docs/diseno/navegacion-v2.md, Decisión 3; docs/diseno/pantallas/OrdenAbierta.html
// y AnexarServicio.html.
//
// LÍMITES DOCUMENTADOS (ver también hoy.js):
// - ServicioConsultaResponse no expone qué insumos consumió cada línea, así
//   que la fila de servicio no pinta el sub-texto "Alcohol 50ml · Gasas 2u"
//   que muestra la maqueta — sólo el nombre.
// - AnexarServicio.html lista "Consultas" como categoría del picker. POST
//   /api/ordenes/{id}/servicios ya acepta tipo_servicio=CONSULTA (consulta-
//   directa-atajo-sin-despacho: EJECUTADO directo, asignada al veterinario),
//   pero el picker sigue excluyendo la categoría: la consulta se abre desde
//   el consultorio (POST /api/consultas/), que además crea la ficha clínica.
// - Facturar una orden usa su propio endpoint (orden-servicio-carrito,
//   decisión 6): GET /api/ordenes/{id}/pendientes-facturar arma la vista
//   previa (ítems + total) y POST /api/ordenes/{id}/facturar arma la factura
//   en el servidor con TODOS los servicios sin facturar de la orden CERRADA
//   -- el cliente ya no manda detalles[] ni servicio_id. El servidor también
//   resuelve solo el consulta_id de la orden (si tiene una línea CONSULTA
//   viva), así que la liquidación del veterinario (Decisión 3, docs/diseno/
//   ordenes-de-servicio.md) sigue enganchada sin que el front tenga que
//   conocer ese detalle.

import { fetchAPI } from '../core/api.js';
import { showNotification, openModal, closeModal, debounce, escapeHtml, submitWithLoading } from '../core/ui.js';
import { money, totalServicios, ESTADO_TOMA_PILL, estadoTomaLabel, agruparPorPaquete } from '../core/format.js';
import { showSection } from '../core/router.js';
import { getRole } from '../core/session.js';
// Relación cíclica segura con consultorio.js (que importa abrirOrden de este
// módulo): mostrarFicha sólo se usa dentro del handler de "← Volver a la
// ficha" (ficha-animal-ordenes-servicios, decisión 11 del design), nunca en
// la evaluación del módulo -- mismo patrón ya documentado en consultorio.js
// para facturacion.js/ordenes.js.
import { mostrarFicha } from './consultorio.js';

const ESTADO_LABEL_ORDEN = { ABIERTA: 'Abierta', EN_ATENCION: 'En atención', CERRADA: 'Cerrada', ANULADA: 'Anulada' };

const ESTADO_PILL_SRV = {
    SOLICITADO: 'av-pill--neutral', ASIGNADO: 'av-pill--warn', EN_PROCESO: 'av-pill--info',
    EJECUTADO: 'av-pill--ok', FACTURADO: 'av-pill--ok', CANCELADO: 'av-pill--neutral',
};
const ESTADO_LABEL_SRV = {
    SOLICITADO: 'Solicitado', ASIGNADO: 'Asignado', EN_PROCESO: 'En proceso',
    EJECUTADO: 'Ejecutado', FACTURADO: 'Facturado', CANCELADO: 'Cancelado',
};

// Categoría del catálogo -> tipo_servicio que acepta OrdenServicioAnexarServicio
// (no hay un enum estricto del lado del backend — sólo importa para el gate
// de recepcionista, ver TIPOS_SERVICIO_CLINICOS en routers/servicios.py).
const CATEGORIA_TIPO = {
    LABORATORIO: 'LABORATORIO',
    IMAGENOLOGIA: 'LABORATORIO',
    QUIROFANO: 'CIRUGIA',
    HOSPITALIZACION: 'HOSPITALIZACION',
    PELUQUERIA: 'ESTETICA',
    FARMACIA: 'INSUMO',
    SERVICIOS: 'OTRO',
    'ADMINISTRACION VARIOS': 'OTRO',
};

let _ordenId = null;
let _ordenData = null;
let _catalogo = [];
let _catActual = null;
let _svcSeleccionado = null;
let _consumos = [];
let _wired = false;

// Candidatos para el selector "elegir gestor" al confirmar (asignacion-
// directa-servicio-gestor, decisión 9): cache por area_id, una request por
// área distinta durante el pintado de la orden abierta — se reinicia en cada
// pintarServicios porque distintas órdenes pueden reflejar altas/bajas de
// gestores entre una y otra.
let _gestoresPorArea = new Map();

async function cargarGestoresActivosDeArea(areaId) {
    if (_gestoresPorArea.has(areaId)) return _gestoresPorArea.get(areaId);
    try {
        const gestores = await fetchAPI(`/areas/${areaId}/gestores-activos`);
        _gestoresPorArea.set(areaId, gestores || []);
    } catch (_) {
        _gestoresPorArea.set(areaId, []);
    }
    return _gestoresPorArea.get(areaId);
}

/** Abre la orden `ordenId`: navega a sec-orden-abierta y carga sus datos. */
export const abrirOrden = async (ordenId) => {
    _ordenId = ordenId;
    showSection('sec-orden-abierta');
    cerrarAnexarPanel();
    await cargarOrden();
};

async function cargarOrden() {
    const patient = document.getElementById('oaPatient');
    if (patient) patient.innerHTML = '<p class="av-muted">Cargando datos de la orden…</p>';
    try {
        const orden = await fetchAPI(`/ordenes/${_ordenId}`);
        _ordenData = orden;
        pintarHeader(orden);
        pintarPaciente(orden);
        await pintarServicios(orden);
        pintarResumen(orden);
        pintarMeta(orden);
        pintarAcciones(orden);
    } catch (e) {
        if (patient) patient.innerHTML = `<p class="av-text-danger">Error cargando la orden: ${escapeHtml(e.message)}</p>`;
    }
}

function pintarHeader(orden) {
    const title = document.getElementById('avHeaderTitleText');
    const sub = document.getElementById('avHeaderSubtitleText');
    if (title) title.textContent = `Orden ${orden.numero}`;
    if (sub) sub.textContent = `${ESTADO_LABEL_ORDEN[orden.estado] || orden.estado} · ${orden.mascota_nombre || 'Sin paciente'} / ${orden.propietario_nombre || 'Sin tutor'}`;
}

function pintarPaciente(orden) {
    const el = document.getElementById('oaPatient');
    if (!el) return;
    const iniciales = (orden.mascota_nombre || orden.propietario_nombre || '?').slice(0, 2).toUpperCase();
    // "← Volver a la ficha" (ficha-animal-ordenes-servicios, decisión 11):
    // sólo tiene sentido si la orden tiene un paciente -- una venta de
    // mostrador (sin mascota_id) no tiene ficha a la que volver.
    const btnVolverFicha = orden.mascota_id
        ? `<button type="button" class="av-btn" id="btnOaVolverFicha" title="Volver a la ficha del paciente">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            Volver a la ficha
        </button>`
        : '';
    el.innerHTML = `
        ${btnVolverFicha}
        <div class="oa-patient-avatar">${iniciales}</div>
        <div class="oa-patient-main">
            <div class="oa-patient-namerow">
                <span class="ser">${escapeHtml(orden.mascota_nombre || 'Sin paciente (venta de mostrador)')}</span>
                <span class="av-pill av-pill--neutral">${ESTADO_LABEL_ORDEN[orden.estado] || orden.estado}</span>
            </div>
            <span class="oa-patient-meta">Orden <span class="num">${orden.numero}</span> · Motivo: ${escapeHtml(orden.motivo_visita || 'Sin especificar')}</span>
        </div>
        <div class="oa-divider"></div>
        <div class="oa-owner">
            <span class="av-eyebrow">Tutor</span>
            <strong>${escapeHtml(orden.propietario_nombre || '—')}</strong>
        </div>
        <div class="av-spacer"></div>
        <button type="button" class="av-btn av-btn--primary" id="btnOaAnexarInline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Anexar servicio
        </button>`;
    document.getElementById('btnOaAnexarInline')?.addEventListener('click', abrirAnexarPanel);
    document.getElementById('btnOaVolverFicha')?.addEventListener('click', () => {
        showSection('sec-consultorio');
        mostrarFicha(orden.mascota_id);
    });
}

async function pintarServicios(orden) {
    const body = document.getElementById('oaServiciosBody');
    const count = document.getElementById('oaServiciosCount');
    const resumen = document.getElementById('oaServiciosResumen');
    if (!body) return;
    const servicios = (orden.servicios || []).filter(s => !s.is_deleted);
    if (count) count.textContent = `${servicios.length} de esta orden`;
    if (resumen) {
        const aplicados = servicios.filter(s => s.estado === 'EJECUTADO' || s.estado === 'FACTURADO').length;
        const pendientes = servicios.length - aplicados;
        resumen.textContent = `${aplicados} aplicado${aplicados === 1 ? '' : 's'} · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}`;
    }
    if (servicios.length === 0) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Todavía no se anexó ningún servicio.</td></tr>';
        return;
    }

    // Elegir gestor al confirmar (asignacion-directa-servicio-gestor,
    // decisión 9): solo admin/veterinario (los que confirman) y solo para
    // líneas SOLICITADO con área — antes de despacharlas es cuando tiene
    // sentido elegir a quién. Se precargan los gestores activos de cada área
    // distinta antes de pintar, para no armar el <select> a medio llenar.
    _gestoresPorArea = new Map();
    const puedeAsignar = ['admin', 'veterinario'].includes(getRole());
    if (puedeAsignar) {
        const areaIds = [...new Set(
            servicios.filter(s => s.estado === 'SOLICITADO' && s.area_id).map(s => s.area_id)
        )];
        await Promise.all(areaIds.map(cargarGestoresActivosDeArea));
    }

    // servicio-base-paquete-items: agrupar bases + sus items adicionales;
    // "sueltos" son los que no son base ni tienen padre (el caso de siempre).
    // Un item cuyo padre no aparece en `servicios` (ej. padre soft-deleted, o
    // huérfano por ON DELETE SET NULL tras un borrado físico) cae en
    // `sueltos` de agruparPorPaquete (servicio_padre_id sigue apuntando a un
    // id que no está en la lista visible), así que se pinta como fila suelta
    // en vez de desaparecer — decisión del orquestador.
    const { grupos, sueltos } = agruparPorPaquete(servicios);
    const idsAgrupados = new Set([
        ...grupos.map(g => g.base.id),
        ...grupos.flatMap(g => g.items.map(i => i.id)),
    ]);
    const filasSueltas = sueltos.filter(s => !idsAgrupados.has(s.id));

    const filaHtml = (s, { indent = false } = {}) => {
        const puedeElegirGestor = puedeAsignar && s.estado === 'SOLICITADO' && s.area_id;
        const ultimaColumna = puedeElegirGestor
            ? `<label class="av-visually-hidden" for="oaAsignar-${s.id}">Gestor para ${escapeHtml(s.nombre_servicio || 'este servicio')}</label>
               <select id="oaAsignar-${s.id}" data-asignar-servicio="${s.id}" style="max-width:170px; padding:2px 6px; border:1px solid var(--border); border-radius:6px; font:inherit;">
                   <option value="">Cualquier gestor del área</option>
                   ${(_gestoresPorArea.get(s.area_id) || []).map(g => `<option value="${g.usuario_id}">${escapeHtml(g.username)}</option>`).join('')}
               </select>`
            : (s.estado_toma ? `<span class="av-pill ${ESTADO_TOMA_PILL[s.estado_toma] || 'av-pill--neutral'}">${escapeHtml(estadoTomaLabel(s))}</span>` : '');
        // consulta-directa-atajo-sin-despacho: en una línea CONSULTA,
        // veterinario_nombre es quien la ejecutó. En el resto es el gestor que
        // la tomó, y eso ya lo dice la pill de toma de la última columna.
        const vet = s.tipo_servicio === 'CONSULTA' && s.veterinario_nombre
            ? `<div style="font-size:12px; color:var(--text-secondary);">Veterinario: ${escapeHtml(s.veterinario_nombre)}</div>`
            : '';
        const area = s.area_nombre
            ? ` <span class="av-pill av-pill--neutral" title="Área que ejecuta el servicio">${s.area_nombre === 'NINGUNO' ? 'Sin área' : escapeHtml(s.area_nombre)}</span>`
            : '';
        const nombre = indent
            ? `<span style="padding-left:2rem; color:var(--text-secondary);">└─ </span><span class="oa-service-name">${escapeHtml(s.nombre_servicio || '—')}</span>`
            : `<span class="oa-service-name">${escapeHtml(s.nombre_servicio || '—')}</span>`;
        return `
        <tr class="${indent ? 'oa-paquete-item' : ''}" data-padre-id="${s.servicio_padre_id ?? ''}">
            <td>${nombre}${vet}</td>
            <td><span class="av-pill av-pill--info">${escapeHtml(s.tipo_servicio || '—')}</span>${area}</td>
            <td class="num">${s.cantidad}</td>
            <td class="num" style="font-weight:500;">${money(s.precio_unitario)}</td>
            <td class="num" style="font-weight:500;">${money((s.cantidad || 0) * (s.precio_unitario || 0))}</td>
            <td><span class="av-pill ${ESTADO_PILL_SRV[s.estado] || 'av-pill--neutral'}">${ESTADO_LABEL_SRV[s.estado] || s.estado}</span></td>
            <td>${ultimaColumna}</td>
        </tr>`;
    };

    const filaBaseHtml = (base, subtotalPaquete, itemsCount) => {
        const area = base.area_nombre
            ? ` <span class="av-pill av-pill--neutral" title="Área que ejecuta el servicio">${base.area_nombre === 'NINGUNO' ? 'Sin área' : escapeHtml(base.area_nombre)}</span>`
            : '';
        return `
        <tr class="oa-paquete-base" data-paquete-id="${base.id}" style="background:var(--surface-hover); cursor:pointer;">
            <td>
                <span class="oa-service-name" style="font-weight:600;">${escapeHtml(base.nombre_servicio || '—')}</span>
                <span class="av-pill av-pill--info" style="margin-left:6px; font-size:11px;">PAQUETE</span>
                <span class="av-pill av-pill--neutral" style="font-size:11px;">${itemsCount} item${itemsCount === 1 ? '' : 's'}</span>
            </td>
            <td><span class="av-pill av-pill--info">${escapeHtml(base.tipo_servicio || '—')}</span>${area}</td>
            <td class="num">${base.cantidad}</td>
            <td class="num" style="font-weight:500;">${money(base.precio_unitario)}</td>
            <td class="num" style="font-weight:600;">${money(subtotalPaquete)}</td>
            <td><span class="av-pill ${ESTADO_PILL_SRV[base.estado] || 'av-pill--neutral'}">${ESTADO_LABEL_SRV[base.estado] || base.estado}</span></td>
            <td></td>
        </tr>`;
    };

    const filaSubtotalHtml = (base, subtotalPaquete) => `
        <tr class="oa-paquete-subtotal" data-padre-id="${base.id}">
            <td colspan="7" style="text-align:right; font-weight:600; padding:0.4rem 1rem; background:var(--surface-hover); font-size:12px; color:var(--text-secondary);">
                Subtotal paquete "${escapeHtml(base.nombre_servicio || '—')}": ${money(subtotalPaquete)}
            </td>
        </tr>`;

    let html = '';
    grupos.forEach(({ base, items, subtotalPaquete }) => {
        html += filaBaseHtml(base, subtotalPaquete, items.length);
        html += items.map(i => filaHtml(i, { indent: true })).join('');
        html += filaSubtotalHtml(base, subtotalPaquete);
    });
    html += filasSueltas.map(s => filaHtml(s)).join('');

    body.innerHTML = html;

    // Colapso/expandir (tarea 6.4): click en la fila base alterna la
    // visibilidad de sus items + su fila de subtotal. Delegado en `body`
    // (no se reasigna en cada pintado, `body` no se reemplaza — solo su
    // innerHTML) y guardado con un dataset flag para no apilar listeners.
    if (!body.dataset.wiredColapso) {
        body.dataset.wiredColapso = '1';
        body.addEventListener('click', (e) => {
            const baseRow = e.target.closest('.oa-paquete-base');
            if (!baseRow) return;
            const paqueteId = baseRow.dataset.paqueteId;
            body.querySelectorAll(`[data-padre-id="${paqueteId}"]`).forEach(el => {
                el.style.display = el.style.display === 'none' ? '' : 'none';
            });
        });
    }
}

function pintarResumen(orden) {
    // orden.total lo calcula el servidor al leer (orden-servicio-carrito,
    // decisión 2): presupuesto real, incluye SOLICITADO/ASIGNADO/EN_PROCESO,
    // no solo lo ejecutado. totalServicios queda de fallback por si el
    // backend no lo manda (respuesta vieja en caché, etc.) — decisión 9.
    const total = typeof orden.total === 'number' ? orden.total : totalServicios(orden.servicios);
    document.getElementById('oaResumenServicios').textContent = money(total);
    document.getElementById('oaTotal').textContent = money(total);
}

function pintarMeta(orden) {
    document.getElementById('oaMetaNumero').textContent = orden.numero;
    document.getElementById('oaMetaApertura').textContent = orden.fecha_apertura
        ? new Date(orden.fecha_apertura).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
    pintarVeterinario(orden);
    document.getElementById('oaMetaEstado').textContent = ESTADO_LABEL_ORDEN[orden.estado] || orden.estado;
}

// Veterinario de la orden: admin y recepción lo pueden cambiar mientras la
// orden admite trabajo (PUT /ordenes/{id}/veterinario, orden-veterinario-y-
// tutores); el resto solo lo ve.
async function pintarVeterinario(orden) {
    const el = document.getElementById('oaMetaVeterinario');
    if (!el) return;
    const puedeCambiar = ['admin', 'recepcionista'].includes(getRole())
        && ['ABIERTA', 'EN_ATENCION'].includes(orden.estado);
    if (!puedeCambiar) {
        el.textContent = orden.veterinario_nombre || 'Sin asignar';
        return;
    }
    try {
        const vets = await fetchAPI('/usuarios/veterinarios');
        el.innerHTML = `<select id="oaVeterinarioSelect" aria-label="Veterinario de la orden" style="max-width: 160px; padding: 2px 6px; border: 1px solid var(--border); border-radius: 6px; font: inherit;">
            <option value="">Sin asignar</option>
            ${(vets || []).map(v => `<option value="${v.id}" ${v.id === orden.veterinario_id ? 'selected' : ''}>${escapeHtml(v.username)}</option>`).join('')}
        </select>`;
        document.getElementById('oaVeterinarioSelect')?.addEventListener('change', async (e) => {
            const vetId = Number(e.target.value);
            if (!vetId) return;
            try {
                await fetchAPI(`/ordenes/${_ordenId}/veterinario`, { method: 'PUT', body: JSON.stringify({ veterinario_id: vetId }) });
                showNotification('Veterinario asignado.', 'success');
                await cargarOrden();
            } catch (err) {
                showNotification('No se pudo asignar el veterinario: ' + err.message, 'error');
            }
        });
    } catch (_) {
        el.textContent = orden.veterinario_nombre || 'Sin asignar';
    }
}

function pintarAcciones(orden) {
    const terminal = orden.estado === 'CERRADA' || orden.estado === 'ANULADA';
    const hayPendientes = (orden.servicios || []).some(s => !s.is_deleted && s.estado === 'SOLICITADO');
    const btnConfirmar = document.getElementById('btnOaConfirmar');
    const btnFacturar = document.getElementById('btnOaFacturar');
    const btnCerrar = document.getElementById('btnOaCerrar');
    const btnAnular = document.getElementById('btnOaAnular');
    // El botón inline vive dentro de #oaPatient y se recrea en cada
    // pintarPaciente() (que corre antes que pintarAcciones en cargarOrden),
    // así que consultarlo acá siempre encuentra el nodo actual.
    const btnAnexar = document.getElementById('btnOaAnexar');
    const btnAnexarInline = document.getElementById('btnOaAnexarInline');
    if (btnConfirmar) btnConfirmar.disabled = terminal || !hayPendientes;
    // Facturar por orden (decisión 9): solo tiene sentido con la orden
    // CERRADA -- ABIERTA/EN_ATENCION todavía es presupuesto, no factura.
    if (btnFacturar) btnFacturar.disabled = orden.estado !== 'CERRADA';
    if (btnCerrar) btnCerrar.disabled = terminal;
    if (btnAnular) btnAnular.disabled = orden.estado === 'ANULADA';
    // El backend ya bloquea anexar con 409 en una orden CERRADA/ANULADA, pero
    // sin esto el usuario completaba todo el panel "Anexar servicio" y recién
    // ahí se enteraba (hallazgo de revisión, etapa 7).
    if (btnAnexar) btnAnexar.disabled = terminal;
    if (btnAnexarInline) btnAnexarInline.disabled = terminal;
}

// ── acciones de ciclo de vida ────────────────────────────────────────────────

async function confirmarServicios() {
    // asignacion-directa-servicio-gestor, decisión 9: junta los <select
    // data-asignar-servicio> con un gestor elegido; sin ninguno, manda el
    // POST sin cuerpo como siempre (el front viejo, e2e/helpers.js::
    // confirmarServiciosOrden, sigue funcionando igual del lado del backend).
    const asignaciones = Array.from(document.querySelectorAll('[data-asignar-servicio]'))
        .map(sel => ({ servicio_id: Number(sel.dataset.asignarServicio), gestor_id: Number(sel.value) }))
        .filter(a => a.gestor_id > 0);
    try {
        await fetchAPI(`/ordenes/${_ordenId}/confirmar`, {
            method: 'POST',
            ...(asignaciones.length ? { body: JSON.stringify({ asignaciones }) } : {}),
        });
        showNotification('Servicios confirmados.', 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo confirmar: ' + e.message, 'error');
    }
}

// orden-servicio-carrito, decisión 9: "Facturar" abre #modalFacturarOrden con
// la vista previa que arma el SERVIDOR (GET /pendientes-facturar), no un
// cálculo local sobre orden.servicios -- así el modal siempre refleja
// exactamente lo que POST /facturar va a cobrar. Solo se ofrece con la orden
// CERRADA (gate en pintarAcciones); acá se repite el chequeo por si el botón
// quedó habilitado con datos viejos.
let _pendientesFacturar = null;

// servicio-base-paquete-items, tarea 7.1: mismo agrupamiento visual que
// pintarServicios(), sobre los ítems planos de GET .../pendientes-facturar
// (`id_interno`, `es_base`, `servicio_padre_id` -- cambio aditivo en
// FacturacionService.obtener_items_pendientes_orden). Reutiliza
// agruparPorPaquete (core/format.js, tarea 7.3) con getters propios porque
// estos ítems no tienen `id`/`cantidad`/`precio_unitario` con esos nombres
// para el id, y ya traen `subtotal` calculado.
function pintarConceptosAgrupados(items) {
    const opts = {
        getId: it => it.id_interno,
        getPadreId: it => it.servicio_padre_id,
        getEsBase: it => !!it.es_base,
        getSubtotal: it => it.subtotal,
    };
    const { grupos, sueltos } = agruparPorPaquete(items, opts);
    const idsAgrupados = new Set([
        ...grupos.map(g => g.base.id_interno),
        ...grupos.flatMap(g => g.items.map(i => i.id_interno)),
    ]);
    const filasSueltas = sueltos.filter(it => !idsAgrupados.has(it.id_interno));

    const filaConcepto = (it, { indent = false } = {}) => `
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:6px 0; ${indent ? 'padding-left:1.5rem; color:var(--text-secondary);' : ''}">
            <span>${indent ? '└─ ' : ''}${escapeHtml(it.descripcion || '—')}</span>
            <span class="rp-num" style="white-space:nowrap;">${money(it.subtotal)}</span>
        </div>`;

    let html = '';
    grupos.forEach(({ base, items: hijos, subtotalPaquete }) => {
        html += `<div style="font-weight:600; font-size:13px; padding:6px 0 0;">${escapeHtml(base.descripcion || '—')} <span class="av-pill av-pill--info" style="font-size:10px;">PAQUETE</span></div>`;
        html += hijos.map(h => filaConcepto(h, { indent: true })).join('');
        html += `<div style="display:flex; justify-content:space-between; gap:10px; font-size:12px; color:var(--text-secondary); padding:2px 0 8px; border-bottom:1px dashed var(--border);">
            <span>Subtotal paquete</span><span class="rp-num">${money(subtotalPaquete)}</span>
        </div>`;
    });
    html += filasSueltas.map(it => filaConcepto(it)).join('');
    return html;
}

async function facturarOrden() {
    if (_ordenData?.estado !== 'CERRADA') {
        showNotification('Solo se puede facturar una orden CERRADA.', 'warning');
        return;
    }
    try {
        _pendientesFacturar = await fetchAPI(`/ordenes/${_ordenId}/pendientes-facturar`);
    } catch (e) {
        showNotification('No se pudo cargar lo pendiente de facturar: ' + e.message, 'error');
        return;
    }
    const items = _pendientesFacturar?.items || [];
    if (items.length === 0) {
        showNotification('No hay servicios pendientes de facturar en esta orden.', 'warning');
        return;
    }

    document.getElementById('facOrdenNumero').textContent = `orden ${_ordenData.numero || _ordenId}`;
    document.getElementById('facOrdenConceptos').innerHTML = pintarConceptosAgrupados(items);
    document.getElementById('facOrdenTotal').textContent = money(_pendientesFacturar.total);
    document.querySelector('input[name="facOrdenMetodo"][value="EFECTIVO"]').checked = true;
    document.getElementById('facOrdenPagaAhora').checked = true;
    document.getElementById('facOrdenPendienteNota').hidden = true;

    openModal('modalFacturarOrden');
}

async function confirmarFacturarOrden() {
    if (!_pendientesFacturar || (_pendientesFacturar.items || []).length === 0) return;

    const metodoPago = document.querySelector('input[name="facOrdenMetodo"]:checked')?.value || 'EFECTIVO';
    const pagaAhora = document.getElementById('facOrdenPagaAhora')?.checked;
    const total = _pendientesFacturar.total || 0;

    try {
        // El servidor arma los detalles y resuelve el consulta_id de la
        // orden solo (decisión 6): el front ya no manda detalles[] ni
        // servicio_id, ni tiene que buscar la línea CONSULTA a mano.
        const factura = await fetchAPI(`/ordenes/${_ordenId}/facturar`, {
            method: 'POST',
            body: JSON.stringify({
                // No se manda metodo_pago si no se cobra ahora (total_pagado
                // 0): mandarlo igual dejaba una factura PENDIENTE marcada
                // como cobrada por el método por defecto (hallazgo de
                // revisión 11, se mantiene con el endpoint nuevo).
                ...(pagaAhora ? { metodo_pago: metodoPago } : {}),
                total_pagado: pagaAhora ? total : 0.0,
                descuento: 0.0,
                impuesto: 0.0,
            }),
        });
        closeModal('modalFacturarOrden');
        _pendientesFacturar = null;
        showNotification(`Factura #${factura.numero_factura || factura.id} emitida${pagaAhora ? ' y cobrada' : ''}.`, 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo facturar la orden: ' + e.message, 'error');
    }
}

async function cerrarOrden() {
    if (!window.confirm('¿Cerrar esta orden? No se van a poder anexar más servicios.')) return;
    try {
        await fetchAPI(`/ordenes/${_ordenId}/cerrar`, { method: 'POST' });
        showNotification('Orden cerrada.', 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo cerrar la orden: ' + e.message, 'error');
    }
}

async function anularOrden(motivo) {
    try {
        await fetchAPI(`/ordenes/${_ordenId}/anular`, { method: 'POST', body: JSON.stringify({ motivo_anulacion: motivo }) });
        showNotification('Orden anulada.', 'success');
        closeModal('modalAnularOrden');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo anular la orden: ' + e.message, 'error');
    }
}

// ── panel "Anexar servicio" (452px, hermano flex del contenido — Decisión 3) ─

function cerrarAnexarPanel() {
    const panel = document.getElementById('oaAnexarPanel');
    const canvas = document.getElementById('oaCanvas');
    if (panel) panel.hidden = true;
    if (canvas) canvas.classList.remove('oa-canvas--compressed');
    _svcSeleccionado = null;
    _consumos = [];
    ocultarPanelPaquete();
    document.removeEventListener('keydown', onAnexarKeydown);
}

async function abrirAnexarPanel() {
    const panel = document.getElementById('oaAnexarPanel');
    const canvas = document.getElementById('oaCanvas');
    if (!panel) return;
    panel.hidden = false;
    if (canvas) canvas.classList.add('oa-canvas--compressed');
    document.addEventListener('keydown', onAnexarKeydown);
    document.getElementById('oaAnexarSearch')?.focus();
    pintarPaquetePadreOptions();
    await cargarCatalogoAnexar();
}

// servicio-base-paquete-items, tarea 8: opciones del selector "Paquete
// padre" = servicios `es_base=true` vivos (no is_deleted, no CANCELADO —
// mismo criterio que orden_service.crear_servicio_en_orden) de la orden
// actual. Se recalcula cada vez que se abre el panel, sobre `_ordenData` ya
// cargado por cargarOrden().
function pintarPaquetePadreOptions() {
    const select = document.getElementById('oaPaquetePadre');
    const checkbox = document.getElementById('oaEsBase');
    if (!select) return;
    const bases = (_ordenData?.servicios || []).filter(s =>
        s.es_base && !s.is_deleted && s.estado !== 'CANCELADO'
    );
    select.innerHTML = [
        '<option value="">Servicio suelto (sin paquete)</option>',
        ...bases.map(b => `<option value="${b.id}">${escapeHtml(b.nombre_servicio || `#${b.id}`)} (PAQUETE)</option>`),
    ].join('');
    select.value = '';
    if (checkbox) checkbox.checked = false;
    select.disabled = false;
}

function onAnexarKeydown(e) {
    if (e.key === 'Escape') cerrarAnexarPanel();
}

async function cargarCatalogoAnexar() {
    try {
        _catalogo = await fetchAPI('/catalogo?solo_activos=true&limit=500') || [];
    } catch (_) {
        _catalogo = [];
    }
    // AnexarServicio.html contradicción documentada arriba: se excluye
    // CONSULTA — se abre desde el consultorio, no desde el picker.
    _catalogo = _catalogo.filter(s => (s.categoria || '').toUpperCase() !== 'CONSULTA');
    _catActual = null;
    pintarCategorias();
    pintarServiciosPicker();
}

function pintarCategorias() {
    const cont = document.getElementById('oaCatList');
    if (!cont) return;
    const porCategoria = new Map();
    _catalogo.forEach(s => porCategoria.set(s.categoria, (porCategoria.get(s.categoria) || 0) + 1));
    const cats = Array.from(porCategoria.entries());
    cont.innerHTML = [
        `<button type="button" class="oa-cat-item" data-cat="" aria-current="${_catActual === null ? 'true' : 'false'}"><span>Todas</span><span class="av-nav-num">${_catalogo.length}</span></button>`,
        ...cats.map(([cat, n]) => `<button type="button" class="oa-cat-item" data-cat="${escapeHtml(cat)}" aria-current="${_catActual === cat ? 'true' : 'false'}"><span>${escapeHtml(cat)}</span><span class="av-nav-num">${n}</span></button>`),
    ].join('');
    cont.querySelectorAll('.oa-cat-item').forEach(btn => {
        btn.addEventListener('click', () => {
            _catActual = btn.dataset.cat || null;
            pintarCategorias();
            pintarServiciosPicker();
        });
    });
}

function pintarServiciosPicker() {
    const cont = document.getElementById('oaSvcList');
    if (!cont) return;
    const q = (document.getElementById('oaAnexarSearch')?.value || '').trim().toLowerCase();
    const items = _catalogo.filter(s =>
        (!_catActual || s.categoria === _catActual) &&
        (!q || s.nombre.toLowerCase().includes(q))
    );
    if (items.length === 0) {
        cont.innerHTML = '<p class="av-muted" style="padding:12px;">Sin resultados.</p>';
        return;
    }
    cont.innerHTML = items.map(s => `
        <button type="button" class="oa-svc-item" data-id="${s.id}" aria-checked="${_svcSeleccionado?.id === s.id ? 'true' : 'false'}">
            <span class="oa-svc-radio"><span class="oa-svc-radio-dot"></span></span>
            <span class="oa-svc-info"><strong>${escapeHtml(s.nombre)}</strong>${s.es_paquete ? ' <span class="av-pill av-pill--info" style="font-size:10px;">PAQUETE</span>' : ''}<span>${escapeHtml(s.categoria)}</span></span>
            <span class="oa-svc-price num">${money(s.precio_ref)}</span>
        </button>`).join('');
    cont.querySelectorAll('.oa-svc-item').forEach(btn => {
        btn.addEventListener('click', () => seleccionarServicio(Number(btn.dataset.id)));
    });
}

async function seleccionarServicio(id) {
    _svcSeleccionado = _catalogo.find(s => s.id === id) || null;
    pintarServiciosPicker();
    if (_svcSeleccionado?.es_paquete) {
        await mostrarPanelPaquete();
    } else {
        ocultarPanelPaquete();
        await mostrarConsumosServicio();
    }
}

async function mostrarConsumosServicio() {
    const wrap = document.getElementById('oaConsumosWrap');
    const list = document.getElementById('oaConsumosList');
    if (!_svcSeleccionado || !wrap || !list) return;
    // Fix de revisión: si el usuario elige otro servicio mientras este fetch
    // está en vuelo, no hay que pintar la respuesta vieja encima del nuevo
    // servicio seleccionado.
    const svcId = _svcSeleccionado.id;
    wrap.hidden = false;
    list.innerHTML = '<p class="av-muted" style="padding:8px 0;">Cargando insumos…</p>';
    try {
        const lineas = await fetchAPI(`/catalogo/${svcId}/recetas`) || [];
        if (_svcSeleccionado?.id !== svcId) return;
        _consumos = lineas.map(l => ({ inventario_id: l.inventario_id, nombre: l.inventario_nombre, cantidad: Number(l.cantidad), unidad: l.unidad_medida }));
        if (_consumos.length === 0) {
            list.innerHTML = '<p class="av-muted" style="padding:8px 0;">Este servicio no consume insumos con receta fija.</p>';
            return;
        }
        list.innerHTML = _consumos.map((c, i) => `
            <div class="oa-consumo-row">
                <div class="oa-consumo-info"><strong>${escapeHtml(c.nombre || ('#' + c.inventario_id))}</strong><span>Cantidad estándar</span></div>
                <div class="oa-consumo-qty"><input type="number" step="0.001" min="0" value="${c.cantidad}" data-idx="${i}" style="width:100%; border:0; background:transparent; text-align:center; font:inherit;" class="num"> ${escapeHtml(c.unidad || '')}</div>
            </div>`).join('');
        list.querySelectorAll('input[data-idx]').forEach(inp => {
            inp.addEventListener('change', () => {
                const idx = Number(inp.dataset.idx);
                // Vacío queda como null (no como 0): confirmarAnexo lo rechaza.
                _consumos[idx].cantidad = inp.value.trim() === '' ? null : Number(inp.value);
            });
        });
    } catch (_) {
        if (_svcSeleccionado?.id !== svcId) return;
        _consumos = [];
        list.innerHTML = '<p class="av-text-danger" style="padding:8px 0;">No se pudo cargar la receta de este servicio.</p>';
    }
}

// plantillas-paquete-catalogo: un servicio marcado es_paquete arma su propia
// jerarquía base/items al confirmar (POST /ordenes/{id}/paquetes) -- se
// oculta el editor de consumos (no aplica: son varias líneas, no una) y el
// grupo "es paquete base"/"paquete padre" (redundante, el paquete YA es su
// propia base).
async function mostrarPanelPaquete() {
    const wrap = document.getElementById('oaPaqueteWrap');
    const consumosWrap = document.getElementById('oaConsumosWrap');
    const basePadreGroup = document.getElementById('oaBasePadreGroup');
    const btnConfirmar = document.getElementById('btnOaAnexarConfirmar');
    const componentesEl = document.getElementById('oaPaqueteComponentes');
    const dispEl = document.getElementById('oaPaqueteDisponibilidad');
    const totalEl = document.getElementById('oaPaqueteTotal');
    if (!_svcSeleccionado || !wrap || !componentesEl || !dispEl) return;
    // Fix de revisión: mismo criterio que mostrarConsumosServicio -- si el
    // usuario elige otro servicio antes de que resuelvan estos dos fetch,
    // no pintar la respuesta vieja.
    const svcId = _svcSeleccionado.id;

    if (consumosWrap) consumosWrap.hidden = true;
    // `#oaBasePadreGroup` trae `display:flex` inline (index.html): un inline
    // style siempre gana sobre la regla `[hidden]{display:none}` del user
    // agent, así que ocultarlo es `style.display`, no el atributo `hidden`.
    if (basePadreGroup) basePadreGroup.style.display = 'none';
    if (btnConfirmar) btnConfirmar.textContent = 'Agregar paquete';
    wrap.hidden = false;
    componentesEl.innerHTML = '<p class="av-muted" style="padding:8px 0;">Cargando componentes…</p>';
    dispEl.innerHTML = '';
    if (totalEl) totalEl.textContent = '';

    try {
        const [paquete, disponibilidad] = await Promise.all([
            fetchAPI(`/catalogo/${svcId}/componentes`),
            fetchAPI(`/catalogo/${svcId}/disponibilidad`),
        ]);
        if (_svcSeleccionado?.id !== svcId) return;
        componentesEl.innerHTML = (paquete.componentes || []).map(c => `
            <div class="oa-consumo-row">
                <div class="oa-consumo-info"><strong>${escapeHtml(c.nombre)}</strong><span>cantidad ${c.cantidad}${c.activo ? '' : ' · inactivo (se omite)'}</span></div>
                <div class="oa-consumo-qty num">${money(c.subtotal)}</div>
            </div>`).join('') || '<p class="av-muted" style="padding:8px 0;">Este paquete no tiene componentes.</p>';
        if (totalEl) totalEl.textContent = `Total: ${money(paquete.total_paquete)}`;

        const insumos = disponibilidad.insumos || [];
        dispEl.innerHTML = insumos.length === 0
            ? '<p class="av-muted" style="padding:8px 0;">No consume insumos con receta fija.</p>'
            : insumos.map(i => `
                <div class="oa-consumo-row">
                    <div class="oa-consumo-info"><strong>${escapeHtml(i.nombre)}</strong><span>requiere ${i.requerido} ${escapeHtml(i.unidad)} · hay ${i.disponible} ${escapeHtml(i.unidad)}</span></div>
                    <div class="oa-consumo-qty num${i.faltante > 0 ? ' av-text-danger' : ''}">${i.faltante > 0 ? `faltan ${i.faltante}` : 'ok'}</div>
                </div>`).join('');
    } catch (e) {
        if (_svcSeleccionado?.id !== svcId) return;
        componentesEl.innerHTML = `<p class="av-text-danger" style="padding:8px 0;">No se pudo cargar el paquete: ${escapeHtml(e.message)}</p>`;
    }
}

function ocultarPanelPaquete() {
    const wrap = document.getElementById('oaPaqueteWrap');
    const basePadreGroup = document.getElementById('oaBasePadreGroup');
    const btnConfirmar = document.getElementById('btnOaAnexarConfirmar');
    if (wrap) wrap.hidden = true;
    if (basePadreGroup) basePadreGroup.style.display = 'flex';
    if (btnConfirmar) btnConfirmar.textContent = 'Anexar a la orden';
}

async function confirmarAnexo() {
    if (!_svcSeleccionado) {
        showNotification('Elegí un servicio del catálogo primero.', 'warning');
        return;
    }
    if (_svcSeleccionado.es_paquete) {
        try {
            const resp = await fetchAPI(`/ordenes/${_ordenId}/paquetes`, {
                method: 'POST',
                body: JSON.stringify({ catalogo_servicio_id: _svcSeleccionado.id }),
            });
            showNotification('Paquete anexado a la orden.', 'success');
            if (resp?.advertencias?.length) {
                showNotification(resp.advertencias.map(a => a.mensaje || JSON.stringify(a)).join(' — '), 'warning');
            }
            cerrarAnexarPanel();
            await cargarOrden();
        } catch (e) {
            showNotification('No se pudo anexar el paquete: ' + e.message, 'error');
        }
        return;
    }
    const tipo = CATEGORIA_TIPO[(_svcSeleccionado.categoria || '').toUpperCase()] || 'OTRO';
    const body = {
        tipo_servicio: tipo,
        catalogo_servicio_id: _svcSeleccionado.id,
        nombre_servicio: _svcSeleccionado.nombre,
        cantidad: 1,
        precio_unitario: _svcSeleccionado.precio_ref,
    };
    if (_consumos.length) {
        // Vacío o negativo no se adivina: se pide corregir. Se mandan también
        // los 0 ("no se usó"): si se omitían, al ejecutar se descontaba la
        // cantidad de la receta (fix de revisión).
        if (_consumos.some(c => c.cantidad === null || !(c.cantidad >= 0))) {
            showNotification('Completá la cantidad de cada material (0 si no se usó).', 'warning');
            return;
        }
        body.consumos = _consumos.map(c => ({ inventario_id: c.inventario_id, cantidad: c.cantidad }));
    }
    // servicio-base-paquete-items, tarea 8: "es paquete base" y "paquete
    // padre" son mutuamente excluyentes (ya se garantiza en el wiring de
    // abajo, se repite acá por si el DOM quedó en un estado intermedio).
    const esBase = document.getElementById('oaEsBase')?.checked || false;
    const padreId = document.getElementById('oaPaquetePadre')?.value;
    if (esBase) {
        body.es_base = true;
    } else if (padreId) {
        body.servicio_padre_id = Number(padreId);
    }
    try {
        const resp = await fetchAPI(`/ordenes/${_ordenId}/servicios`, { method: 'POST', body: JSON.stringify(body) });
        showNotification('Servicio anexado a la orden.', 'success');
        if (resp?.advertencias?.length) {
            showNotification(resp.advertencias.map(a => a.mensaje || JSON.stringify(a)).join(' — '), 'warning');
        }
        cerrarAnexarPanel();
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo anexar el servicio: ' + e.message, 'error');
    }
}

// ── wiring (una sola vez) ────────────────────────────────────────────────────
export const initOrdenAbierta = () => {
    if (_wired) return;
    _wired = true;

    document.getElementById('btnOaAnexar')?.addEventListener('click', abrirAnexarPanel);
    document.getElementById('btnOaAnexarClose')?.addEventListener('click', cerrarAnexarPanel);
    document.getElementById('btnOaAnexarCancelar')?.addEventListener('click', cerrarAnexarPanel);
    document.getElementById('btnOaAnexarConfirmar')?.addEventListener('click', confirmarAnexo);
    document.getElementById('oaAnexarSearch')?.addEventListener('input', debounce(pintarServiciosPicker, 150));

    // servicio-base-paquete-items, tarea 8.3: "es paquete base" y "paquete
    // padre" son mutuamente excluyentes -- marcar uno limpia/deshabilita el
    // otro, no dos requests separadas a confirmarAnexo lo van a permitir de
    // todas formas (el backend rechaza es_base+servicio_padre_id con 422).
    document.getElementById('oaEsBase')?.addEventListener('change', (e) => {
        const select = document.getElementById('oaPaquetePadre');
        if (!select) return;
        if (e.target.checked) {
            select.value = '';
            select.disabled = true;
        } else {
            select.disabled = false;
        }
    });
    document.getElementById('oaPaquetePadre')?.addEventListener('change', (e) => {
        const checkbox = document.getElementById('oaEsBase');
        if (e.target.value && checkbox) checkbox.checked = false;
    });

    document.getElementById('btnOaConfirmar')?.addEventListener('click', confirmarServicios);
    document.getElementById('btnOaFacturar')?.addEventListener('click', facturarOrden);
    // Guard contra doble clic (revisión 11): sin esto, dos clics rápidos en
    // "Emitir factura" mandaban dos POST /facturas/ casi simultáneos y
    // creaban dos facturas para los mismos servicios. submitWithLoading
    // deshabilita el botón mientras la request está en vuelo y lo reactiva
    // siempre (éxito o error) vía finally.
    document.getElementById('btnConfirmarFacturarOrden')?.addEventListener('click', (e) => {
        submitWithLoading(e.currentTarget, confirmarFacturarOrden);
    });
    document.getElementById('facOrdenPagaAhora')?.addEventListener('change', (e) => {
        document.getElementById('facOrdenPendienteNota').hidden = e.target.checked;
    });
    document.getElementById('btnOaCerrar')?.addEventListener('click', cerrarOrden);
    document.getElementById('btnOaAnular')?.addEventListener('click', () => {
        document.getElementById('anularOrdenMotivo').value = '';
        openModal('modalAnularOrden');
    });
    document.getElementById('formAnularOrden')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const motivo = document.getElementById('anularOrdenMotivo').value.trim();
        if (!motivo) return;
        anularOrden(motivo);
    });
};
