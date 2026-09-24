// sections/inventario.js — inventario de productos / stock.
// Tarea 07 slice C: soporte de materiales fraccionados (tipo_item, unidad_medida,
// contenido_por_envase, merma_al_abrir) y presentación de stock decimal.

import { fetchAPI } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal, escapeHtml, escapeJsAttr } from '../core/ui.js';
import { abrirHistorialPrecios, gatePrecioInput } from './historial-precios.js';

// Abre el panel "Historial de precios" (Tarea 08) para un material/producto.
// Expuesto en window por app.js; lo llama el onclick de la fila.
export const abrirHistorialProducto = (id, nombre) =>
    abrirHistorialPrecios({ tipo: 'inventario', id, nombre });

// Formato numérico es-AR: coma decimal, punto de miles.
const fmtNum = (n) => Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });

// Presentación humana del stock de una fila de inventario.
// - Con contenido_por_envase > 0: "<N env.> · <stock> <unidad>" (ej. "2,5 env. · 2.500 ml").
// - Sin envase: "<stock> <unidad|'u'>".
export const formatStockDisplay = (p) => {
    const stock = Number(p.stock_actual);
    const envase = Number(p.contenido_por_envase);
    if (envase > 0) {
        const unidad = p.unidad_medida || '';
        return `${fmtNum(stock / envase)} env. · ${fmtNum(stock)} ${unidad}`.trim();
    }
    return `${fmtNum(stock)} ${p.unidad_medida || 'u'}`;
};

// Muestra/oculta los campos de material según el tipo de ítem elegido.
// scope: 'prod' (alta) | 'editProd' (edición).
const toggleMaterialFields = (scope) => {
    const esMaterial = document.getElementById(`${scope}TipoItem`)?.value === 'MATERIAL';
    const unidadGroup = document.getElementById(`${scope}MaterialUnidadGroup`);
    const envaseRow = document.getElementById(`${scope}MaterialEnvaseRow`);
    if (unidadGroup) unidadGroup.hidden = !esMaterial;
    if (envaseRow) envaseRow.hidden = !esMaterial;
};

const wireMaterialToggles = () => {
    document.getElementById('prodTipoItem')?.addEventListener('change', () => toggleMaterialFields('prod'));
    document.getElementById('editProdTipoItem')?.addEventListener('change', () => toggleMaterialFields('editProd'));
};

// Los módulos se cargan con `defer`: el DOM ya está listo al evaluarse.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireMaterialToggles);
} else {
    wireMaterialToggles();
}

// Tarea 11 (revisión de bocetos): pill de categoría activa. '' = Todos;
// '__bajo_minimo__' es la pill sintética que reemplaza al viejo botón
// "Bajo Stock" (que duplicaba todo el renderizado en app.js contra una
// tabla de 7 columnas que ya no existe).
let categoriaActiva = '';
let pillsWired = false;

const esBajoMinimo = (p) => Number(p.stock_actual) <= Number(p.stock_minimo);
// "Por reponer": entre el mínimo y un 30% por encima (boceto Insumos.html:
// "stock entre el mínimo y el 30%"). No cuenta lo que ya está bajo mínimo.
const esPorReponer = (p) => {
    const actual = Number(p.stock_actual);
    const minimo = Number(p.stock_minimo);
    return actual > minimo && actual <= minimo * 1.3;
};

const renderPills = (productos) => {
    const cont = document.getElementById('invCategoriaPills');
    if (!cont) return;
    const categorias = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();
    const pillHtml = (valor, etiqueta) =>
        `<button type="button" class="rp-pill${valor === categoriaActiva ? ' rp-pill--active' : ''}" data-cat="${escapeHtml(valor === '__bajo_minimo__' ? '__bajo_minimo__' : (valor || ''))}">${escapeHtml(etiqueta)}</button>`;
    cont.innerHTML = [
        pillHtml('', 'Todos'),
        ...categorias.map(c => pillHtml(c, c)),
        pillHtml('__bajo_minimo__', 'Bajo mínimo'),
    ].join('');
    if (!pillsWired) {
        cont.addEventListener('click', (e) => {
            const btn = e.target.closest('.rp-pill');
            if (!btn) return;
            categoriaActiva = btn.dataset.cat;
            loadInventario(document.getElementById('searchInventario')?.value || '');
        });
        pillsWired = true;
    }
};

