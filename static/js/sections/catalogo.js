// sections/catalogo.js — catálogo de servicios.
//
// Tarea 11 (revisión de bocetos): reescrito maestro-detalle fiel a
// docs/diseno/pantallas/Catalogo.html. El backend ya soportaba recetas
// (Tarea 07 slice C) e historial de precios (Tarea 08) por servicio; vivían
// dentro del modal de edición. Acá quedan siempre visibles para el servicio
// seleccionado, igual que dibuja el boceto -- "Duración estimada" del boceto
// no se copia: CatalogoServicio no tiene ese campo (ver
// docs/revision-integral-11.md, pendientes).

import { fetchAPI } from '../core/api.js';
import { showNotification, openModal, closeModal, escapeHtml } from '../core/ui.js';
import { gatePrecioInput, getUsuariosMap } from './historial-precios.js';

// ============================================================
// ESTADO DEL PANEL MAESTRO-DETALLE
// ============================================================

let listaCache = [];          // último /catalogo?... resuelto
let selectedId = null;
let materialesCache = [];     // inventario filtrado a tipo_item === 'MATERIAL'

const formatMoney = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatFechaCorta = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
};

export async function cargarCategoriasSelect() {
    try {
        const cats = await fetchAPI('/catalogo/categorias');
        const filter = document.getElementById('catalogoCategoriaFilter');
        if (!filter) return;
        filter.innerHTML = '<option value="">Todas las categorías</option>';
        (cats || []).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            filter.appendChild(opt);
        });
    } catch (err) {
        console.error('Error loading catalog categories:', err);
    }
}

// ============================================================
// LISTA MAESTRA
// ============================================================

export async function cargarCatalogo() {
    const q = (document.getElementById('catalogoSearch')?.value || '').trim();
    const cat = document.getElementById('catalogoCategoriaFilter')?.value || '';
    let url = '/catalogo?solo_activos=false&limit=500';
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (cat) url += `&categoria=${encodeURIComponent(cat)}`;

    const lista = document.getElementById('catalogoLista');
    const contador = document.getElementById('catalogoContador');
    if (!lista) return;
    lista.innerHTML = '<p class="rp-empty-text">Cargando…</p>';

    try {
        const items = await fetchAPI(url);
        listaCache = Array.isArray(items) ? items : [];
        const activos = listaCache.filter(s => s.activo).length;
        if (contador) contador.textContent = `${activos} activos${listaCache.length !== activos ? ` · ${listaCache.length - activos} inactivos` : ''}`;

        if (listaCache.length === 0) {
            lista.innerHTML = '<p class="rp-empty-text">Sin resultados.</p>';
            renderDetalleVacio();
            return;
        }

        lista.innerHTML = listaCache.map(s => `
            <button type="button" class="cat-item${s.id === selectedId ? ' cat-item--active' : ''}${s.activo ? '' : ' cat-item--inactivo'}" data-id="${s.id}">
                <div class="cat-item-info">
                    <span class="cat-item-nombre">${escapeHtml(s.nombre)}</span>
                    <span class="cat-item-sub">${escapeHtml(s.categoria)}${s.activo ? '' : ' · inactivo'}</span>
                </div>
                <span class="cat-item-precio">${formatMoney(s.precio_ref)}</span>
            </button>
        `).join('');

        lista.querySelectorAll('.cat-item').forEach(btn => {
            btn.addEventListener('click', () => seleccionarServicio(Number(btn.dataset.id)));
        });

        // Si el servicio seleccionado sigue en la lista filtrada, mantiene
        // selección; si no, selecciona el primero (o vacío si no hay).
        if (selectedId && listaCache.some(s => s.id === selectedId)) {
            cargarDetalle(selectedId);
        } else {
            seleccionarServicio(listaCache[0].id);
        }
    } catch (err) {
        lista.innerHTML = `<p class="rp-empty-text">Error: ${escapeHtml(err.message)}</p>`;
    }
}

