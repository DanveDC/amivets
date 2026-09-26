// sections/facturacion.js — facturación, abonos y previews de factura.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// Los listeners de nivel superior (submit de abono, buscador, filtro, pestañas
// y el click en .nav-link[data-target="sec-facturacion"]) se mantienen a nivel
// de módulo: corren una sola vez al cargar el módulo.

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal, escapeHtml } from '../core/ui.js';

// ============ FACTURACIÓN LOGIC ============
// orden-servicio-carrito, decisión 8: se quitó el cobro por consulta y su
// modal de ítems pendientes -- facturar es por orden (ver
// cargarOrdenesPorCobrar más abajo: "Cobrar" abre la orden vía
// window.abrirOrden, y #modalFacturarOrden en orden-abierta.js factura con
// POST /ordenes/{id}/facturar).

export const exportarFacturaPDF = async (facturaId) => {
    try {
        const token = localStorage.getItem('token');
        showNotification('Generando PDF...', 'info');
        const response = await fetch(`${API_BASE_URL}/facturas/${facturaId}/pdf`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error("Error al comunicarse con el servidor");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Factura_${facturaId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        alert('Hubo un problema descargando el PDF: ' + e.message);
    }
};

// ── ABONOS ───────────────────────────────────────────────────────────────────

export const exportarAbonoPDF = async (facturaId, abonoId) => {
    try {
        const token = localStorage.getItem('token');
        showNotification('Generando comprobante...', 'info');
        const response = await fetch(`${API_BASE_URL}/facturas/${facturaId}/abonos/${abonoId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Error al generar el PDF');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `abono-${abonoId}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        alert('Error descargando comprobante: ' + e.message);
    }
};

export const abrirModalAbono = (facturaId, saldoPendiente) => {
    document.getElementById('abonoFacturaId').value = facturaId;
    document.getElementById('abonoSaldoPendiente').textContent = `$${parseFloat(saldoPendiente).toFixed(2)}`;
    document.getElementById('abonoMonto').max = parseFloat(saldoPendiente).toFixed(2);
    document.getElementById('abonoMonto').value = '';
    document.getElementById('abonoMetodoPago').value = 'EFECTIVO';
    document.getElementById('abonoNotas').value = '';
    openModal('modal-abono');
};

document.getElementById('form-abono')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const facturaId = document.getElementById('abonoFacturaId').value;
    const monto = parseFloat(document.getElementById('abonoMonto').value);
    const metodoPago = document.getElementById('abonoMetodoPago').value;
    const notas = document.getElementById('abonoNotas').value.trim() || null;

    if (!monto || monto <= 0) { alert('El monto debe ser mayor a 0.'); return; }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE_URL}/facturas/${facturaId}/abonar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ monto, metodo_pago: metodoPago, notas })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Error registrando abono');
        }
        showNotification('Abono registrado con éxito.', 'success');
        closeModal('modal-abono');
        cargarHistorialFacturas();
        // Refresh the preview modal with updated data
        abrirPreviewFactura(parseInt(facturaId));
    } catch (err) {
        alert('Error: ' + err.message);
    }
});

