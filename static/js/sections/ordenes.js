// sections/ordenes.js — shim post-Tarea 09 (etapa 5).
//
// La sección sec-ordenes-medico se eliminó: la bandeja de trabajo del
// veterinario (consultas ABIERTA + turnos en sala) vive ahora en "Hoy"
// (sections/hoy.js). Este módulo queda como shim porque todavía lo importan
// app.js (window.atenderOrden, arranque del badge), agenda.js y consultorio.js
// (refrescan el contador tras un alta de cita/consulta).
//
// cargarBadgeOrdenes() ahora sólo:
//   1. actualiza el stub #badgeOrdenesMedico (oculto, sin regresión de null),
//   2. emite 'av:hoy-refresh' para que la pantalla Hoy, si está montada, se
//      vuelva a pintar.

import { fetchAPI } from '../core/api.js';
import { showSection } from '../core/router.js';
import { seleccionarMascotaBasica, abrirFormularioConsulta } from './consultorio.js';

export const cargarBadgeOrdenes = async () => {
    try {
        const citas = await fetchAPI('/citas/');
        const pendientes = (Array.isArray(citas) ? citas : []).filter(c => c && c.estado === 'pendiente');
        const badge = document.getElementById('badgeOrdenesMedico');
        if (badge) badge.textContent = String(pendientes.length);
    } catch (_) {
        /* el badge es informativo: si falla, no rompe nada */
    }
    document.dispatchEvent(new CustomEvent('av:hoy-refresh'));
};

export const atenderOrden = async (citaId, mascotaId) => {
    await seleccionarMascotaBasica(mascotaId);
    showSection('sec-consultorio');
    setTimeout(() => {
        const input = document.getElementById('consultaMascotaId');
        if (input) input.value = mascotaId;
        abrirFormularioConsulta();
    }, 300);
};

export { cargarBadgeOrdenes as init };
