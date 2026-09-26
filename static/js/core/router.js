// core/router.js — shell nuevo: barra lateral de 6 módulos (Tarea 06, etapa 7).
// Reemplaza al router de pestañas planas 1A (renderTabs/wireTabs/activateTab).
//
// Responsibilities:
//   1. Register every SPA section with its data-loading initFn (same fns as
//      before — sólo cambia CÓMO se llega a ellas, no qué cargan).
//   2. Render la barra lateral (#avSidebar) agrupada en 6 módulos
//      (docs/diseno/navegacion-v2.md, Decisión 1 y 2). La visibilidad de cada
//      módulo se DERIVA de la visibilidad de sus secciones — no hay una
//      segunda lista de roles por módulo que pueda desincronizarse.
//   3. Navigate: toggle each <section> via the `hidden` attribute (never
//      style.display), keep location.hash in sync, run the section initFn.
//   4. Gate by role: sections the current role may not see are not rendered
//      as a nav entry, and a direct navigation to them shows an "Sin acceso"
//      empty state instead of the section.
//   5. El lanzador (`sec-inicio`) no lleva barra lateral: `.av-app--launcher`
//      la oculta por CSS. Si el rol resuelto tiene un solo módulo utilizable,
//      se omite el lanzador (Decisión 2, regla 6).
//
// `window.showSection` stays exported for the ~4 inline / section-module
// callers.

import { getRole, getUsername, getRoleLabel, whenReady } from './session.js';
import { escapeHtml } from './ui.js';

import { initConsultorio } from '../sections/consultorio.js';
import { loadAgenda } from '../sections/agenda.js';
import { loadPropietarios } from '../sections/propietarios.js';
import { initMascotas } from '../sections/mascotas.js';
import { loadInventario } from '../sections/inventario.js';
import { initFacturacion } from '../sections/facturacion.js';
import { loadReportes } from '../sections/reportes.js';
import { loadUsuarios } from '../sections/usuarios.js';
import { loadPerfil } from '../sections/perfil.js';
import { cargarCategoriasSelect, cargarCatalogo } from '../sections/catalogo.js';
import { init as initCitasWeb } from '../sections/citas-web.js';
import { loadHoy } from '../sections/hoy.js';
import { initInicio } from '../sections/inicio.js';
import { loadBandejaGestor, refrescarBadgeBandeja } from '../sections/bandeja-gestor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Section registry
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SECTION = 'sec-inicio';

const ADMISION_ROLES = ['admin', 'recepcionista', 'veterinario'];
const SERVICIOS_ROLES = ['admin', 'veterinario', 'gestor'];
const MASCOTAS_ROLES = ['admin', 'recepcionista', 'veterinario'];

// Todas las secciones del sistema. `tab:false` = no es entrada de menú (se
// abre desde otro lado): sec-inicio (es el lanzador, no un módulo), y las
// pantallas de trabajo sec-orden-abierta / sec-consulta-abierta.
const SECTIONS = [
    { id: 'sec-inicio',          label: 'Inicio',              tab: false, init: initInicio },
    { id: 'sec-hoy',             label: 'Panel del día',       tab: true,  init: loadHoy,             roles: ADMISION_ROLES },
    { id: 'sec-agenda',          label: 'Agenda',              tab: true,  init: loadAgenda,           roles: ADMISION_ROLES },
    { id: 'sec-orden-abierta',   label: 'Orden abierta',       tab: false, init: null },
    { id: 'sec-catalogo',        label: 'Catálogo',            tab: true,  init: () => { cargarCategoriasSelect(); cargarCatalogo(); }, roles: ['admin', 'veterinario'] },
    { id: 'sec-bandeja-gestor',  label: 'Mi bandeja',          tab: true,  init: loadBandejaGestor,    roles: SERVICIOS_ROLES },
    // sec-mascotas es la entrada nueva del módulo 3 (etapa 8); sec-propietarios
    // sigue registrada -- tab:false porque MODULES ya no la lista en
    // sectionIds, ver abajo. Se llega por el botón "Tutores" de sec-mascotas
    // (#btnVerTutores, sections/mascotas.js) o por un resultado de
    // propietario en la búsqueda global. CORRECCIÓN (hallazgo de revisión):
    // este comentario decía "alcanzable ej. desde verMascotasPropietario",
    // pero esa función navega a sec-consultorio, no acá -- era falso; el
    // botón "Tutores" es el fix real, no solo la corrección del comentario.
    { id: 'sec-mascotas',        label: 'Mascotas',            tab: true,  init: initMascotas,         roles: MASCOTAS_ROLES },
    { id: 'sec-propietarios',    label: 'Propietarios',        tab: false, init: loadPropietarios,     roles: MASCOTAS_ROLES },
    { id: 'sec-consultorio',     label: 'Historia clínica',    tab: true,  init: initConsultorio,      roles: MASCOTAS_ROLES },
    { id: 'sec-consulta-abierta', label: 'Consulta abierta',   tab: false, init: null },
    { id: 'sec-inventario',      label: 'Inventario',          tab: true,  init: loadInventario,       roles: ['admin'] },
    { id: 'sec-facturacion',     label: 'Facturación',         tab: true,  init: initFacturacion, roles: ['admin', 'recepcionista'] },
    { id: 'sec-reportes',        label: 'Informes',            tab: true,  init: loadReportes,         roles: ['admin'] },
    // Reachable via the user menu and the command palette — no sidebar entry.
    { id: 'sec-citas-web',       label: 'Citas web / QR',      tab: false, init: initCitasWeb },
    { id: 'sec-usuarios',        label: 'Usuarios',            tab: false, init: loadUsuarios, roles: ['admin'] },
    { id: 'sec-perfil',          label: 'Mi perfil',           tab: false, init: loadPerfil },
];