function seleccionarServicio(id) {
    selectedId = id;
    document.querySelectorAll('#catalogoLista .cat-item').forEach(btn => {
        btn.classList.toggle('cat-item--active', Number(btn.dataset.id) === id);
    });
    cargarDetalle(id);
}

function renderDetalleVacio() {
    selectedId = null;
    const detalle = document.getElementById('catalogoDetalle');
    if (!detalle) return;
    detalle.innerHTML = `
        <div class="av-empty">
            <span class="av-empty-icon" aria-hidden="true"><i class="ph ph-list-magnifying-glass" aria-hidden="true"></i></span>
            <strong class="av-empty-title">Elegí un servicio</strong>
            <p class="av-empty-text">Seleccioná un servicio de la lista para ver su detalle, los insumos que consume y su historial de precios.</p>
        </div>`;
}

// Sin cache de sesión a propósito: un material nuevo en Insumos tiene que
// aparecer en "Agregar insumo" sin recargar toda la página. /inventario/ ya
// es la misma llamada que hacía el select del modal viejo en cada apertura.
async function cargarMaterialesCache() {
    try {
        const items = await fetchAPI('/inventario/?limit=500');
        materialesCache = (items || []).filter(p => p.tipo_item === 'MATERIAL');
    } catch (err) {
        console.error('Error cargando materiales:', err);
        materialesCache = [];
    }
    return materialesCache;
}

// ============================================================
// PANEL DE DETALLE
// ============================================================

async function cargarDetalle(id) {
    const detalle = document.getElementById('catalogoDetalle');
    if (!detalle) return;
    detalle.innerHTML = '<p class="rp-empty-text">Cargando…</p>';

    try {
        const [servicio, recetas, historial, usuarios, materiales] = await Promise.all([
            fetchAPI(`/catalogo/${id}`),
            fetchAPI(`/catalogo/${id}/recetas`),
            fetchAPI(`/catalogo/${id}/historial-precios`),
            getUsuariosMap(),
            cargarMaterialesCache(),
        ]);
        if (id !== selectedId) return; // superseded por otra selección mientras cargaba
        renderDetalle(servicio, recetas || [], historial || [], usuarios, materiales);
    } catch (err) {
        detalle.innerHTML = `<p class="rp-empty-text">Error al cargar el servicio: ${escapeHtml(err.message)}</p>`;
    }
}

