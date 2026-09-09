// core/router.js — shell 1A tab router (etapa 2b). Replaces core/legacy-nav.js.
//
// Responsibilities:
//   1. Register the 11 SPA sections with their data-loading initFn (same fns
//      legacy-nav.js used — no behaviour change per section).
//   2. Render the primary tab bar into #avTabs following the WAI-ARIA tabs
//      pattern (roving tabindex, Left/Right/Home/End).
//   3. Navigate: toggle each <section> via the `hidden` attribute (never
//      style.display), keep location.hash in sync, run the section initFn.
//   4. Gate by role: sections the current role may not see are not rendered
//      as a tab / menu entry, and a direct navigation to them shows an
//      "Sin acceso" empty state instead of the section.
//
// `window.showSection` stays exported for the ~4 inline / section-module
// callers.

import { getRole, whenReady } from './session.js';

import { initConsultorio } from '../sections/consultorio.js';
import { loadAgenda } from '../sections/agenda.js';
import { loadPropietarios } from '../sections/propietarios.js';
import { loadInventario } from '../sections/inventario.js';
import { cargarHistorialFacturas } from '../sections/facturacion.js';
import { loadReportes } from '../sections/reportes.js';
import { loadUsuarios } from '../sections/usuarios.js';
import { loadPerfil } from '../sections/perfil.js';
import { cargarCategoriasSelect, cargarCatalogo } from '../sections/catalogo.js';
import { init as initCitasWeb } from '../sections/citas-web.js';

// ─────────────────────────────────────────────────────────────────────────────
// Section registry
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SECTION = 'sec-consultorio';

// Primary tab bar, in 1A order.
const SECTIONS = [
    { id: 'sec-consultorio',     label: 'Consultorio',       tab: true,  init: initConsultorio },
    { id: 'sec-agenda',          label: 'Agenda',            tab: true,  init: loadAgenda },
    { id: 'sec-propietarios',    label: 'Propietarios',      tab: true,  init: loadPropietarios },
    { id: 'sec-facturacion',     label: 'Facturación',       tab: true,  init: cargarHistorialFacturas },
    { id: 'sec-inventario',      label: 'Inventario',        tab: true,  init: loadInventario },
    { id: 'sec-reportes',        label: 'Informes',          tab: true,  init: loadReportes },
    // Reachable via the user menu and the command palette — no tab.
    { id: 'sec-catalogo',        label: 'Catálogo',          tab: false, init: () => { cargarCategoriasSelect(); cargarCatalogo(); } },
    { id: 'sec-citas-web',       label: 'Citas web / QR',    tab: false, init: initCitasWeb },
    { id: 'sec-ordenes-medico',  label: 'Órdenes (Médico)',  tab: false, init: null },
    { id: 'sec-usuarios',        label: 'Usuarios',          tab: false, init: loadUsuarios, roles: ['admin'] },
    { id: 'sec-perfil',          label: 'Mi perfil',         tab: false, init: loadPerfil },
];

/** @type {Map<string, {id:string,label:string,tab:boolean,init:Function|null,roles:string[]|null}>} */
const registry = new Map();

/**
 * Register (or override) a section.
 * @param {string} id            section element id, e.g. "sec-agenda"
 * @param {Function|null} initFn  data loader run every time the section opens
 * @param {{label?:string, tab?:boolean, roles?:string[]|null}} [opts]
 */
export function register(id, initFn, opts = {}) {
    registry.set(id, {
        id,
        label: opts.label || id,
        tab: !!opts.tab,
        init: initFn || null,
        roles: opts.roles || null,
    });
}

SECTIONS.forEach(s => register(s.id, s.init, { label: s.label, tab: s.tab, roles: s.roles || null }));

