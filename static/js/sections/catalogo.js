// sections/catalogo.js — catálogo de servicios.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.

import { fetchAPI } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal } from '../core/ui.js';

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
                        ${s.activo ? `<button onclick="desactivarServicio(${s.id})" class="btn-secondary btn-sm btn-row-danger" style="font-size:0.8rem;">Desact.</button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--accent);">Error: ${err.message}</td></tr>`;
    }
}

export async function abrirModalServicio(id = null) {
    document.getElementById('catalogoServicioId').value = '';
    document.getElementById('formCatalogoServicio').reset();
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar Servicio' : 'Nuevo Servicio';

    if (id) {
        try {
            const s = await fetchAPI(`/catalogo/${id}`);
            document.getElementById('catalogoServicioId').value = s.id;
            document.getElementById('catalogoNombre').value = s.nombre;
            document.getElementById('catalogoCategoria').value = s.categoria;
            document.getElementById('catalogoPrecioRef').value = s.precio_ref;
            document.getElementById('catalogoUnidad').value = s.unidad || '';
            document.getElementById('catalogoPrecioVariable').checked = s.precio_variable;
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
