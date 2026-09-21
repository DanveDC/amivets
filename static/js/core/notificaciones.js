// core/notificaciones.js — campana de la cabecera (Tarea 06, etapa 7).
//
// El modelo ya existe desde la etapa 5 (ordenes-de-servicio.md, Decisión 6);
// esta etapa sólo agrega la UI: el contador de no leídas y un panel corto que
// las lista y las marca leídas. El histórico completo (con filtros, paginado)
// es etapa 8 — ver navegacion-v2.md, Puntos abiertos.

import { fetchAPI } from './api.js';
import { escapeHtml } from './ui.js';
import { haceCuanto } from './format.js';
import { abrirOrden } from '../sections/orden-abierta.js';

let open = false;
let pollTimer = null;

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

async function renderList() {
    const list = document.getElementById('notifList');
    if (!list) return;
    list.innerHTML = '<p class="av-notif-empty">Cargando…</p>';
    try {
        const items = await fetchAPI('/notificaciones/?no_leidas=true');
        const lista = Array.isArray(items) ? items : [];
        if (lista.length === 0) {
            list.innerHTML = '<p class="av-notif-empty">Sin notificaciones nuevas.</p>';
            return;
        }
        list.innerHTML = lista.map(n => `
            <button type="button" class="av-notif-item av-notif-item--unread" data-id="${n.id}" data-orden-id="${n.orden_id || ''}">
                <strong>${escapeHtml(n.titulo)}</strong>
                <span>${escapeHtml(n.cuerpo || '')}</span>
                <span>hace ${haceCuanto(n.created_at).texto}</span>
            </button>`).join('');
        list.querySelectorAll('.av-notif-item').forEach(el => {
            el.addEventListener('click', () => onItemClick(Number(el.dataset.id), el.dataset.ordenId ? Number(el.dataset.ordenId) : null));
        });
    } catch (e) {
        list.innerHTML = `<p class="av-notif-empty">No se pudieron cargar: ${escapeHtml(e.message)}</p>`;
    }
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

    refreshBadge();
    // Poll simple: el resto de la app ya refresca por navegación; esto sólo
    // mantiene el contador honesto si la pestaña queda abierta mucho tiempo.
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshBadge, 60000);
}
