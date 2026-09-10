// sections/hoy.js — pantalla de inicio "Hoy" (Tarea 09, etapa 4).
//
// Bandeja de consultas ABIERTA + turnos en sala (absorbe sec-ordenes-medico),
// más las dos entradas de alta: "Agregar consulta" y "Agregar servicio directo".
// El servicio directo usa POST /api/servicios/ (sin consulta) y su cobro
// POST /api/facturas/ sin consulta_id.

import { fetchAPI } from '../core/api.js';
import { showNotification, openModal, closeModal, debounce } from '../core/ui.js';
import {
    verConsultaCompleta,
    seleccionarMascotaBasica,
    abrirFormularioConsulta,
} from './consultorio.js';

// ── utilidades ──────────────────────────────────────────────────────────────
const totalServicios = (servicios) =>
    (servicios || [])
        .filter(s => !s.is_deleted)
        .reduce((acc, s) => acc + (s.cantidad || 0) * (s.precio_unitario || 0), 0);

const haceCuanto = (iso) => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    return `hace ${Math.round(hrs / 24)} d`;
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

// ── bandeja de consultas abiertas ───────────────────────────────────────────
const renderConsultasAbiertas = async () => {
    const box = document.getElementById('hoyConsultasList');
    if (!box) return;
    box.innerHTML = '<p class="av-muted" style="padding:12px 16px;">Cargando…</p>';
    try {
        const [consultas, mascotas] = await Promise.all([
            fetchAPI('/consultas/?estado=ABIERTA&limit=100'),
            cargarMascotasMap(),
        ]);
        if (!consultas || consultas.length === 0) {
            box.innerHTML = '<p class="av-muted" style="padding:12px 16px;">No hay consultas abiertas.</p>';
            return;
        }
        box.innerHTML = consultas.map(c => {
            const m = mascotas.get(c.mascota_id);
            const nombre = m ? m.nombre : `Paciente #${c.mascota_id}`;
            const especie = m ? (m.especie || '') : '';
            const total = totalServicios(c.servicios);
            return `
                <button type="button" class="av-hoy-row" data-consulta-id="${c.id}" data-mascota-id="${c.mascota_id}">
                    <span>
                        <span class="av-hoy-row-name">${nombre}</span>
                        <span class="av-hoy-row-sub">${[especie, c.motivo || 'Sin motivo'].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span class="av-hoy-row-sub">${c.veterinario || 'Sin veterinario'}</span>
                    <span class="av-hoy-row-meta">
                        <span class="av-hoy-row-amount">$${total.toFixed(2)}</span><br>
                        ${haceCuanto(c.fecha_consulta)}
                    </span>
                </button>`;
        }).join('');
        box.querySelectorAll('.av-hoy-row').forEach(row => {
            row.addEventListener('click', () => {
                verConsultaCompleta(Number(row.dataset.consultaId), Number(row.dataset.mascotaId));
            });
        });
    } catch (e) {
        box.innerHTML = `<p class="av-text-danger" style="padding:12px 16px;">Error cargando consultas: ${e.message}</p>`;
    }
};

// ── turnos en sala (ex sec-ordenes-medico) ──────────────────────────────────
const renderTurnos = async () => {
    const box = document.getElementById('hoyTurnosList');
    if (!box) return;
    box.innerHTML = '<p class="av-muted" style="padding:12px 16px;">Cargando…</p>';
    try {
        const [citas, mascotas] = await Promise.all([
            fetchAPI('/citas/'),
            cargarMascotasMap(),
        ]);
        const pendientes = (Array.isArray(citas) ? citas : []).filter(c => c && c.estado === 'pendiente');
        if (pendientes.length === 0) {
            box.innerHTML = '<p class="av-muted" style="padding:12px 16px;">No hay turnos pendientes.</p>';
            return;
        }
        box.innerHTML = pendientes.map(c => {
            const m = mascotas.get(c.mascota_id);
            const nombre = m ? m.nombre : `Paciente #${c.mascota_id}`;
            return `
                <button type="button" class="av-hoy-row" data-mascota-id="${c.mascota_id}">
                    <span>
                        <span class="av-hoy-row-name">${nombre}</span>
                        <span class="av-hoy-row-sub">${c.tipo || 'Turno'}</span>
                    </span>
                    <span class="av-hoy-row-sub">${c.fecha_cita ? new Date(c.fecha_cita).toLocaleString() : ''}</span>
                    <span class="av-hoy-row-meta">Abrir consulta</span>
                </button>`;
        }).join('');
        box.querySelectorAll('.av-hoy-row').forEach(row => {
            row.addEventListener('click', async () => {
                const mascotaId = Number(row.dataset.mascotaId);
                await seleccionarMascotaBasica(mascotaId);
                abrirFormularioConsulta();
            });
        });
    } catch (e) {
        box.innerHTML = `<p class="av-text-danger" style="padding:12px 16px;">Error cargando turnos: ${e.message}</p>`;
    }
};

export const loadHoy = async () => {
    _mascotaCache = null; // refrescar nombres cada vez que se entra a Hoy
    await Promise.all([renderConsultasAbiertas(), renderTurnos()]);
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
            <button type="button" class="av-hoy-row" role="option" data-id="${m.id}" data-nombre="${(m.nombre || '').replace(/"/g, '&quot;')}">
                <span>
                    <span class="av-hoy-row-name">${m.nombre}</span>
                    <span class="av-hoy-row-sub">${[m.especie, m.raza].filter(Boolean).join(' · ')}</span>
                </span>
                <span class="av-hoy-row-sub">#${m.codigo_historia || m.id}</span>
                <span class="av-hoy-row-meta">Elegir</span>
            </button>`).join('');
        results.querySelectorAll('.av-hoy-row').forEach(row => {
            row.addEventListener('click', () => {
                const cb = _selectorPick;
                _selectorPick = null;
                closeModal('modalSelectorMascota');
                if (cb) cb(Number(row.dataset.id), row.dataset.nombre);
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

// ── flujo: agregar servicio directo ─────────────────────────────────────────
export const abrirServicioDirectoFlow = () => {
    abrirSelectorMascota('Servicio directo — elegí el paciente', (id, nombre) => {
        const form = document.getElementById('formServicioDirecto');
        if (form) form.reset();
        document.getElementById('servicioDirectoMascotaId').value = id;
        document.getElementById('servicioDirectoCatalogoId').value = '';
        const label = document.getElementById('servicioDirectoPaciente');
        if (label) label.textContent = `Paciente: ${nombre || ('#' + id)}`;
        openModal('modalServicioDirecto');
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

// ── wiring (una sola vez) ──────────────────────────────────────────────────
export const initHoy = () => {
    document.getElementById('btnHoyNuevaConsulta')?.addEventListener('click', abrirNuevaConsultaFlow);
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

    // ordenes.js (shim) emite esto tras un alta de cita/consulta.
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
            loadHoy();
        } catch (err) {
            showNotification('No se pudo cobrar: ' + err.message, 'error');
        }
    });
};

export { loadHoy as init };