function renderDetalle(servicio, recetas, historial, usuarios, materiales) {
    const detalle = document.getElementById('catalogoDetalle');
    if (!detalle) return;

    const materialPorId = new Map(materiales.map(m => [m.id, m]));
    const costoLinea = (l) => (materialPorId.get(l.inventario_id)?.precio_unitario || 0) * Number(l.cantidad || 0);
    const costoTotal = recetas.reduce((acc, l) => acc + costoLinea(l), 0);

    const filasReceta = recetas.length === 0
        ? '<tr><td colspan="4" class="rp-empty-text">Sin insumos en la receta.</td></tr>'
        : recetas.map(l => `
            <tr data-receta-id="${l.id}">
                <td>${escapeHtml(l.inventario_nombre || ('#' + l.inventario_id))}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:7px;">
                        <input type="number" class="cat-cantidad-input receta-cantidad" value="${Number(l.cantidad)}" step="0.001" min="0.001" aria-label="Cantidad">
                        <span style="font-size:12.5px; color:var(--text-muted);">${escapeHtml(l.unidad_medida || '')}</span>
                    </div>
                </td>
                <td class="rp-num" style="color:var(--text-secondary);">${formatMoney(costoLinea(l))}</td>
                <td style="text-align:right;">
                    <button type="button" class="cat-icon-btn receta-quitar" title="Quitar" aria-label="Quitar insumo">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </td>
            </tr>`).join('');

    const filasHistorial = historial.length === 0
        ? '<p class="rp-empty-text">Sin cambios de precio registrados.</p>'
        : historial.map(h => {
            const quien = h.usuario_id != null ? escapeHtml(usuarios.get(h.usuario_id) || ('#' + h.usuario_id)) : '—';
            const pct = h.variacion_pct;
            const pctTxt = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
            const pctColor = pct == null ? 'var(--text-muted)' : (pct >= 0 ? 'var(--secondary)' : 'var(--accent)');
            return `
                <div class="cat-hist-row">
                    <span class="rp-num" style="color:var(--text-secondary); width:92px;">${formatFechaCorta(h.fecha_cambio)}</span>
                    <span class="rp-num" style="font-weight:500; width:72px;">${formatMoney(h.precio_nuevo)}</span>
                    <span class="rp-num" style="width:60px; color:${pctColor};">${pctTxt}</span>
                    <span style="flex-grow:1; text-align:right; color:var(--text-muted); font-size:12px;">${quien}</span>
                </div>`;
        }).join('');

    detalle.innerHTML = `
        <div class="cat-detail-head">
            <div class="cat-detail-heading">
                <span class="ser cat-detail-nombre">${escapeHtml(servicio.nombre)}</span>
                <div class="cat-detail-pills">
                    <span class="av-pill">${escapeHtml(servicio.categoria)}</span>
                    <span class="av-pill ${servicio.activo ? 'av-pill--ok' : 'av-pill--neutral'}">${servicio.activo ? 'Activo' : 'Inactivo'}</span>
                    ${servicio.precio_variable ? '<span class="av-pill av-pill--warn">Precio variable</span>' : ''}
                </div>
            </div>
            <div class="cat-detail-precio">
                <span class="rp-num" style="font-size:26px; font-weight:500; letter-spacing:-0.02em;">${formatMoney(servicio.precio_ref)}</span>
                <span style="font-size:12px; color:var(--text-secondary);">costo de insumos ${formatMoney(costoTotal)}</span>
            </div>
            <button type="button" class="av-btn" id="btnCatEditar">Editar</button>
            ${servicio.activo ? '<button type="button" class="av-btn" style="color:var(--accent); border-color:var(--accent);" id="btnCatDesactivar">Desactivar</button>' : ''}
        </div>

        <div class="cat-hr"></div>

        <div class="cat-detail-section">
            <div class="cat-detail-section-head">
                <span style="font-size:14px; font-weight:600;">Insumos que consume</span>
                <span style="font-size:12px; color:var(--text-muted);">se descuentan al aplicar el servicio</span>
                <div class="av-spacer"></div>
                <button type="button" class="av-btn" id="btnCatAgregarInsumo">+ Agregar insumo</button>
            </div>
            <div id="catAgregarInsumoRow" class="cat-agregar-row" hidden>
                <select id="catMaterialSelect"><option value="">Seleccionar…</option></select>
                <input type="number" id="catMaterialCantidad" step="0.001" min="0.001" placeholder="Cantidad" style="width:100px;">
                <select id="catMaterialUnidad">
                    <option value="ml">ml</option>
                    <option value="g">g</option>
                    <option value="unidad">unidad</option>
                    <option value="par">par</option>
                </select>
                <button type="button" class="av-btn av-btn--primary" id="btnCatConfirmarInsumo">Agregar</button>
                <span id="catInsumoError" class="rp-empty-text" style="padding:0; display:none;"></span>
            </div>
            <table class="rp-table cat-receta-table">
                <thead><tr><th>Material</th><th>Cantidad</th><th>Costo</th><th></th></tr></thead>
                <tbody id="catRecetaBody">${filasReceta}</tbody>
            </table>
        </div>

        <div class="cat-hr"></div>

        <div class="cat-detail-section">
            <div class="cat-detail-section-head">
                <span style="font-size:14px; font-weight:600;">Historial de precios</span>
                <span style="font-size:12px; color:var(--text-muted);">${historial.length} cambio${historial.length === 1 ? '' : 's'} registrado${historial.length === 1 ? '' : 's'}</span>
            </div>
            <div class="cat-hist-list">${filasHistorial}</div>
        </div>
    `;

    document.getElementById('btnCatEditar')?.addEventListener('click', () => abrirModalServicio(servicio.id));
    // Tarea 11 (revisión de bocetos): desactivarServicio() quedó exportado y
    // bindeado en window (app.js) pero ningún elemento de la UI la llamaba
    // desde la reescritura maestro-detalle -- hallazgo de revisión.
    document.getElementById('btnCatDesactivar')?.addEventListener('click', () => desactivarServicio(servicio.id));

    const filaVacia = document.getElementById('catRecetaBody');
    filaVacia?.addEventListener('click', (e) => {
        const btn = e.target.closest('.receta-quitar');
        if (!btn) return;
        const row = btn.closest('[data-receta-id]');
        if (row) quitarReceta(row.dataset.recetaId);
    });
    filaVacia?.addEventListener('change', (e) => {
        const inp = e.target.closest('.receta-cantidad');
        if (!inp) return;
        const row = inp.closest('[data-receta-id]');
        if (row) actualizarRecetaCantidad(row.dataset.recetaId, inp.value);
    });

    const selectMaterial = document.getElementById('catMaterialSelect');
    if (selectMaterial) {
        selectMaterial.innerHTML = '<option value="">Seleccionar…</option>' + materiales.map(m =>
            `<option value="${m.id}" data-unidad="${escapeHtml(m.unidad_medida || '')}">${escapeHtml(m.nombre)}</option>`
        ).join('');
        selectMaterial.addEventListener('change', (e) => {
            const unidad = (e.target.selectedOptions[0]?.dataset.unidad || '').trim();
            const unidadSelect = document.getElementById('catMaterialUnidad');
            if (unidadSelect && unidad) unidadSelect.value = unidad;
        });
    }

    document.getElementById('btnCatAgregarInsumo')?.addEventListener('click', async () => {
        const row = document.getElementById('catAgregarInsumoRow');
        if (!row) return;
        row.hidden = !row.hidden;
        if (!row.hidden) {
            // Refresca la lista de materiales al abrir -- si se dio de alta
            // uno nuevo en Insumos después de entrar al detalle, tiene que
            // aparecer sin recargar toda la pantalla.
            const materialesFrescos = await cargarMaterialesCache();
            const select = document.getElementById('catMaterialSelect');
            if (select) {
                select.innerHTML = '<option value="">Seleccionar…</option>' + materialesFrescos.map(m =>
                    `<option value="${m.id}" data-unidad="${escapeHtml(m.unidad_medida || '')}">${escapeHtml(m.nombre)}</option>`
                ).join('');
            }
        }
    });
    document.getElementById('btnCatConfirmarInsumo')?.addEventListener('click', () => agregarReceta(servicio.id));
}

