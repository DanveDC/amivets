// core/session.js — session check + role for the shell.
// Reads GET /usuarios/me once, keeps the role, and exposes it to the router:
//   - getRole()   → current role string or null while it resolves
//   - whenReady   → promise the router awaits before gating restricted sections
// The role is also seeded synchronously from localStorage (auth.js stores it on
// login) so the first paint already knows it in the common case.
//
// Nav visibility by role now lives in core/router.js. The only thing kept here
// is revealing the in-page `.admin-only` blocks that are NOT navigation
// (currently just #liqSeccion inside Informes), which no router owns.

import { fetchAPI } from './api.js';

let currentRole = null;
let currentUserId = null;
let currentUsername = null;
try { currentRole = localStorage.getItem('role') || null; } catch (_) { /* private mode */ }
try { currentUserId = Number(localStorage.getItem('userId')) || null; } catch (_) { /* private mode */ }
try { currentUsername = localStorage.getItem('username') || null; } catch (_) { /* private mode */ }

let resolveReady;
export const whenReady = new Promise((resolve) => { resolveReady = resolve; });

export const getRole = () => currentRole;
export const getUserId = () => currentUserId;
export const getUsername = () => currentUsername;

// Etiqueta legible del rol para la barra lateral y el lanzador
// (navegacion-v2.md, Decisión 2 — mismos nombres que la tabla de módulos).
const ROLE_LABELS = {
    admin: 'Administrador',
    recepcionista: 'Recepción',
    veterinario: 'Veterinario',
    gestor: 'Gestor de servicio',
};
export const getRoleLabel = () => ROLE_LABELS[currentRole] || currentRole || '';

export const initSession = async () => {
    try {
        const user = await fetchAPI('/usuarios/me');
        if (user) {
            if (user.role) {
                currentRole = user.role;
                try { localStorage.setItem('role', currentRole); } catch (_) { /* ignore */ }
            }
            if (user.id) {
                currentUserId = user.id;
                try { localStorage.setItem('userId', String(user.id)); } catch (_) { /* ignore */ }
            }
            if (user.username) {
                currentUsername = user.username;
                try { localStorage.setItem('username', currentUsername); } catch (_) { /* ignore */ }
            }

            // Non-navigation admin blocks (e.g. #liqSeccion). The router gates
            // sections/tabs; this only ungates content inside a section.
            if (currentRole === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    el.style.display = 'flex';
                });
            }
        }
    } catch (error) {
        console.warn('Could not verify session:', error.message);
    } finally {
        resolveReady(currentRole);
    }
};
