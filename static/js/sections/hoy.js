// sections/hoy.js — sec-hoy, "Panel del día" (Tarea 06, etapa 7; antes
// "Hoy" con bandeja de consultas — Tarea 09, etapa 4).
//
// Portada del módulo 1 (Admisión). Ya no muestra consultas: la bandeja del
// día es de ÓRDENES DE SERVICIO (ABIERTA/EN_ATENCION), más la sala de espera
// (turnos PENDIENTE, se conserva igual que antes) y los KPI de cobro.
// docs/diseno/navegacion-v2.md, Decisión 1 y `docs/diseno/pantallas/Main.html`.
//
// LÍMITE DOCUMENTADO: OrdenServicioResponse (GET /api/ordenes/) no expone
// total ni cantidad de servicios por fila — sólo OrdenServicioDetalleResponse
// (GET /api/ordenes/{id}) los trae. Para pintar la columna "Servicios"/"Total"
// de la tabla se hace un fetch de detalle por orden (Promise.all, acotado por
// el `limit` del listado). Es un N+1 conocido; una mejora de backend futura
// podría exponer esos dos campos ya agregados en el listado.

import { fetchAPI } from '../core/api.js';
import { showNotification, openModal, closeModal, debounce } from '../core/ui.js';
import { money, totalServicios, fechaLargaEsVE } from '../core/format.js';
import { getRole, getUserId, whenReady } from '../core/session.js';
import {
    verConsultaCompleta,
    seleccionarMascotaBasica,
    abrirFormularioConsulta,
} from './consultorio.js';
import { abrirOrden } from './orden-abierta.js';

// ── utilidades ──────────────────────────────────────────────────────────────
const countServicios = (servicios) => (servicios || []).filter(s => !s.is_deleted).length;

const ESTADO_PILL = {
    ABIERTA: 'av-pill--warn',
    EN_ATENCION: 'av-pill--info',
    CERRADA: 'av-pill--ok',
    ANULADA: 'av-pill--neutral',
};

const ESTADO_LABEL = {
    ABIERTA: 'Abierta',
    EN_ATENCION: 'En atención',
    CERRADA: 'Cerrada',
    ANULADA: 'Anulada',
};

let _mascotaCache = null;
const cargarMascotasMap = async () => {
    if (_mascotaCache) return _mascotaCache;
    try {
        const list = await fetchAPI('/mascotas/?skip=0&limit=500');
        _mascotaCache = new Map((list || []).map(m => [m.id, m]));
    } catch (_) {
        _mascotaCache = new Map();
    }
    return _mascotaCache;
};

// ── KPIs ─────────────────────────────────────────────────────────────────────
const isToday = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const renderKpiOrdenes = (ordenes) => {
    const val = document.getElementById('pdKpiOrdenes');
    const sub = document.getElementById('pdKpiOrdenesSub');
    if (!val) return;
    const abiertas = ordenes.filter(o => o.estado === 'ABIERTA').length;
    val.textContent = String(ordenes.length);
    if (sub) sub.textContent = `${abiertas} esperando atención`;
};

