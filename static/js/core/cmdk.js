// core/cmdk.js — command palette (etapa 2b). Replaces the 11-item sidebar
// search. Opens with a click on #cmdkTrigger or Ctrl/Cmd+K, searches patients,
// owners, order numbers and invoice numbers in parallel, and navigates on
// Enter.
//
// La búsqueda por orden y por factura se agregó en la etapa 8
// (navegacion-v2.md, "Puntos abiertos"): `/facturas/?search=` ya existía en
// el backend y nunca se usaba acá; `/ordenes/?numero=` es nuevo (filtro
// trivial, mismo patrón que los demás Optional de ese endpoint).
//
// Accessibility: role="dialog" + aria-modal on the panel, focus trapped on the
// input, Up/Down move aria-selected in the list, Enter activates, Esc / click
// outside close, focus returns to the trigger.

import { fetchAPI } from './api.js';
import { showSection } from './router.js';
import { escapeHtml } from './ui.js';
import { getRole } from './session.js';
import { abrirOrden } from '../sections/orden-abierta.js';
import { abrirPreviewFactura } from '../sections/facturacion.js';
import { verMascotasPropietario } from '../sections/propietarios.js';

// Roles sin acceso a la búsqueda global (Decisión 4, navegacion-v2.md, regla
// 5): el gestor sólo ve sus propios servicios/orden de origen, un buscador
// del padrón completo de pacientes/tutores sería una fuga. Hallazgo de
// revisión: ocultar #cmdkTrigger (vía data-hide-for-role en el markup) NO
// alcanza -- es sólo el botón, el atajo Ctrl/Cmd+K seguía activo para
// cualquiera igual. El control de acceso real está en el backend (cada
// endpoint gatea por su cuenta), pero el atajo tiene que respetar la misma
// regla que ya respeta el botón, no ser una puerta de al lado.
const ROLES_SIN_BUSQUEDA_GLOBAL = ['gestor'];

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

let triggerEl = null;
let backdrop = null;
let inputEl = null;
let listEl = null;
let lastFocused = null;
let debounceTimer = null;
let results = [];          // [{ type, id, label, sub, data }]
let activeIndex = -1;
let queryToken = 0;        // guards against out-of-order async responses
let ownersSearchUnsupported = false;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function init() {
    triggerEl = document.getElementById('cmdkTrigger');
    if (triggerEl) triggerEl.addEventListener('click', open);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            if (ROLES_SIN_BUSQUEDA_GLOBAL.includes(getRole())) return;
            e.preventDefault();
            if (backdrop) close();
            else open();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Open / close
// ─────────────────────────────────────────────────────────────────────────────

function open() {
    if (backdrop) return;
    // El chequeo va acá y no solo en el atajo: cualquier camino que abra la
    // paleta (botón, atajo, otro módulo) respeta la misma regla de rol
    // (pantalla-encargado, decisión 1).
    if (ROLES_SIN_BUSQUEDA_GLOBAL.includes(getRole())) return;
    lastFocused = document.activeElement;

    backdrop = document.createElement('div');
    backdrop.className = 'av-cmdk-backdrop';

    const panel = document.createElement('div');
    panel.className = 'av-cmdk';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Buscar');

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'input av-cmdk-input';
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-expanded', 'true');
    inputEl.setAttribute('aria-autocomplete', 'list');
    inputEl.setAttribute('aria-controls', 'avCmdkList');
    inputEl.setAttribute('placeholder', 'Buscar mascota, tutor, orden o factura');
    inputEl.autocomplete = 'off';
    inputEl.spellcheck = false;

    listEl = document.createElement('div');
    listEl.className = 'av-cmdk-list';
    listEl.id = 'avCmdkList';
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Resultados');

    panel.appendChild(inputEl);
    panel.appendChild(listEl);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    renderEmpty('Escribí para buscar pacientes, tutores, órdenes o facturas.');

    backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close();
    });
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeydown);
    backdrop.addEventListener('keydown', trapFocus);

    inputEl.focus();
}

