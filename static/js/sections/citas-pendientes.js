// sections/citas-pendientes.js — shim post-Tarea 09 (etapa 5), renombrado en
// la Tarea 06 etapa 7 (navegacion-v2.md, Decisión 5, hallazgo 1).
//
// Este archivo se llamaba sections/ordenes.js y no tenía nada que ver con las
// ÓRDENES DE SERVICIO de la Tarea 06 (colisión de nombre con el nuevo
// contenedor de facturación del paciente): es un shim sobre CITAS agendadas
// que cuenta las PENDIENTE para un badge y expone atenderOrden(citaId,
// mascotaId), que abre el consultorio. Se renombra para dejar
// sections/ordenes.js libre; el concepto NO se fusiona con Orden de servicio.
//
// Todavía lo importan app.js (window.atenderOrden, arranque del badge),
// agenda.js y consultorio.js (refrescan el contador tras un alta de
// cita/consulta).
//
// cargarBadgeOrdenes() ahora sólo:
//   1. actualiza el stub #badgeOrdenesMedico (oculto, sin regresión de null),
//   2. emite 'av:hoy-refresh' para que el panel del día, si está montado, se
//      vuelva a pintar.

import { fetchAPI } from '../core/api.js';
import { showSection } from '../core/router.js';
import { seleccionarMascotaBasica, abrirFormularioConsulta } from './consultorio.js';

export const cargarBadgeOrdenes = async () => {
    try {
        const citas = await fetchAPI('/citas/');
        const pendientes = (Array.isArray(citas) ? citas : []).filter(c => c && c.estado === 'PENDIENTE');
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