// Los 6 módulos de la barra lateral (arquitectura-informacion-v2.md, "Los
// seis módulos"). Cada uno agrupa `sectionIds` ya declarados arriba —
// la lista de roles NO se repite acá: la visibilidad del módulo es la unión
// de la visibilidad de sus secciones (Decisión 2, regla 5).
const iconSvg = (inner) =>
    `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// `descripcion` y `cta` viven ACÁ (no en una segunda lista aparte en
// inicio.js, keyed por número de módulo) por la misma razón que el comentario
// de arriba: si un módulo se reordena o renumera, antes la descripción podía
// quedar mostrada bajo la tarjeta equivocada sin ningún chequeo (hallazgo de
// revisión, etapa 7). `cta` es un mapa sectionId -> texto porque el CTA
// depende de CUÁL sección terminó siendo la entrada por defecto del módulo
// para el rol actual (ver getVisibleModules).
const MODULES = [
    {
        num: 1, label: 'Admisión', sectionIds: ['sec-hoy', 'sec-agenda'],
        descripcion: 'Abrir, tomar, cerrar y modificar órdenes de servicio. Recepción, sala de espera y presupuestos.',
        cta: { 'sec-hoy': 'Abre el panel del día' },
        icon: iconSvg('<path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 13h6M9 17h4"/>'),
    },
    {
        num: 2, label: 'Servicios', sectionIds: ['sec-catalogo', 'sec-bandeja-gestor'],
        descripcion: 'El catálogo y la ejecución: consultas, laboratorio, cirugía, hospitalización, estética e insumos médicos.',
        cta: { 'sec-catalogo': 'Abre el catálogo de servicios', 'sec-bandeja-gestor': 'Abre tu bandeja de trabajo' },
        icon: iconSvg('<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .2.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>'),
    },
    {
        num: 3, label: 'Mascotas / Tutores', sectionIds: ['sec-mascotas', 'sec-consultorio'],
        descripcion: 'Pacientes por especie, tutores naturales y jurídicos, y la historia clínica completa de cada uno.',
        cta: { 'sec-mascotas': 'Abre el listado de mascotas', 'sec-consultorio': 'Abre la historia clínica' },
        icon: iconSvg('<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="6.5" cy="15" r="2"/><path d="M14.5 15c1.6 1.2 2.5 2.6 2.5 4a2.6 2.6 0 0 1-2.6 2.6c-1 0-1.8-.4-2.9-.4s-1.9.4-2.9.4A2.6 2.6 0 0 1 6 19c0-2.6 3-5.4 5.5-5.4 1.1 0 2.1.5 3 1.4z"/>'),
    },
    {
        num: 4, label: 'Insumos', sectionIds: ['sec-inventario'],
        descripcion: 'Medicamentos, consumibles y accesorios con unidad de medida, consumo fraccionado y alertas de stock.',
        cta: { 'sec-inventario': 'Abre el inventario' },
        icon: iconSvg('<path d="m7.5 4.3 9 5.1"/><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
    },
    {
        num: 5, label: 'Facturación', sectionIds: ['sec-facturacion'],
        descripcion: 'Facturar una orden completa o por partes, cobros y abonos, y el resumen por método de pago.',
        cta: { 'sec-facturacion': 'Abre las órdenes por cobrar' },
        icon: iconSvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
    },
    {
        num: 6, label: 'KPI / Reportes', sectionIds: ['sec-reportes'],
        descripcion: 'Indicadores por servicio, por especie, por médico y por patología, y las liquidaciones del equipo.',
        cta: { 'sec-reportes': 'Abre KPI y reportes' },
        icon: iconSvg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
    },
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

/** Módulos visibles para `role` — al menos una de sus secciones tiene que serlo. */
function modulesForRole(role) {
    return MODULES
        .map(m => ({ ...m, sectionIds: m.sectionIds.filter(id => roleAllows(registry.get(id), role)) }))
        .filter(m => m.sectionIds.length > 0);
}

/** Sección de la que cuelga `sectionId` (para saber qué módulo activar). */
function moduleOwning(sectionId) {
    return MODULES.find(m => m.sectionIds.includes(sectionId)) || null;
}

/**
 * Módulos visibles para el rol actual, con su sección de entrada resuelta.
 * Lo consume sections/inicio.js para dibujar el lanzador — misma fuente de
 * verdad que la barra lateral (Decisión 2, regla 5: nada de una segunda lista).
 * @returns {{num:number, label:string, icon:string, defaultSection:string}[]}
 */
export function getVisibleModules() {
    return modulesForRole(getRole()).map(m => ({
        num: m.num, label: m.label, icon: m.icon, defaultSection: m.sectionIds[0],
        descripcion: m.descripcion || '', cta: m.cta[m.sectionIds[0]] || 'Abrir',
    }));
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

function setLauncherMode(isLauncher) {
    const app = document.getElementById('avApp');
    if (app) app.classList.toggle('av-app--launcher', isLauncher);
}

/**
 * Show a section, run its loader, update the sidebar and the hash.
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

    setLauncherMode(id === 'sec-inicio');
    syncSidebar(id);
    syncHeaderTitle(entry);
    if (push) setHash(id);

    // Each section owns its scroll (.av-main). Keep it pinned to the top on
    // every navigation so the previous section's scroll position doesn't leak.
    const main = document.querySelector('.av-main');
    if (main) main.scrollTop = 0;

    try {
        if (typeof entry.init === 'function') entry.init();
    } catch (err) {
        console.error(`[router] init de ${id} falló:`, err);
    }
}

function setHash(id) {
    if (location.hash === `#${id}`) return;
    // replaceState (not `location.hash = …`) so the URL reflects the section
    // without the browser scrolling the <section> under the header and
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
// Header — título/subtítulo por defecto (las secciones lo pueden sobreescribir)
// ─────────────────────────────────────────────────────────────────────────────