const renderKpis = (todos) => {
    // GET /inventario/ ya filtra activo==True en el backend (sin parametro
    // solo_activos) -- 'todos' acá ya es 'todos los activos', no hace falta
    // volver a filtrar.
    const activos = todos;
    const categoriasActivas = new Set(activos.map(p => p.categoria).filter(Boolean));
    const bajoMinimo = activos.filter(esBajoMinimo);
    const porReponer = activos.filter(esPorReponer);
    const valorInventario = activos.reduce((acc, p) => acc + Number(p.stock_actual) * (p.precio_unitario || 0), 0);

    document.getElementById('invKpiActivos').textContent = activos.length.toLocaleString('es-AR');
    document.getElementById('invKpiActivosSub').textContent = `en ${categoriasActivas.size} categoría${categoriasActivas.size === 1 ? '' : 's'}`;

    document.getElementById('invKpiBajoMinimo').textContent = bajoMinimo.length.toLocaleString('es-AR');
    document.getElementById('invKpiBajoMinimo').className = `rp-kpi-value${bajoMinimo.length > 0 ? ' rp-kpi-value--down' : ''}`;
    document.getElementById('invKpiBajoMinimoSub').textContent = bajoMinimo.length === 1 ? bajoMinimo[0].nombre : (bajoMinimo.length === 0 ? 'nada por debajo del mínimo' : `${bajoMinimo.length} materiales`);

    document.getElementById('invKpiPorReponer').textContent = porReponer.length.toLocaleString('es-AR');
    document.getElementById('invKpiPorReponerSub').textContent = 'stock entre el mínimo y +30%';

    document.getElementById('invKpiValor').textContent = `$ ${valorInventario.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
};

export const loadInventario = async (filtro = '') => {
    const tbody = document.getElementById('inventarioTableBody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Cargando...</td></tr>';

    try {
        const todos = await fetchAPI('/inventario/?limit=2000');
        renderKpis(todos);
        renderPills(todos);

        let productos = todos;
        if (categoriaActiva === '__bajo_minimo__') {
            productos = productos.filter(esBajoMinimo);
        } else if (categoriaActiva) {
            productos = productos.filter(p => p.categoria === categoriaActiva);
        }

        if (filtro) {
            const q = filtro.toLowerCase();
            productos = productos.filter(p =>
                p.nombre.toLowerCase().includes(q) ||
                p.codigo.toLowerCase().includes(q) ||
                (p.categoria && p.categoria.toLowerCase().includes(q))
            );
        }

        if (productos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">No se encontraron materiales.</td></tr>';
            return;
        }

        tbody.innerHTML = productos.map(p => {
            const stockActual = Number(p.stock_actual);
            const stockMinimo = Number(p.stock_minimo);
            const bajStock = esBajoMinimo(p);
            const vencimiento = p.fecha_vencimiento ? new Date(p.fecha_vencimiento).toLocaleDateString() : null;
            const vencido = vencimiento && new Date(p.fecha_vencimiento) < new Date();
            // % sobre el mínimo (no "% del máximo" del boceto: no hay campo
            // de stock objetivo/máximo en el modelo). Se tapa en 100% para
            // que la barra no se salga del contenedor con stock muy alto.
            const pctMinimo = stockMinimo > 0 ? Math.min(100, (stockActual / stockMinimo) * 100) : (stockActual > 0 ? 100 : 0);
            const barColor = bajStock ? 'var(--accent)' : (esPorReponer(p) ? 'var(--warning)' : 'var(--primary)');
            const tipoPill = p.tipo_item === 'MATERIAL' ? 'Material' : 'Producto';
            return `
            <tr>
                <td class="rp-num" style="color:var(--text-secondary);">${escapeHtml(p.codigo)}</td>
                <td>
                    <div style="font-weight:500; color:var(--text-primary);">${escapeHtml(p.nombre)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(formatStockDisplay(p))} · ${tipoPill}${vencimiento ? ` · vence ${escapeHtml(vencimiento)}` : ''}</div>
                </td>
                <td><span class="av-pill">${escapeHtml(p.categoria || '—')}</span></td>
                <td class="rp-num" style="font-weight:500;">${fmtNum(stockActual)} <span style="font-size:11.5px; color:var(--text-muted); font-weight:400;">${escapeHtml(p.unidad_medida || '')}</span></td>
                <td>
                    <div class="rp-progress" style="width:88px;"><div class="rp-progress-fill" style="width:${pctMinimo.toFixed(0)}%; background:${barColor};"></div></div>
                    <span style="font-size:11px; color:var(--text-muted);">${pctMinimo.toFixed(0)}% del mínimo</span>
                </td>
                <td class="rp-num" style="color:var(--text-secondary);">$ ${(p.precio_unitario || 0).toFixed(2)}</td>
                <td>${bajStock
                    ? `<span class="av-pill av-pill--warn">Bajo mínimo</span>`
                    : (vencido ? `<span class="av-pill av-pill--warn">Vencido</span>` : `<span class="av-pill av-pill--ok">Disponible</span>`)}</td>
                <td style="text-align:right;">
                    <div class="row-actions">
                        <button class="av-btn" style="height:28px; padding:0 8px; font-size:11.5px;" onclick="abrirMovimientoStock(${p.id}, '${escapeJsAttr(p.nombre)}', ${stockActual})" title="Ajustar stock" aria-label="Ajustar stock">${ICONS.box}</button>
                        <button class="av-btn btn-historial-precios" style="height:28px; padding:0 8px; font-size:11.5px;" onclick="abrirHistorialProducto(${p.id}, '${escapeJsAttr(p.nombre)}')" title="Historial de precios" aria-label="Historial de precios">${ICONS.dollar}</button>
                        <button class="av-btn" style="height:28px; padding:0 8px; font-size:11.5px;" onclick="abrirEditarProducto(${p.id})" title="Editar" aria-label="Editar">${ICONS.edit}</button>
                        <button class="av-btn" style="height:28px; padding:0 8px; font-size:11.5px; color:var(--accent); border-color:var(--accent);" onclick="confirmarEliminarProducto(${p.id}, '${escapeJsAttr(p.nombre)}')" title="Desactivar" aria-label="Desactivar">${ICONS.trash}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        const badge = document.getElementById('badgeStock');
        if (badge) {
            const lowStock = todos.filter(p => p.activo && esBajoMinimo(p)).length;
            badge.textContent = lowStock > 0 ? lowStock : '';
        }

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color:var(--accent);">Error: ${error.message}</td></tr>`;
    }
};

