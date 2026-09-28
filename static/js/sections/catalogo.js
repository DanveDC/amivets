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
import { getRole } from '../core/session.js';

// ============================================================
// ESTADO DEL PANEL MAESTRO-DETALLE
// ============================================================

let listaCache = [];          // acumulado de todas las páginas cargadas hasta ahora
let selectedId = null;
let materialesCache = [];     // inventario filtrado a tipo_item === 'MATERIAL'

// ============================================================
// PAGINACIÓN "CARGAR MÁS" (paginacion-catalogo) — antes se pedía todo de
// una con ?limit=500 y, pasado ese techo, el resto del catálogo no
// aparecía salvo que se lo buscara por nombre. Página de PAGE_SIZE_CATALOGO,
// que avanza con `skip`; buscar o cambiar de categoría resetea a la
// primera página. `_generacionCatalogo` evita que una respuesta vieja
// (de un filtro ya reemplazado) pise una más nueva -- mismo patrón que
// `_generacionPorCobrar` en sections/facturacion.js.
// ============================================================
const PAGE_SIZE_CATALOGO = 100;
let catalogoSkip = 0;
let catalogoHayMasPaginas = false;
let catalogoCargandoMas = false;
let _generacionCatalogo = 0;

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

function catalogoFiltrosActuales() {
    const q = (document.getElementById('catalogoSearch')?.value || '').trim();
    const cat = document.getElementById('catalogoCategoriaFilter')?.value || '';
    return { q, cat };
}

// Contador real para los filtros actuales (GET /catalogo/contador): la
// lista pagina con skip/limit y `listaCache` solo tiene lo cargado hasta
// ahora, no alcanza para contar. Se pide aparte para no cambiar la forma
// de la respuesta de la lista (paginacion-catalogo).
async function actualizarContadorCatalogo(generacion, q, cat) {
    const contador = document.getElementById('catalogoContador');
    if (!contador) return;
    try {
        let url = '/catalogo/contador';
        const params = [];
        if (q) params.push(`q=${encodeURIComponent(q)}`);
        if (cat) params.push(`categoria=${encodeURIComponent(cat)}`);
        if (params.length) url += `?${params.join('&')}`;
        const info = await fetchAPI(url);
        if (generacion !== _generacionCatalogo) return; // filtro reemplazado mientras cargaba
        contador.textContent = `${info.activos} activos${info.inactivos ? ` · ${info.inactivos} inactivos` : ''}`;
    } catch (err) {
        // El contador es un detalle secundario: si falla no rompe la lista.
        console.error('Error cargando el contador del catálogo:', err);
    }
}

