// sections/historial-precios.js — Tarea 08.
// Panel compartido de "Historial de precios" para materiales (inventario) y
// servicios (catálogo): tabla `Fecha · Precio · Variación · Motivo · Quién`,
// toggle "Ocultar correcciones" y gráfico de evolución (línea escalonada).
//
// Es una serie temporal: el precio se mantiene constante hasta el próximo
// cambio (`stepped: 'after'`), X = tiempo, Y = precio. Para materiales se
// superpone la curva de costo de compra (ENTRADAs de MovimientoInventario);
// la brecha entre ambas curvas es el margen.
//
// Backend (todo GET, Bearer vía fetchAPI):
//   GET /inventario/{id}/historial-precios   -> array, más nuevo primero
//   GET /catalogo/{id}/historial-precios     -> misma forma
//   GET /inventario/{id}/movimientos?tipo=ENTRADA  -> curva de costo (materiales)
// Los montos serializan como string (Decimal) -> parseFloat.

import { fetchAPI } from '../core/api.js';
import { getRole } from '../core/session.js';
import { escapeHtml } from '../core/ui.js';

// ── Helpers de formato ──────────────────────────────────────────────────────

// Moneda es-AR: coma decimal, punto de miles, prefijo $. No hay helper
// compartido previo en el repo (el resto usa `$${n.toFixed(2)}` inline).
export const formatMoney = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtFechaCorta = (iso) => (iso
    ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—');

// Celda "Variación": `+$150,00 (+7,5%)`; `—` cuando ambos son null (registro
// inicial). Verde si sube, rojo si baja, vía tokens del design system.
const renderVariacion = (vaRaw, vpRaw) => {
    if (vaRaw == null && vpRaw == null) return '<span style="color:var(--text-muted);">—</span>';
    const va = vaRaw == null ? null : parseFloat(vaRaw);
    const vp = vpRaw == null ? null : parseFloat(vpRaw);
    const basis = va != null ? va : vp;
    const up = basis >= 0;
    const sign = up ? '+' : '-';
    const cls = up ? 'hist-precios-var--up' : 'hist-precios-var--down';
    const money = va != null ? formatMoney(Math.abs(va)) : null;
    const pct = vp != null
        ? Math.abs(vp).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
        : null;
    let txt;
    if (money && pct) txt = `${sign}${money} (${sign}${pct})`;
    else if (money) txt = `${sign}${money}`;
    else txt = `${sign}${pct}`;
    return `<span class="${cls}">${txt}</span>`;
};

// ── Lookup de usuarios (para la columna "Quién") ────────────────────────────
// GET /usuarios/ es admin-only; para no-admin devolvemos un mapa vacío y la
// tabla cae a `#<id>`. Filas de migración traen usuario_id = null -> `—`.
let usuariosMapCache = null;
// Exportado (Tarea 11): catalogo.js lo reusa para el historial de precios
// inline del panel maestro-detalle (boceto Catalogo.html), en vez de
// duplicar la resolución usuario_id -> username.
export const getUsuariosMap = async () => {
    if (usuariosMapCache) return usuariosMapCache;
    if (getRole() !== 'admin') {
        usuariosMapCache = new Map();
        return usuariosMapCache;
    }
    try {
        const list = await fetchAPI('/usuarios/');
        usuariosMapCache = new Map((list || []).map((u) => [u.id, u.username || ('#' + u.id)]));
    } catch (_) {
        usuariosMapCache = new Map();
    }
    return usuariosMapCache;
};

// ── Estado del panel ───────────────────────────────────────────────────────
let histChart = null;
let lastFocused = null;
let wired = false;
let state = { historial: [], movimientos: [], tipo: 'inventario', usuarios: new Map() };

const CHART_TOKENS = () => {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    return {
        venta: pick('--primary', '#0C7A89'),
        costo: pick('--info', '#1F6C9F'),
        grid: pick('--border', '#EAEAEA'),
        text: pick('--text-secondary', '#787774'),
    };
};

// Extiende la última muestra hasta "ahora" para que el precio vigente se lea
// como un tramo plano hasta hoy (y para que un único registro no quede como un
// punto suelto invisible).
const extenderHastaHoy = (pts) => {
    if (!pts.length) return pts;
    const last = pts[pts.length - 1];
    const now = Date.now();
    return last.x < now ? [...pts, { x: now, y: last.y }] : pts;
};

// ── Render: tabla ──────────────────────────────────────────────────────────
const renderTabla = () => {
    const tbody = document.getElementById('histPreciosBody');
    if (!tbody) return;
    const { historial, usuarios } = state;
    const ocultar = document.getElementById('histPreciosOcultarCorrecciones').checked;
    const anulados = new Set(historial.filter((h) => h.corrige_id != null).map((h) => h.corrige_id));

    let rows = historial; // backend: más nuevo primero
    if (ocultar) rows = rows.filter((h) => h.corrige_id == null && !anulados.has(h.id));

    if (!historial.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:2rem;">Sin cambios de precio registrados</td></tr>';
        return;
    }
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:2rem;">Todos los registros son correcciones ocultas.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((h) => {
        const tag = h.corrige_id != null ? '<span class="hist-precios-tag-correccion">corrección</span>' : '';
        const anulada = anulados.has(h.id) ? ' hist-precios-row--anulada' : '';
        const motivo = h.motivo ? escapeHtml(h.motivo) : '<span style="color:var(--text-muted);">—</span>';
        const quien = h.usuario_id != null
            ? escapeHtml(usuarios.get(h.usuario_id) || ('#' + h.usuario_id))
            : '<span style="color:var(--text-muted);">—</span>';
        return `
            <tr class="hist-precios-row${anulada}">
                <td>${fmtFechaCorta(h.fecha_cambio)}${tag}</td>
                <td class="num">${formatMoney(h.precio_nuevo)}</td>
                <td>${renderVariacion(h.variacion_abs, h.variacion_pct)}</td>
                <td>${motivo}</td>
                <td>${quien}</td>
            </tr>`;
    }).join('');
};

