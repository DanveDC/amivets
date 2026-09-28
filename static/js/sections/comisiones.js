// sections/comisiones.js — comisiones por servicio (comisiones-por-servicio,
// decisión 11). Vive dentro de Informes (#liqSeccion, solo admin) y lo
// inicializa reportes.js.
//
// (a) porcentaje por defecto y comisión propia de cada encargado: FIJO,
//     PORCENTAJE o MIXTO (comision-tipo-mixto-encargado),
// (b) control por encargado y rango: pendientes, liquidadas y totales, con
//     el botón "Liquidar",
// (c) liquidaciones del encargado con su comprobante PDF.
// Sin onclick inline: los botones generados usan data-* y listeners.
// tablaLineas / totales / descargarPdf / pct se reusan en la pestaña
// "Mis comisiones" de la bandeja (pantalla-encargado).

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { showNotification, escapeHtml, submitWithLoading } from '../core/ui.js';
import { money, fechaCorta } from '../core/format.js';

let _wired = false;
let _calcularRango = null;
let _ultimoControl = null; // { encargado_id, desde, hasta }

const ROL_LABEL = { veterinario: 'Veterinario/a', gestor: 'Encargado/a de área' };
export const pct = (v) => `${Number(v).toLocaleString('es', { maximumFractionDigits: 2 })}%`;
const fecha = fechaCorta;

export const TIPO_COMISION_LABEL = { FIJO: 'Fijo', PORCENTAJE: 'Porcentaje', MIXTO: 'Mixto' };
const USA_MONTO = new Set(['FIJO', 'MIXTO']);
const USA_PCT = new Set(['PORCENTAJE', 'MIXTO', '']);

/** Texto corto de una comisión: "20%", "$50,00 fijo" o "$30,00 + 10%". */
export function describirComision(tipo, montoFijo, porcentaje) {
    if (tipo === 'FIJO') return `${money(montoFijo)} fijo`;
    if (tipo === 'MIXTO') return `${money(montoFijo)} + ${pct(porcentaje)}`;
    return pct(porcentaje ?? 0);
}

const describirEncargado = (e) => describirComision(e.tipo_comision, e.monto_fijo, e.porcentaje_efectivo);

// ── (a) Porcentajes ─────────────────────────────────────────────────────────

async function cargarConfiguracion() {
    try {
        const cfg = await fetchAPI('/comisiones/configuracion');
        const input = document.getElementById('comDefectoInput');
        if (input) input.value = Number(cfg.porcentaje_defecto);
    } catch (e) {
        showNotification('No se pudo cargar la configuración de comisiones: ' + e.message, 'error');
    }
}

async function guardarDefecto() {
    const valor = Number(document.getElementById('comDefectoInput')?.value);
    if (Number.isNaN(valor) || valor < 0 || valor > 100) {
        showNotification('El porcentaje tiene que estar entre 0 y 100.', 'warning');
        return;
    }
    try {
        await fetchAPI('/comisiones/configuracion', { method: 'PUT', body: JSON.stringify({ porcentaje_defecto: valor }) });
        showNotification('Porcentaje por defecto actualizado.', 'success');
        await cargarEncargados();
    } catch (e) {
        showNotification('No se pudo guardar: ' + e.message, 'error');
    }
}