// ─────────────────────────────────────────────────────────────────────────────
// Role gating helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when `role` (may be null while it resolves) is allowed to see `entry`. */
function roleAllows(entry, role) {
    if (!entry || !entry.roles) return true;      // unrestricted
    if (!role) return true;                       // not resolved yet → optimistic
    return entry.roles.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

let deniedEl = null;

function clearDenied() {
    if (deniedEl && deniedEl.parentNode) deniedEl.parentNode.removeChild(deniedEl);
    deniedEl = null;
}

function showDenied() {
    const main = document.querySelector('.av-main');
    if (!main) return;
    registry.forEach((_, sid) => {
        const el = document.getElementById(sid);
        if (el) el.hidden = true;
    });
    if (!deniedEl) {
        deniedEl = document.createElement('div');
        deniedEl.className = 'av-empty';
        deniedEl.id = 'avNoAccess';
        deniedEl.innerHTML =
            '<i class="ph ph-lock av-empty-icon" aria-hidden="true"></i>' +
            '<p class="av-empty-title">Sin acceso</p>' +
            '<p class="av-empty-text">No tenés permiso para ver esta sección.</p>';
        main.appendChild(deniedEl);
    }
}

function syncTabs(activeId) {
    document.querySelectorAll('#avTabs .av-tab').forEach(btn => {
        const isActive = btn.dataset.target === activeId;
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        btn.tabIndex = isActive ? 0 : -1;
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
}

/**
 * Show a section, run its loader, update the tab bar and the hash.
 * @param {string} id
 * @param {{ push?: boolean }} [opts] push=false when the change came from the hash itself
 */
function navigate(id, opts = {}) {
    const push = opts.push !== false;
    const entry = registry.get(id);
    if (!entry) return;

    if (!roleAllows(entry, getRole())) {
        showDenied();
        if (push) setHash(id);
        return;
    }

    clearDenied();

    registry.forEach((_, sid) => {
        const el = document.getElementById(sid);
        if (el) el.hidden = (sid !== id);
    });

    syncTabs(id);
    if (push) setHash(id);

    // Each section owns its scroll; keep the top bar + tabs pinned in view.
    // (Sections still use styles.css layout until etapa 3, so the window — not
    // the section — is what scrolls today.)
    window.scrollTo(0, 0);

    try {
        if (typeof entry.init === 'function') entry.init();
    } catch (err) {
        console.error(`[router] init de ${id} falló:`, err);
    }
}

function setHash(id) {
    if (location.hash === `#${id}`) return;
    // replaceState (not `location.hash = …`) so the URL reflects the section
    // without the browser scrolling the <section> under the top bar and
    // without firing a hashchange we'd have to de-loop.
    try {
        history.replaceState(history.state, '', `#${id}`);
    } catch (_) {
        location.hash = `#${id}`;
    }
}

/** Public navigation entry point (also exposed as window.showSection). */
export function showSection(id) {
    navigate(id, { push: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar + keyboard
// ─────────────────────────────────────────────────────────────────────────────

function renderTabs() {
    const nav = document.getElementById('avTabs');
    if (!nav) return;
    const role = getRole();
    const frag = document.createDocumentFragment();

    SECTIONS.filter(s => s.tab).forEach(s => {
        const entry = registry.get(s.id);
        if (!roleAllows(entry, role)) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'av-tab';
        btn.setAttribute('role', 'tab');
        btn.id = `tab-${s.id}`;
        btn.dataset.target = s.id;
        btn.setAttribute('aria-controls', s.id);
        btn.setAttribute('aria-selected', 'false');
        btn.tabIndex = -1;
        btn.textContent = s.label;
        frag.appendChild(btn);
    });

    nav.innerHTML = '';
    nav.appendChild(frag);
}

/** Activate a tab: show its section, then (re)focus the tab button. The focus
 *  call comes AFTER navigate() because setting location.hash to an element id
 *  blurs the active element — refocusing keeps the roving-tabindex contract. */
function activateTab(btn) {
    if (!btn || !btn.dataset.target) return;
    navigate(btn.dataset.target);
    btn.focus();
}

function wireTabs() {
    const nav = document.getElementById('avTabs');
    if (!nav) return;

    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('.av-tab');
        if (btn) activateTab(btn);
    });

    nav.addEventListener('keydown', (e) => {
        const tabs = Array.from(nav.querySelectorAll('.av-tab'));
        if (!tabs.length) return;
        const current = document.activeElement && document.activeElement.closest
            ? document.activeElement.closest('.av-tab') : null;
        let idx = tabs.indexOf(current);
        if (idx === -1) idx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
        if (idx === -1) idx = 0;

        let next = null;
        switch (e.key) {
            case 'ArrowRight': case 'ArrowDown': next = (idx + 1) % tabs.length; break;
            case 'ArrowLeft':  case 'ArrowUp':   next = (idx - 1 + tabs.length) % tabs.length; break;
            case 'Home': next = 0; break;
            case 'End':  next = tabs.length - 1; break;
            default: return;
        }
        e.preventDefault();
        activateTab(tabs[next]);
    });
}

function wireUserMenu() {
    document.querySelectorAll('.av-usermenu [data-target]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const details = el.closest('details');
            if (details) details.open = false;
            navigate(el.dataset.target);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Role gating once /usuarios/me resolves
// ─────────────────────────────────────────────────────────────────────────────

function applyRoleGating() {
    const role = getRole();
    if (!role) return;

    // Drop user-menu entries this role must not see (e.g. Usuarios for non-admin).
    document.querySelectorAll('.av-usermenu [data-role]').forEach(el => {
        if (el.dataset.role !== role) el.remove();
    });

    // Drop restricted tabs (none of the 6 primary tabs are restricted today,
    // but keep this generic).
    document.querySelectorAll('#avTabs .av-tab').forEach(btn => {
        const entry = registry.get(btn.dataset.target);
        if (entry && !roleAllows(entry, role)) btn.remove();
    });

    // If the section currently shown is no longer allowed, fall back.
    const currentId = (location.hash || '').slice(1);
    const entry = registry.get(currentId);
    if (entry && !roleAllows(entry, role)) navigate(DEFAULT_SECTION);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

export function init() {
    // This is a single-page shell — the browser must not try to restore a
    // previous scroll position over the top bar.
    try { history.scrollRestoration = 'manual'; } catch (_) { /* older browsers */ }

    renderTabs();
    wireTabs();
    wireUserMenu();

    // Manual URL edits / brand link — programmatic changes use replaceState and
    // do not fire this.
    window.addEventListener('hashchange', () => {
        const id = (location.hash || '').slice(1);
        if (registry.has(id)) navigate(id, { push: false });
    });

    // Brand → home, without the native anchor scroll.
    const brand = document.querySelector('.av-brand');
    if (brand) brand.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(DEFAULT_SECTION);
    });

    const fromHash = (location.hash || '').slice(1);
    const start = registry.has(fromHash) ? fromHash : DEFAULT_SECTION;
    navigate(start, { push: true });

    // Belt-and-braces: some first-paint layout passes nudge the window scroll
    // (content briefly taller than the viewport). Pin it back to the top once
    // the page has settled.
    requestAnimationFrame(() => window.scrollTo(0, 0));
    window.addEventListener('load', () => window.scrollTo(0, 0), { once: true });

    whenReady.then(() => {
        applyRoleGating();
    }).catch(() => { /* session resolution never rejects, but be safe */ });
}