const renderKpiSala = (pendientes) => {
    const val = document.getElementById('pdKpiSala');
    const sub = document.getElementById('pdKpiSalaSub');
    if (!val) return;
    val.textContent = String(pendientes.length);
    if (sub) {
        const ordenadas = [...pendientes].sort((a, b) => new Date(a.fecha_cita) - new Date(b.fecha_cita));
        const masAntigua = ordenadas[0];
        sub.textContent = masAntigua
            ? `La más antigua: ${new Date(masAntigua.fecha_cita).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Sin turnos pendientes';
    }
};

// Consume el mismo caché que renderOrdenes (cargarOrdenesConDetalle) — antes
// esta función hacía su propio fetch de `/ordenes/?estado=CERRADA` + su propio
// N+1 de detalle, duplicando exactamente las mismas órdenes que ya pedía
// renderOrdenes() en el mismo loadHoy() (hallazgo de revisión, etapa 7).
const renderKpiCobrar = (ordenesConDetalle) => {
    const val = document.getElementById('pdKpiCobrar');
    const sub = document.getElementById('pdKpiCobrarSub');
    if (!val) return;
    const cerradas = ordenesConDetalle.filter(o => o.estado === 'CERRADA');
    const total = cerradas.reduce((acc, o) => acc + (o._total || 0), 0);
    val.textContent = money(total);
    if (sub) sub.textContent = `${cerradas.length} órdenes cerradas sin facturar`;
};

const renderKpiFacturado = async () => {
    const val = document.getElementById('pdKpiFacturado');
    const sub = document.getElementById('pdKpiFacturadoSub');
    if (!val) return;
    try {
        const facturas = await fetchAPI('/facturas/');
        const lista = (Array.isArray(facturas) ? facturas : [])
            .filter(f => f.estado !== 'ANULADA' && isToday(f.fecha_emision));
        const total = lista.reduce((acc, f) => acc + (f.total ?? f.total_pagado ?? 0), 0);
        val.textContent = money(total);
        if (sub) sub.textContent = `${lista.length} facturas emitidas hoy`;
    } catch (_) {
        val.textContent = '—';
    }
};

// ── sala de espera (turnos PENDIENTE — se conserva igual que "Hoy" 1A) ──────
const renderSalaEspera = async () => {
    const box = document.getElementById('pdWaitingList');
    const count = document.getElementById('pdWaitingCount');
    if (!box) return [];
    box.innerHTML = '<p class="av-muted" style="padding: 12px 16px;">Cargando…</p>';
    try {
        await whenReady;
        const soloMias = getRole() === 'veterinario' && getUserId();
        const url = `/citas/${soloMias ? `?veterinario_id=${getUserId()}` : ''}`;
        const [citas, mascotas] = await Promise.all([
            fetchAPI(url),
            cargarMascotasMap(),
        ]);
        const pendientes = (Array.isArray(citas) ? citas : []).filter(c => c && c.estado === 'PENDIENTE');
        if (count) count.textContent = `${pendientes.length} paciente${pendientes.length === 1 ? '' : 's'}`;
        if (pendientes.length === 0) {
            box.innerHTML = '<p class="av-muted" style="padding: 12px 16px;">No hay turnos pendientes.</p>';
            return pendientes;
        }
        box.innerHTML = pendientes
            .sort((a, b) => new Date(a.fecha_cita) - new Date(b.fecha_cita))
            .map(c => {
                const m = mascotas.get(c.mascota_id);
                const nombre = m ? m.nombre : `Paciente #${c.mascota_id}`;
                const iniciales = (nombre || '?').slice(0, 2).toUpperCase();
                const hora = c.fecha_cita ? new Date(c.fecha_cita).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                return `
                    <button type="button" class="pd-waiting-row" data-mascota-id="${c.mascota_id}">
                        <span class="pd-waiting-avatar">${iniciales}</span>
                        <span class="pd-waiting-info">
                            <strong>${nombre}</strong>
                            <span>${c.tipo || 'Turno'}</span>
                        </span>
                        <span class="pd-waiting-time">${hora}</span>
                    </button>`;
            }).join('');
        box.querySelectorAll('.pd-waiting-row').forEach(row => {
            row.addEventListener('click', async () => {
                const mascotaId = Number(row.dataset.mascotaId);
                await seleccionarMascotaBasica(mascotaId);
                abrirFormularioConsulta();
            });
        });
        return pendientes;
    } catch (e) {
        box.innerHTML = `<p class="av-text-danger" style="padding:12px 16px;">Error cargando turnos: ${e.message}</p>`;
        return [];
    }
};

// ── órdenes de servicio del día ──────────────────────────────────────────────
let _ordenesCache = [];
let _filtroActual = 'todas';

const FILTRO_ESTADOS = {
    todas: null,
    abiertas: ['ABIERTA', 'EN_ATENCION'],
    cobrar: ['CERRADA'],
    cerradas: ['CERRADA', 'ANULADA'],
};