async function cargarEncargados() {
    const body = document.getElementById('comEncargadosBody');
    const select = document.getElementById('comEncargadoSelect');
    if (!body) return;
    try {
        const lista = await fetchAPI('/comisiones/encargados');
        if (!lista.length) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary); padding: 1rem;">No hay veterinarios ni encargados de área activos.</td></tr>';
        } else {
            const campo = 'padding:0.35rem 0.5rem; border:1px solid var(--border); border-radius:6px; margin:0;';
            body.innerHTML = lista.map(e => {
                const tipo = e.tipo_comision || '';
                const nombre = escapeHtml(e.username);
                return `
                <tr>
                    <td style="padding: 0.6rem 0.75rem;">${nombre}</td>
                    <td style="padding: 0.6rem 0.75rem;">${escapeHtml(ROL_LABEL[e.role] || e.role || '')}</td>
                    <td style="padding: 0.6rem 0.75rem;">
                        <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
                            <select data-com-tipo="${e.usuario_id}" aria-label="Tipo de comisión de ${nombre}" style="${campo}">
                                <option value=""${tipo === '' ? ' selected' : ''}>Por defecto</option>
                                <option value="PORCENTAJE"${tipo === 'PORCENTAJE' ? ' selected' : ''}>Porcentaje</option>
                                <option value="FIJO"${tipo === 'FIJO' ? ' selected' : ''}>Fijo</option>
                                <option value="MIXTO"${tipo === 'MIXTO' ? ' selected' : ''}>Mixto</option>
                            </select>
                            <input type="number" min="0" step="0.01" data-com-monto="${e.usuario_id}" value="${e.monto_fijo ?? ''}" placeholder="Monto fijo" aria-label="Monto fijo de ${nombre}" ${USA_MONTO.has(tipo) ? '' : 'hidden'} style="width:110px; ${campo}">
                            <input type="number" min="0" max="100" step="0.01" data-com-pct="${e.usuario_id}" value="${e.porcentaje_propio ?? ''}" placeholder="${tipo ? '%' : 'Por defecto'}" aria-label="Porcentaje propio de ${nombre}" ${USA_PCT.has(tipo) ? '' : 'hidden'} style="width:110px; ${campo}">
                        </div>
                    </td>
                    <td style="padding: 0.6rem 0.75rem;" data-com-efectivo="${e.usuario_id}">${describirEncargado(e)}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align:right;">
                        <button type="button" class="av-btn" data-com-guardar="${e.usuario_id}" style="height:30px; padding:0 10px; font-size:12.5px;">Guardar</button>
                    </td>
                </tr>`;
            }).join('');
        }
        if (select) {
            const previo = select.value;
            select.innerHTML = '<option value="">Seleccioná un encargado...</option>' +
                lista.map(e => `<option value="${e.usuario_id}">${escapeHtml(e.username)} · ${escapeHtml(ROL_LABEL[e.role] || e.role || '')}</option>`).join('');
            if (previo) select.value = previo;
        }
    } catch (e) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--accent); padding: 1rem;">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

/** Muestra solo los campos que usa el tipo elegido. */
function mostrarCamposTipo(usuarioId) {
    const tipo = document.querySelector(`[data-com-tipo="${usuarioId}"]`)?.value ?? '';
    const monto = document.querySelector(`[data-com-monto="${usuarioId}"]`);
    const porcentaje = document.querySelector(`[data-com-pct="${usuarioId}"]`);
    if (monto) monto.hidden = !USA_MONTO.has(tipo);
    if (porcentaje) {
        porcentaje.hidden = !USA_PCT.has(tipo);
        porcentaje.placeholder = tipo ? '%' : 'Por defecto';
    }
}

const numeroOVacio = (input) => {
    const texto = (input?.value ?? '').trim();
    return texto === '' ? null : Number(texto);
};

/** Payload del PUT, validado igual que el backend. Devuelve un string si
 *  hay error. "Por defecto" con un porcentaje escrito es PORCENTAJE. */