async function cargarPaginaCatalogo(generacion, reset) {
    const { q, cat } = catalogoFiltrosActuales();
    let url = `/catalogo?solo_activos=false&limit=${PAGE_SIZE_CATALOGO}&skip=${catalogoSkip}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (cat) url += `&categoria=${encodeURIComponent(cat)}`;

    const lista = document.getElementById('catalogoLista');
    const btnCargarMas = document.getElementById('catalogoCargarMas');
    if (!lista) return;

    if (reset) {
        lista.innerHTML = '<p class="rp-empty-text">Cargando…</p>';
        // Por si quedaba un "cargar más" a mitad de camino de un filtro
        // anterior (ver comentario de cargarCatalogo sobre catalogoCargandoMas):
        // el botón vuelve a su estado de reposo, no al que dejó esa carga vieja.
        if (btnCargarMas) { btnCargarMas.hidden = true; btnCargarMas.disabled = false; btnCargarMas.textContent = 'Cargar más'; }
    } else {
        catalogoCargandoMas = true;
        if (btnCargarMas) { btnCargarMas.disabled = true; btnCargarMas.textContent = 'Cargando…'; }
    }

    try {
        const items = await fetchAPI(url);
        if (generacion !== _generacionCatalogo) return; // superseded por otro filtro mientras cargaba

        const pagina = Array.isArray(items) ? items : [];
        listaCache = reset ? pagina : listaCache.concat(pagina);
        catalogoSkip += pagina.length;
        catalogoHayMasPaginas = pagina.length === PAGE_SIZE_CATALOGO;

        if (reset) await actualizarContadorCatalogo(generacion, q, cat);
        if (generacion !== _generacionCatalogo) return; // por si el filtro cambió durante el contador

        if (listaCache.length === 0) {
            lista.innerHTML = '<p class="rp-empty-text">Sin resultados.</p>';
            if (btnCargarMas) btnCargarMas.hidden = true;
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

        if (btnCargarMas) btnCargarMas.hidden = !catalogoHayMasPaginas;

        if (reset) {
            // Si el servicio seleccionado sigue en la lista filtrada, mantiene
            // selección; si no, selecciona el primero (o vacío si no hay).
            if (selectedId && listaCache.some(s => s.id === selectedId)) {
                cargarDetalle(selectedId);
            } else {
                seleccionarServicio(listaCache[0].id);
            }
        }
        // "Cargar más" (reset=false) nunca toca la selección ni el detalle
        // ya abierto -- solo agrega filas al final de la lista.
    } catch (err) {
        if (generacion !== _generacionCatalogo) return;
        lista.innerHTML = `<p class="rp-empty-text">Error: ${escapeHtml(err.message)}</p>`;
    } finally {
        if (generacion === _generacionCatalogo) {
            catalogoCargandoMas = false;
            if (btnCargarMas) { btnCargarMas.disabled = false; btnCargarMas.textContent = 'Cargar más'; }
        }
    }
}

export async function cargarCatalogo() {
    // Carga inicial, nueva búsqueda o cambio de categoría: vuelve a la
    // primera página y descarta lo acumulado hasta ahora.
    catalogoSkip = 0;
    catalogoHayMasPaginas = false;
    // Si quedaba un "cargar más" en vuelo de un filtro anterior, su respuesta
    // va a llegar con una generación vieja y salir por el chequeo de arriba
    // sin pasar por el `finally` que limpia esta bandera -- se resetea acá
    // para que un cambio de filtro nunca deje "cargar más" trabado en true.
    catalogoCargandoMas = false;
    listaCache = [];
    const generacion = ++_generacionCatalogo;
    await cargarPaginaCatalogo(generacion, true);
}

async function cargarMasCatalogo() {
    if (catalogoCargandoMas || !catalogoHayMasPaginas) return;
    await cargarPaginaCatalogo(_generacionCatalogo, false);
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
        const [servicio, recetas, historial, usuarios, materiales, costo] = await Promise.all([
            fetchAPI(`/catalogo/${id}`),
            fetchAPI(`/catalogo/${id}/recetas`),
            fetchAPI(`/catalogo/${id}/historial-precios`),
            getUsuariosMap(),
            cargarMaterialesCache(),
            fetchAPI(`/catalogo/${id}/costo`),
        ]);
        // plantillas-paquete-catalogo: componentes y disponibilidad solo hacen
        // falta para un paquete -- para el resto de los servicios se ahorran
        // las dos llamadas.
        let paquete = null;
        let disponibilidad = null;
        if (servicio.es_paquete) {
            [paquete, disponibilidad] = await Promise.all([
                fetchAPI(`/catalogo/${id}/componentes`),
                fetchAPI(`/catalogo/${id}/disponibilidad`),
            ]);
        }
        if (id !== selectedId) return; // superseded por otra selección mientras cargaba
        renderDetalle(servicio, recetas || [], historial || [], usuarios, materiales, costo, paquete, disponibilidad);
    } catch (err) {
        detalle.innerHTML = `<p class="rp-empty-text">Error al cargar el servicio: ${escapeHtml(err.message)}</p>`;
    }
}

function pillComision(s) {
    if (s.tipo_comision_servicio === 'FIJO') return `<span class="av-pill" data-cat-comision>Comisión ${formatMoney(s.monto_fijo_servicio)} fijo</span>`;
    if (s.tipo_comision_servicio === 'PORCENTAJE') return `<span class="av-pill" data-cat-comision>Comisión ${Number(s.porcentaje_servicio)}%</span>`;
    return '';
}

function renderDetalle(servicio, recetas, historial, usuarios, materiales, costo, paquete = null, disponibilidad = null) {
    const detalle = document.getElementById('catalogoDetalle');
    if (!detalle) return;
    const esAdmin = getRole() === 'admin';

    // Costo desde GET /catalogo/{id}/costo (catalogo-servicios-configurable):
    // precio por UNIDAD BASE del material (envase / contenido). Antes se
    // multiplicaba el precio del envase por la cantidad en ml o g.
    const costoPorMaterial = new Map((costo?.lineas || []).map(l => [l.inventario_id, l.subtotal]));
    const costoLinea = (l) => costoPorMaterial.get(l.inventario_id) || 0;
    const costoTotal = Number(costo?.total || 0);

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

    // plantillas-paquete-catalogo: "Componentes del paquete" (solo si
    // `servicio.es_paquete`) e "Insumos y stock" (agregación de la propia
    // receta + la de cada componente activo, design D4). Edición solo admin.
    const filasComponentes = !paquete || paquete.componentes.length === 0
        ? '<tr><td colspan="5" class="rp-empty-text">Sin componentes todavía.</td></tr>'
        : paquete.componentes.map((c, idx) => `
            <tr data-componente-row-id="${c.id}" style="${c.activo ? '' : 'opacity:0.55;'}">
                <td>${escapeHtml(c.nombre)}${c.activo ? '' : ' <span class="av-pill av-pill--neutral" style="font-size:10px;">inactivo</span>'}</td>
                <td>
                    ${esAdmin
                        ? `<input type="number" class="cat-cantidad-input paquete-cantidad" value="${Number(c.cantidad)}" step="0.001" min="0.001" aria-label="Cantidad de ${escapeHtml(c.nombre)}">`
                        : Number(c.cantidad)}
                </td>
                <td class="rp-num">${formatMoney(c.subtotal)}</td>
                ${esAdmin ? `
                <td style="white-space:nowrap;">
                    <button type="button" class="cat-icon-btn paquete-subir" title="Subir" aria-label="Subir ${escapeHtml(c.nombre)}" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="cat-icon-btn paquete-bajar" title="Bajar" aria-label="Bajar ${escapeHtml(c.nombre)}" ${idx === paquete.componentes.length - 1 ? 'disabled' : ''}>↓</button>
                </td>
                <td style="text-align:right;">
                    <button type="button" class="cat-icon-btn paquete-quitar" title="Quitar" aria-label="Quitar ${escapeHtml(c.nombre)}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </td>` : '<td></td><td></td>'}
            </tr>`).join('');

    const seccionPaquete = !servicio.es_paquete ? '' : `
        <div class="cat-hr"></div>
        <div class="cat-detail-section">
            <div class="cat-detail-section-head">
                <span style="font-size:14px; font-weight:600;">Componentes del paquete</span>
                <span style="font-size:12px; color:var(--text-muted);">total del paquete ${formatMoney(paquete?.total_paquete ?? servicio.precio_ref)}</span>
                <div class="av-spacer"></div>
                ${esAdmin ? '<button type="button" class="av-btn" id="btnCatAgregarComponente">+ Agregar componente</button>' : ''}
            </div>
            ${esAdmin ? `
            <div id="catAgregarComponenteRow" class="cat-agregar-row" hidden>
                <select id="catComponenteSelect" aria-label="Servicio del catálogo"><option value="">Seleccionar…</option></select>
                <input type="number" id="catComponenteCantidad" step="0.001" min="0.001" value="1" placeholder="Cantidad" aria-label="Cantidad" style="width:100px;">
                <button type="button" class="av-btn av-btn--primary" id="btnCatConfirmarComponente">Agregar</button>
                <span id="catComponenteError" class="rp-empty-text" role="alert" style="padding:0; display:none;"></span>
            </div>` : ''}
            <table class="rp-table cat-receta-table">
                <thead><tr><th>Servicio</th><th>Cantidad</th><th>Subtotal</th><th colspan="2"></th></tr></thead>
                <tbody id="catPaqueteComponentesBody">${filasComponentes}</tbody>
            </table>
        </div>`;

    const filasInsumosStock = !disponibilidad || disponibilidad.insumos.length === 0
        ? '<tr><td colspan="4" class="rp-empty-text">Sin insumos en la receta.</td></tr>'
        : disponibilidad.insumos.map((i) => `
            <tr>
                <td>${escapeHtml(i.nombre)}</td>
                <td class="rp-num">${i.requerido} ${escapeHtml(i.unidad)}</td>
                <td class="rp-num">${i.disponible} ${escapeHtml(i.unidad)}</td>
                <td class="rp-num${i.faltante > 0 ? ' av-text-danger' : ''}">${i.faltante}</td>
            </tr>`).join('');

    const seccionDisponibilidad = !servicio.es_paquete ? '' : `
        <div class="cat-hr"></div>
        <div class="cat-detail-section">
            <div class="cat-detail-section-head">
                <span style="font-size:14px; font-weight:600;">Insumos y stock</span>
                <span style="font-size:12px; ${disponibilidad && !disponibilidad.suficiente ? 'color:var(--accent);' : 'color:var(--text-muted);'}">${disponibilidad?.suficiente ? 'Stock suficiente para el paquete completo' : 'Stock insuficiente para algún insumo'}</span>
            </div>
            <table class="rp-table cat-receta-table">
                <thead><tr><th>Material</th><th>Requerido</th><th>Disponible</th><th>Faltante</th></tr></thead>
                <tbody>${filasInsumosStock}</tbody>
            </table>
        </div>`;

    detalle.innerHTML = `
        <div class="cat-detail-head">
            <div class="cat-detail-heading">
                <span class="ser cat-detail-nombre">${escapeHtml(servicio.nombre)}</span>
                <div class="cat-detail-pills">
                    <span class="av-pill">${escapeHtml(servicio.categoria)}</span>
                    <span class="av-pill ${servicio.activo ? 'av-pill--ok' : 'av-pill--neutral'}">${servicio.activo ? 'Activo' : 'Inactivo'}</span>
                    ${servicio.precio_variable ? '<span class="av-pill av-pill--warn">Precio variable</span>' : ''}
                    ${servicio.es_paquete ? '<span class="av-pill av-pill--info">PAQUETE</span>' : ''}
                    ${pillComision(servicio)}
                </div>
            </div>
            <div class="cat-detail-precio">
                <span class="rp-num" style="font-size:26px; font-weight:500; letter-spacing:-0.02em;">${formatMoney(servicio.precio_ref)}</span>
                <span style="font-size:12px; color:var(--text-secondary);" id="catCostoInsumos">costo de insumos ${formatMoney(costoTotal)}</span>
                ${costoTotal > 0 ? `<button type="button" class="av-btn" id="btnCatUsarCosto" style="height:28px; padding:0 10px; font-size:12px; margin-top:4px;">Usar como precio base</button>` : ''}
            </div>
            <button type="button" class="av-btn" id="btnCatEditar">Editar</button>
            ${servicio.activo ? '<button type="button" class="av-btn" style="color:var(--accent); border-color:var(--accent);" id="btnCatDesactivar">Desactivar</button>' : ''}
        </div>

        ${seccionPaquete}
        ${seccionDisponibilidad}

        <div class="cat-hr"></div>

        <div class="cat-detail-section">
            <div class="cat-detail-section-head">
                <span style="font-size:14px; font-weight:600;">Insumos que consume</span>
                <span style="font-size:12px; color:var(--text-muted);">se descuentan al aplicar el servicio</span>
                <div class="av-spacer"></div>
                <button type="button" class="av-btn" id="btnCatAgregarInsumo">+ Agregar insumo</button>
            </div>
            <div id="catAgregarInsumoRow" class="cat-agregar-row" hidden>
                <select id="catMaterialSelect" aria-label="Material"><option value="">Seleccionar…</option></select>
                <input type="number" id="catMaterialCantidad" step="0.001" min="0.001" placeholder="Cantidad" aria-label="Cantidad" style="width:100px;">
                <select id="catMaterialUnidad" aria-label="Unidad de medida">
                    <option value="ml">ml</option>
                    <option value="g">g</option>
                    <option value="unidad">unidad</option>
                </select>
                <button type="button" class="av-btn av-btn--primary" id="btnCatConfirmarInsumo">Agregar</button>
                <span id="catInsumoError" class="rp-empty-text" role="alert" style="padding:0; display:none;"></span>
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
    // Precio base desde el costo de insumos (catalogo-servicios-configurable):
    // queda registrado en el historial de precios con su motivo.
    document.getElementById('btnCatUsarCosto')?.addEventListener('click', async () => {
        if (!confirm(`¿Usar ${formatMoney(costoTotal)} (costo de insumos) como precio base del servicio?`)) return;
        try {
            await fetchAPI(`/catalogo/${servicio.id}`, {
                method: 'PUT',
                body: JSON.stringify({ precio_ref: costoTotal, motivo: 'Precio base desde costo de insumos' }),
            });
            showNotification('Precio base actualizado.', 'success');
            cargarCatalogo();
        } catch (err) {
            showNotification('No se pudo actualizar el precio: ' + err.message, 'error');
        }
    });

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
            // Siempre setea el select (restaura el comportamiento viejo): si
            // el material no declara unidad_medida, cae en 'unidad' en vez
            // de dejar la selección anterior puesta (podía quedar
            // desincronizada con el material recién elegido).
            if (unidadSelect) unidadSelect.value = unidad || 'unidad';
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

    if (servicio.es_paquete && esAdmin) wirePaqueteComponentes(servicio.id);
}

