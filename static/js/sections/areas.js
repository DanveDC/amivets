// ============================================
// ÁREAS Y GESTORES (areas-y-gestores)
// ============================================
// Pantalla de admin: alta/edición de áreas de despacho, qué usuarios las
// atienden (gestor_area) y qué servicios del catálogo despachan
// (CatalogoServicio.area_id). Al confirmar una orden, los servicios de un área
// con gestores quedan ASIGNADOS y aparecen en "Mi bandeja" de ese gestor.

import { fetchAPI } from '../core/api.js';
import { showNotification, escapeHtml } from '../core/ui.js';

// Roles que pueden atender un área: el gestor, y el veterinario que además
// despacha un área (decisión 5, "una persona con varios roles").
const ROLES_ATIENDEN = ['gestor', 'veterinario'];

let areas = [];
let selectedId = null;
let wired = false;

export async function loadAreas() {
    wire();
    try {
        areas = (await fetchAPI('/areas/')) || [];
    } catch (err) {
        showNotification(err.message || 'No se pudieron cargar las áreas', 'error');
        return;
    }
    renderLista();
    if (selectedId && areas.some(a => a.id === selectedId)) {
        await seleccionarArea(selectedId);
    } else {
        nuevaArea();
    }
}

function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('btnAreaNueva')?.addEventListener('click', nuevaArea);
    document.getElementById('formArea')?.addEventListener('submit', guardarArea);
    document.getElementById('btnAreaAgregarGestor')?.addEventListener('click', agregarGestor);
    document.getElementById('btnAreaAgregarServicio')?.addEventListener('click', asignarServicio);
    document.getElementById('areasLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-area-id]');
        if (btn) seleccionarArea(Number(btn.dataset.areaId));
    });
    document.getElementById('areaGestoresLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-gestor]');
        if (btn) quitarGestor(Number(btn.dataset.quitarGestor));
    });
    document.getElementById('areaServiciosLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-servicio]');
        if (btn) quitarServicio(Number(btn.dataset.quitarServicio));
    });
}

function renderLista() {
    const cont = document.getElementById('areasLista');
    if (!cont) return;
    if (!areas.length) {
        cont.innerHTML = '<p class="rp-empty-text">Todavía no hay áreas. Creá la primera.</p>';
        return;
    }
    cont.innerHTML = areas.map(a => `
        <button type="button" class="cat-item${a.id === selectedId ? ' cat-item--active' : ''}${a.activo ? '' : ' cat-item--inactivo'}" data-area-id="${a.id}">
            <div class="cat-item-info">
                <span class="cat-item-nombre">${escapeHtml(a.nombre)}</span>
                <span class="cat-item-sub">${escapeHtml(a.codigo)}${a.requiere_adjunto ? ' · exige adjunto' : ''}${a.activo ? '' : ' · inactiva'}</span>
            </div>
        </button>`).join('');
}

function nuevaArea() {
    selectedId = null;
    document.getElementById('formArea')?.reset();
    document.getElementById('areaId').value = '';
    document.getElementById('areaCodigo').disabled = false;
    document.getElementById('areaActiva').checked = true;
    document.getElementById('areaAsignaciones').hidden = true;
    renderLista();
    document.getElementById('areaNombre')?.focus();
}

async function seleccionarArea(id) {
    const area = areas.find(a => a.id === id);
    if (!area) return;
    selectedId = id;
    renderLista();
    document.getElementById('areaId').value = String(area.id);
    document.getElementById('areaNombre').value = area.nombre;
    document.getElementById('areaCodigo').value = area.codigo;
    // El código es la clave única del área: no se edita (AreaServicioUpdate no lo acepta).
    document.getElementById('areaCodigo').disabled = true;
    document.getElementById('areaRequiereAdjunto').checked = !!area.requiere_adjunto;
    document.getElementById('areaActiva').checked = !!area.activo;
    document.getElementById('areaAsignaciones').hidden = false;
    await Promise.all([cargarGestores(), cargarServicios()]);
}