// ============================================================
// RECETA DE MATERIALES (Tarea 07 slice C) — ahora sobre el panel de detalle
// ============================================================

function showInsumoError(msg) {
    const el = document.getElementById('catInsumoError');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'inline' : 'none';
}

async function agregarReceta(servicioId) {
    const materialSelect = document.getElementById('catMaterialSelect');
    const inventarioId = parseInt(materialSelect?.value, 10);
    const cantidad = parseFloat(document.getElementById('catMaterialCantidad')?.value);
    const unidadSelect = document.getElementById('catMaterialUnidad');
    let unidad = (unidadSelect?.value || '').trim();
    if (!unidad) unidad = (materialSelect?.selectedOptions[0]?.dataset.unidad || '').trim() || 'unidad';

    showInsumoError('');
    if (!inventarioId) { showInsumoError('Elegí un material.'); return; }
    if (!(cantidad > 0)) { showInsumoError('Ingresá una cantidad mayor a 0.'); return; }

    try {
        await fetchAPI(`/catalogo/${servicioId}/recetas`, {
            method: 'POST',
            body: JSON.stringify({ inventario_id: inventarioId, cantidad, unidad_medida: unidad }),
        });
        await cargarDetalle(servicioId);
    } catch (err) {
        if (/ya está en la receta|ya esta en la receta|409/i.test(err.message)) {
            showInsumoError('Ese material ya está en la receta.');
        } else {
            showInsumoError('Error: ' + err.message);
        }
    }
}