// ============================================================
// COMPONENTES DEL PAQUETE (plantillas-paquete-catalogo) — solo admin edita;
// veterinario/otros ven la sección de renderDetalle en modo lectura (sin estos
// listeners, porque los botones de edición ni se pintan).
// ============================================================

function wirePaqueteComponentes(paqueteId) {
    const body = document.getElementById('catPaqueteComponentesBody');
    body?.addEventListener('click', (e) => {
        const row = e.target.closest('[data-componente-row-id]');
        if (!row) return;
        const rowId = row.dataset.componenteRowId;
        if (e.target.closest('.paquete-quitar')) return quitarComponentePaquete(rowId);
        if (e.target.closest('.paquete-subir')) return moverComponentePaquete(paqueteId, row, -1);
        if (e.target.closest('.paquete-bajar')) return moverComponentePaquete(paqueteId, row, 1);
    });
    body?.addEventListener('change', (e) => {
        const inp = e.target.closest('.paquete-cantidad');
        if (!inp) return;
        const row = inp.closest('[data-componente-row-id]');
        if (row) actualizarCantidadComponentePaquete(row.dataset.componenteRowId, inp.value);
    });

    document.getElementById('btnCatAgregarComponente')?.addEventListener('click', async () => {
        const row = document.getElementById('catAgregarComponenteRow');
        if (!row) return;
        row.hidden = !row.hidden;
        if (!row.hidden) await cargarComponentesDisponiblesSelect();
    });
    document.getElementById('btnCatConfirmarComponente')?.addEventListener('click', () => agregarComponentePaqueteUI(paqueteId));
}

