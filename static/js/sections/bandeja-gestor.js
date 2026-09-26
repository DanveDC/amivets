// sections/bandeja-gestor.js — sec-bandeja-gestor (Tarea 06, etapa 7;
// pantalla-encargado).
//
// La pantalla de trabajo del encargado de área, en tres pestañas:
// - Bandeja: GET /api/servicios/bandeja, tomar (POST .../tomar), ejecutar y
//   cargar el resultado (PATCH .../{id}, con el candado de adjunto) y subir
//   el adjunto (POST .../{id}/adjuntos).
// - Realizados: GET /api/servicios/realizados, con los adjuntos de cada uno.
// - Mis comisiones: GET /api/comisiones/mias y /mias/liquidaciones.
// El rubro (las áreas del usuario) sale de GET /api/areas/mias; cada servicio
// trae su area_id. docs/diseno/pantallas/BandejaGestor.html.
//
// LÍMITES DOCUMENTADOS:
// - GET /api/ordenes/{id} excluye a `gestor` (fila 4 de la matriz): para un
//   gestor puro el número de orden se muestra "#<id>" sin enlace.
// - No hay endpoint de "devolver: no me corresponde"; ese botón de la maqueta
//   no se implementa.
//
// Todo texto que viene del servidor pasa por escapeHtml (pantalla-encargado,
// decisión 7): antes el área, el servicio y el paciente se insertaban crudos.

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { showNotification, escapeHtml } from '../core/ui.js';
import { haceCuanto, fechaLargaEsVE } from '../core/format.js';
import { tablaLineas, totales, descargarPdf, pct } from './comisiones.js';

const ESTADO_PILL = { ASIGNADO: 'av-pill--warn', EN_PROCESO: 'av-pill--info' };
const ESTADO_LABEL = { ASIGNADO: 'Asignado', EN_PROCESO: 'En proceso' };

let _cache = [];
let _misAreas = null;          // Map<area_id, nombre> — GET /areas/mias
let _mascotasCache = null;
let _ordenesCache = new Map(); // orden_id -> numero | null (403/404)
let _filtroLocal = '';
let _wired = false;

const areaNombre = (areaId) => (areaId == null ? '—' : (_misAreas?.get(areaId) || `Área #${areaId}`));

async function cargarMascotasMap() {
    if (_mascotasCache) return _mascotasCache;
    try {
        const list = await fetchAPI('/mascotas/?skip=0&limit=500');
        _mascotasCache = new Map((list || []).map(m => [m.id, m]));
    } catch (_) {
        _mascotasCache = new Map();
    }
    return _mascotasCache;
}

async function cargarMisAreas() {
    try {
        const areas = await fetchAPI('/areas/mias');
        _misAreas = new Map((areas || []).map(a => [a.id, a.nombre]));
    } catch (_) {
        _misAreas = new Map();
    }
    return _misAreas;
}

async function resolverOrdenNumero(ordenId) {
    if (!ordenId) return null;
    if (_ordenesCache.has(ordenId)) return _ordenesCache.get(ordenId);
    try {
        const orden = await fetchAPI(`/ordenes/${ordenId}`);
        _ordenesCache.set(ordenId, orden.numero);
    } catch (_) {
        _ordenesCache.set(ordenId, null); // 403 para gestor puro
    }
    return _ordenesCache.get(ordenId);
}

const ordenHtml = (numero, ordenId) => (numero
    ? `<span class="num" style="font-weight:500;color:var(--primary);">${escapeHtml(numero)}</span>`
    : (ordenId ? `<span class="num">#${Number(ordenId)}</span>` : '—'));

// ── rubro (cabecera) ─────────────────────────────────────────────────────────
function pintarRubro() {
    const el = document.getElementById('bgRubro');
    if (!el) return;
    const nombres = Array.from(_misAreas?.values() || []);
    el.innerHTML = nombres.length
        ? `Tu rubro: <strong>${nombres.map(escapeHtml).join(' · ')}</strong>`
        : 'Todavía no tenés un área asignada. Pedile al administrador que te sume a una.';
}

// ── badge del sidebar ("Mi bandeja") ─────────────────────────────────────────
// Se actualiza cuando esta pantalla carga su lista y una vez al resolver el
// rol en el boot (router.js llama refrescarBadgeBandeja). Sin polling.
function actualizarBadge(count) {
    const el = document.getElementById('avSidebarBandejaBadge');
    if (!el) return;
    el.textContent = String(count);
    el.hidden = count === 0;
}

