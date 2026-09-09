// sections/usuarios.js — gestión de usuarios (solo admin).
// Movido verbatim desde app.js (etapa 2a). `handleEditarUsuarioSubmit` es el
// handler que antes vivía inline en el DOMContentLoaded del bootstrap; se extrajo
// a función nombrada, el bootstrap lo vuelve a enlazar a #formEditarUsuario.

import { fetchAPI } from '../core/api.js';
import { ICONS, openModal, closeModal } from '../core/ui.js';

export const loadUsuarios = async () => {
    const tbody = document.getElementById('usuariosTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';
    try {
        const usuarios = await fetchAPI('/usuarios/');
        const meResp = await fetchAPI('/usuarios/me');
        const meId = meResp?.id;
        const roleBadge = (role) => {
            const colors = {
                admin: 'var(--primary)',
                veterinario: 'var(--secondary)',
                user: 'var(--text-muted)'
            };
            return `<span class="badge" style="background:${colors[role] || 'var(--text-muted)'}">${role}</span>`;
        };
        tbody.innerHTML = usuarios.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.email}</td>
                <td>${roleBadge(u.role)}</td>
                <td>${u.is_active
                    ? `<span class="status-pill status-pill--ok">${ICONS.checkCircle} Activo</span>`
                    : `<span class="status-pill status-pill--muted">${ICONS.xCircle} Inactivo</span>`}</td>
                <td style="white-space:nowrap;">
                    <button class="btn-secondary btn-sm" onclick="abrirEditarUsuario(${u.id}, '${u.username}', '${u.email}', '${u.role}')"
                        style="font-size:0.75rem; padding:0.25rem 0.6rem; margin-right:0.35rem;">
                        Editar
                    </button>
                    <button class="btn-secondary btn-sm" onclick="toggleUsuarioActivo(${u.id}, ${u.is_active})"
                        style="font-size:0.75rem; padding:0.25rem 0.6rem;">
                        ${u.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    ${u.id !== meId ? `<button class="btn-secondary btn-sm btn-row-danger" onclick="deleteUsuario(${u.id}, '${u.username}')"
                        style="font-size:0.75rem; padding:0.25rem 0.6rem; margin-left:0.35rem;">
                        Eliminar
                    </button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent);">Error: ${error.message}</td></tr>`;
    }
};

export const handleNuevoUsuarioSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            username: document.getElementById('userUsername').value,
            email: document.getElementById('userEmail').value,
            password: document.getElementById('userPassword').value,
            role: document.getElementById('userRole').value
        };
        await fetchAPI('/usuarios/', { method: 'POST', body: JSON.stringify(data) });
        alert('Usuario creado correctamente.');
        closeModal('modalNuevoUsuario');
        loadUsuarios();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const toggleUsuarioActivo = async (id, currentActive) => {
    try {
        await fetchAPI(`/usuarios/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !currentActive })
        });
        loadUsuarios();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const deleteUsuario = async (id, username) => {
    if (!confirm(`¿Eliminar el usuario "${username}"? Esta acción no se puede deshacer.`)) return;
    try {
        await fetchAPI(`/usuarios/${id}`, { method: 'DELETE' });
        loadUsuarios();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const abrirEditarUsuario = (id, username, email, role) => {
    document.getElementById('editUserId').value = id;
    document.getElementById('editUsername').value = username;
    document.getElementById('editEmail').value = email;
    document.getElementById('editRole').value = role;
    openModal('modalEditarUsuario');
};

export const handleEditarUsuarioSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editUserId').value;
    const data = {
        username: document.getElementById('editUsername').value,
        email: document.getElementById('editEmail').value,
        role: document.getElementById('editRole').value,
    };
    try {
        await fetchAPI(`/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        closeModal('modalEditarUsuario');
        loadUsuarios();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export { loadUsuarios as init };