function showComponenteError(msg) {
    const el = document.getElementById('catComponenteError');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'inline' : 'none';
}

// Candidatos del <select> "Agregar componente": activos, que no sean ellos
// mismos un paquete (un nivel solo, design D1) y que no sean CONSULTA (design
// D5) -- el backend igual valida todo esto, esto solo evita un 422 obvio.
async function cargarComponentesDisponiblesSelect() {
    const select = document.getElementById('catComponenteSelect');
    if (!select) return;
    try {
        const servicios = await fetchAPI('/catalogo?solo_activos=true&limit=500') || [];
        const candidatos = servicios.filter(s =>
            !s.es_paquete && (s.categoria || '').toUpperCase() !== 'CONSULTA' && s.id !== selectedId
        );
        select.innerHTML = '<option value="">Seleccionar…</option>' + candidatos.map(s =>
            `<option value="${s.id}">${escapeHtml(s.nombre)} (${escapeHtml(s.categoria)})</option>`
        ).join('');
    } catch (err) {
        select.innerHTML = '<option value="">Error al cargar servicios</option>';
    }
}

async function agregarComponentePaqueteUI(paqueteId) {
    const componenteId = parseInt(document.getElementById('catComponenteSelect')?.value, 10);
    const cantidad = parseFloat(document.getElementById('catComponenteCantidad')?.value);
    showComponenteError('');
    if (!componenteId) { showComponenteError('Elegí un servicio.'); return; }
    if (!(cantidad > 0)) { showComponenteError('Ingresá una cantidad mayor a 0.'); return; }
    try {
        await fetchAPI(`/catalogo/${paqueteId}/componentes`, {
            method: 'POST',
            body: JSON.stringify({ componente_id: componenteId, cantidad }),
        });
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showComponenteError('Error: ' + err.message);
    }
}

