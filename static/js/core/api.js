// core/api.js — fetchAPI, CircuitBreaker, manejo de error/red y red de seguridad
// para promesas sin manejar. Movido verbatim desde app.js (etapa 2a). Sin cambio
// de comportamiento; única diferencia mecánica: `logout()` -> `window.logout()`
// (logout vive en auth.js, script clásico cargado antes que este módulo).

import { showNotification } from './ui.js';

// Configuración de la API
export const API_BASE_URL = '/api'; // Relative path for deployment

// Utilidades

export const CircuitBreaker = (() => {
    const state = {};
    const THRESHOLD = 3;
    const RESET_AFTER_MS = 30000;
    return {
        isOpen(endpoint) {
            const s = state[endpoint];
            if (!s || !s.open) return false;
            if (Date.now() - s.lastFailure > RESET_AFTER_MS) {
                s.open = false; s.failures = 0; return false;
            }
            return true;
        },
        recordFailure(endpoint) {
            if (!state[endpoint]) state[endpoint] = { failures: 0, open: false };
            state[endpoint].failures++;
            state[endpoint].lastFailure = Date.now();
            if (state[endpoint].failures >= THRESHOLD) state[endpoint].open = true;
        },
        recordSuccess(endpoint) {
            if (state[endpoint]) state[endpoint] = { failures: 0, open: false };
        }
    };
})();

export const fetchAPI = async (endpoint, options = {}) => {
    if (CircuitBreaker.isOpen(endpoint)) {
        showNotification('El servicio no está disponible temporalmente. Intentá en unos segundos.', 'warning');
        return null;
    }

    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) {
            window.logout();
            return;
        }

        let data = null;
        if (response.status !== 204) {
            data = await response.json();
        }

        if (!response.ok) {
            CircuitBreaker.recordFailure(endpoint);
            throw new Error((data && data.detail) || 'Error en la petición');
        }

        CircuitBreaker.recordSuccess(endpoint);
        return data;
    } catch (error) {
        if (error.name !== 'AbortError') CircuitBreaker.recordFailure(endpoint);
        console.error('Error en fetchAPI:', error);
        throw error;
    }
};

// Global safety net for unhandled async errors
window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    const message = event.reason?.message || 'Error inesperado. Intentá de nuevo.';
    // Don't show notification for AbortError (user cancelled navigation)
    if (event.reason?.name === 'AbortError') return;
    showNotification(message, 'error');
    // Silent beacon to backend for logging (fire-and-forget)
    try {
        navigator.sendBeacon('/api/client-errors', JSON.stringify({
            event: 'unhandledrejection',
            message,
            url: window.location.href,
            timestamp: new Date().toISOString()
        }));
    } catch (_) { /* sendBeacon not critical */ }
});
