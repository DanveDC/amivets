// sections/bandeja-gestor.js — sec-bandeja-gestor (Tarea 06, etapa 7).
//
// La cola de trabajo del gestor: GET /api/servicios/bandeja, tomar
// (POST .../tomar), ejecutar y cargar el resultado (PATCH .../{id}, con el
// candado de adjunto), y subir el adjunto (POST .../{id}/adjuntos).
// docs/diseno/pantallas/BandejaGestor.html.
//
// LÍMITES DOCUMENTADOS (backend real, no se puede resolver del lado del
// frontend sin tocar la API — fuera de alcance de esta etapa):
// - ServicioConsultaResponse no expone area_id/asignado_a_id/asignado_at, así
//   que "área" se resuelve mirando el catálogo del ítem (GET /catalogo/{id},
//   sin restricción de rol) y "esperando" usa created_at como aproximación
//   de asignado_at (que sí existe en el modelo pero no en el schema).
// - GET /api/areas es admin/recepción/veterinario — un gestor puro recibe 403
//   al intentar resolver el NOMBRE del área; se degrada a "Área #N".
// - GET /api/ordenes/{id} también excluye a `gestor` (fila 4 de la matriz,
//   alcance recortado pendiente para una etapa futura): el número de orden
//   se resuelve igual para admin/veterinario probando esta pantalla, y para
//   un gestor puro se muestra "#<id>" sin enlace (abrir la orden le daría 403).
// - No hay endpoint de "devolver: no me corresponde" en la lista de la etapa;
//   ese botón de la maqueta no se implementa.

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { showNotification } from '../core/ui.js';
// `money` no se importa: la copia local de este archivo nunca se usaba (dead
// code) — se elimina en vez de consolidar contra un import sin uso.
import { haceCuanto, fechaLargaEsVE } from '../core/format.js';

const ESTADO_PILL = { ASIGNADO: 'av-pill--warn', EN_PROCESO: 'av-pill--info' };
const ESTADO_LABEL = { ASIGNADO: 'Asignado', EN_PROCESO: 'En proceso' };

let _cache = [];
let _areasCache = null;       // Map<area_id, nombre> | null si no se pudo resolver
let _catalogoAreaCache = new Map(); // catalogo_servicio_id -> area_id
let _mascotasCache = null;
let _ordenesCache = new Map(); // orden_id -> numero | null (403/404)
let _filtroLocal = '';
let _wired = false;

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

async function resolverAreas() {
    if (_areasCache !== null) return _areasCache;
    try {
        const areas = await fetchAPI('/areas/');
        _areasCache = new Map((areas || []).map(a => [a.id, a.nombre]));
    } catch (_) {
        _areasCache = new Map(); // 403 para gestor — se degrada a "Área #N"
    }
    return _areasCache;
}

