// sections/inventario.js — inventario de productos / stock.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.

import { fetchAPI } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal } from '../core/ui.js';

export const loadInventario = async (filtro = '') => {
    const tbody = document.getElementById('inventarioTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Cargando...</td></tr>';

    try {
        const categoriaFiltro = document.getElementById('filtroInventarioCategoria')?.value || '';
        const url = `/inventario/?limit=200${categoriaFiltro ? `&categoria=${encodeURIComponent(categoriaFiltro)}` : ''}`;
        let productos = await fetchAPI(url);

        // Filtro de texto local
        if (filtro) {
            const q = filtro.toLowerCase();
            productos = productos.filter(p =>
                p.nombre.toLowerCase().includes(q) ||
                p.codigo.toLowerCase().includes(q) ||
                (p.categoria && p.categoria.toLowerCase().includes(q))
            );
        }

        if (productos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No se encontraron productos.</td></tr>';
            return;
        }

        tbody.innerHTML = productos.map(p => {
            const bajStock = p.stock_actual <= p.stock_minimo;
            const vencimiento = p.fecha_vencimiento ? new Date(p.fecha_vencimiento).toLocaleDateString() : '—';
            const vencimientoStyle = p.fecha_vencimiento && new Date(p.fecha_vencimiento) < new Date() ? 'color:var(--accent); font-weight:700;' : '';
            return `
            <tr>
                <td>
                    <div style="font-weight:600; color:var(--text-primary);">${p.nombre}</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">${p.codigo}</div>
                </td>
                <td><span class="badge" style="background:var(--primary-subtle); color:var(--primary); font-size:0.75rem;">${p.categoria || '—'}</span></td>
                <td style="font-weight:700; color:${bajStock ? 'var(--accent)' : 'var(--secondary)'}">
                    ${p.stock_actual}
                    <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted);">/ min ${p.stock_minimo}</span>
                </td>
                <td class="num">$${(p.precio_unitario || 0).toFixed(2)}</td>
                <td style="${vencimientoStyle}">${vencimiento}</td>
                <td>${bajStock
                    ? `<span class="status-pill status-pill--warn">${ICONS.alertTriangle} Bajo</span>`
                    : `<span class="status-pill status-pill--ok">${ICONS.checkCircle} OK</span>`}</td>
                <td style="text-align:right;">
                    <div class="row-actions">
                        <button class="btn-secondary btn-sm" onclick="abrirMovimientoStock(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${p.stock_actual})" title="Ajustar stock" aria-label="Ajustar stock" style="font-size:0.75rem; padding:4px 8px;">${ICONS.box} Stock</button>
                        <button class="btn-secondary btn-sm" onclick="abrirEditarProducto(${p.id})" title="Editar" aria-label="Editar" style="font-size:0.75rem; padding:4px 8px;">${ICONS.edit}</button>
                        <button class="btn-secondary btn-sm btn-row-danger" onclick="confirmarEliminarProducto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}')" title="Desactivar" aria-label="Desactivar" style="font-size:0.75rem; padding:4px 8px;">${ICONS.trash}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        // Actualizar badge
        const lowStock = productos.filter(p => p.stock_actual <= p.stock_minimo).length;
        document.getElementById('badgeStock').textContent = lowStock > 0 ? lowStock : '';

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color:var(--accent);">Error: ${error.message}</td></tr>`;
    }
};

export const handleProductoSubmit = async (e) => {
    e.preventDefault();
    try {
        const codigoInput = document.getElementById('prodCodigo').value.trim();
        const data = {
            codigo: codigoInput || `PROD-${Date.now()}`,
            nombre: document.getElementById('prodNombre').value,
            descripcion: document.getElementById('prodDescripcion').value || null,
            categoria: document.getElementById('prodTipo').value,
            stock_actual: parseInt(document.getElementById('prodStock').value),
            stock_minimo: parseInt(document.getElementById('prodMinimo').value),
            precio_unitario: parseFloat(document.getElementById('prodPrecio').value) || 0,
            fecha_vencimiento: document.getElementById('prodVencimiento').value || null,
            proveedor: document.getElementById('prodProveedor').value || null
        };
        await fetchAPI('/inventario/', { method: 'POST', body: JSON.stringify(data) });
        showNotification('Producto registrado en inventario.', 'success');
        closeModal('modalProducto');
        loadInventario();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const abrirEditarProducto = async (id) => {
    try {
        const p = await fetchAPI(`/inventario/${id}`);
        document.getElementById('editProdId').value = p.id;
        document.getElementById('editProdCodigo').value = p.codigo;
        document.getElementById('editProdNombre').value = p.nombre;
        document.getElementById('editProdDescripcion').value = p.descripcion || '';
        document.getElementById('editProdTipo').value = p.categoria || '';
        document.getElementById('editProdStock').value = p.stock_actual;
        document.getElementById('editProdMinimo').value = p.stock_minimo;
        document.getElementById('editProdPrecio').value = p.precio_unitario;
        document.getElementById('editProdVencimiento').value = p.fecha_vencimiento || '';
        document.getElementById('editProdProveedor').value = p.proveedor || '';
        openModal('modalEditarProducto');
    } catch (error) {
        alert('Error al cargar producto: ' + error.message);
    }
};

export const handleEditarProductoSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editProdId').value;
    try {
        const data = {
            nombre: document.getElementById('editProdNombre').value,
            descripcion: document.getElementById('editProdDescripcion').value || null,
            categoria: document.getElementById('editProdTipo').value,
            stock_minimo: parseInt(document.getElementById('editProdMinimo').value),
            precio_unitario: parseFloat(document.getElementById('editProdPrecio').value) || 0,
            fecha_vencimiento: document.getElementById('editProdVencimiento').value || null,
            proveedor: document.getElementById('editProdProveedor').value || null
        };
        await fetchAPI(`/inventario/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showNotification('Producto actualizado.', 'success');
        closeModal('modalEditarProducto');
        loadInventario();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const abrirMovimientoStock = (id, nombre, stockActual) => {
    document.getElementById('movStockProdId').value = id;
    document.getElementById('movStockNombre').textContent = nombre;
    document.getElementById('movStockActual').textContent = stockActual;
    document.getElementById('movStockCantidad').value = '';
    document.getElementById('movStockTipo').value = 'ENTRADA';
    openModal('modalMovimientoStock');
};

export const handleMovimientoStockSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('movStockProdId').value;
    const cantidad = parseInt(document.getElementById('movStockCantidad').value);
    const tipo = document.getElementById('movStockTipo').value;
    try {
        await fetchAPI(`/inventario/${id}/movimiento?cantidad=${cantidad}&tipo=${tipo}`, { method: 'POST' });
        showNotification(`${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} de stock registrada.`, 'success');
        closeModal('modalMovimientoStock');
        loadInventario();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const confirmarEliminarProducto = async (id, nombre) => {
    if (!confirm(`¿Desactivar el producto "${nombre}" del inventario?`)) return;
    try {
        await fetchAPI(`/inventario/${id}`, { method: 'DELETE' });
        showNotification('Producto desactivado.', 'success');
        loadInventario();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export { loadInventario as init };