async function quitarReceta(recetaId) {
    try {
        await fetchAPI(`/catalogo/recetas/${recetaId}`, { method: 'DELETE' });
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showNotification('Error al quitar insumo: ' + err.message, 'error');
    }
}

async function actualizarRecetaCantidad(recetaId, valor) {
    const cantidad = parseFloat(valor);
    if (!(cantidad > 0)) { showNotification('La cantidad debe ser mayor a 0.', 'error'); return; }
    try {
        await fetchAPI(`/catalogo/recetas/${recetaId}`, { method: 'PUT', body: JSON.stringify({ cantidad }) });
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showNotification('Error al actualizar cantidad: ' + err.message, 'error');
    }
}

// ============================================================
// MODAL DE METADATA (nombre / categoría / precio / unidad) — CRUD
// ============================================================

export async function abrirModalServicio(id = null) {
    document.getElementById('catalogoServicioId').value = '';
    document.getElementById('formCatalogoServicio').reset();
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar Servicio' : 'Nuevo Servicio';

    const precioInput = document.getElementById('catalogoPrecioRef');
    const precioHint = document.getElementById('catalogoPrecioRefHint');
    const motivoGroup = document.getElementById('catalogoMotivoGroup');
    if (precioInput) { precioInput.disabled = false; precioInput.classList.remove('is-locked'); }
    if (precioHint) precioHint.hidden = true;
    if (motivoGroup) motivoGroup.hidden = true;

    if (id) {
        try {
            const s = await fetchAPI(`/catalogo/${id}`);
            document.getElementById('catalogoServicioId').value = s.id;
            document.getElementById('catalogoNombre').value = s.nombre;
            document.getElementById('catalogoCategoria').value = s.categoria;
            document.getElementById('catalogoPrecioRef').value = s.precio_ref;
            document.getElementById('catalogoUnidad').value = s.unidad || '';
            document.getElementById('catalogoPrecioVariable').checked = s.precio_variable;
            gatePrecioInput({ inputId: 'catalogoPrecioRef', hintId: 'catalogoPrecioRefHint', motivoGroupId: 'catalogoMotivoGroup' });
        } catch (err) {
            showNotification('Error cargando servicio: ' + err.message, 'error');
            return;
        }
    }
    openModal('modalCatalogoServicio');
}

export async function guardarServicio(e) {
    e.preventDefault();
    const id = document.getElementById('catalogoServicioId').value;
    const payload = {
        nombre: document.getElementById('catalogoNombre').value.trim(),
        categoria: document.getElementById('catalogoCategoria').value,
        precio_ref: parseFloat(document.getElementById('catalogoPrecioRef').value) || 0,
        unidad: document.getElementById('catalogoUnidad').value.trim() || null,
        precio_variable: document.getElementById('catalogoPrecioVariable').checked,
        activo: true,
    };
    try {
        if (id) {
            const motivo = document.getElementById('catalogoMotivo')?.value.trim();
            if (motivo) payload.motivo = motivo;
            await fetchAPI(`/catalogo/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showNotification('Servicio actualizado', 'success');
        } else {
            await fetchAPI('/catalogo', { method: 'POST', body: JSON.stringify(payload) });
            showNotification('Servicio creado', 'success');
        }
        closeModal('modalCatalogoServicio');
        if (id) selectedId = Number(id);
        cargarCatalogo();
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
}

export async function desactivarServicio(id) {
    if (!confirm('¿Desactivar este servicio del catálogo?')) return;
    try {
        await fetchAPI(`/catalogo/${id}`, { method: 'DELETE' });
        showNotification('Servicio desactivado', 'success');
        cargarCatalogo();
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
}

// El router del shell 1A (etapa 2b) llama a init(); la nav actual llama a
// cargarCategoriasSelect()+cargarCatalogo() directamente (ver legacy-nav.js).
export function init() {
    cargarCategoriasSelect();
    cargarCatalogo();
}