/** Refresco liviano del badge sin pintar toda la pantalla — lo usa router.js
 * al resolver el rol, para roles que no necesariamente están parados en
 * sec-bandeja-gestor. */
export async function refrescarBadgeBandeja() {
    try {
        const servicios = await fetchAPI('/servicios/bandeja');
        const count = (Array.isArray(servicios) ? servicios : []).filter(s => !s.is_deleted).length;
        actualizarBadge(count);
    } catch (_) {
        // El badge es informativo: si falla (403, red, etc.) no rompe nada.
    }
}

// ── carga principal ──────────────────────────────────────────────────────────
export const loadBandejaGestor = async () => {
    const title = document.getElementById('avHeaderTitleText');
    const sub = document.getElementById('avHeaderSubtitleText');
    if (title) title.textContent = 'Mi bandeja';
    if (sub) sub.textContent = fechaLargaEsVE();

    const body = document.getElementById('bgQueueBody');
    if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Cargando…</td></tr>';

    try {
        const [servicios, mascotas] = await Promise.all([
            fetchAPI('/servicios/bandeja'),
            cargarMascotasMap(),
            cargarMisAreas(),
        ]);
        pintarRubro();
        const lista = (Array.isArray(servicios) ? servicios : []).filter(s => !s.is_deleted);

        const enriquecidas = await Promise.all(lista.map(async (s) => {
            const m = mascotas.get(s.mascota_id);
            return {
                ...s,
                _ordenNumero: await resolverOrdenNumero(s.orden_id),
                _mascotaNombre: m ? m.nombre : (s.mascota_id ? `Paciente #${s.mascota_id}` : '—'),
                _mascotaEspecie: m ? m.especie : '',
                _espera: haceCuanto(s.created_at),
            };
        }));

        enriquecidas.sort((a, b) => b._espera.minutos - a._espera.minutos);
        _cache = enriquecidas;
        actualizarBadge(_cache.length);
        pintarFiltros();
        pintarQueue();
        pintarDetalle();
    } catch (e) {
        if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent); padding:1.5rem;">Error cargando la bandeja: ${escapeHtml(e.message)}</td></tr>`;
    }
};

// ── filtros por área (chips) ─────────────────────────────────────────────────
// Un chip por cada área del usuario, aunque no tenga nada pendiente
// (pantalla-encargado, requisito "Rubro del encargado"). Clave: area_id.
let _filtroArea = 'todas';

function chipsArea(conteo, activa, attr) {
    const chip = (key, label, n) =>
        `<span class="av-pill ${activa === key ? '' : 'av-pill--neutral'}" ${attr}="${key}" style="cursor:pointer;">${escapeHtml(label)} <span class="num">${n}</span></span>`;
    const total = Array.from(conteo.values()).reduce((a, b) => a + b, 0);
    return [chip('todas', 'Todas', total),
        ...Array.from(_misAreas?.entries() || []).map(([id, nombre]) => chip(String(id), nombre, conteo.get(id) || 0))].join('');
}

function pintarFiltros() {
    const cont = document.getElementById('bgFilters');
    if (!cont) return;
    const conteo = new Map();
    _cache.forEach(s => conteo.set(s.area_id, (conteo.get(s.area_id) || 0) + 1));
    cont.innerHTML = chipsArea(conteo, _filtroArea, 'data-area');
    cont.querySelectorAll('[data-area]').forEach(chip => chip.addEventListener('click', () => {
        _filtroArea = chip.dataset.area;
        pintarFiltros();
        pintarQueue();
    }));
}

