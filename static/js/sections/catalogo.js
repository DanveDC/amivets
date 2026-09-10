// sections/catalogo.js — catálogo de servicios.
// Tarea 07 slice C: editor de receta de materiales por servicio (sección
// "Materiales que consume" dentro del modal de edición).

import { fetchAPI } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal } from '../core/ui.js';
import { abrirHistorialPrecios, gatePrecioInput } from './historial-precios.js';

// Abre el panel "Historial de precios" (Tarea 08) para un servicio del catálogo.
// Sin curva de costo: los servicios no tienen costo de compra.
export const abrirHistorialServicio = (id, nombre, precioVariable = false) =>
    abrirHistorialPrecios({ tipo: 'catalogo', id, nombre, precioVariable });

// ============================================================
// CATALOGO DE SERVICIOS MODULE
// ============================================================

export async function cargarCategoriasSelect() {
    try {
        const cats = await fetchAPI('/catalogo/categorias');
        const filter = document.getElementById('catalogoCategoriaFilter');
        if (!filter) return;
        // Keep first placeholder option, rebuild the rest
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

export async function cargarCatalogo() {
    const q = (document.getElementById('catalogoSearch')?.value || '').trim();
    const cat = document.getElementById('catalogoCategoriaFilter')?.value || '';
    let url = '/catalogo?solo_activos=false&limit=500';
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (cat) url += `&categoria=${encodeURIComponent(cat)}`;

    const tbody = document.getElementById('catalogoBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-secondary);">Cargando…</td></tr>';

    try {
        const items = await fetchAPI(url);
        if (!items || !items.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-secondary);">Sin resultados.</td></tr>';
            return;
        }
        tbody.innerHTML = items.map(s => `
            <tr style="${s.activo ? '' : 'opacity:0.5;'}">
                <td>${s.id}</td>
                <td style="font-weight:600;">${s.nombre}</td>
                <td><span style="background:var(--primary-subtle); color:var(--primary); padding:2px 8px; border-radius:12px; font-size:0.75rem;">${s.categoria}</span></td>
                <td class="num" style="font-weight:700; color:var(--secondary);">$${s.precio_ref.toFixed(2)}</td>
                <td style="text-align:center;">${s.precio_variable ? `<span class="status-pill status-pill--muted">${ICONS.check}</span>` : ''}</td>
                <td style="font-size:0.8rem; color:var(--text-secondary);">${s.unidad || ''}</td>
                <td style="text-align:center;">${s.activo
                    ? `<span class="status-pill status-pill--ok">${ICONS.checkCircle}</span>`
                    : `<span class="status-pill status-pill--muted">${ICONS.xCircle}</span>`}</td>
                <td>
                    <div class="row-actions" style="justify-content:flex-start;">
                        <button onclick="abrirModalServicio(${s.id})" class="btn-secondary btn-sm" style="font-size:0.8rem;">Editar</button>
                        <button onclick="abrirHistorialServicio(${s.id}, '${(s.nombre || '').replace(/'/g, "\\'")}', ${!!s.precio_variable})" class="btn-secondary btn-sm btn-historial-precios" style="font-size:0.8rem;" title="Historial de precios">Historial</button>
                        ${s.activo ? `<button onclick="desactivarServicio(${s.id})" class="btn-secondary btn-sm btn-row-danger" style="font-size:0.8rem;">Desact.</button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--accent);">Error: ${err.message}</td></tr>`;
    }
}

// ============================================================
// RECETA DE MATERIALES POR SERVICIO (Tarea 07 slice C)
// ============================================================

let materialesCache = [];   // inventario filtrado a tipo_item === 'MATERIAL'
let recetaWired = false;

function showRecetaError(msg) {
    const el = document.getElementById('recetaError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
}

async function cargarMaterialesSelect() {
    const select = document.getElementById('recetaMaterialSelect');
    if (!select) return;
    try {
        const items = await fetchAPI('/inventario/?limit=500');
        materialesCache = (items || []).filter(p => p.tipo_item === 'MATERIAL');
        select.innerHTML = '<option value="">Seleccionar…</option>' + materialesCache.map(m =>
            `<option value="${m.id}" data-unidad="${m.unidad_medida || ''}">${m.nombre}</option>`
        ).join('');
    } catch (err) {
        console.error('Error cargando materiales:', err);
        select.innerHTML = '<option value="">No se pudo cargar el inventario</option>';
    }
}

function renderRecetas(lineas) {
    const cont = document.getElementById('catalogoRecetaLista');
    if (!cont) return;
    if (!lineas || !lineas.length) {
        cont.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); margin:0;">Sin materiales en la receta.</p>';
        return;
    }
    cont.innerHTML = lineas.map(l => `
        <div class="receta-linea" data-receta-id="${l.id}" style="display:flex; gap:0.5rem; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--border);">
            <span style="flex:2; min-width:120px; color:var(--text-primary);">${l.inventario_nombre || ('#' + l.inventario_id)}</span>
            <input type="number" class="receta-cantidad" value="${Number(l.cantidad)}" step="0.001" min="0.001"
                style="flex:1; max-width:90px;" aria-label="Cantidad">
            <span style="flex:0 0 auto; min-width:48px; color:var(--text-secondary); font-size:0.85rem;">${l.unidad_medida}</span>
            <button type="button" class="btn-secondary btn-sm btn-row-danger receta-quitar" style="font-size:0.75rem;">Quitar</button>
        </div>
    `).join('');
}

async function cargarRecetas(servicioId) {
    const cont = document.getElementById('catalogoRecetaLista');
    if (!cont) return;
    cont.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); margin:0;">Cargando receta…</p>';
    try {
        const lineas = await fetchAPI(`/catalogo/${servicioId}/recetas`);
        renderRecetas(lineas || []);
    } catch (err) {
        cont.innerHTML = `<p style="font-size:0.8rem; color:var(--accent); margin:0;">No se pudo cargar la receta: ${err.message}</p>`;
    }
}

async function agregarReceta() {
    const servicioId = document.getElementById('catalogoServicioId').value;
    if (!servicioId) return;
    const materialSelect = document.getElementById('recetaMaterialSelect');
    const inventarioId = parseInt(materialSelect.value, 10);
    const cantidad = parseFloat(document.getElementById('recetaMaterialCantidad').value);
    const unidadInput = document.getElementById('recetaMaterialUnidad');
    // Si el material no declara unidad base (data-unidad vacio), no se manda
    // blanco/stale: se fuerza 'unidad', que es como el backend interpreta NULL.
    let unidad = (unidadInput.value || '').trim();
    if (!unidad) {
        unidad = (materialSelect.selectedOptions[0]?.dataset.unidad || '').trim() || 'unidad';
        unidadInput.value = unidad;
    }
    showRecetaError('');
    if (!inventarioId) { showRecetaError('Elegí un material.'); return; }
    if (!(cantidad > 0)) { showRecetaError('Ingresá una cantidad mayor a 0.'); return; }
    try {
        await fetchAPI(`/catalogo/${servicioId}/recetas`, {
            method: 'POST',
            body: JSON.stringify({ inventario_id: inventarioId, cantidad, unidad_medida: unidad }),
        });
        document.getElementById('recetaMaterialSelect').value = '';
        document.getElementById('recetaMaterialCantidad').value = '';
        await cargarRecetas(servicioId);
    } catch (err) {
        if (/ya está en la receta|ya esta en la receta|409/i.test(err.message)) {
            showRecetaError('Ese material ya está en la receta');
        } else {
            showRecetaError('Error: ' + err.message);
        }
    }
}

async function quitarReceta(recetaId) {
    try {
        await fetchAPI(`/catalogo/recetas/${recetaId}`, { method: 'DELETE' });
        const servicioId = document.getElementById('catalogoServicioId').value;
        await cargarRecetas(servicioId);
    } catch (err) {
        showRecetaError('Error al quitar: ' + err.message);
    }
}

async function actualizarRecetaCantidad(recetaId, valor) {
    const cantidad = parseFloat(valor);
    if (!(cantidad > 0)) { showRecetaError('La cantidad debe ser mayor a 0.'); return; }
    try {
        await fetchAPI(`/catalogo/recetas/${recetaId}`, {
            method: 'PUT',
            body: JSON.stringify({ cantidad }),
        });
        showRecetaError('');
    } catch (err) {
        showRecetaError('Error al actualizar: ' + err.message);
    }
}

function wireRecetaUI() {
    if (recetaWired) return;
    const section = document.getElementById('catalogoRecetaSection');
    if (!section) return;
    recetaWired = true;

    document.getElementById('btnAgregarReceta')?.addEventListener('click', agregarReceta);

    const lista = document.getElementById('catalogoRecetaLista');
    lista?.addEventListener('click', (e) => {
        const btn = e.target.closest('.receta-quitar');
        if (!btn) return;
        const row = btn.closest('[data-receta-id]');
        if (row) quitarReceta(row.dataset.recetaId);
    });
    lista?.addEventListener('change', (e) => {
        const inp = e.target.closest('.receta-cantidad');
        if (!inp) return;
        const row = inp.closest('[data-receta-id]');
        if (row) actualizarRecetaCantidad(row.dataset.recetaId, inp.value);
    });

    document.getElementById('recetaMaterialSelect')?.addEventListener('change', (e) => {
        const unidad = (e.target.selectedOptions[0]?.dataset.unidad || '').trim();
        // Material sin unidad declarada -> 'unidad' (no dejar el valor previo pegado).
        document.getElementById('recetaMaterialUnidad').value = unidad || 'unidad';
    });
}

export async function abrirModalServicio(id = null) {
    document.getElementById('catalogoServicioId').value = '';
    document.getElementById('formCatalogoServicio').reset();
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar Servicio' : 'Nuevo Servicio';

    const recetaSection = document.getElementById('catalogoRecetaSection');
    showRecetaError('');

    // Tarea 08: alta -> precio editable por cualquiera; edición -> solo admin.
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
        // La receta solo existe para un servicio ya persistido.
        wireRecetaUI();
        if (recetaSection) recetaSection.hidden = false;
        cargarMaterialesSelect();
        cargarRecetas(id);
    } else if (recetaSection) {
        recetaSection.hidden = true;
        const lista = document.getElementById('catalogoRecetaLista');
        if (lista) lista.innerHTML = '';
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
            // Tarea 08: motivo opcional del cambio de precio (solo lo ve el admin).
            const motivo = document.getElementById('catalogoMotivo')?.value.trim();
            if (motivo) payload.motivo = motivo;
            await fetchAPI(`/catalogo/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showNotification('Servicio actualizado', 'success');
        } else {
            await fetchAPI('/catalogo', { method: 'POST', body: JSON.stringify(payload) });
            showNotification('Servicio creado', 'success');
        }
        closeModal('modalCatalogoServicio');
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
