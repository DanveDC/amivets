// sections/comisiones.js — comisiones por servicio (comisiones-por-servicio,
// decisión 11). Vive dentro de Informes (#liqSeccion, solo admin) y lo
// inicializa reportes.js.
//
// (a) porcentaje por defecto y porcentaje propio de cada encargado,
// (b) control por encargado y rango: pendientes, liquidadas y totales, con
//     el botón "Liquidar",
// (c) liquidaciones del encargado con su comprobante PDF.
// Sin onclick inline: los botones generados usan data-* y listeners.
// tablaLineas / totales / descargarPdf / pct se reusan en la pestaña
// "Mis comisiones" de la bandeja (pantalla-encargado).

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { showNotification, escapeHtml, submitWithLoading } from '../core/ui.js';
import { money } from '../core/format.js';

let _wired = false;
let _calcularRango = null;
let _ultimoControl = null; // { encargado_id, desde, hasta }

const ROL_LABEL = { veterinario: 'Veterinario/a', gestor: 'Encargado/a de área' };
export const pct = (v) => `${Number(v).toLocaleString('es', { maximumFractionDigits: 2 })}%`;
const fecha = (v) => (v ? new Date(v).toLocaleDateString() : '—');

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
            body.innerHTML = lista.map(e => `
                <tr>
                    <td style="padding: 0.6rem 0.75rem;">${escapeHtml(e.username)}</td>
                    <td style="padding: 0.6rem 0.75rem;">${escapeHtml(ROL_LABEL[e.role] || e.role || '')}</td>
                    <td style="padding: 0.6rem 0.75rem;">
                        <input type="number" min="0" max="100" step="0.01" data-com-pct="${e.usuario_id}" value="${e.porcentaje_propio ?? ''}" placeholder="Por defecto" aria-label="Porcentaje propio de ${escapeHtml(e.username)}" style="width:110px; padding:0.35rem 0.5rem; border:1px solid var(--border); border-radius:6px; margin:0;">
                    </td>
                    <td style="padding: 0.6rem 0.75rem;" data-com-efectivo="${e.usuario_id}">${pct(e.porcentaje_efectivo)}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align:right;">
                        <button type="button" class="av-btn" data-com-guardar="${e.usuario_id}" style="height:30px; padding:0 10px; font-size:12.5px;">Guardar</button>
                    </td>
                </tr>`).join('');
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

async function guardarPorcentaje(usuarioId) {
    const input = document.querySelector(`[data-com-pct="${usuarioId}"]`);
    if (!input) return;
    const texto = input.value.trim();
    const porcentaje = texto === '' ? null : Number(texto);
    if (porcentaje !== null && (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
        showNotification('El porcentaje tiene que estar entre 0 y 100, o vacío para usar el de defecto.', 'warning');
        return;
    }
    try {
        const r = await fetchAPI(`/comisiones/encargados/${usuarioId}`, { method: 'PUT', body: JSON.stringify({ porcentaje }) });
        const celda = document.querySelector(`[data-com-efectivo="${usuarioId}"]`);
        if (celda) celda.textContent = pct(r.porcentaje_efectivo);
        showNotification(porcentaje === null ? 'Vuelve al porcentaje por defecto.' : 'Porcentaje actualizado.', 'success');
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
            <td style="padding: 0.5rem 0.75rem; text-align:right;">${pct(l.porcentaje)}</td>
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
                <b>${escapeHtml(c.username)}</b> · porcentaje actual ${pct(c.porcentaje_efectivo)}
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
    if (!confirm('¿Liquidar las comisiones pendientes? El porcentaje y los montos quedan fijos y esas líneas no se vuelven a liquidar.')) return;
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
    document.getElementById('comEncargadosBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-com-guardar]');
        if (btn) guardarPorcentaje(Number(btn.dataset.comGuardar));
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
