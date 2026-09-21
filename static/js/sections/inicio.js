// sections/inicio.js — sec-inicio, el lanzador de los seis módulos
// (Tarea 06, etapa 7). Entrada de SESIÓN: DEFAULT_SECTION en core/router.js.
//
// Las tarjetas se recortan por rol: getVisibleModules() (core/router.js) ya
// devuelve solo los módulos que el rol puede usar — no hay tarjeta apagada,
// candado ni "sin acceso" (docs/diseno/navegacion-v2.md, Decisión 2, regla 5).
// Si el rol tiene un solo módulo, router.js salta el lanzador antes de que
// esta pantalla llegue a pintarse (regla 6).

import { getUsername, getRoleLabel, whenReady } from '../core/session.js';
import { getVisibleModules, showSection } from '../core/router.js';
import { fechaLargaEsVE } from '../core/format.js';

// La descripción y el CTA de cada tarjeta viven en MODULES (core/router.js),
// no acá — antes esta pantalla tenía su propia lista keyed por número de
// módulo (DESCRIPTIONS) que podía desincronizarse si un módulo se reordenaba
// en router.js (hallazgo de revisión, etapa 7). getVisibleModules() ya
// devuelve `descripcion`/`cta` resueltos para el rol actual.

const chevron = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const saludo = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
};

function renderCard(mod) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'av-launcher-card';
    card.dataset.target = mod.defaultSection;
    card.innerHTML = `
        <div class="av-launcher-card-top">
            <span class="av-launcher-card-icon">${mod.icon}</span>
            <div class="av-launcher-card-heading">
                <span class="av-eyebrow">Módulo ${mod.num}</span>
                <strong class="ser">${mod.label}</strong>
            </div>
        </div>
        <span class="av-launcher-card-desc">${mod.descripcion}</span>
        <div class="av-launcher-card-cta"><span>${mod.cta}</span>${chevron}</div>
    `;
    return card;
}

export const initInicio = async () => {
    await whenReady;
    const nombre = getUsername();
    const roleLabel = getRoleLabel();

    const h1 = document.getElementById('inicioSaludo');
    if (h1) h1.textContent = nombre ? `${saludo()}, ${nombre}` : saludo();

    const p = document.getElementById('inicioFecha');
    if (p) p.textContent = `${fechaLargaEsVE()} · Elegí el módulo con el que vas a trabajar.`;

    const modules = getVisibleModules();

    const contador = document.getElementById('inicioContador');
    if (contador) contador.textContent = `${roleLabel} · ${modules.length} de 6 módulos`;

    const grid = document.getElementById('inicioGrid');
    if (grid) {
        grid.innerHTML = '';
        modules.forEach(m => grid.appendChild(renderCard(m)));
        grid.querySelectorAll('.av-launcher-card').forEach(card => {
            card.addEventListener('click', () => {
                showSection(card.dataset.target);
            });
        });
    }
};
