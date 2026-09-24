// sections/facturacion.js — facturación, abonos y previews de factura.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// Los listeners de nivel superior (monto a pagar, submit de factura, submit de
// abono, buscador, filtro y el click en .nav-link[data-target="sec-facturacion"])
// se mantienen a nivel de módulo: corren una sola vez al cargar el módulo.
// Depende de consultorio.js (currentMascotaId / cargarConsultas / actualizarCountsPet);
// la relación es cíclica pero segura: sólo se usa dentro de handlers, nunca en la
// evaluación del módulo.

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal } from '../core/ui.js';
import { currentMascotaId, actualizarCountsPet, cargarConsultas } from './consultorio.js';

// ============ FACTURACIÓN LOGIC ============
export const facturarConsulta = async (consultaId) => {
    // Si ya estamos cargando algo, evitamos duplicidad
    if (window.loadingFactura) return;
    window.loadingFactura = true;

    document.getElementById('facturaConsultaId').value = consultaId;
    document.getElementById('facturaConsultaIdTxt').textContent = `(Consulta #${consultaId})`;

    const itemsList = document.getElementById('facturaItemsList');
    itemsList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">Calculando items y validando precios...</p>';

    try {
        // Primero intentamos abrir el modal para que el usuario vea que algo ocurre
        openModal('modalFactura');

        const dataContext = await fetchAPI(`/facturas/pendientes/${consultaId}`);
        window.loadingFactura = false;

        if (!dataContext || !dataContext.items || dataContext.items.length === 0) {
            itemsList.innerHTML = `<div style="text-align:center; padding: 2.5rem; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 1rem;">${ICONS.notePencil}</div>
                No hay cargos pendientes para facturar en esta consulta.<br>
                <small>Agregue servicios o medicamentos en el expediente clínico primero.</small>
            </div>`;
            document.getElementById('facturaTotalCalculado').textContent = '0.00';
            return;
        }

        // Auto-populate context from backend response
        document.getElementById('facturaPropietarioId').value = dataContext.propietario_id;
        document.getElementById('facturaMascotaNombre').textContent = dataContext.mascota_nombre;
        document.getElementById('facturaPropietarioNombre').textContent = dataContext.propietario_nombre;

        let total = 0;
        let html = '<table class="data-table" style="width:100%;"><thead><tr><th>Detalle</th><th>Cant.</th><th>P. Unitario</th><th>Subtotal</th></tr></thead><tbody>';

        dataContext.items.forEach(item => {
            const rowTotal = item.cantidad * item.precio_unitario;
            total += rowTotal;
            html += `
                <tr>
                    <td>${item.descripcion}</td>
                    <td>${item.cantidad}</td>
                    <td>$${item.precio_unitario.toFixed(2)}</td>
                    <td style="font-weight:bold;">$${rowTotal.toFixed(2)}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        itemsList.innerHTML = html;
        document.getElementById('facturaTotalCalculado').textContent = total.toFixed(2);

        const montoPagarInput = document.getElementById('facturaMontoPagar');
        montoPagarInput.max = total.toFixed(2);
        montoPagarInput.value = total.toFixed(2);
        document.getElementById('facturaSaldoPendienteCalculado').textContent = '0.00';

        // Save items data globally so the submit handler can use it
        // servicio_id sólo aplica a items tipo SERVICIO: para tipo CONSULTA,
        // id_interno es un Consulta.id (no un ServicioConsulta.id) -- mismo
        // criterio que facturas.py::from-consulta (es_servicio). La línea
        // CONSULTA queda igualmente anclada vía consulta_id en el payload.
        window.currentFacturaItems = dataContext.items.map(p => ({
            servicio_id: p.tipo === 'SERVICIO' ? p.id_interno : null,
            producto_id: p.producto_id || (p.tipo === 'SERVICIO' ? p.referencia_id : null),
            descripcion: p.descripcion,
            cantidad: p.cantidad,
            precio_unitario: p.precio_unitario,
            subtotal: p.subtotal
        }));
        window.currentFacturaTotal = total;

        // openModal('modalFactura'); // Already opened above
    } catch (e) {
        window.loadingFactura = false;
        alert("Error cargando detalles para facturar: " + e.message);
    }
};

document.getElementById('facturaMontoPagar')?.addEventListener('input', (e) => {
    const total = window.currentFacturaTotal || 0;
    const monto = parseFloat(e.target.value) || 0;
    const saldo = Math.max(0, total - monto);
    document.getElementById('facturaSaldoPendienteCalculado').textContent = saldo.toFixed(2);
});

document.getElementById('formFactura')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.currentFacturaItems || window.currentFacturaItems.length === 0) {
        alert("No hay items para facturar.");
        return;
    }

    const total = window.currentFacturaTotal;
    const montoPagar = parseFloat(document.getElementById('facturaMontoPagar').value);

    if (isNaN(montoPagar) || montoPagar < 0 || montoPagar > total) {
        alert(`El monto a pagar debe estar entre 0 y $${total.toFixed(2)}.`);
        return;
    }

    // Validar el body de acuerdo a FacturaCreate del router
    const data = {
        propietario_id: parseInt(document.getElementById('facturaPropietarioId').value),
        consulta_id: parseInt(document.getElementById('facturaConsultaId').value),
        metodo_pago: document.getElementById('facturaMetodoPago').value,
        descuento: 0.0,
        impuesto: 0.0,
        total_pagado: montoPagar,
        es_presupuesto: false,
        detalles: window.currentFacturaItems.map(item => ({
             descripcion: item.descripcion,
             cantidad: item.cantidad,
             precio_unitario: item.precio_unitario,
             producto_id: item.producto_id,
             servicio_id: item.servicio_id
        }))
    };

    try {
        const result = await fetchAPI('/facturas/', { method: 'POST', body: JSON.stringify(data) });

        showNotification('Factura generada con éxito.', 'success');
        closeModal('modalFactura');

        // Refresh Consultation UI
        if (currentMascotaId) {
            actualizarCountsPet(currentMascotaId);
            const activeTab = document.querySelector('.pet-nav-item.active')?.dataset.tab;
            if (activeTab === 'consultas') {
                cargarConsultas(currentMascotaId);
            }
        }

        setTimeout(() => {
            if (confirm("¿Desea descargar el comprobante/PDF de la factura ahora?")) {
                exportarFacturaPDF(result.id);
            }
        }, 500);

    } catch (err) {
        alert('Error emitiendo factura: ' + err.message);
    }
});


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

document.querySelector('.nav-link[data-target="sec-facturacion"]')?.addEventListener('click', () => {
    cargarHistorialFacturas();
});

export { cargarHistorialFacturas as init };
