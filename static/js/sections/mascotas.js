// sections/mascotas.js — listado de mascotas (Tarea 06, etapa 8).
//
// Landing nuevo del módulo 3 (navegacion-v2.md, "Puntos abiertos": el
// listado quedaba pendiente para esta etapa; hasta ahora la tarjeta abría
// sec-propietarios con su layout viejo). Filtro por especie
// (Perro/Gato/Otros, arquitectura-informacion-v2.md §3), búsqueda por
// nombre/tutor/código, y acceso directo a la ficha (sec-consultorio).
//
// sec-propietarios NO se borra: sigue existiendo como ruta alcanzable
// (router.js la deja fuera del sidebar de este módulo, pero el id sigue
// registrado y funcional -- ver reporte de esta etapa).
//
// "Otros" no es un valor real de Mascota.especie (texto libre, sin
// catálogo cerrado) -- se filtra client-side excluyendo Perro/Gato.

import { fetchAPI } from '../core/api.js';
import { escapeHtml, openModal } from '../core/ui.js';
import { showSection } from '../core/router.js';
import { seleccionarMascota, ownerSelectInstance } from './consultorio.js';

let especieActiva = '';
let searchTimer = null;

const initials = (nombre) => (nombre || '').trim().slice(0, 2).toUpperCase() || '—';

function wireFiltros() {
    const wrap = document.getElementById('mascotasFiltros');
    if (!wrap || wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    wrap.querySelectorAll('[data-especie]').forEach((btn) => {
        btn.addEventListener('click', () => {
            especieActiva = btn.dataset.especie;
            wrap.querySelectorAll('[data-especie]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
            loadMascotas(document.getElementById('mascotasSearch')?.value.trim() || '');
        });
    });
}

function wireSearch() {
    const input = document.getElementById('mascotasSearch');
    if (!input || input.dataset.wired) return;
    input.dataset.wired = '1';
    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadMascotas(input.value.trim()), 250);
    });
}

function wireNuevaMascota() {
    const btn = document.getElementById('btnNuevaMascotaListado');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
        try {
            const propietarios = await fetchAPI('/propietarios/');
            const ownerOptions = propietarios.map((p) => ({
                value: p.id,
                label: `${p.nombre} ${p.apellido}`,
                subtext: `Cédula: ${p.cedula}`,
            }));
            ownerSelectInstance?.setOptions(ownerOptions);
        } catch (_) { /* el modal igual abre, sólo no se refresca el combo */ }
        openModal('modalMascota');
    });
}

export const loadMascotas = async (filtro = '') => {
    const tbody = document.getElementById('mascotasTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">Cargando…</td></tr>';

    try {
        const params = new URLSearchParams({ activo: 'true', limit: '150' });
        if (filtro) params.set('search', filtro);
        if (especieActiva && especieActiva !== 'otro') params.set('especie', especieActiva);

        const [mascotasRaw, propietarios] = await Promise.all([
            fetchAPI(`/mascotas/?${params.toString()}`),
            fetchAPI('/propietarios/?activo=true&limit=200'),
        ]);

        const ownerById = new Map((propietarios || []).map((p) => [p.id, p]));
        let lista = Array.isArray(mascotasRaw) ? mascotasRaw : [];
        if (especieActiva === 'otro') {
            lista = lista.filter((m) => !['perro', 'gato'].includes((m.especie || '').toLowerCase()));
        }

        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">No se encontraron mascotas.</td></tr>';
            return;
        }

        tbody.innerHTML = lista.map((m) => {
            const owner = ownerById.get(m.propietario_id);
            const ownerLabel = owner ? `${owner.nombre} ${owner.apellido}` : '—';
            return `
            <tr>
                <td>
                    <div class="av-row">
                        <div class="av-sidebar-avatar" style="border-radius:8px;">${escapeHtml(initials(m.nombre))}</div>
                        <div>
                            <div style="font-weight:500;">${escapeHtml(m.nombre)}</div>
                            <div style="font-size:12px; color:var(--text-muted);">#${escapeHtml(String(m.codigo_historia || m.id))}</div>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(m.especie || '—')}${m.raza ? ' · ' + escapeHtml(m.raza) : ''}</td>
                <td>${escapeHtml(ownerLabel)}</td>
                <td>${escapeHtml(m.sexo || '—')}</td>
                <td style="text-align:right;">
                    <button type="button" class="av-btn av-btn--primary" style="height:30px; padding:0 12px; font-size:12.5px;"
                        data-open-mascota="${m.id}" data-nombre="${escapeHtml(m.nombre)}"
                        data-especie="${escapeHtml(m.especie || '')}" data-codigo="${escapeHtml(m.codigo_historia || '')}">Ver ficha</button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-open-mascota]').forEach((btn) => {
            btn.addEventListener('click', () => {
                showSection('sec-consultorio');
                seleccionarMascota(Number(btn.dataset.openMascota), btn.dataset.nombre, btn.dataset.especie, btn.dataset.codigo);
            });
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--accent); padding:2rem;">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
};

export const initMascotas = () => {
    wireFiltros();
    wireSearch();
    wireNuevaMascota();
    loadMascotas(document.getElementById('mascotasSearch')?.value.trim() || '');
};

export { initMascotas as init };