async function quitarComponentePaquete(rowId) {
    try {
        await fetchAPI(`/catalogo/componentes/${rowId}`, { method: 'DELETE' });
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showNotification('Error al quitar componente: ' + err.message, 'error');
    }
}

async function actualizarCantidadComponentePaquete(rowId, valor) {
    const cantidad = parseFloat(valor);
    if (!(cantidad > 0)) { showNotification('La cantidad debe ser mayor a 0.', 'error'); return; }
    try {
        await fetchAPI(`/catalogo/componentes/${rowId}`, { method: 'PUT', body: JSON.stringify({ cantidad }) });
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showNotification('Error al actualizar cantidad: ' + err.message, 'error');
    }
}

// Reordenar (design D5, "Reordenar componentes"): el front intercambia la
// `posicion` de la fila con su vecino con dos PUT -- no hay un endpoint de
// "mover" dedicado.
async function moverComponentePaquete(paqueteId, row, delta) {
    const vecino = delta < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!vecino || !vecino.dataset.componenteRowId) return;
    const filaId = row.dataset.componenteRowId;
    const vecinoId = vecino.dataset.componenteRowId;
    try {
        const [listado] = await Promise.all([listarComponentesPaqueteUI(paqueteId)]);
        const filaActual = listado.componentes.find(c => String(c.id) === filaId);
        const filaVecina = listado.componentes.find(c => String(c.id) === vecinoId);
        if (!filaActual || !filaVecina) return;
        await Promise.all([
            fetchAPI(`/catalogo/componentes/${filaId}`, { method: 'PUT', body: JSON.stringify({ posicion: filaVecina.posicion }) }),
            fetchAPI(`/catalogo/componentes/${vecinoId}`, { method: 'PUT', body: JSON.stringify({ posicion: filaActual.posicion }) }),
        ]);
        if (selectedId) await cargarDetalle(selectedId);
    } catch (err) {
        showNotification('Error al reordenar: ' + err.message, 'error');
    }
}