export const abrirPreviewFactura = async (facturaId) => {
    try {
        const [factura, abonos] = await Promise.all([
            fetchAPI(`/facturas/${facturaId}`),
            fetchAPI(`/facturas/${facturaId}/abonos`).catch(() => [])
        ]);

        document.getElementById('previewFacturaNumero').textContent = `(#${factura.numero_factura || factura.id})`;
        document.getElementById('previewFacturaFecha').textContent = new Date(factura.fecha_emision).toLocaleDateString();
        document.getElementById('previewFacturaEstado').textContent = factura.estado;
        document.getElementById('previewFacturaMetodo').textContent = factura.metodo_pago || '-';
        document.getElementById('previewFacturaConsulta').textContent = factura.consulta_id ? `Consulta #${factura.consulta_id}` : 'General';

        const tbody = document.getElementById('previewFacturaItems');
        let totalC = 0;
        tbody.innerHTML = factura.detalles.map(d => {
            totalC += d.subtotal;
            return `
            <tr>
                <td>${d.descripcion || 'Ítem Médico'}</td>
                <td>${d.cantidad}</td>
                <td>$${d.precio_unitario.toFixed(2)}</td>
                <td style="text-align: right; font-weight: 500;">$${d.subtotal.toFixed(2)}</td>
            </tr>`;
        }).join('');

        document.getElementById('previewFacturaSubtotal').textContent = `$${factura.subtotal.toFixed(2)}`;
        document.getElementById('previewFacturaTotal').textContent = `$${factura.total.toFixed(2)}`;

        const btnD = document.getElementById('btnDescargarPreviewFactura');
        btnD.onclick = () => exportarFacturaPDF(factura.id);

        // ── Abonos section ────────────────────────────────────────────────────
        const totalFactura = parseFloat(factura.total || 0);
        const totalAbonado = Array.isArray(abonos)
            ? abonos.reduce((sum, a) => sum + parseFloat(a.monto || 0), 0)
            : parseFloat(factura.total_pagado || 0);
        const saldo = Math.max(0, totalFactura - totalAbonado);

        // Remove previous abono section if exists
        const prevSection = document.getElementById('previewAbonosSection');
        if (prevSection) prevSection.remove();

        const modalContent = document.querySelector('#modalPreviewFactura .modal-content');
        const modalFooter = document.querySelector('#modalPreviewFactura .modal-footer');

        const abonosSection = document.createElement('div');
        abonosSection.id = 'previewAbonosSection';
        abonosSection.style.cssText = 'padding: 0 2.5rem 1.5rem;';

        const abonosHTML = Array.isArray(abonos) && abonos.length > 0
            ? `<div style="overflow-x:auto; border-radius:8px; border:1px solid var(--border);">
                <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
                    <thead style="background:var(--surface-hover);">
                        <tr>
                            <th style="padding:0.6rem 0.75rem; text-align:left; color:var(--text-secondary); font-weight:600;">#</th>
                            <th style="padding:0.6rem 0.75rem; text-align:left; color:var(--text-secondary); font-weight:600;">Fecha</th>
                            <th style="padding:0.6rem 0.75rem; text-align:right; color:var(--text-secondary); font-weight:600;">Monto</th>
                            <th style="padding:0.6rem 0.75rem; text-align:left; color:var(--text-secondary); font-weight:600;">Método</th>
                            <th style="padding:0.6rem 0.75rem; text-align:left; color:var(--text-secondary); font-weight:600;">Notas</th>
                            <th style="padding:0.6rem 0.75rem; text-align:center; color:var(--text-secondary); font-weight:600;">Comprobante</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${abonos.map((a, i) => `
                        <tr style="border-top:1px solid var(--border-light);">
                            <td style="padding:0.6rem 0.75rem;">${i + 1}</td>
                            <td style="padding:0.6rem 0.75rem;">${a.fecha ? new Date(a.fecha).toLocaleDateString() : '-'}</td>
                            <td class="num" style="padding:0.6rem 0.75rem; font-weight:600; color:var(--secondary);">$${parseFloat(a.monto).toFixed(2)}</td>
                            <td style="padding:0.6rem 0.75rem;">${a.metodo_pago || '-'}</td>
                            <td style="padding:0.6rem 0.75rem; color:var(--text-secondary); font-size:0.8rem;">${a.notas || '-'}</td>
                            <td style="padding:0.6rem 0.75rem; text-align:center;">
                                <button onclick="exportarAbonoPDF(${facturaId}, ${a.id})" class="btn-secondary btn-sm" style="padding:0.2rem 0.5rem; font-size:0.78rem;">PDF</button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
               </div>`
            : '<p style="color:var(--text-muted); font-size:0.875rem; margin:0.5rem 0;">No hay abonos registrados.</p>';

        abonosSection.innerHTML = `
            <h3 style="font-size:0.95rem; font-weight:700; color:var(--text-primary); margin-bottom:0.75rem;">Pagos registrados</h3>
            ${abonosHTML}
            <div style="display:flex; gap:2rem; margin-top:1rem; padding:1rem; background:var(--surface-hover); border-radius:8px; border:1px solid var(--border); font-size:0.9rem;">
                <div><span style="color:var(--text-secondary);">Total:</span> <strong>$${totalFactura.toFixed(2)}</strong></div>
                <div><span style="color:var(--text-secondary);">Pagado:</span> <strong style="color:var(--secondary);">$${totalAbonado.toFixed(2)}</strong></div>
                <div><span style="color:var(--text-secondary);">Saldo:</span> <strong style="color:${saldo > 0 ? 'var(--warning-dark)' : 'var(--secondary)'};">$${saldo.toFixed(2)}</strong></div>
            </div>
            ${saldo > 0 ? `<div style="margin-top:0.75rem; text-align:right;"><button onclick="abrirModalAbono(${facturaId}, ${saldo})" class="btn-primary" style="background:var(--secondary); border-color:var(--secondary-dark);">+ Registrar Abono</button></div>` : ''}
        `;

        modalContent.insertBefore(abonosSection, modalFooter);
        // ─────────────────────────────────────────────────────────────────────

        openModal('modalPreviewFactura');
    } catch (e) {
        alert("Error cargando la vista previa: " + e.message);
    }
};

// ── Órdenes por cobrar (orden-servicio-carrito, decisión 8) ──────────────────
// Vista POR DEFECTO de Facturación: las órdenes CERRADA a la espera de cobro
// (el router.js prometía "Abre las órdenes por cobrar" desde antes de que
// existiera esta vista — ver proposal.md). El historial de facturas queda
// como vista secundaria (pestaña "Historial", _mostrarVistaFacturacion).
const LIMITE_POR_COBRAR = 200;

export const cargarOrdenesPorCobrar = async () => {
    const tbody = document.getElementById('facOrdenesBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Cargando…</td></tr>';
    try {
        // por_cobrar: solo CERRADA con algo pendiente de facturar -- una orden
        // cerrada sin nada que cobrar no puede salir de la lista (fix de revisión).
        const ordenes = await fetchAPI(`/ordenes/?por_cobrar=true&limit=${LIMITE_POR_COBRAR}`);
        if (!ordenes || ordenes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No hay órdenes cerradas esperando cobro.</td></tr>';
            return;
        }
        const aviso = ordenes.length >= LIMITE_POR_COBRAR
            ? `<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding:0.75rem;">Se muestran las ${LIMITE_POR_COBRAR} órdenes más recientes; buscá una más vieja por su número con la búsqueda global.</td></tr>`
            : '';
        tbody.innerHTML = aviso + ordenes.map(o => {
            const fecha = o.fecha_cierre || o.fecha_apertura;
            return `
            <tr>
                <td><b>${escapeHtml(o.numero)}</b></td>
                <td>${escapeHtml(o.propietario_nombre || '—')}</td>
                <td>${escapeHtml(o.mascota_nombre || 'Sin paciente')}</td>
                <td>${fecha ? new Date(fecha).toLocaleDateString() : '—'}</td>
                <td class="num"><b>$${parseFloat(o.total || 0).toFixed(2)}</b></td>
                <td style="text-align:right;">
                    <button class="btn-primary btn-sm" onclick="abrirOrden(${o.id})" style="padding:0.4rem 0.75rem; font-size:0.8rem; background: var(--secondary); border-color: var(--secondary-dark); color:#fff; border-radius:6px;">${ICONS.dollar} Cobrar</button>
                </td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('Error cargando órdenes por cobrar:', e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--accent);">Error cargando.</td></tr>';
    }
};

// Toggle entre las dos vistas de la sección (sin sub-router: son dos <div>
// hermanos, mismo criterio que otras secciones con pestañas internas del
// front, ej. bandeja-gestor.js).
const _mostrarVistaFacturacion = (vista) => {
    const viewOrdenes = document.getElementById('facViewOrdenes');
    const viewHistorial = document.getElementById('facViewHistorial');
    const tabOrdenes = document.getElementById('facTabOrdenes');
    const tabHistorial = document.getElementById('facTabHistorial');
    if (viewOrdenes) viewOrdenes.hidden = vista !== 'ordenes';
    if (viewHistorial) viewHistorial.hidden = vista !== 'historial';
    if (tabOrdenes) tabOrdenes.setAttribute('aria-pressed', String(vista === 'ordenes'));
    if (tabHistorial) tabHistorial.setAttribute('aria-pressed', String(vista === 'historial'));
    if (vista === 'ordenes') cargarOrdenesPorCobrar();
    else cargarHistorialFacturas();
};

document.getElementById('facTabOrdenes')?.addEventListener('click', () => _mostrarVistaFacturacion('ordenes'));
document.getElementById('facTabHistorial')?.addEventListener('click', () => _mostrarVistaFacturacion('historial'));

// initFn de la sección (router.js): Facturación abre en "Órdenes por cobrar",
// no en el historial (decisión 8).
export const initFacturacion = () => _mostrarVistaFacturacion('ordenes');

const ESTADO_FACTURA_COLORS = {
    PAGADA: { bg: 'var(--secondary-subtle)', fg: 'var(--secondary-dark)' },
    ANULADA: { bg: 'var(--accent-subtle)', fg: 'var(--accent-dark)' },
    PARCIAL: { bg: 'var(--info-subtle)', fg: 'var(--info-dark)' },
    PENDIENTE: { bg: 'var(--warning-subtle)', fg: 'var(--warning-dark)' }
};

export const cargarHistorialFacturas = async () => {
    const tableBody = document.getElementById('facturacionTableBody');
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Cargando...</td></tr>';
    try {
        const queryParams = new URLSearchParams();
        const searchVal = document.getElementById('searchFactura')?.value;
        const estadoFilter = document.getElementById('filterEstadoFactura')?.value;

        if (searchVal) queryParams.append('search', searchVal);
        if (estadoFilter) queryParams.append('estado', estadoFilter);

        const result = await fetchAPI(`/facturas/?${queryParams.toString()}`);
        if (!result || result.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No se encontraron facturas.</td></tr>';
            return;
        }

        tableBody.innerHTML = result.map(f => {
            const total = f.total !== undefined ? f.total : (f.total_pagado || 0);
            const numero = f.numero_factura || f.id;
            const fecha = f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '-';
            const estado = f.estado || 'PENDIENTE';
            const metodo = f.metodo_pago || '-';
            const pagado = f.total_pagado || 0;
            const saldo = f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : Math.max(0, total - pagado);
            const colors = ESTADO_FACTURA_COLORS[estado] || ESTADO_FACTURA_COLORS.PENDIENTE;

            return `
            <tr>
                <td><b>#${numero}</b></td>
                <td>${fecha}</td>
                <td><span class="status-pill" style="padding: 2px 6px; border-radius: 4px; background: ${colors.bg}; color: ${colors.fg};">${estado}</span></td>
                <td class="num"><b>$${parseFloat(total).toFixed(2)}</b></td>
                <td class="num">$${parseFloat(pagado).toFixed(2)}</td>
                <td class="num"><b style="color: ${saldo > 0 ? 'var(--warning-dark)' : 'var(--text-primary)'};">$${parseFloat(saldo).toFixed(2)}</b></td>
                <td><span style="font-size: 0.85rem; color: var(--text-secondary);">${metodo}</span></td>
                <td style="text-align: right;">
                    <div class="row-actions">
                        ${(estado === 'PENDIENTE' || estado === 'PARCIAL') ? `<button class="btn-primary btn-sm" onclick="abrirModalAbono(${f.id}, ${saldo})" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: var(--secondary); border-color: var(--secondary-dark); color: #fff; border-radius: 6px;">${ICONS.dollar} Abonar</button>` : ''}
                        <button class="btn-primary btn-sm" onclick="abrirPreviewFactura(${f.id})" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: var(--primary); border: none; color: #fff; border-radius: 6px;">${ICONS.fileText} Ver PDF</button>
                        ${f.consulta_id ? `<button class="btn-secondary btn-sm" onclick="verConsultaCompleta(${f.consulta_id})" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; border-radius: 6px;">Consulta</button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error("Error cargando historial de facturacion:", e);
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--accent);">Error loading.</td></tr>';
    }
};

export const cargarFacturasMascota = async (mascotaId) => {
    const tableBody = document.getElementById('petFacturasTableBody');
    if (!tableBody) return;

    try {
        const facturas = await fetchAPI(`/facturas/mascota/${mascotaId}`);
        if (!facturas || facturas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay facturas registradas para esta mascota.</td></tr>';
            return;
        }

        tableBody.innerHTML = facturas.map(f => {
            const total = f.total !== undefined ? f.total : (f.total_pagado || 0);
            const numero = f.numero_factura || f.id;
            const fecha = f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '-';
            const estado = f.estado || 'PENDIENTE';

            return `
            <tr>
                <td><b>#${numero}</b></td>
                <td>${fecha}</td>
                <td><span class="status-pill" style="padding: 2px 6px; border-radius: 4px; background: ${estado==='PAGADA'?'var(--secondary-subtle)':(estado==='ANULADA'?'var(--accent-subtle)':'var(--warning-subtle)')}; color: ${estado==='PAGADA'?'var(--secondary-dark)':(estado==='ANULADA'?'var(--accent-dark)':'var(--warning-dark)')};">${estado}</span></td>
                <td class="num"><b>$${parseFloat(total).toFixed(2)}</b></td>
                <td>
                    <button class="btn-primary btn-sm" onclick="abrirPreviewFactura(${f.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: var(--primary); border: none; color: #fff;">${ICONS.fileText} PDF</button>
                </td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error("Error cargando facturas de mascota:", e);
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--accent);">Error cargando datos.</td></tr>';
    }
};

document.getElementById('searchFactura')?.addEventListener('input', (e) => {
    clearTimeout(window.searchFacturaTimeout);
    window.searchFacturaTimeout = setTimeout(() => cargarHistorialFacturas(), 500);
});

document.getElementById('filterEstadoFactura')?.addEventListener('change', cargarHistorialFacturas);

// `.nav-link[data-target=…]` es del shell viejo de pestañas planas (pre
// etapa 7); ya no hay ningún `.nav-link` en el DOM del shell actual (barra
// lateral, core/router.js), así que este listener nunca dispara. Se deja tal
// cual -- no forma parte de este cambio -- el wiring real es router.js
// (`init: initFacturacion` en SECTIONS).
document.querySelector('.nav-link[data-target="sec-facturacion"]')?.addEventListener('click', () => {
    cargarHistorialFacturas();
});

export { initFacturacion as init };