const pintarOrdenes = () => {
    const body = document.getElementById('pdOrdersBody');
    if (!body) return;
    const estados = FILTRO_ESTADOS[_filtroActual];
    const filtradas = estados ? _ordenesCache.filter(o => estados.includes(o.estado)) : _ordenesCache;
    if (filtradas.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No hay órdenes en este filtro.</td></tr>';
        return;
    }
    body.innerHTML = filtradas.map(o => `
        <tr data-orden-id="${o.id}">
            <td><span class="num pd-order-link">${o.numero}</span></td>
            <td style="font-weight:500;">${o.mascota_nombre || '—'}</td>
            <td style="color:var(--text-secondary);">${o.propietario_nombre || '—'}</td>
            <td class="num" style="color:var(--text-secondary);">${o._serviciosCount ?? '—'}</td>
            <td class="num" style="font-weight:500;">${o._total != null ? money(o._total) : '—'}</td>
            <td><span class="av-pill ${ESTADO_PILL[o.estado] || 'av-pill--neutral'}">${ESTADO_LABEL[o.estado] || o.estado}</span></td>
        </tr>`).join('');
    body.querySelectorAll('tr[data-orden-id]').forEach(tr => {
        tr.addEventListener('click', () => abrirOrden(Number(tr.dataset.ordenId)));
    });
};

// Trae las órdenes del panel del día UNA sola vez con su detalle (total +
// cantidad de servicios) y las cachea — renderOrdenes() y renderKpiCobrar()
// consumen el mismo resultado en vez de pedirlo cada una por su lado
// (hallazgo de revisión, etapa 7: N+1 duplicado).
//
// Alcance por rol: un veterinario sólo ve SUS órdenes (mismo patrón
// `soloMias`/`veterinario_id` que renderSalaEspera usa para turnos); admin y
// recepcionista ven las de todos. Antes esta consulta no mandaba
// `veterinario_id`, así que cualquier veterinario veía las órdenes de todos
// los demás (regresión de alcance de datos vs. la pantalla vieja).
const cargarOrdenesConDetalle = async () => {
    const body = document.getElementById('pdOrdersBody');
    if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Cargando…</td></tr>';
    try {
        const soloMias = getRole() === 'veterinario' && getUserId();
        const filtroVet = soloMias ? `&veterinario_id=${getUserId()}` : '';
        const lista = await fetchAPI(`/ordenes/?estado=ABIERTA,EN_ATENCION,CERRADA&limit=100${filtroVet}`);
        const ordenes = Array.isArray(lista) ? lista : [];
        // N+1 documentado (ver cabecera del archivo): el listado no trae
        // total ni cantidad de servicios, sólo el detalle por id.
        const detalles = await Promise.all(ordenes.map(o => fetchAPI(`/ordenes/${o.id}`).catch(() => null)));
        return ordenes.map((o, i) => {
            const d = detalles[i];
            return { ...o, _total: d ? totalServicios(d.servicios) : null, _serviciosCount: d ? countServicios(d.servicios) : null };
        });
    } catch (e) {
        if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent); padding:1.5rem;">Error cargando órdenes: ${e.message}</td></tr>`;
        const cobrar = document.getElementById('pdKpiCobrar');
        if (cobrar) cobrar.textContent = '—';
        return [];
    }
};

const renderOrdenes = (ordenesConDetalle) => {
    _ordenesCache = ordenesConDetalle;
    pintarOrdenes();
    renderKpiOrdenes(ordenesConDetalle.filter(o => o.estado === 'ABIERTA' || o.estado === 'EN_ATENCION'));
};

const wireFiltros = () => {
    const bar = document.getElementById('pdOrdersFilters');
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = 'true';
    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.pd-filter');
        if (!btn) return;
        _filtroActual = btn.dataset.filtro;
        bar.querySelectorAll('.pd-filter').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        pintarOrdenes();
    });
};

// ── header (título fijo, subtítulo con la fecha) ────────────────────────────
const pintarHeader = () => {
    const sub = document.getElementById('avHeaderSubtitleText');
    if (sub) sub.textContent = fechaLargaEsVE();
};

export const loadHoy = async () => {
    _mascotaCache = null; // refrescar nombres cada vez que se entra al panel
    pintarHeader();
    wireFiltros();
    const salaP = renderSalaEspera().then(renderKpiSala);
    const facturadoP = renderKpiFacturado();
    const ordenesConDetalle = await cargarOrdenesConDetalle();
    renderOrdenes(ordenesConDetalle);
    renderKpiCobrar(ordenesConDetalle);
    await Promise.all([salaP, facturadoP]);
};

// ── selector de mascota reutilizable ────────────────────────────────────────
let _selectorPick = null;

const abrirSelectorMascota = (titulo, onPick) => {
    _selectorPick = onPick;
    const t = document.getElementById('selectorMascotaTitulo');
    if (t) t.textContent = titulo;
    const input = document.getElementById('selectorMascotaSearch');
    const results = document.getElementById('selectorMascotaResultados');
    if (input) input.value = '';
    if (results) results.innerHTML = '<p class="av-muted" style="padding:8px 4px;">Escriba para buscar.</p>';
    openModal('modalSelectorMascota');
    if (input) input.focus();
};