function listarComponentesPaqueteUI(paqueteId) {
    return fetchAPI(`/catalogo/${paqueteId}/componentes`);
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

// Categorías del modal: las del catálogo (pueden haberse creado nuevas) más
// la opción "Otra…" (catalogo-servicios-configurable).
async function cargarCategoriasModal() {
    const select = document.getElementById('catalogoCategoria');
    if (!select) return;
    const fijas = [...select.options].map(o => o.value).filter(v => v && v !== '__nueva__');
    try {
        const cats = await fetchAPI('/catalogo/categorias');
        const todas = [...new Set([...fijas, ...(cats || [])])].sort();
        select.innerHTML = '<option value="">Seleccionar...</option>' +
            todas.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
            '<option value="__nueva__">Otra (nueva categoría)…</option>';
    } catch (_) { /* quedan las fijas */ }
}

// Áreas del modal: GET /areas/ es solo para admin/recepción/veterinario; si
// falla, el campo se oculta y el servicio conserva su área.
async function cargarAreasModal() {
    const group = document.getElementById('catalogoAreaGroup');
    const select = document.getElementById('catalogoArea');
    if (!select) return;
    try {
        const areas = await fetchAPI('/areas/');
        select.innerHTML = '<option value="">Sin despacho (se ejecuta al confirmar)</option>' +
            (areas || []).filter(a => a.activo).map(a => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`).join('');
        if (group) group.hidden = false;
    } catch (_) {
        if (group) group.hidden = true;
    }
}

function toggleCategoriaNueva() {
    const nueva = document.getElementById('catalogoCategoriaNueva');
    const esNueva = document.getElementById('catalogoCategoria')?.value === '__nueva__';
    if (nueva) {
        nueva.hidden = !esNueva;
        nueva.required = esNueva;
        if (esNueva) nueva.focus();
    }
}

// Override de comisión por item (comision-tipo-mixto-encargado), admin-only
// como el precio: a los demás roles el grupo ni se les muestra.
function toggleCamposComision() {
    const tipo = document.getElementById('catalogoTipoComision')?.value;
    const monto = document.getElementById('catalogoMontoFijoComision');
    const porcentaje = document.getElementById('catalogoPorcentajeComision');
    if (monto) monto.hidden = tipo !== 'FIJO';
    if (porcentaje) porcentaje.hidden = tipo !== 'PORCENTAJE';
}

function cargarComisionModal(s) {
    const group = document.getElementById('catalogoComisionGroup');
    if (group) group.hidden = getRole() !== 'admin';
    document.getElementById('catalogoTipoComision').value = s?.tipo_comision_servicio || 'HEREDA';
    document.getElementById('catalogoMontoFijoComision').value = s?.monto_fijo_servicio ?? '';
    document.getElementById('catalogoPorcentajeComision').value = s?.porcentaje_servicio ?? '';
    toggleCamposComision();
}

/** Campos de comisión del payload, o un string con el error. */
function payloadComision() {
    const tipo = document.getElementById('catalogoTipoComision').value;
    const leer = (idInput) => {
        const texto = document.getElementById(idInput).value.trim();
        return texto === '' ? null : Number(texto);
    };
    const monto = tipo === 'FIJO' ? leer('catalogoMontoFijoComision') : null;
    const porcentaje = tipo === 'PORCENTAJE' ? leer('catalogoPorcentajeComision') : null;
    if (tipo === 'FIJO' && (monto === null || Number.isNaN(monto) || monto < 0)) {
        return 'Indicá un monto fijo de comisión válido.';
    }
    if (tipo === 'PORCENTAJE' && (porcentaje === null || Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
        return 'El porcentaje de comisión tiene que estar entre 0 y 100.';
    }
    return { tipo_comision_servicio: tipo, monto_fijo_servicio: monto, porcentaje_servicio: porcentaje };
}

export async function abrirModalServicio(id = null) {
    document.getElementById('catalogoServicioId').value = '';
    document.getElementById('formCatalogoServicio').reset();
    await Promise.all([cargarCategoriasModal(), cargarAreasModal()]);
    toggleCategoriaNueva();
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar Servicio' : 'Nuevo Servicio';

    const precioInput = document.getElementById('catalogoPrecioRef');
    const precioHint = document.getElementById('catalogoPrecioRefHint');
    const motivoGroup = document.getElementById('catalogoMotivoGroup');
    if (precioInput) { precioInput.disabled = false; precioInput.classList.remove('is-locked'); }
    if (precioHint) precioHint.hidden = true;
    if (motivoGroup) motivoGroup.hidden = true;
    cargarComisionModal(null);

    // plantillas-paquete-catalogo: "Es paquete" es admin-only (design D5),
    // igual que el grupo de comisión de arriba.
    const esPaqueteGroup = document.getElementById('catalogoEsPaqueteGroup');
    if (esPaqueteGroup) esPaqueteGroup.hidden = getRole() !== 'admin';
    document.getElementById('catalogoEsPaquete').checked = false;

    if (id) {
        try {
            const s = await fetchAPI(`/catalogo/${id}`);
            document.getElementById('catalogoServicioId').value = s.id;
            document.getElementById('catalogoNombre').value = s.nombre;
            document.getElementById('catalogoCategoria').value = s.categoria;
            document.getElementById('catalogoPrecioRef').value = s.precio_ref;
            document.getElementById('catalogoUnidad').value = s.unidad || '';
            document.getElementById('catalogoPrecioVariable').checked = s.precio_variable;
            document.getElementById('catalogoArea').value = s.area_id ? String(s.area_id) : '';
            document.getElementById('catalogoAdjunto').value = s.requiere_adjunto === true ? 'si' : (s.requiere_adjunto === false ? 'no' : '');
            document.getElementById('catalogoEsPaquete').checked = !!s.es_paquete;
            cargarComisionModal(s);
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
    const categoriaSel = document.getElementById('catalogoCategoria').value;
    const categoria = categoriaSel === '__nueva__'
        ? document.getElementById('catalogoCategoriaNueva').value.trim().toUpperCase()
        : categoriaSel;
    if (!categoria) {
        showNotification('Elegí o escribí la categoría del servicio.', 'warning');
        return;
    }
    const adjunto = document.getElementById('catalogoAdjunto').value;
    const areaGroup = document.getElementById('catalogoAreaGroup');
    const payload = {
        nombre: document.getElementById('catalogoNombre').value.trim(),
        categoria,
        precio_ref: parseFloat(document.getElementById('catalogoPrecioRef').value) || 0,
        unidad: document.getElementById('catalogoUnidad').value.trim() || null,
        precio_variable: document.getElementById('catalogoPrecioVariable').checked,
        activo: true,
        requiere_adjunto: adjunto === 'si' ? true : (adjunto === 'no' ? false : null),
    };
    // El área solo se manda si el usuario la pudo ver (admin/recepción/vet).
    if (!areaGroup?.hidden) {
        const area = document.getElementById('catalogoArea').value;
        payload.area_id = area ? Number(area) : null;
    }
    // plantillas-paquete-catalogo: "Es paquete" solo se manda si el grupo es
    // visible (admin) -- el backend igual es admin-only, esto evita mandar
    // `es_paquete=false` de un rol que ni ve el checkbox y "cambiar" el valor
    // sin querer si algún día backend deja de ser idempotente en el mismo valor.
    const esPaqueteGroup = document.getElementById('catalogoEsPaqueteGroup');
    if (!esPaqueteGroup?.hidden) {
        payload.es_paquete = document.getElementById('catalogoEsPaquete').checked;
    }
    if (!document.getElementById('catalogoComisionGroup')?.hidden) {
        const comision = payloadComision();
        if (typeof comision === 'string') {
            showNotification(comision, 'warning');
            return;
        }
        Object.assign(payload, comision);
    }
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
        cargarCategoriasSelect();
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
let _modalWired = false;

export function init() {
    if (!_modalWired) {
        _modalWired = true;
        document.getElementById('catalogoCategoria')?.addEventListener('change', toggleCategoriaNueva);
        document.getElementById('catalogoTipoComision')?.addEventListener('change', toggleCamposComision);
        document.getElementById('catalogoCargarMas')?.addEventListener('click', cargarMasCatalogo);
    }
    cargarCategoriasSelect();
    cargarCatalogo();
}
