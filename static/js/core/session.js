// core/session.js — verificación de sesión y visibilidad por rol.
// `initSession` es el antiguo `checkAdminAccess` de app.js (renombrado en la
// etapa 2a; comportamiento idéntico: lee /usuarios/me, pinta el nombre y
// habilita los elementos .admin-only cuando el rol es admin).

import { fetchAPI } from './api.js';

export const initSession = async () => {
    try {
        const user = await fetchAPI('/usuarios/me');
        if (user) {
            const display = document.getElementById('userNameDisplay');
            if (display) display.textContent = `Hola, ${user.username}`;

            if (user.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    el.style.display = 'flex';
                });
            }
        }
    } catch (error) {
        console.warn("Could not verify admin status:", error.message);
    }
};