function filaVisible(s) {
    if (_filtroArea !== 'todas' && String(s.area_id) !== _filtroArea) return false;
    if (_filtroLocal) {
        const needle = _filtroLocal.toLowerCase();
        const hay = `${s.nombre_servicio || ''} ${s._mascotaNombre || ''} ${s._ordenNumero || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
    }
    return true;
}

// ── cola ──────────────────────────────────────────────────────────────────────
let _servicioActivoId = null;

function pintarQueue() {
    const body = document.getElementById('bgQueueBody');
    const nota = document.getElementById('bgEsperaAviso');
    if (!body) return;
    const visibles = _cache.filter(filaVisible);
    if (nota) {
        const esperando = visibles.filter(s => s._espera.minutos > 60).length;
        nota.textContent = esperando ? `${esperando} esperando más de 1 h` : '';
        nota.className = esperando ? 'av-pill av-pill--warn' : '';
    }
    if (visibles.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No hay nada pendiente en tu bandeja.</td></tr>';
        return;
    }
    body.innerHTML = visibles.map(s => {
        const activo = s.estado === 'EN_PROCESO';
        const accion = s.estado === 'ASIGNADO'
            ? `<button type="button" class="bg-btn-take" data-tomar="${s.id}">Tomar</button>`
            : `<button type="button" class="bg-btn-cargar" data-cargar="${s.id}">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                 Cargar resultado
               </button>`;
        return `
            <tr class="${activo && s.id === _servicioActivoId ? 'bg-row--active' : ''}">
                <td>
                    <span class="bg-svc-name">${escapeHtml(s.nombre_servicio || '—')}</span>
                    <span class="bg-svc-area">${escapeHtml(areaNombre(s.area_id))}</span>
                </td>
                <td>${escapeHtml(s._mascotaNombre)} <span style="color:var(--text-muted); font-size:12.5px;">· ${escapeHtml(s._mascotaEspecie || '')}</span></td>
                <td>${ordenHtml(s._ordenNumero, s.orden_id)}</td>
                <td class="num ${s._espera.minutos > 60 ? 'num--warn' : ''}">${escapeHtml(s._espera.texto)}</td>
                <td><span class="av-pill ${ESTADO_PILL[s.estado] || 'av-pill--neutral'}">${escapeHtml(ESTADO_LABEL[s.estado] || s.estado)}</span></td>
                <td style="text-align:right;">${accion}</td>
            </tr>`;
    }).join('');

    body.querySelectorAll('[data-tomar]').forEach(btn => btn.addEventListener('click', () => tomar(Number(btn.dataset.tomar))));
    body.querySelectorAll('[data-cargar]').forEach(btn => btn.addEventListener('click', () => {
        _servicioActivoId = Number(btn.dataset.cargar);
        pintarQueue();
        pintarDetalle();
    }));
}

async function tomar(servicioId) {
    try {
        await fetchAPI(`/servicios/${servicioId}/tomar`, { method: 'POST' });
        showNotification('Servicio tomado.', 'success');
        _servicioActivoId = servicioId;
        await loadBandejaGestor();
    } catch (e) {
        showNotification('No se pudo tomar el servicio: ' + e.message, 'error');
    }
}

// ── panel de detalle (el servicio en proceso) ───────────────────────────────
let _adjuntoPendiente = null;

function pintarDetalle() {
    const cont = document.getElementById('bgDetail');
    if (!cont) return;
    const activo = _cache.find(s => s.id === _servicioActivoId && s.estado === 'EN_PROCESO')
        || _cache.find(s => s.estado === 'EN_PROCESO');
    _servicioActivoId = activo ? activo.id : null;
    _adjuntoPendiente = null;

    if (!activo) {
        cont.innerHTML = `
            <div class="bg-empty">
                <svg class="bg-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                <strong>Nada en proceso</strong>
                <span>Tomá un servicio de tu bandeja para verlo acá y cargar su resultado.</span>
            </div>`;
        return;
    }

    cont.innerHTML = `
        <div class="bg-detail-head">
            <span class="av-eyebrow">En proceso</span>
            <strong class="ser">${escapeHtml(activo.nombre_servicio || '—')}</strong>
            <div class="bg-detail-meta">
                <span class="av-pill av-pill--neutral">${escapeHtml(areaNombre(activo.area_id))}</span>
                <span class="bg-detail-order">${ordenHtml(activo._ordenNumero, activo.orden_id)}</span>
            </div>
        </div>
        <div class="bg-detail-body">
            <div class="bg-detail-field">
                <label>Paciente</label>
                <span>${escapeHtml(activo._mascotaNombre)}</span>
            </div>
            <div class="bg-detail-field">
                <label>Notas / resultado</label>
                <textarea id="bgDetalleTexto" rows="4" placeholder="Resultado, hallazgos, observaciones…">${escapeHtml(activo.detalles_clinicos || '')}</textarea>
            </div>
            <div class="bg-detail-field">
                <label>Adjunto</label>
                <div class="bg-dropzone" id="bgDropzone">
                    <input type="file" id="bgAdjuntoInput" style="display:none;" accept="application/pdf,image/jpeg,image/png,.dcm">
                    <span id="bgDropzoneLabel">Hacé clic para elegir un archivo (PDF, JPG, PNG o DICOM)</span>
                </div>
            </div>
        </div>
        <div class="bg-detail-footer">
            <button type="button" class="av-btn av-btn--primary" id="btnBgEjecutar">Marcar como ejecutado</button>
        </div>`;

    const dropzone = document.getElementById('bgDropzone');
    const input = document.getElementById('bgAdjuntoInput');
    dropzone?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
        _adjuntoPendiente = input.files?.[0] || null;
        const label = document.getElementById('bgDropzoneLabel');
        if (label && _adjuntoPendiente) label.textContent = `Seleccionado: ${_adjuntoPendiente.name}`;
    });
    document.getElementById('btnBgEjecutar')?.addEventListener('click', () => ejecutarServicio(activo.id));
}

async function subirAdjunto(servicioId, file) {
    const token = localStorage.getItem('token');
    const form = new FormData();
    form.append('archivo', file);
    const resp = await fetch(`${API_BASE_URL}/servicios/${servicioId}/adjuntos`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
    });
    if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `No se pudo subir el adjunto (HTTP ${resp.status})`);
    }
    return resp.json();
}

async function ejecutarServicio(servicioId) {
    try {
        if (_adjuntoPendiente) {
            await subirAdjunto(servicioId, _adjuntoPendiente);
            // El archivo YA se subió: se limpia ya para que un reintento tras
            // un PATCH fallido no lo vuelva a subir (hallazgo de revisión, etapa 7).
            _adjuntoPendiente = null;
            const label = document.getElementById('bgDropzoneLabel');
            if (label) label.textContent = 'Archivo subido — confirmando…';
        }
        const texto = document.getElementById('bgDetalleTexto')?.value || undefined;
        await fetchAPI(`/servicios/${servicioId}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'EJECUTADO', detalles_clinicos: texto }),
        });
        showNotification('Servicio ejecutado.', 'success');
        await loadBandejaGestor();
    } catch (e) {
        // 422 = candado de adjunto (el área lo exige y no se subió ninguno).
        showNotification('No se pudo ejecutar: ' + e.message, 'error');
    }
}

