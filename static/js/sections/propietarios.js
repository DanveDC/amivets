// sections/propietarios.js — propietarios (tabla, alta, edición, baja lógica).
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// `verMascotasPropietario` conserva su manipulación directa de la nav SPA
// (.menu-item / .spa-section) exactamente como estaba.

import { fetchAPI } from '../core/api.js';
import { ICONS, openModal, closeModal } from '../core/ui.js';
import { renderMascotasList, seleccionarMascota } from './consultorio.js';

// ============ PROPIETARIOS MODULE ============
export const loadPropietarios = async (filter = '') => {
    const tbody = document.getElementById('propietariosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Cargando propietarios...</td></tr>';
    try {
        let propietarios = await fetchAPI('/propietarios/');
        // Filtrar inactivos
        propietarios = propietarios.filter(p => p.activo !== false);

        if (filter) {
            const f = filter.toLowerCase();
            propietarios = propietarios.filter(p =>
                p.nombre.toLowerCase().includes(f) ||
                p.apellido.toLowerCase().includes(f) ||
                p.cedula.includes(f)
            );
        }

        if (propietarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No se encontraron propietarios.</td></tr>';
            return;
        }

        tbody.innerHTML = propietarios.map(p => `
            <tr class="table-row-hover">
                <td><span class="badge-id">#${p.id}</span></td>
                <td style="font-weight: 500;">${p.nombre} ${p.apellido}</td>
                <td>${p.cedula}</td>
                <td>${p.telefono}</td>
                <td>${p.email || '<span style="color: var(--text-muted);">N/D</span>'}</td>
                <td style="text-align: right;">
                    <div class="row-actions">
                        <button class="btn-secondary btn-sm" onclick="verMascotasPropietario(${p.id}, '${p.nombre}')" title="Ver mascotas" aria-label="Ver mascotas">${ICONS.paw} Mascotas</button>
                        <button class="btn-secondary btn-sm" onclick="abrirEditarPropietario(${p.id})" title="Editar" aria-label="Editar">${ICONS.edit}</button>
                        <button class="btn-secondary btn-sm btn-row-danger" onclick="confirmEliminarPropietario(${p.id}, '${p.nombre} ${p.apellido}')" title="Eliminar" aria-label="Eliminar">${ICONS.trash}</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--accent); padding: 2rem;">Error: ${error.message}</td></tr>`;
    }
};

export const abrirEditarPropietario = async (id) => {
    try {
        const p = await fetchAPI(`/propietarios/${id}`);
        document.getElementById('editPropietarioId').value = p.id;
        document.getElementById('editPropietarioNombre').value = p.nombre;
        document.getElementById('editPropietarioApellido').value = p.apellido;
        document.getElementById('editPropietarioCedula').value = p.cedula;
        document.getElementById('editPropietarioTelefono').value = p.telefono;
        document.getElementById('editPropietarioEmail').value = p.email || '';
        document.getElementById('editPropietarioDireccion').value = p.direccion || '';

        openModal('modalEditarPropietario');
    } catch (error) {
        alert("Error al cargar datos del propietario");
    }
};

export const confirmEliminarPropietario = async (id, nombre) => {
    if (confirm(`¿Estás seguro de que deseas eliminar al propietario ${nombre}?\nEsta acción lo desactivará del sistema.`)) {
        try {
            await fetchAPI(`/propietarios/${id}`, { method: 'DELETE' });
            alert("Propietario eliminado con éxito.");
            loadPropietarios();
        } catch (error) {
            alert(error.message);
        }
    }
};

export const verMascotasPropietario = async (propietarioId, nombre) => {
    try {
        const mascotas = await fetchAPI(`/mascotas/?propietario_id=${propietarioId}`);
        // Redirect to Consultorio and filter
        const listContainer = document.getElementById('consultorioMascotasList');
        const searchInput = document.getElementById('consultorioSearchMascota');

        // Switch section manually to avoid race conditions with DOM elements
        const menuItems = document.querySelectorAll('.menu-item[data-target]');
        const sections = document.querySelectorAll('.spa-section');
        menuItems.forEach(i => i.classList.remove('active'));
        document.querySelector('.menu-item[data-target="sec-consultorio"]').classList.add('active');
        sections.forEach(s => s.style.display = 'none');
        document.getElementById('sec-consultorio').style.display = 'block';

        if (searchInput) {
            searchInput.value = `ID Propietario: ${propietarioId}`; // UI feedback
        }

        renderMascotasList(mascotas, listContainer);

        if (mascotas.length === 1) {
            const m = mascotas[0];
            seleccionarMascota(m.id, m.nombre, m.especie, m.codigo_historia);
        }
    } catch (e) {
        alert("Error cargando mascotas del propietario");
    }
};

export const handlePropietarioSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            nombre: document.getElementById('propietarioNombre').value,
            apellido: document.getElementById('propietarioApellido').value,
            cedula: document.getElementById('propietarioCedula').value,
            telefono: document.getElementById('propietarioTelefono').value,
            email: document.getElementById('propietarioEmail').value || null,
            direccion: document.getElementById('propietarioDireccion').value || null
        };
        const result = await fetchAPI('/propietarios/', { method: 'POST', body: JSON.stringify(data) });
        alert(`Propietario registrado: ${result.nombre} ${result.apellido}`);
        closeModal('modalPropietario');
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const handleEditarPropietarioSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editPropietarioId').value;
    const data = {
        nombre: document.getElementById('editPropietarioNombre').value,
        apellido: document.getElementById('editPropietarioApellido').value,
        cedula: document.getElementById('editPropietarioCedula').value,
        telefono: document.getElementById('editPropietarioTelefono').value,
        email: document.getElementById('editPropietarioEmail').value || null,
        direccion: document.getElementById('editPropietarioDireccion').value || null
    };
    try {
        await fetchAPI(`/propietarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        alert("Propietario actualizado correctamente");
        closeModal('modalEditarPropietario');
        loadPropietarios();
    } catch (error) {
        alert("Error: " + error.message);
    }
};

export { loadPropietarios as init };
