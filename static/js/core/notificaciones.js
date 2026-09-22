// core/notificaciones.js — campana de la cabecera (Tarea 06, etapa 7).
//
// El modelo ya existe desde la etapa 5 (ordenes-de-servicio.md, Decisión 6);
// etapa 7 agregó el contador de no leídas y el panel corto que las lista y
// las marca leídas. Etapa 8 (navegacion-v2.md, "Puntos abiertos") agrega el
// histórico completo: el mismo panel, con un botón "Ver histórico" que
// cambia a listar TODAS las notificaciones (leídas + no leídas) del usuario,
// paginadas con `skip`/`limit` (`GET /api/notificaciones`), con "Cargar más"
// al pie. No es una sección nueva -- el panel ya tiene su propio scroll
// (`.av-notif-panel`, max-height 420px) y separar esto en una `sec-*` hubiera
// significado una entrada de router + sidebar para algo que es, en esencia,
// la misma lista con más filas.

import { fetchAPI } from './api.js';
import { escapeHtml } from './ui.js';
import { haceCuanto } from './format.js';
import { abrirOrden } from '../sections/orden-abierta.js';

const HISTORY_PAGE = 20;

let open = false;
let pollTimer = null;
let historyMode = false;
let historyOffset = 0;
let historyHasMore = false;

async function refreshBadge() {
    const countEl = document.getElementById('notifCount');
    try {
        const no_leidas = await fetchAPI('/notificaciones/?no_leidas=true');
        const n = Array.isArray(no_leidas) ? no_leidas.length : 0;
        if (countEl) {
            countEl.textContent = String(n);
            countEl.hidden = n === 0;
        }
    } catch (_) {
        /* la campana es informativa: si falla, no rompe nada */
    }
}

// Una fila de la lista — `unread` decide la clase visual, no de qué modo
// venimos (en modo histórico también se pintan las ya leídas, sin la clase).
function notifRowHtml(n) {
    const unread = !n.leida_at;
    return `
        <button type="button" class="av-notif-item${unread ? ' av-notif-item--unread' : ''}" data-id="${n.id}" data-orden-id="${n.orden_id || ''}">
            <strong>${escapeHtml(n.titulo)}</strong>
            <span>${escapeHtml(n.cuerpo || '')}</span>
            <span>hace ${haceCuanto(n.created_at).texto}</span>
        </button>`;
}

function wireRows(list) {
    list.querySelectorAll('.av-notif-item').forEach(el => {
        el.addEventListener('click', () => onItemClick(Number(el.dataset.id), el.dataset.ordenId ? Number(el.dataset.ordenId) : null));
    });
}

function syncLoadMore() {
    const wrap = document.getElementById('notifLoadMoreWrap');
    if (wrap) wrap.hidden = !(historyMode && historyHasMore);
}

async function renderList() {
    const list = document.getElementById('notifList');
    if (!list) return;
    historyOffset = 0;
    historyHasMore = false;
    list.innerHTML = '<p class="av-notif-empty">Cargando…</p>';
    try {
        const url = historyMode
            ? `/notificaciones/?skip=0&limit=${HISTORY_PAGE}`
            : '/notificaciones/?no_leidas=true';
        const items = await fetchAPI(url);
        const lista = Array.isArray(items) ? items : [];
        historyHasMore = historyMode && lista.length === HISTORY_PAGE;
        if (lista.length === 0) {
            list.innerHTML = `<p class="av-notif-empty">${historyMode ? 'Sin notificaciones todavía.' : 'Sin notificaciones nuevas.'}</p>`;
            syncLoadMore();
            return;
        }
        list.innerHTML = lista.map(notifRowHtml).join('');
        wireRows(list);
        syncLoadMore();
    } catch (e) {
        list.innerHTML = `<p class="av-notif-empty">No se pudieron cargar: ${escapeHtml(e.message)}</p>`;
        syncLoadMore();
    }
}

async function cargarMasHistorial() {
    const list = document.getElementById('notifList');
    const btn = document.getElementById('notifCargarMas');
    if (!list || !historyMode) return;
    historyOffset += HISTORY_PAGE;
    if (btn) { btn.disabled = true; btn.textContent = 'Cargando…'; }
    try {
        const items = await fetchAPI(`/notificaciones/?skip=${historyOffset}&limit=${HISTORY_PAGE}`);
        const lista = Array.isArray(items) ? items : [];
        historyHasMore = lista.length === HISTORY_PAGE;
        list.insertAdjacentHTML('beforeend', lista.map(notifRowHtml).join(''));
        wireRows(list);
    } catch (_) {
        historyOffset -= HISTORY_PAGE; // permitir reintentar
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Cargar más'; }
        syncLoadMore();
    }
}

function toggleHistorial() {
    historyMode = !historyMode;
    const btn = document.getElementById('notifVerHistorial');
    if (btn) btn.textContent = historyMode ? 'Ver no leídas' : 'Ver histórico';
    renderList();
}

async function onItemClick(id, ordenId) {
    try {
        await fetchAPI(`/notificaciones/${id}/leer`, { method: 'PATCH' });
    } catch (_) { /* best-effort */ }
    closePanel();
    await refreshBadge();
    if (ordenId) abrirOrden(ordenId);
}

async function markAll() {
    try {
        await fetchAPI('/notificaciones/leer-todas', { method: 'PATCH' });
    } catch (_) { /* best-effort */ }
    await refreshBadge();
    await renderList();
}

function openPanel() {
    open = true;
    const panel = document.getElementById('notifPanel');
    const trigger = document.getElementById('notifTrigger');
    if (panel) panel.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    // Siempre arranca en "no leídas" — el histórico completo es una acción
    // explícita (botón "Ver histórico"), no el estado por defecto.
    historyMode = false;
    const histBtn = document.getElementById('notifVerHistorial');
    if (histBtn) histBtn.textContent = 'Ver histórico';
    renderList();
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onKeydown);
}

function closePanel() {
    open = false;
    const panel = document.getElementById('notifPanel');
    const trigger = document.getElementById('notifTrigger');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeydown);
}

function onOutsideClick(e) {
    const wrap = document.getElementById('avNotif');
    if (wrap && !wrap.contains(e.target)) closePanel();
}

function onKeydown(e) {
    if (e.key === 'Escape') closePanel();
}

export function init() {
    const trigger = document.getElementById('notifTrigger');
    if (trigger) trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) closePanel(); else openPanel();
    });
    document.getElementById('notifMarkAll')?.addEventListener('click', (e) => {
        e.stopPropagation();
        markAll();
    });
    document.getElementById('notifVerHistorial')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHistorial();
    });
    document.getElementById('notifCargarMas')?.addEventListener('click', (e) => {
        e.stopPropagation();
        cargarMasHistorial();
    });

    refreshBadge();
    // Poll simple: el resto de la app ya refresca por navegación; esto sólo
    // mantiene el contador honesto si la pestaña queda abierta mucho tiempo.
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshBadge, 60000);
}