// ── pestañas ──────────────────────────────────────────────────────────────────
const VISTAS = { bandeja: 'bgViewBandeja', realizados: 'bgViewRealizados', comisiones: 'bgViewComisiones' };

function mostrarVista(vista) {
    Object.entries(VISTAS).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.hidden = k !== vista;
    });
    document.querySelectorAll('[data-bg-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bgVista === vista)));
    if (vista === 'realizados') cargarRealizados();
    if (vista === 'comisiones') cargarMisComisiones();
}

// ── rangos de fecha ───────────────────────────────────────────────────────────
// En UTC, igual que kpiCalcularRango (reportes.js) y que los filtros del
// backend: si se armaran con la fecha local, después de las 20:00 (UTC-4) el
// "Hoy" del navegador y el del servidor no coincidirían.
const iso = (d) => d.toISOString().slice(0, 10);

function rango(tipo) {
    const hoy = new Date();
    if (tipo === 'semana') {
        const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7)));
        return { desde: iso(lunes), hasta: iso(hoy) };
    }
    if (tipo === 'mes') return { desde: iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))), hasta: iso(hoy) };
    return { desde: iso(hoy), hasta: iso(hoy) };
}

function fijarRango(idDesde, idHasta, tipo) {
    const r = rango(tipo);
    const d = document.getElementById(idDesde);
    const h = document.getElementById(idHasta);
    if (d) d.value = r.desde;
    if (h) h.value = r.hasta;
}

// ── Realizados ────────────────────────────────────────────────────────────────
let _filtroAreaReal = 'todas';
const LIMITE_REALIZADOS = 200;

