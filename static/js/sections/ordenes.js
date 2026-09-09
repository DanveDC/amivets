// sections/ordenes.js — órdenes de atención para el veterinario (badge + lista).
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// No había una rama de nav dedicada para sec-ordenes-medico: la lista se llena
// vía cargarBadgeOrdenes() al arrancar y tras cada alta de cita/consulta.

import { fetchAPI } from '../core/api.js';
import { ICONS } from '../core/ui.js';
import { showSection } from '../core/router.js';
import { seleccionarMascotaBasica, abrirFormularioConsulta } from './consultorio.js';

export const cargarBadgeOrdenes = async () => {
    const badge = document.getElementById('badgeOrdenesMedico');
    if (!badge) return;
    try {
        const citas = await fetchAPI('/citas/');
        const mIsAdmin = localStorage.getItem('role') === 'admin';
        const mUser = localStorage.getItem('username');
        // Simple logic: filter pending ones assigned to me (or all if admin)
        const safeCitas = Array.isArray(citas) ? citas : [];
        const misOrdenes = safeCitas.filter(c => c && c.estado === 'pendiente');
        badge.textContent = misOrdenes.length;
        document.getElementById('kpiOrdenesPendientes').textContent = misOrdenes.length;

        const listContainer = document.getElementById('ordenesMedicoList');
        if (misOrdenes.length === 0) {
            listContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No tiene órdenes pendientes.</p>';
        } else {
            listContainer.innerHTML = misOrdenes.map(c => `
                <div class="card-item" style="border-left: 4px solid var(--primary);">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <div style="font-weight: 700; font-size: 1.1rem; color: var(--primary);">Paciente: ID #${c.mascota_id}</div>
                            <div style="font-size: 0.9rem; color: var(--text-secondary);">${new Date(c.fecha_cita).toLocaleString()}</div>
                            <div style="margin-top: 0.5rem;"><b>Motivo:</b> ${c.tipo}</div>
                        </div>
                        <button class="btn-primary" onclick="atenderOrden(${c.id}, ${c.mascota_id})">Tomar Orden</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) { }
};

export const atenderOrden = (citaId, mascotaId) => {
    // Show pet profile and open consultation
    seleccionarMascotaBasica(mascotaId);
    showSection('sec-consultorio');
    // Ensure the ID is set for the consultation modal
    setTimeout(() => {
        const input = document.getElementById('consultaMascotaId');
        if (input) input.value = mascotaId;
        abrirFormularioConsulta();
    }, 500);
};

export { cargarBadgeOrdenes as init };