// ── Render: gráfico ────────────────────────────────────────────────────────
const renderChart = () => {
    const wrap = document.getElementById('histPreciosChartWrap');
    if (!wrap || typeof window.Chart === 'undefined') return;
    const { historial, movimientos, tipo } = state;
    const ocultar = document.getElementById('histPreciosOcultarCorrecciones').checked;
    const anulados = new Set(historial.filter((h) => h.corrige_id != null).map((h) => h.corrige_id));

    let hist = historial.filter((h) => h.fecha_cambio);
    if (ocultar) hist = hist.filter((h) => h.corrige_id == null && !anulados.has(h.id));

    const ventaPts = hist
        .map((h) => ({ x: new Date(h.fecha_cambio).getTime(), y: parseFloat(h.precio_nuevo) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x);
    const motivoPorTs = new Map(
        hist.filter((h) => h.motivo).map((h) => [new Date(h.fecha_cambio).getTime(), h.motivo])
    );

    if (histChart) { histChart.destroy(); histChart = null; }

    if (!ventaPts.length) {
        wrap.innerHTML = '<p class="hist-precios-chart-empty">Sin datos para graficar.</p>';
        return;
    }
    if (!document.getElementById('histPreciosChart')) {
        wrap.innerHTML = '<canvas id="histPreciosChart"></canvas>';
    }

    const t = CHART_TOKENS();
    const datasets = [{
        label: 'Precio de venta',
        data: extenderHastaHoy(ventaPts),
        borderColor: t.venta,
        backgroundColor: t.venta,
        stepped: 'after',
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0,
    }];

    if (tipo === 'inventario') {
        const costoPts = (movimientos || [])
            .map((m) => ({ x: new Date(m.fecha_registro).getTime(), y: Number(m.costo_unitario) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0)
            .sort((a, b) => a.x - b.x);
        if (costoPts.length) {
            datasets.push({
                label: 'Costo de compra',
                data: extenderHastaHoy(costoPts),
                borderColor: t.costo,
                backgroundColor: t.costo,
                stepped: 'after',
                borderWidth: 2,
                borderDash: [4, 3],
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0,
            });
        }
    }

    const ctx = document.getElementById('histPreciosChart').getContext('2d');
    histChart = new window.Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            plugins: {
                legend: {
                    display: datasets.length > 1,
                    position: 'bottom',
                    labels: { color: t.text, boxWidth: 12, usePointStyle: true },
                },
                tooltip: {
                    callbacks: {
                        title: (items) => fmtFechaCorta(new Date(items[0].parsed.x).toISOString()),
                        label: (item) => `${item.dataset.label}: ${formatMoney(item.parsed.y)}`,
                        afterLabel: (item) => {
                            const m = motivoPorTs.get(item.parsed.x);
                            return m ? `Motivo: ${m}` : '';
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    grid: { display: false },
                    ticks: {
                        color: t.text,
                        maxTicksLimit: 6,
                        callback: (v) => new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
                    },
                },
                y: {
                    beginAtZero: false,
                    grid: { color: t.grid },
                    ticks: { color: t.text, callback: (v) => formatMoney(v) },
                },
            },
        },
    });
};

// ── Apertura / cierre del modal ────────────────────────────────────────────
const closeHistorial = () => {
    const modal = document.getElementById('modalHistorialPrecios');
    if (!modal) return;
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    if (histChart) { histChart.destroy(); histChart = null; }
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
};

const trapTab = (e, modal) => {
    const focusables = modal.querySelectorAll(
        'button, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusables).filter((el) => el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
};

export function initHistorialPreciosModal() {
    if (wired) return;
    const modal = document.getElementById('modalHistorialPrecios');
    if (!modal) return;
    wired = true;
    document.getElementById('histPreciosClose')?.addEventListener('click', closeHistorial);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeHistorial(); });
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeHistorial(); return; }
        if (e.key === 'Tab') trapTab(e, modal);
    });
    document.getElementById('histPreciosOcultarCorrecciones')?.addEventListener('change', () => {
        renderTabla();
        renderChart();
    });
}