async function cargarRealizados() {
    const body = document.getElementById('bgRealBody');
    const aviso = document.getElementById('bgRealAviso');
    if (!body) return;
    if (!document.getElementById('bgRealDesde').value) fijarRango('bgRealDesde', 'bgRealHasta', 'hoy');
    if (!_misAreas) await cargarMisAreas();

    const params = new URLSearchParams({
        desde: document.getElementById('bgRealDesde').value,
        hasta: document.getElementById('bgRealHasta').value,
    });
    if (_filtroAreaReal !== 'todas') params.set('area_id', _filtroAreaReal);

    body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Cargando…</td></tr>';
    try {
        const lista = await fetchAPI(`/servicios/realizados?${params}`);
        pintarChipsRealizados(lista);
        if (aviso) {
            aviso.textContent = lista.length >= LIMITE_REALIZADOS ? `Se muestran los ${LIMITE_REALIZADOS} más recientes: acotá el rango.` : '';
            aviso.className = lista.length >= LIMITE_REALIZADOS ? 'av-pill av-pill--warn' : '';
        }
        if (!lista.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No realizaste servicios en este rango.</td></tr>';
            return;
        }
        body.innerHTML = lista.map(s => `
            <tr data-real-id="${s.id}">
                <td>
                    <span class="bg-svc-name">${escapeHtml(s.nombre_servicio || '—')}</span>
                    <span class="bg-svc-area">${escapeHtml(s.area_nombre || areaNombre(s.area_id))}</span>
                </td>
                <td>${escapeHtml(s.mascota_nombre || '—')}</td>
                <td>${ordenHtml(s.orden_numero, s.orden_id)}</td>
                <td class="num">${s.ejecutado_at ? escapeHtml(new Date(s.ejecutado_at).toLocaleString()) : '—'}</td>
                <td class="num">${Number(s.adjuntos) || 0}</td>
                <td style="text-align:right;">
                    <button type="button" class="av-btn" data-real-ver="${s.id}" style="height:30px; padding:0 10px; font-size:12.5px;">Ver</button>
                </td>
            </tr>
            <tr data-real-detalle="${s.id}" hidden><td colspan="6"></td></tr>`).join('');
        _realizados = new Map(lista.map(s => [s.id, s]));
    } catch (e) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent); padding:1.5rem;">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

let _realizados = new Map();

function pintarChipsRealizados(lista) {
    const cont = document.getElementById('bgRealAreas');
    if (!cont) return;
    // Los conteos solo tienen sentido para "Todas": con un área elegida, la
    // lista ya viene filtrada por el servidor.
    const conteo = new Map();
    lista.forEach(s => conteo.set(s.area_id, (conteo.get(s.area_id) || 0) + 1));
    cont.innerHTML = chipsArea(conteo, _filtroAreaReal, 'data-real-area');
    cont.querySelectorAll('[data-real-area]').forEach(chip => chip.addEventListener('click', () => {
        _filtroAreaReal = chip.dataset.realArea;
        cargarRealizados();
    }));
}

async function verDetalleRealizado(id) {
    const fila = document.querySelector(`[data-real-detalle="${id}"]`);
    if (!fila) return;
    if (!fila.hidden) { fila.hidden = true; return; }
    const s = _realizados.get(id);
    const celda = fila.querySelector('td');
    fila.hidden = false;
    celda.innerHTML = '<span style="color:var(--text-muted);">Cargando adjuntos…</span>';
    try {
        const adjuntos = await fetchAPI(`/servicios/${id}/adjuntos`);
        const notas = s?.detalles_clinicos
            ? `<p style="margin:0 0 0.5rem;"><b>Resultado:</b> ${escapeHtml(s.detalles_clinicos)}</p>` : '';
        const lista = (adjuntos || []).length
            ? adjuntos.map(a => `
                <button type="button" class="av-btn" data-adjunto="${a.id}" data-adjunto-nombre="${escapeHtml(a.nombre_original)}" style="height:30px; padding:0 10px; font-size:12.5px; margin:0 6px 6px 0;">
                    Descargar ${escapeHtml(a.nombre_original)}
                </button>`).join('')
            : '<span style="color:var(--text-muted);">Sin adjuntos.</span>';
        celda.innerHTML = `<div style="padding:0.5rem 0.25rem;">${notas}${lista}</div>`;
    } catch (e) {
        celda.innerHTML = `<span style="color:var(--accent);">No se pudieron cargar los adjuntos: ${escapeHtml(e.message)}</span>`;
    }
}