async function guardarArea(e) {
    e.preventDefault();
    const id = document.getElementById('areaId').value;
    const nombre = document.getElementById('areaNombre').value.trim();
    const requiere_adjunto = document.getElementById('areaRequiereAdjunto').checked;
    const activo = document.getElementById('areaActiva').checked;
    try {
        let area;
        if (id) {
            area = await fetchAPI(`/areas/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ nombre, requiere_adjunto, activo }),
            });
        } else {
            const codigo = document.getElementById('areaCodigo').value.trim().toUpperCase();
            area = await fetchAPI('/areas/', {
                method: 'POST',
                body: JSON.stringify({ nombre, codigo, requiere_adjunto, activo }),
            });
        }
        if (!area) return;
        showNotification(id ? 'Área actualizada' : 'Área creada', 'success');
        selectedId = area.id;
        await loadAreas();
    } catch (err) {
        showNotification(err.message || 'No se pudo guardar el área', 'error');
    }
}

async function cargarGestores() {
    const lista = document.getElementById('areaGestoresLista');
    const select = document.getElementById('areaGestorSelect');
    let gestores = [];
    let usuarios = [];
    try {
        [gestores, usuarios] = await Promise.all([
            fetchAPI(`/areas/${selectedId}/gestores`),
            fetchAPI('/usuarios/'),
        ]);
    } catch (err) {
        showNotification(err.message || 'No se pudieron cargar los gestores', 'error');
        return;
    }
    gestores = gestores || [];
    lista.innerHTML = gestores.length
        ? gestores.map(g => `
            <li>
                <span>${escapeHtml(g.username)} <small class="text-muted">(${escapeHtml(g.role)}${g.activo ? '' : ', inactivo'})</small></span>
                <button type="button" class="av-btn av-btn--ghost" data-quitar-gestor="${g.usuario_id}">Quitar</button>
            </li>`).join('')
        : '<li class="ar-vacio">Sin gestores: los servicios de esta área quedan sin asignar al confirmar la orden.</li>';

    const asignados = new Set(gestores.map(g => g.usuario_id));
    const candidatos = (usuarios || []).filter(u => u.is_active && ROLES_ATIENDEN.includes(u.role) && !asignados.has(u.id));
    select.innerHTML = candidatos.length
        ? '<option value="">Elegí un usuario…</option>' + candidatos
            .map(u => `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`).join('')
        : '<option value="">No hay gestores ni veterinarios activos sin asignar</option>';
}

async function agregarGestor() {
    const usuarioId = Number(document.getElementById('areaGestorSelect').value);
    if (!usuarioId) {
        showNotification('Elegí un usuario para sumar como gestor', 'warning');
        return;
    }
    try {
        await fetchAPI(`/areas/${selectedId}/gestores`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: usuarioId }),
        });
        showNotification('Gestor agregado al área', 'success');
        await cargarGestores();
    } catch (err) {
        showNotification(err.message || 'No se pudo agregar el gestor', 'error');
    }
}

async function quitarGestor(usuarioId) {
    try {
        await fetchAPI(`/areas/${selectedId}/gestores/${usuarioId}`, { method: 'DELETE' });
        showNotification('Gestor quitado del área', 'success');
        await cargarGestores();
    } catch (err) {
        showNotification(err.message || 'No se pudo quitar el gestor', 'error');
    }
}

async function cargarServicios() {
    const lista = document.getElementById('areaServiciosLista');
    const select = document.getElementById('areaServicioSelect');
    let servicios = [];
    try {
        servicios = (await fetchAPI('/catalogo/?solo_activos=true&limit=1000')) || [];
    } catch (err) {
        showNotification(err.message || 'No se pudo cargar el catálogo', 'error');
        return;
    }
    const propios = servicios.filter(s => s.area_id === selectedId);
    lista.innerHTML = propios.length
        ? propios.map(s => `
            <li>
                <span>${escapeHtml(s.nombre)} <small class="text-muted">${escapeHtml(s.categoria)}</small></span>
                <button type="button" class="av-btn av-btn--ghost" data-quitar-servicio="${s.id}">Quitar</button>
            </li>`).join('')
        : '<li class="ar-vacio">Esta área todavía no despacha ningún servicio.</li>';

    // Solo los servicios sin área: mover uno de otra área se hace quitándolo allá primero.
    const libres = servicios.filter(s => !s.area_id);
    select.innerHTML = libres.length
        ? '<option value="">Elegí un servicio…</option>' + libres
            .map(s => `<option value="${s.id}">${escapeHtml(s.nombre)} — ${escapeHtml(s.categoria)}</option>`).join('')
        : '<option value="">No hay servicios sin área</option>';
}

async function setAreaServicio(servicioId, areaId) {
    await fetchAPI(`/catalogo/${servicioId}`, {
        method: 'PUT',
        body: JSON.stringify({ area_id: areaId }),
    });
}

async function asignarServicio() {
    const servicioId = Number(document.getElementById('areaServicioSelect').value);
    if (!servicioId) {
        showNotification('Elegí un servicio del catálogo', 'warning');
        return;
    }
    try {
        await setAreaServicio(servicioId, selectedId);
        showNotification('Servicio asignado al área', 'success');
        await cargarServicios();
    } catch (err) {
        showNotification(err.message || 'No se pudo asignar el servicio', 'error');
    }
}

async function quitarServicio(servicioId) {
    try {
        await setAreaServicio(servicioId, null);
        showNotification('Servicio quitado del área', 'success');
        await cargarServicios();
    } catch (err) {
        showNotification(err.message || 'No se pudo quitar el servicio', 'error');
    }
}