async function resolverAreaDeServicio(s) {
    if (!s.catalogo_servicio_id) return null;
    if (!_catalogoAreaCache.has(s.catalogo_servicio_id)) {
        try {
            const item = await fetchAPI(`/catalogo/${s.catalogo_servicio_id}`);
            _catalogoAreaCache.set(s.catalogo_servicio_id, item?.area_id ?? null);
        } catch (_) {
            _catalogoAreaCache.set(s.catalogo_servicio_id, null);
        }
    }
    return _catalogoAreaCache.get(s.catalogo_servicio_id);
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

// ── badge del sidebar ("Mi bandeja") ─────────────────────────────────────────
// El span existía en el markup del sidebar (router.js) desde que se armó pero
// nada lo llenaba (hallazgo de revisión, etapa 7). Mínimo viable elegido: se
// actualiza cuando esta pantalla carga/cambia su propia lista (no hace falta
// un fetch aparte, ya se trajo `/servicios/bandeja`) y una vez cuando el rol
// se resuelve en el boot (router.js llama refrescarBadgeBandeja), para que el
// contador aparezca aunque el usuario entre por otra sección. Deliberadamente
// SIN polling — cablear una actualización en vivo completa (websocket o poll
// periódico) excede una corrección puntual de este hallazgo.
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
        ]);
        await resolverAreas();
        const lista = (Array.isArray(servicios) ? servicios : []).filter(s => !s.is_deleted);

        const enriquecidas = await Promise.all(lista.map(async (s) => {
            const areaId = await resolverAreaDeServicio(s);
            const numero = await resolverOrdenNumero(s.orden_id);
            const m = mascotas.get(s.mascota_id);
            return {
                ...s,
                _areaNombre: areaId != null ? (_areasCache.get(areaId) || `Área #${areaId}`) : '—',
                _ordenNumero: numero,
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
        if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent); padding:1.5rem;">Error cargando la bandeja: ${e.message}</td></tr>`;
    }
};

// ── filtros por área (chips) ─────────────────────────────────────────────────
let _filtroArea = 'todas';

function pintarFiltros() {
    const cont = document.getElementById('bgFilters');
    if (!cont) return;
    const porArea = new Map();
    _cache.forEach(s => porArea.set(s._areaNombre, (porArea.get(s._areaNombre) || 0) + 1));
    const chips = [
        `<span class="av-pill ${_filtroArea === 'todas' ? '' : 'av-pill--neutral'}" data-area="todas" style="cursor:pointer;">Todas <span class="num">${_cache.length}</span></span>`,
        ...Array.from(porArea.entries()).map(([area, n]) =>
            `<span class="av-pill ${_filtroArea === area ? '' : 'av-pill--neutral'}" data-area="${area}" style="cursor:pointer;">${area} <span class="num">${n}</span></span>`),
    ];
    cont.innerHTML = chips.join('');
    cont.querySelectorAll('.av-pill').forEach(chip => {
        chip.addEventListener('click', () => {
            _filtroArea = chip.dataset.area;
            pintarFiltros();
            pintarQueue();
        });
    });
}

function filaVisible(s) {
    if (_filtroArea !== 'todas' && s._areaNombre !== _filtroArea) return false;
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
                    <span class="bg-svc-name">${s.nombre_servicio || '—'}</span>
                    <span class="bg-svc-area">${s._areaNombre}</span>
                </td>
                <td>${s._mascotaNombre} <span style="color:var(--text-muted); font-size:12.5px;">· ${s._mascotaEspecie || ''}</span></td>
                <td>${s._ordenNumero ? `<span class="num" style="font-weight:500;color:var(--primary);">${s._ordenNumero}</span>` : (s.orden_id ? `<span class="num">#${s.orden_id}</span>` : '—')}</td>
                <td class="num ${s._espera.minutos > 60 ? 'num--warn' : ''}">${s._espera.texto}</td>
                <td><span class="av-pill ${ESTADO_PILL[s.estado] || 'av-pill--neutral'}">${ESTADO_LABEL[s.estado] || s.estado}</span></td>
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
            <strong class="ser">${activo.nombre_servicio || '—'}</strong>
            <div class="bg-detail-meta">
                <span class="av-pill av-pill--neutral">${activo._areaNombre}</span>
                <span class="bg-detail-order">${activo._ordenNumero || (activo.orden_id ? '#' + activo.orden_id : '—')}</span>
            </div>
        </div>
        <div class="bg-detail-body">
            <div class="bg-detail-field">
                <label>Paciente</label>
                <span>${activo._mascotaNombre}</span>
            </div>
            <div class="bg-detail-field">
                <label>Notas / resultado</label>
                <textarea id="bgDetalleTexto" rows="4" placeholder="Resultado, hallazgos, observaciones…">${activo.detalles_clinicos || ''}</textarea>
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
            // El archivo YA se subió al servidor acá — se limpia de inmediato
            // (no sólo en pintarDetalle(), que no corre en este camino de
            // error) para que un reintento tras un PATCH fallido no vuelva a
            // subirlo y duplique el adjunto (hallazgo de revisión, etapa 7).
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

// ── wiring ────────────────────────────────────────────────────────────────────
export const initBandejaGestor = () => {
    if (_wired) return;
    _wired = true;
    document.getElementById('bgFiltroLocal')?.addEventListener('input', (e) => {
        _filtroLocal = e.target.value.trim();
        pintarQueue();
    });
};