async function descargarAdjunto(id, nombre) {
    try {
        const resp = await fetch(`${API_BASE_URL}/adjuntos/${id}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const url = window.URL.createObjectURL(await resp.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre || `adjunto_${id}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (e) {
        showNotification('No se pudo descargar el adjunto: ' + e.message, 'error');
    }
}

// ── Mis comisiones ────────────────────────────────────────────────────────────
async function cargarMisComisiones() {
    const wrap = document.getElementById('bgComWrap');
    const liqWrap = document.getElementById('bgComLiquidaciones');
    if (!wrap) return;
    if (!document.getElementById('bgComDesde').value) fijarRango('bgComDesde', 'bgComHasta', 'mes');
    const params = new URLSearchParams({
        desde: document.getElementById('bgComDesde').value,
        hasta: document.getElementById('bgComHasta').value,
    });
    wrap.innerHTML = '<p style="color: var(--text-secondary); margin:0;">Calculando…</p>';
    try {
        const [c, liquidaciones] = await Promise.all([
            fetchAPI(`/comisiones/mias?${params}`),
            fetchAPI('/comisiones/mias/liquidaciones'),
        ]);
        wrap.innerHTML = `
            <p style="margin:0 0 0.75rem;">Tu porcentaje actual: <b>${pct(c.porcentaje_efectivo)}</b></p>
            <h4 style="margin: 0.5rem 0;">Pendiente de liquidar</h4>
            ${tablaLineas(c.pendientes, 'No tenés comisiones pendientes en este rango.')}
            <div id="bgComTotalesPendientes" style="margin:0.75rem 0 1.25rem;">${totales(c.totales_pendientes)}</div>
            <h4 style="margin: 0.5rem 0;">Ya liquidado</h4>
            ${tablaLineas(c.liquidadas, 'Nada liquidado en este rango.')}
            <div style="margin-top:0.75rem;">${totales(c.totales_liquidadas)}</div>`;
        if (liqWrap) {
            liqWrap.innerHTML = liquidaciones.length
                ? liquidaciones.map(l => `
                    <div data-bg-liquidacion="${l.id}" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding:0.6rem 0.9rem; margin-bottom:0.5rem; border:1px solid var(--border); border-radius:8px;">
                        <div><b>${escapeHtml(l.numero)}</b> · ${escapeHtml(new Date(l.desde).toLocaleDateString())} a ${escapeHtml(new Date(l.hasta).toLocaleDateString())} · ${totales({ encargado: l.total_encargado, amivets: l.total_amivets })}</div>
                        <button type="button" class="av-btn" data-bg-pdf="${l.id}" data-bg-numero="${escapeHtml(l.numero)}" style="height:30px; padding:0 10px; font-size:12.5px;">Descargar PDF</button>
                    </div>`).join('')
                : '<p style="color: var(--text-secondary); margin:0;">Todavía no tenés liquidaciones.</p>';
        }
    } catch (e) {
        wrap.innerHTML = `<p style="color: var(--accent); margin:0;">Error: ${escapeHtml(e.message)}</p>`;
    }
}

// ── wiring ────────────────────────────────────────────────────────────────────
export const initBandejaGestor = () => {
    if (_wired) return;
    _wired = true;
    document.getElementById('bgFiltroLocal')?.addEventListener('input', (e) => {
        _filtroLocal = e.target.value.trim();
        pintarQueue();
    });
    document.querySelectorAll('[data-bg-vista]').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.bgVista)));

    document.querySelectorAll('.bg-real-rango').forEach(b => b.addEventListener('click', () => {
        fijarRango('bgRealDesde', 'bgRealHasta', b.dataset.bgRango);
        cargarRealizados();
    }));
    document.getElementById('btnBgRealVer')?.addEventListener('click', cargarRealizados);
    document.getElementById('bgRealBody')?.addEventListener('click', (e) => {
        const ver = e.target.closest('[data-real-ver]');
        if (ver) { verDetalleRealizado(Number(ver.dataset.realVer)); return; }
        const adj = e.target.closest('[data-adjunto]');
        if (adj) descargarAdjunto(Number(adj.dataset.adjunto), adj.dataset.adjuntoNombre);
    });

    document.getElementById('btnBgComVer')?.addEventListener('click', cargarMisComisiones);
    document.getElementById('bgComLiquidaciones')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-bg-pdf]');
        if (btn) descargarPdf(Number(btn.dataset.bgPdf), btn.dataset.bgNumero);
    });
};