const buscarMascotasSelector = debounce(async (query) => {
    const results = document.getElementById('selectorMascotaResultados');
    if (!results) return;
    if (!query || query.trim().length < 2) {
        results.innerHTML = '<p class="av-muted" style="padding:8px 4px;">Escriba al menos 2 caracteres.</p>';
        return;
    }
    try {
        const mascotas = await fetchAPI(`/mascotas/?search=${encodeURIComponent(query.trim())}&limit=40`);
        if (!mascotas || mascotas.length === 0) {
            results.innerHTML = '<p class="av-muted" style="padding:8px 4px;">Sin resultados.</p>';
            return;
        }
        results.innerHTML = mascotas.map(m => `
            <button type="button" class="pd-waiting-row" role="option" data-id="${m.id}" data-nombre="${(m.nombre || '').replace(/"/g, '&quot;')}" data-propietario-id="${m.propietario_id || ''}">
                <span class="pd-waiting-avatar">${(m.nombre || '?').slice(0, 2).toUpperCase()}</span>
                <span class="pd-waiting-info">
                    <strong>${m.nombre}</strong>
                    <span>${[m.especie, m.raza].filter(Boolean).join(' · ')}</span>
                </span>
                <span class="pd-waiting-time">#${m.codigo_historia || m.id}</span>
            </button>`).join('');
        results.querySelectorAll('.pd-waiting-row').forEach(row => {
            row.addEventListener('click', () => {
                const cb = _selectorPick;
                _selectorPick = null;
                closeModal('modalSelectorMascota');
                if (cb) cb(Number(row.dataset.id), row.dataset.nombre, row.dataset.propietarioId ? Number(row.dataset.propietarioId) : null);
            });
        });
    } catch (e) {
        results.innerHTML = `<p class="av-text-danger" style="padding:8px 4px;">Error: ${e.message}</p>`;
    }
}, 350);

// ── flujo: agregar consulta ─────────────────────────────────────────────────
export const abrirNuevaConsultaFlow = () => {
    abrirSelectorMascota('Nueva consulta — elegí el paciente', async (id) => {
        await seleccionarMascotaBasica(id);
        abrirFormularioConsulta();
    });
};

// ── flujo: nueva orden de servicio ──────────────────────────────────────────
// Abre el selector de paciente y, con la mascota elegida, abre la orden
// (propietario_id se deriva de la mascota — POST /api/ordenes/ lo exige).
export const abrirNuevaOrdenFlow = () => {
    abrirSelectorMascota('Nueva orden — elegí el paciente', async (mascotaId, nombre, propietarioId) => {
        if (!propietarioId) {
            showNotification('Ese paciente no tiene un propietario asociado; no se puede abrir la orden.', 'error');
            return;
        }
        try {
            const orden = await fetchAPI('/ordenes/', {
                method: 'POST',
                body: JSON.stringify({ propietario_id: propietarioId, mascota_id: mascotaId }),
            });
            showNotification(`Orden ${orden.numero} abierta.`, 'success');
            abrirOrden(orden.id);
        } catch (err) {
            showNotification('No se pudo abrir la orden: ' + err.message, 'error');
        }
    });
};

// ── flujo: agregar servicio directo ─────────────────────────────────────────
// Abre el modal de servicio directo ya apuntado a una mascota concreta (sin pasar
// por el selector). Lo reusa la pestaña "Servicios" de la ficha del paciente.
export const abrirServicioDirectoParaMascota = (id, nombre) => {
    const form = document.getElementById('formServicioDirecto');
    if (form) form.reset();
    document.getElementById('servicioDirectoMascotaId').value = id;
    document.getElementById('servicioDirectoCatalogoId').value = '';
    const label = document.getElementById('servicioDirectoPaciente');
    if (label) label.textContent = `Paciente: ${nombre || ('#' + id)}`;
    openModal('modalServicioDirecto');
};

export const abrirServicioDirectoFlow = () => {
    abrirSelectorMascota('Servicio directo — elegí el paciente', (id, nombre) => {
        abrirServicioDirectoParaMascota(id, nombre);
    });
};