function syncHeaderTitle(entry) {
    if (entry.id === 'sec-inicio') return; // el lanzador pinta su propio encabezado
    const title = document.getElementById('avHeaderTitleText');
    const sub = document.getElementById('avHeaderSubtitleText');
    if (title) title.textContent = entry.label;
    if (sub && entry.id !== 'sec-orden-abierta' && entry.id !== 'sec-bandeja-gestor' && entry.id !== 'sec-mascotas') sub.textContent = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Barra lateral
// ─────────────────────────────────────────────────────────────────────────────

/** Firma del sidebar para un rol: cambia sólo si el rol o el set de módulos
 * visibles cambian — sirve para decidir si hace falta un rebuild completo
 * (ver syncSidebar). */
function sidebarSignature(role, mods) {
    return `${role || '∅'}::${mods.map(m => `${m.num}:${m.sectionIds.join(',')}`).join('|')}`;
}

function renderSidebar(role, activeId) {
    const nav = document.getElementById('avSidebar');
    if (!nav) return;
    const mods = modulesForRole(role);
    const activeModule = moduleOwning(activeId);
    const frag = document.createDocumentFragment();

    const brand = document.createElement('a');
    brand.className = 'av-sidebar-brand';
    brand.href = `#${DEFAULT_SECTION}`;
    brand.innerHTML =
        '<span class="av-sidebar-logo" aria-hidden="true">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="#FFFFFF"><circle cx="11" cy="4.6" r="2.1"/><circle cx="17.8" cy="8.2" r="2.1"/><circle cx="4.2" cy="8.2" r="2.1"/><circle cx="6.8" cy="14.6" r="2.1"/><path d="M14.4 14.6c1.6 1.2 2.6 2.7 2.6 4.2a2.7 2.7 0 0 1-2.7 2.7c-1 0-1.9-.4-3-.4s-2 .4-3 .4A2.7 2.7 0 0 1 5.6 18.8c0-2.7 3.1-5.6 5.7-5.6 1.1 0 2.2.5 3.1 1.4Z"/></svg>' +
        '</span>' +
        '<span class="av-sidebar-brandtext"><strong class="ser">AmiVets</strong><span>Sistema de gestión</span></span>';
    brand.addEventListener('click', (e) => { e.preventDefault(); navigate(DEFAULT_SECTION); });
    frag.appendChild(brand);

    const navEl = document.createElement('nav');
    navEl.className = 'av-nav';
    navEl.setAttribute('aria-label', 'Módulos');

    mods.forEach(m => {
        const isActiveModule = activeModule && activeModule.num === m.num;
        const defaultSection = m.sectionIds[0];

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'av-nav-item';
        row.dataset.target = defaultSection;
        row.dataset.moduleNum = String(m.num); // usado por updateActiveStates
        row.setAttribute('aria-current', isActiveModule ? 'true' : 'false');
        row.innerHTML = `${m.icon}<span class="av-nav-label">${m.label}</span><span class="av-nav-num">${m.num}</span>`;
        row.addEventListener('click', () => navigate(defaultSection));
        navEl.appendChild(row);

        // Sub-items: sólo cuando el módulo tiene más de una sección visible
        // para este rol (Servicios: Catálogo/Mi bandeja; Mascotas: Propietarios/
        // Historia clínica). Se muestran siempre que el módulo está en el
        // sidebar — no sólo cuando está activo — para que la navegación sea
        // de un clic y la suite e2e pueda enlazar directo (ver e2e/helpers.js).
        if (m.sectionIds.length > 1) {
            m.sectionIds.forEach(sid => {
                const entry = registry.get(sid);
                if (!entry) return;
                const sub = document.createElement('button');
                sub.type = 'button';
                sub.className = 'av-nav-sub';
                sub.dataset.target = sid;
                sub.setAttribute('aria-current', sid === activeId ? 'true' : 'false');
                const badgeId = sid === 'sec-bandeja-gestor' ? ' id="avSidebarBandejaBadge"' : '';
                sub.innerHTML = `<span class="av-nav-label">${entry.label}</span><span class="av-nav-num"${badgeId} hidden></span>`;
                sub.addEventListener('click', () => navigate(sid));
                navEl.appendChild(sub);
            });
        }
    });

    frag.appendChild(navEl);
    frag.appendChild(document.createElement('div')).className = 'av-sidebar-spacer';

    const username = getUsername() || '';
    // El backend sólo limita la LONGITUD del username, no sus caracteres —
    // un admin puede setear uno con HTML/script y se ejecutaría en cada
    // navegación si se inyecta sin escapar (hallazgo de revisión, etapa 7:
    // XSS almacenado). `initials` sale del mismo string pero nunca se inyecta
    // como HTML, así que no necesita escapado — sólo textContent-safe.
    const initials = username.slice(0, 2).toUpperCase() || '—';
    const userBlock = document.createElement('div');
    userBlock.className = 'av-sidebar-user';
    userBlock.id = 'avSidebarUser';
    userBlock.innerHTML =
        `<div class="av-sidebar-avatar">${escapeHtml(initials)}</div>` +
        `<div class="av-sidebar-userinfo"><strong>${escapeHtml(username) || '…'}</strong><span>${escapeHtml(getRoleLabel())}</span></div>`;
    frag.appendChild(userBlock);

    nav.innerHTML = '';
    nav.appendChild(frag);
    nav.dataset.signature = sidebarSignature(role, mods);
}

/** Sólo togglea `aria-current` sobre los nodos ya existentes — no reconstruye
 * el árbol. Lo usa syncSidebar cuando el set de módulos visibles no cambió. */
function updateActiveStates(activeId) {
    const nav = document.getElementById('avSidebar');
    if (!nav) return;
    const activeModule = moduleOwning(activeId);
    nav.querySelectorAll('.av-nav-item').forEach(row => {
        const isActiveModule = activeModule && Number(row.dataset.moduleNum) === activeModule.num;
        row.setAttribute('aria-current', isActiveModule ? 'true' : 'false');
    });
    nav.querySelectorAll('.av-nav-sub').forEach(sub => {
        sub.setAttribute('aria-current', sub.dataset.target === activeId ? 'true' : 'false');
    });
}

// Cada navegación interna llamaba renderSidebar() y reconstruía TODO el árbol
// (nav.innerHTML = '' + recrear cada nodo + re-registrar cada listener), aun
// cuando lo único que cambiaba era CUÁL fila está activa (hallazgo de
// revisión, etapa 7). Ahora sólo se reconstruye desde cero cuando el rol o el
// set de módulos visibles realmente cambian (primera carga, resolución de rol
// asíncrona); el resto de las navegaciones sólo togglea `aria-current`.
function syncSidebar(activeId) {
    const role = getRole();
    const mods = modulesForRole(role);
    const nav = document.getElementById('avSidebar');
    if (nav && nav.dataset.signature === sidebarSignature(role, mods)) {
        updateActiveStates(activeId);
        return;
    }
    renderSidebar(role, activeId);
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

    // Decisión 4, regla 5: el gestor no tiene búsqueda global (matriz §9.3,
    // fila 4 — sólo ve sus servicios y la cabecera de su orden). Tampoco
    // necesita el menú "+ Nuevo" (crear consulta/servicio directo/propietario
    // no es su trabajo). Filtra en su propia bandeja, no en el padrón.
    //
    // `data-hide-for-role` en el markup (en vez de un `if (role === 'gestor')`
    // hardcodeado acá) para que esto use el mismo mecanismo declarativo que
    // `[data-role]` un poco más arriba, en lugar de un segundo camino de
    // gating por fuera del sistema (hallazgo de revisión, etapa 7).
    document.querySelectorAll('[data-hide-for-role]').forEach(el => {
        if (el.dataset.hideForRole.split(',').includes(role)) el.setAttribute('hidden', '');
    });

    // If the section currently shown is no longer allowed, fall back.
    const currentId = (location.hash || '').slice(1);
    const entry = registry.get(currentId);
    const startingFresh = !currentId || currentId === DEFAULT_SECTION;

    if (entry && !roleAllows(entry, role)) {
        navigate(landingFor(role));
        return;
    }

    // Re-render the sidebar now that the role (and therefore the module list)
    // is resolved — the first paint was optimistic (roleAllows(role=null)).
    syncSidebar(currentId || DEFAULT_SECTION);

    // Badge de "Mi bandeja" (hallazgo de revisión, etapa 7: el span existía
    // pero nada lo llenaba). Se resuelve una vez acá, al margen de en qué
    // sección haya arrancado el usuario — loadBandejaGestor lo vuelve a
    // refrescar cada vez que esa pantalla carga o cambia.
    if (SERVICIOS_ROLES.includes(role)) refrescarBadgeBandeja();

    // Decisión 2, regla 6: un solo módulo utilizable -> se omite el lanzador.
    if (startingFresh) {
        const mods = modulesForRole(role);
        if (mods.length === 1) {
            navigate(mods[0].sectionIds[0]);
        }
    }
}

/** Primera sección utilizable para `role` (fallback cuando el hash ya no es válido). */
function landingFor(role) {
    const mods = modulesForRole(role);
    if (mods.length === 1) return mods[0].sectionIds[0];
    return DEFAULT_SECTION;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

export function init() {
    // This is a single-page shell — the browser must not try to restore a
    // previous scroll position over the header.
    try { history.scrollRestoration = 'manual'; } catch (_) { /* older browsers */ }

    syncSidebar(DEFAULT_SECTION);
    wireUserMenu();

    // Manual URL edits / brand link — programmatic changes use replaceState and
    // do not fire this.
    window.addEventListener('hashchange', () => {
        const id = (location.hash || '').slice(1);
        if (registry.has(id)) navigate(id, { push: false });
    });

    const fromHash = (location.hash || '').slice(1);
    const start = registry.has(fromHash) ? fromHash : DEFAULT_SECTION;
    navigate(start, { push: true });

    whenReady.then(() => {
        applyRoleGating();
    }).catch(() => { /* session resolution never rejects, but be safe */ });
}
