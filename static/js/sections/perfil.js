// sections/perfil.js — perfil de usuario y cambio de contraseña.
// Movido verbatim desde app.js (etapa 2a). `handlePerfilPasswordSubmit` es el
// handler que antes vivía inline dentro del DOMContentLoaded del bootstrap; se
// extrajo a función nombrada, el bootstrap lo vuelve a enlazar a #formPerfilPassword.

import { fetchAPI } from '../core/api.js';

export const loadPerfil = async () => {
    try {
        const user = await fetchAPI('/usuarios/me');
        const elInitial = document.getElementById('profileInitial');
        const elUser = document.getElementById('profileUsername');
        const elRole = document.getElementById('profileUserRole');

        if (elInitial) elInitial.textContent = user.username ? user.username.charAt(0).toUpperCase() : 'U';
        if (elUser) elUser.textContent = user.username || 'Usuario';
        if (elRole) elRole.textContent = user.role === 'admin' ? 'Administrador' : user.role;
    } catch (e) {
        console.warn('Error fetching profile', e);
    }
};

export const handlePerfilPasswordSubmit = async (e) => {
    e.preventDefault();
    const curr = document.getElementById('profileCurrentPassword').value;
    const nuev = document.getElementById('profileNewPassword').value;
    const conf = document.getElementById('profileConfirmPassword').value;
    if (nuev !== conf) { alert("Las contraseñas no coinciden"); return; }
    try {
        await fetchAPI('/usuarios/me/password', {
            method: 'PUT',
            body: JSON.stringify({ current_password: curr, new_password: nuev })
        });
        alert('Contraseña actualizada con éxito');
        e.target.reset();
    } catch (err) { alert('Error: ' + err.message); }
};

export { loadPerfil as init };