function payloadComision(usuarioId) {
    let tipo = document.querySelector(`[data-com-tipo="${usuarioId}"]`)?.value || null;
    const montoFijo = USA_MONTO.has(tipo ?? '') ? numeroOVacio(document.querySelector(`[data-com-monto="${usuarioId}"]`)) : null;
    const porcentaje = USA_PCT.has(tipo ?? '') ? numeroOVacio(document.querySelector(`[data-com-pct="${usuarioId}"]`)) : null;
    if (!tipo && porcentaje !== null) tipo = 'PORCENTAJE';

    if (porcentaje !== null && (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
        return 'El porcentaje tiene que estar entre 0 y 100.';
    }
    if (montoFijo !== null && (Number.isNaN(montoFijo) || montoFijo < 0)) {
        return 'El monto fijo no puede ser negativo.';
    }
    if (USA_MONTO.has(tipo ?? '') && montoFijo === null) return `El monto fijo es obligatorio para el tipo ${TIPO_COMISION_LABEL[tipo]}.`;
    if ((tipo === 'PORCENTAJE' || tipo === 'MIXTO') && porcentaje === null) return `El porcentaje es obligatorio para el tipo ${TIPO_COMISION_LABEL[tipo]}.`;
    return { tipo_comision: tipo, monto_fijo: montoFijo, porcentaje };
}

async function guardarComision(usuarioId) {
    const payload = payloadComision(usuarioId);
    if (typeof payload === 'string') {
        showNotification(payload, 'warning');
        return;
    }
    try {
        const r = await fetchAPI(`/comisiones/encargados/${usuarioId}`, { method: 'PUT', body: JSON.stringify(payload) });
        const celda = document.querySelector(`[data-com-efectivo="${usuarioId}"]`);
        if (celda) celda.textContent = describirEncargado(r);
        const select = document.querySelector(`[data-com-tipo="${usuarioId}"]`);
        if (select) select.value = r.tipo_comision || '';
        mostrarCamposTipo(usuarioId);
        showNotification(r.tipo_comision ? 'Comisión actualizada.' : 'Vuelve al porcentaje por defecto.', 'success');
    } catch (e) {
        showNotification('No se pudo guardar: ' + e.message, 'error');
    }
}

// ── (b) Control y liquidación ───────────────────────────────────────────────

function filaLinea(l) {
    const estilo = l.es_ajuste ? ' style="background: var(--accent-subtle);"' : '';
    return `
        <tr${estilo}>
            <td style="padding: 0.5rem 0.75rem;">${fecha(l.fecha_cobro)}</td>
            <td style="padding: 0.5rem 0.75rem;">${escapeHtml(l.orden_numero || '—')}</td>
            <td style="padding: 0.5rem 0.75rem;">${escapeHtml(l.descripcion || '—')}${l.es_ajuste ? `<br><small style="color: var(--accent-dark);">Ajuste por anulación · ${escapeHtml(l.numero_factura || '')}</small>` : ''}</td>
            <td style="padding: 0.5rem 0.75rem; text-align:right;">${money(l.subtotal)}</td>
            <td style="padding: 0.5rem 0.75rem;" data-com-linea-tipo>${escapeHtml(TIPO_COMISION_LABEL[l.tipo_comision_usado] || l.tipo_comision_usado || '—')}</td>
            <td style="padding: 0.5rem 0.75rem; text-align:right;">${l.monto_fijo_usado != null ? money(l.monto_fijo_usado) : '—'}</td>
            <td style="padding: 0.5rem 0.75rem; text-align:right;">${l.porcentaje_usado != null ? pct(l.porcentaje_usado) : '—'}</td>
            <td style="padding: 0.5rem 0.75rem; text-align:right; font-weight:600;">${money(l.monto_encargado)}</td>
            <td style="padding: 0.5rem 0.75rem; text-align:right;">${money(l.monto_amivets)}</td>
        </tr>`;
}

export function tablaLineas(lineas, vacio) {
    if (!lineas.length) return `<p style="color: var(--text-secondary); padding: 0.5rem 0; margin:0;">${vacio}</p>`;
    return `
        <table class="consultas-table" style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="background: var(--surface-hover); border-bottom: 1.5px solid var(--border);">
                    <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Cobro</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Orden</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Servicio</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Subtotal</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Tipo</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Monto fijo</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">%</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Encargado</th>
                    <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">AmiVets</th>
                </tr>
            </thead>
            <tbody>${lineas.map(filaLinea).join('')}</tbody>
        </table>`;
}

export function totales(t) {
    return `<span>Encargado: <b>${money(t.encargado)}</b></span> · <span>AmiVets: <b>${money(t.amivets)}</b></span>`;
}

async function verControl() {
    const encargadoId = document.getElementById('comEncargadoSelect')?.value;
    const desde = document.getElementById('comDesde')?.value;
    const hasta = document.getElementById('comHasta')?.value;
    const wrap = document.getElementById('comControlWrap');
    if (!wrap) return;
    if (!encargadoId) { showNotification('Seleccioná un encargado.', 'warning'); return; }
    if (!desde || !hasta) { showNotification('Elegí el rango de fechas.', 'warning'); return; }

    _ultimoControl = { encargado_id: Number(encargadoId), desde, hasta };
    wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Calculando…</p>';
    try {
        const params = new URLSearchParams({ encargado_id: encargadoId, desde, hasta }).toString();
        const c = await fetchAPI(`/comisiones/?${params}`);
        wrap.innerHTML = `
            <p style="margin:0 0 0.75rem; color: var(--text-primary);">
                <b>${escapeHtml(c.username)}</b> · comisión actual ${describirComision(c.tipo_comision, c.monto_fijo, c.porcentaje_efectivo)}
            </p>
            <h4 style="margin: 0.5rem 0;">Pendiente de liquidar</h4>
            ${tablaLineas(c.pendientes, 'No hay comisiones pendientes en este rango.')}
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin:0.75rem 0 1.25rem; padding-top:0.75rem; border-top:1px solid var(--border);">
                <div id="comTotalesPendientes">${totales(c.totales_pendientes)}</div>
                <button type="button" id="btnComLiquidar" class="av-btn av-btn--primary" style="height:34px; padding:0 14px;" ${c.pendientes.length ? '' : 'disabled'}>Liquidar</button>
            </div>
            <h4 style="margin: 0.5rem 0;">Ya liquidado</h4>
            ${tablaLineas(c.liquidadas, 'Nada liquidado en este rango.')}
            <div style="margin-top:0.75rem;">${totales(c.totales_liquidadas)}</div>`;
        document.getElementById('btnComLiquidar')?.addEventListener('click', (e) => submitWithLoading(e.currentTarget, liquidar));
        await cargarLiquidaciones(Number(encargadoId));
    } catch (e) {
        wrap.innerHTML = `<p style="text-align:center; color: var(--accent); padding: 1rem;">Error: ${escapeHtml(e.message)}</p>`;
    }
}

async function liquidar() {
    if (!_ultimoControl) return;
    if (!confirm('¿Liquidar las comisiones pendientes? El tipo de comisión y los montos quedan fijos y esas líneas no se vuelven a liquidar.')) return;
    try {
        const liq = await fetchAPI('/comisiones/liquidaciones', { method: 'POST', body: JSON.stringify(_ultimoControl) });
        showNotification(`Liquidación ${liq.numero} creada: ${money(liq.total_encargado)} para el encargado.`, 'success');
        await verControl();
    } catch (e) {
        showNotification('No se pudo liquidar: ' + e.message, 'error');
    }
}

// ── (c) Liquidaciones y PDF ─────────────────────────────────────────────────

async function cargarLiquidaciones(encargadoId) {
    const wrap = document.getElementById('comLiquidacionesLista');
    if (!wrap) return;
    try {
        const lista = await fetchAPI(`/comisiones/liquidaciones?encargado_id=${encargadoId}`);
        if (!lista.length) {
            wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Este encargado todavía no tiene liquidaciones.</p>';
            return;
        }
        wrap.innerHTML = lista.map(l => `
            <div data-com-liquidacion="${l.id}" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding:0.75rem 1rem; margin-bottom:0.5rem; border:1px solid var(--border); border-radius:8px; background: var(--surface-hover);">
                <div>
                    <b>${escapeHtml(l.numero)}</b> · ${fecha(l.desde)} a ${fecha(l.hasta)} · ${l.detalles.length} línea(s)
                    <div style="font-size:0.8rem; color: var(--text-secondary);">Liquidada el ${fecha(l.fecha_calculo)} · Encargado ${money(l.total_encargado)} · AmiVets ${money(l.total_amivets)}</div>
                </div>
                <button type="button" class="av-btn" data-com-pdf="${l.id}" data-com-numero="${escapeHtml(l.numero)}" style="height:30px; padding:0 10px; font-size:12.5px;">Descargar PDF</button>
            </div>`).join('');
    } catch (e) {
        wrap.innerHTML = `<p style="text-align:center; color: var(--accent); padding: 1rem;">Error: ${escapeHtml(e.message)}</p>`;
    }
}

export async function descargarPdf(id, numero) {
    try {
        const response = await fetch(`${API_BASE_URL}/comisiones/liquidaciones/${id}/pdf`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (!response.ok) throw new Error('el servidor no pudo generar el PDF');
        const url = window.URL.createObjectURL(await response.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = `Liquidacion_${numero || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (e) {
        showNotification('No se pudo descargar el PDF: ' + e.message, 'error');
    }
}

// ── Init ────────────────────────────────────────────────────────────────────

function wire() {
    if (_wired) return;
    _wired = true;
    document.getElementById('btnComGuardarDefecto')?.addEventListener('click', guardarDefecto);
    const encargadosBody = document.getElementById('comEncargadosBody');
    encargadosBody?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-com-guardar]');
        if (btn) guardarComision(Number(btn.dataset.comGuardar));
    });
    encargadosBody?.addEventListener('change', (e) => {
        const select = e.target.closest('[data-com-tipo]');
        if (!select) return;
        // "Por defecto" means no own commission: a leftover percentage would
        // otherwise be saved as PORCENTAJE instead of resetting to the default.
        if (!select.value) {
            const porcentaje = document.querySelector(`[data-com-pct="${select.dataset.comTipo}"]`);
            if (porcentaje) porcentaje.value = '';
        }
        mostrarCamposTipo(Number(select.dataset.comTipo));
    });
    document.getElementById('btnComVer')?.addEventListener('click', verControl);
    document.getElementById('comEncargadoSelect')?.addEventListener('change', (e) => {
        if (e.target.value) cargarLiquidaciones(Number(e.target.value));
    });
    document.querySelectorAll('.com-rango-btn').forEach(btn => btn.addEventListener('click', () => {
        if (!_calcularRango) return;
        const { inicio, fin } = _calcularRango(btn.dataset.comRango);
        document.getElementById('comDesde').value = inicio;
        document.getElementById('comHasta').value = fin;
    }));
    document.getElementById('comLiquidacionesLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-com-pdf]');
        if (btn) descargarPdf(Number(btn.dataset.comPdf), btn.dataset.comNumero);
    });
}

// `calcularRango` lo pasa reportes.js (kpiCalcularRango) para no importar
// reportes desde acá y armar una relación circular.
export const initComisiones = ({ calcularRango } = {}) => {
    _calcularRango = calcularRango || null;
    wire();
    cargarConfiguracion();
    cargarEncargados();
    if (_calcularRango && !document.getElementById('comDesde').value) {
        const { inicio, fin } = _calcularRango('este_mes');
        document.getElementById('comDesde').value = inicio;
        document.getElementById('comHasta').value = fin;
    }
};