export async function abrirHistorialPrecios({ tipo, id, nombre, precioVariable = false }) {
    const modal = document.getElementById('modalHistorialPrecios');
    if (!modal) return;
    initHistorialPreciosModal();
    lastFocused = document.activeElement;

    document.getElementById('histPreciosSubtitulo').textContent = nombre || '';
    document.getElementById('histPreciosOcultarCorrecciones').checked = false;

    const nota = document.getElementById('histPreciosNota');
    if (tipo === 'catalogo' && precioVariable) {
        nota.textContent = 'Este servicio tiene precio variable: el valor registrado es solo de referencia.';
        nota.hidden = false;
    } else {
        nota.hidden = true;
        nota.textContent = '';
    }

    const tbody = document.getElementById('histPreciosBody');
    tbody.innerHTML = `<tr><td colspan="5" style="padding:0.75rem 0;"><div class="skeleton-list">${'<div class="skeleton-row"></div>'.repeat(3)}</div></td></tr>`;
    const wrap = document.getElementById('histPreciosChartWrap');
    if (histChart) { histChart.destroy(); histChart = null; }
    wrap.innerHTML = '<p class="hist-precios-chart-empty">Cargando…</p>';

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.getElementById('histPreciosClose').focus();

    const base = tipo === 'inventario' ? `/inventario/${id}` : `/catalogo/${id}`;
    try {
        const historial = (await fetchAPI(`${base}/historial-precios`)) || [];
        let movimientos = [];
        if (tipo === 'inventario') {
            try {
                movimientos = (await fetchAPI(`/inventario/${id}/movimientos?tipo=ENTRADA`)) || [];
            } catch (_) {
                movimientos = []; // la curva de costo es best-effort
            }
        }
        const usuarios = await getUsuariosMap();
        state = { historial, movimientos, tipo, usuarios };
        wrap.innerHTML = '<canvas id="histPreciosChart"></canvas>';
        renderTabla();
        renderChart();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--accent); padding:1.5rem;">Error al cargar el historial: ${escapeHtml(err.message)}</td></tr>`;
        wrap.innerHTML = '<p class="hist-precios-chart-empty">No se pudo cargar el gráfico.</p>';
    }
}

// ── Gating del campo de precio (no-admin) ──────────────────────────────────
// Deshabilita el input de precio para roles != admin y muestra el hint. El
// value deshabilitado se sigue enviando en el PUT (los handlers leen .value
// directo), así un veterinario edita el resto y el precio viaja sin cambios.
// Muestra el grupo "Motivo (opcional)" solo a admins. Devuelve isAdmin.
export function gatePrecioInput({ inputId, hintId, motivoGroupId }) {
    const isAdmin = getRole() === 'admin';
    const input = document.getElementById(inputId);
    if (input) {
        input.disabled = !isAdmin;
        input.classList.toggle('is-locked', !isAdmin);
    }
    if (hintId) {
        const hint = document.getElementById(hintId);
        if (hint) hint.hidden = isAdmin;
    }
    if (motivoGroupId) {
        const grp = document.getElementById(motivoGroupId);
        if (grp) {
            grp.hidden = !isAdmin;
            if (!isAdmin) {
                const mi = grp.querySelector('input, textarea');
                if (mi) mi.value = '';
            }
        }
    }
    return isAdmin;
}

// Módulos con `defer`: el DOM ya suele estar listo.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHistorialPreciosModal);
} else {
    initHistorialPreciosModal();
}
