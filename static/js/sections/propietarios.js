// sections/propietarios.js — propietarios (tabla, alta, edición, baja lógica).
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// `verMascotasPropietario` navega a Consultorio por el router del shell 1A.

import { fetchAPI } from '../core/api.js';
import { ICONS, openModal, closeModal, escapeHtml, escapeJsAttr, showNotification } from '../core/ui.js';
import { showSection } from '../core/router.js';
import { setOwnerFilter, abrirNuevaMascotaParaPropietario } from './consultorio.js';

// ============ PROPIETARIOS MODULE ============
export const loadPropietarios = async (filter = '') => {
    const tbody = document.getElementById('propietariosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Cargando propietarios...</td></tr>';
    try {
        // Búsqueda del lado del servidor (revisión final Tarea 09): sin esto,
        // solo se veían los primeros 100 propietarios por id — con cientos de
        // registros reales, la inmensa mayoría quedaba invisible sin importar
        // qué se escribiera en el buscador.
        const params = new URLSearchParams({ activo: 'true', limit: '200' });
        if (filter) params.set('search', filter);
        const propietarios = await fetchAPI(`/propietarios/?${params.toString()}`);

        if (propietarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No se encontraron propietarios.</td></tr>';
            return;
        }

        tbody.innerHTML = propietarios.map(p => `
            <tr class="table-row-hover">
                <td><span class="badge-id">#${p.id}</span></td>
                <td style="font-weight: 500;">${escapeHtml(p.nombre)} ${escapeHtml(p.apellido)}</td>
                <td>${escapeHtml(p.cedula)}</td>
                <td>${escapeHtml(p.telefono || '')}</td>
                <td>${p.email ? escapeHtml(p.email) : '<span style="color: var(--text-muted);">N/D</span>'}</td>
                <td style="text-align: right;">
                    <div class="row-actions">
                        <button class="av-btn" style="height:30px; padding:0 10px; font-size:12.5px;" onclick="verMascotasPropietario(${p.id}, '${escapeJsAttr(p.nombre)}')" title="Ver mascotas" aria-label="Ver mascotas">${ICONS.paw} Mascotas</button>
                        <button class="av-btn" style="height:30px; padding:0 10px; font-size:12.5px;" onclick="abrirEditarPropietario(${p.id})" title="Editar" aria-label="Editar">${ICONS.edit}</button>
                        <button class="av-btn" style="height:30px; padding:0 10px; font-size:12.5px; color:var(--accent); border-color:var(--accent);" onclick="confirmEliminarPropietario(${p.id}, '${escapeJsAttr(`${p.nombre} ${p.apellido}`)}')" title="Eliminar" aria-label="Eliminar">${ICONS.trash}</button>
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

export const verMascotasPropietario = (propietarioId, nombre) => {
    // Deja pendiente el filtro para que initConsultorio (disparado por el
    // router al navegar) haga el único fetch, ya filtrado por propietario.
    setOwnerFilter(propietarioId);

    // Si había una mascota abierta en el panel de detalle, ese panel se
    // queda visible aunque cambiemos de sección — sin esto, "Mascotas" de
    // otro propietario mostraba la mascota vieja en lugar de la lista.
    const patientWrapper = document.getElementById('patientWrapper');
    const emptyPatientWrapper = document.getElementById('emptyPatientWrapper');
    if (patientWrapper) patientWrapper.style.display = 'none';
    if (emptyPatientWrapper) emptyPatientWrapper.style.display = 'flex';

    // Navegación por el router del shell (oculta el resto con [hidden]).
    showSection('sec-consultorio');

    const searchInput = document.getElementById('consultorioSearchMascota');
    if (searchInput) {
        searchInput.value = `ID Propietario: ${propietarioId}`; // UI feedback
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
        showNotification(`Propietario registrado: ${result.nombre} ${result.apellido}. Ahora cargá su mascota.`, 'success');
        closeModal('modalPropietario');
        document.getElementById('formPropietario')?.reset();
        // Se sigue de corrido con la mascota del propietario nuevo
        // (propietario-a-mascota).
        await abrirNuevaMascotaParaPropietario(result);
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