const construirBodyServicioDirecto = () => {
    const mascotaId = Number(document.getElementById('servicioDirectoMascotaId').value);
    return {
        mascota_id: mascotaId,
        tipo_servicio: document.getElementById('servicioDirectoTipo').value,
        nombre_servicio: (document.getElementById('servicioDirectoTipo').value + ': ' +
            document.getElementById('servicioDirectoNombre').value).toUpperCase(),
        cantidad: parseFloat(document.getElementById('servicioDirectoCantidad').value) || 1,
        precio_unitario: parseFloat(document.getElementById('servicioDirectoPrecio').value) || 0,
        estado: document.getElementById('servicioDirectoEstado').value,
    };
};

const crearServicioDirecto = async () => {
    const body = construirBodyServicioDirecto();
    if (!body.mascota_id || !body.nombre_servicio) {
        showNotification('Faltan datos del servicio.', 'warning');
        return null;
    }
    // El backend rechaza con 403 los tipos clínicos si el rol es recepcionista;
    // ese error se muestra tal cual (no se esconde con CSS).
    return fetchAPI('/servicios/', { method: 'POST', body: JSON.stringify(body) });
};

const cobrarServicioDirecto = async (servicio) => {
    // Factura sin consulta: consulta_id ausente, detalles[].servicio_id.
    let propietarioId = null;
    try {
        const m = await fetchAPI(`/mascotas/${servicio.mascota_id}`);
        propietarioId = m.propietario_id;
    } catch (_) { /* se maneja abajo */ }
    if (!propietarioId) {
        showNotification('Servicio creado, pero no se pudo resolver el propietario para cobrar.', 'warning');
        return;
    }
    const factura = await fetchAPI('/facturas/', {
        method: 'POST',
        body: JSON.stringify({
            propietario_id: propietarioId,
            total_pagado: 0.0,
            descuento: 0.0,
            impuesto: 0.0,
            detalles: [{
                descripcion: servicio.nombre_servicio,
                cantidad: Math.max(1, Math.round(servicio.cantidad || 1)),
                precio_unitario: servicio.precio_unitario || 0,
                servicio_id: servicio.id,
            }],
        }),
    });
    showNotification(`Factura #${factura.numero_factura || factura.id} emitida.`, 'success');
};

// ── wiring (una sola vez) ────────────────────────────────────────────────────
export const initHoy = () => {
    document.getElementById('btnHoyNuevaOrden')?.addEventListener('click', abrirNuevaOrdenFlow);
    document.getElementById('btnHoyServicioDirecto')?.addEventListener('click', abrirServicioDirectoFlow);
    document.getElementById('btnNuevoConsulta')?.addEventListener('click', () => {
        document.getElementById('avNewMenu')?.removeAttribute('open');
        abrirNuevaConsultaFlow();
    });
    document.getElementById('btnNuevoServicioDirecto')?.addEventListener('click', () => {
        document.getElementById('avNewMenu')?.removeAttribute('open');
        abrirServicioDirectoFlow();
    });

    document.getElementById('selectorMascotaSearch')?.addEventListener('input', (e) => {
        buscarMascotasSelector(e.target.value);
    });

    // citas-pendientes.js (shim) emite esto tras un alta de cita/consulta.
    document.addEventListener('av:hoy-refresh', () => {
        const sec = document.getElementById('sec-hoy');
        if (sec && !sec.hidden) loadHoy();
    });

    const form = document.getElementById('formServicioDirecto');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const s = await crearServicioDirecto();
            if (!s) return;
            closeModal('modalServicioDirecto');
            showNotification('Servicio directo guardado.', 'success');
            document.dispatchEvent(new CustomEvent('av:servicio-directo-creado'));
            loadHoy();
        } catch (err) {
            showNotification('No se pudo guardar el servicio: ' + err.message, 'error');
        }
    });
    document.getElementById('btnServicioDirectoCobrar')?.addEventListener('click', async () => {
        try {
            const s = await crearServicioDirecto();
            if (!s) return;
            await cobrarServicioDirecto(s);
            closeModal('modalServicioDirecto');
            document.dispatchEvent(new CustomEvent('av:servicio-directo-creado'));
            loadHoy();
        } catch (err) {
            showNotification('No se pudo cobrar: ' + err.message, 'error');
        }
    });
};

export { loadHoy as init };