function close() {
    if (!backdrop) return;
    clearTimeout(debounceTimer);
    backdrop.remove();
    backdrop = null;
    inputEl = null;
    listEl = null;
    results = [];
    activeIndex = -1;
    queryToken++;
    const restore = triggerEl || lastFocused;
    if (restore && typeof restore.focus === 'function') restore.focus();
}

function trapFocus(e) {
    if (e.key === 'Tab') {
        // The palette has a single logical control (the input); keep focus on it.
        e.preventDefault();
        if (inputEl) inputEl.focus();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

function onInput() {
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (q.length < MIN_QUERY) {
        queryToken++;
        results = [];
        activeIndex = -1;
        renderEmpty('Escribí al menos ' + MIN_QUERY + ' caracteres.');
        return;
    }
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
}

async function runSearch(q) {
    const token = ++queryToken;
    renderEmpty('Buscando…');

    const [mascRes, propRes, ordenRes, facturaRes] = await Promise.allSettled([
        fetchAPI(`/mascotas/?search=${encodeURIComponent(q)}`),
        fetchAPI(`/propietarios/?search=${encodeURIComponent(q)}`),
        // Búsqueda global por número de orden (etapa 8) — 403 silencioso para
        // roles sin acceso (gestor ya no llega acá: el trigger está oculto).
        fetchAPI(`/ordenes/?numero=${encodeURIComponent(q)}&limit=5`),
        // Búsqueda global por factura (etapa 8) — el endpoint `?search=` ya
        // existía en el backend desde antes; cmdk.js nunca lo usaba.
        fetchAPI(`/facturas/?search=${encodeURIComponent(q)}&limit=5`),
    ]);
    if (token !== queryToken) return; // superseded by a newer query

    const out = [];

    if (mascRes.status === 'fulfilled' && Array.isArray(mascRes.value)) {
        for (const m of mascRes.value) {
            out.push({
                type: 'mascota',
                id: m.id,
                label: m.nombre,
                sub: `${m.especie || 'Paciente'} · #${m.codigo_historia || m.id}`,
                data: m,
            });
        }
    }

    let owners = null;
    if (propRes.status === 'fulfilled' && Array.isArray(propRes.value)) {
        owners = propRes.value;
    } else {
        // /propietarios/?search is unsupported here — fall back to the full
        // (short) list filtered client-side.
        if (!ownersSearchUnsupported) {
            ownersSearchUnsupported = true;
            console.info('[cmdk] /propietarios/?search no disponible — filtrando client-side.');
        }
        try {
            const all = await fetchAPI('/propietarios/?activo=true&limit=1000');
            if (token !== queryToken) return;
            const needle = q.toLowerCase();
            owners = (Array.isArray(all) ? all : []).filter(p =>
                `${p.nombre || ''} ${p.apellido || ''} ${p.cedula || ''}`.toLowerCase().includes(needle)
            );
        } catch (_) {
            owners = [];
        }
    }
    for (const p of owners || []) {
        out.push({
            type: 'propietario',
            id: p.id,
            label: `${p.nombre || ''} ${p.apellido || ''}`.trim(),
            sub: p.cedula ? `Cédula ${p.cedula}` : 'Propietario',
            data: p,
        });
    }

    // Hallazgo de revisión: antes, un 500 real acá quedaba indistinguible de
    // "sin resultados" -- ni un log, ni un aviso. Un 403 por rol es
    // silencioso a propósito (comentario de arriba); cualquier OTRA falla se
    // loguea para que no se pierda en un QA manual mirando la consola.
    if (ordenRes.status === 'rejected') console.warn('[cmdk] búsqueda de órdenes falló:', ordenRes.reason);
    if (facturaRes.status === 'rejected') console.warn('[cmdk] búsqueda de facturas falló:', facturaRes.reason);

    if (ordenRes.status === 'fulfilled' && Array.isArray(ordenRes.value)) {
        for (const o of ordenRes.value) {
            out.push({
                type: 'orden',
                id: o.id,
                label: o.numero,
                sub: `Orden · ${o.estado}`,
                data: o,
            });
        }
    }

    if (facturaRes.status === 'fulfilled' && Array.isArray(facturaRes.value)) {
        for (const f of facturaRes.value) {
            out.push({
                type: 'factura',
                id: f.id,
                label: f.numero_factura,
                sub: `Factura · ${f.estado}`,
                data: f,
            });
        }
    }

    results = out.slice(0, MAX_RESULTS);
    activeIndex = results.length ? 0 : -1;
    render();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

const ICON = {
    mascota: 'ph-dog',
    propietario: 'ph-user',
    orden: 'ph-clipboard-text',
    factura: 'ph-receipt',
};

function renderEmpty(message) {
    if (!listEl) return;
    listEl.innerHTML = `<div class="av-cmdk-empty">${message}</div>`;
    if (inputEl) inputEl.removeAttribute('aria-activedescendant');
}

function render() {
    if (!listEl) return;
    if (!results.length) {
        renderEmpty('Sin resultados.');
        return;
    }
    listEl.innerHTML = results.map((r, i) => `
        <div class="av-cmdk-item" role="option" id="avCmdkOpt${i}"
             data-idx="${i}" aria-selected="${i === activeIndex ? 'true' : 'false'}">
            <i class="ph ${ICON[r.type] || 'ph-magnifying-glass'}" aria-hidden="true"></i>
            <span>${escapeHtml(r.label)}</span>
            <span class="av-muted" style="margin-left:auto">${escapeHtml(r.sub)}</span>
        </div>
    `).join('');

    listEl.querySelectorAll('.av-cmdk-item').forEach(el => {
        el.addEventListener('mousemove', () => setActive(Number(el.dataset.idx)));
        el.addEventListener('click', () => activate(Number(el.dataset.idx)));
    });
    syncActiveDescendant();
}

function setActive(i) {
    if (i === activeIndex || i < 0 || i >= results.length) return;
    activeIndex = i;
    listEl.querySelectorAll('.av-cmdk-item').forEach(el => {
        el.setAttribute('aria-selected', Number(el.dataset.idx) === activeIndex ? 'true' : 'false');
    });
    syncActiveDescendant();
}

function syncActiveDescendant() {
    if (!inputEl) return;
    if (activeIndex >= 0) {
        inputEl.setAttribute('aria-activedescendant', `avCmdkOpt${activeIndex}`);
        const el = listEl.querySelector(`#avCmdkOpt${activeIndex}`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    } else {
        inputEl.removeAttribute('aria-activedescendant');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard on the input
// ─────────────────────────────────────────────────────────────────────────────

function onKeydown(e) {
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            if (results.length) setActive((activeIndex + 1) % results.length);
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (results.length) setActive((activeIndex - 1 + results.length) % results.length);
            break;
        case 'Enter':
            e.preventDefault();
            if (activeIndex >= 0) activate(activeIndex);
            break;
        case 'Escape':
            e.preventDefault();
            close();
            break;
        default:
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate a result
// ─────────────────────────────────────────────────────────────────────────────

function activate(i) {
    const r = results[i];
    if (!r) return;
    close();
    if (r.type === 'mascota') {
        showSection('sec-consultorio');
        if (typeof window.seleccionarMascota === 'function') {
            window.seleccionarMascota(r.id, r.data.nombre, r.data.especie, r.data.codigo_historia);
        }
    } else if (r.type === 'propietario') {
        // Todas las mascotas del tutor elegido, no el listado general de
        // propietarios (orden-veterinario-y-tutores).
        verMascotasPropietario(r.id, r.label);
    } else if (r.type === 'orden') {
        abrirOrden(r.id);
    } else if (r.type === 'factura') {
        showSection('sec-facturacion');
        abrirPreviewFactura(r.id);
    }
}