export const handleProductoSubmit = async (e) => {
    e.preventDefault();
    try {
        const codigoInput = document.getElementById('prodCodigo').value.trim();
        const tipoItem = document.getElementById('prodTipoItem')?.value || 'PRODUCTO';
        const esMaterial = tipoItem === 'MATERIAL';
        const unidadMedida = document.getElementById('prodUnidadMedida')?.value || '';
        const contenidoRaw = document.getElementById('prodContenidoEnvase')?.value ?? '';
        const data = {
            codigo: codigoInput || `PROD-${Date.now()}`,
            nombre: document.getElementById('prodNombre').value,
            descripcion: document.getElementById('prodDescripcion').value || null,
            categoria: document.getElementById('prodTipo').value,
            stock_actual: parseFloat(document.getElementById('prodStock').value),
            stock_minimo: parseFloat(document.getElementById('prodMinimo').value),
            precio_unitario: parseFloat(document.getElementById('prodPrecio').value) || 0,
            fecha_vencimiento: document.getElementById('prodVencimiento').value || null,
            proveedor: document.getElementById('prodProveedor').value || null,
            tipo_item: tipoItem,
            unidad_medida: esMaterial && unidadMedida ? unidadMedida : null,
            contenido_por_envase: esMaterial && contenidoRaw !== '' ? parseFloat(contenidoRaw) : null,
            merma_al_abrir: esMaterial ? !!document.getElementById('prodMermaAlAbrir')?.checked : false,
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
        document.getElementById('editProdTipoItem').value = p.tipo_item || 'PRODUCTO';
        document.getElementById('editProdUnidadMedida').value = p.unidad_medida || '';
        document.getElementById('editProdContenidoEnvase').value = p.contenido_por_envase ?? '';
        document.getElementById('editProdMermaAlAbrir').checked = !!p.merma_al_abrir;
        toggleMaterialFields('editProd');
        // Tarea 08: solo un admin puede cambiar el precio; el resto lo ve bloqueado.
        gatePrecioInput({ inputId: 'editProdPrecio', hintId: 'editProdPrecioHint', motivoGroupId: 'editProdMotivoGroup' });
        openModal('modalEditarProducto');
    } catch (error) {
        alert('Error al cargar producto: ' + error.message);
    }
};

export const handleEditarProductoSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editProdId').value;
    try {
        const tipoItem = document.getElementById('editProdTipoItem')?.value || 'PRODUCTO';
        const esMaterial = tipoItem === 'MATERIAL';
        const unidadMedida = document.getElementById('editProdUnidadMedida')?.value || '';
        const contenidoRaw = document.getElementById('editProdContenidoEnvase')?.value ?? '';
        const data = {
            nombre: document.getElementById('editProdNombre').value,
            descripcion: document.getElementById('editProdDescripcion').value || null,
            categoria: document.getElementById('editProdTipo').value,
            stock_minimo: parseFloat(document.getElementById('editProdMinimo').value),
            precio_unitario: parseFloat(document.getElementById('editProdPrecio').value) || 0,
            fecha_vencimiento: document.getElementById('editProdVencimiento').value || null,
            proveedor: document.getElementById('editProdProveedor').value || null,
            tipo_item: tipoItem,
            unidad_medida: esMaterial && unidadMedida ? unidadMedida : null,
            contenido_por_envase: esMaterial && contenidoRaw !== '' ? parseFloat(contenidoRaw) : null,
            merma_al_abrir: esMaterial ? !!document.getElementById('editProdMermaAlAbrir')?.checked : false,
        };
        // Tarea 08: motivo opcional del cambio de precio (solo lo ve el admin).
        const motivo = document.getElementById('editProdMotivo')?.value.trim();
        if (motivo) data.motivo = motivo;
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
    document.getElementById('movStockActual').textContent = fmtNum(stockActual);
    document.getElementById('movStockCantidad').value = '';
    document.getElementById('movStockTipo').value = 'ENTRADA';
    openModal('modalMovimientoStock');
};

export const handleMovimientoStockSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('movStockProdId').value;
    const cantidad = parseFloat(document.getElementById('movStockCantidad').value);
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
