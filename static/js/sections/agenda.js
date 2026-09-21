// sections/agenda.js — Agenda: lista de espera del día + calendario FullCalendar.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// `atenderDesdeOrden` y `verDetallesDesdeAgenda` navegan a Consultorio por el
// router del shell 1A (showSection).

import { fetchAPI } from '../core/api.js';
import { ICONS, openModal, closeModal } from '../core/ui.js';
import { showSection } from '../core/router.js';
import { getRole, getUserId, whenReady } from '../core/session.js';
import { seleccionarMascotaBasica, switchPetTab } from './consultorio.js';
import { cargarBadgeOrdenes } from './citas-pendientes.js';

// ============ AGENDA MODULE ============
let calendarInstance = null;

export const loadAgenda = async () => {
    const container = document.getElementById('agenda-list');
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Cargando agenda...</p>';

    // Inject filter bar above the waiting list if not yet present
    const agendaWaiting = container.closest('.agenda-waiting');
    if (agendaWaiting && !document.getElementById('agendaFilterBar')) {
        const filterBar = document.createElement('div');
        filterBar.id = 'agendaFilterBar';
        filterBar.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;';
        filterBar.innerHTML = `
            <input type="date" id="filtroAgendaFecha" value="${new Date().toLocaleDateString('en-CA')}" style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem; flex:1; min-width:120px;">
            <select id="filtroAgendaEstado" style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem; flex:1; min-width:120px;">
                <option value="">Todos los estados</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="EN_ESPERA">En Espera</option>
                <option value="EN_CONSULTA">En Consulta</option>
                <option value="FINALIZADO">Finalizado</option>
                <option value="CANCELADA">Cancelada</option>
            </select>
            <input type="text" id="filtroAgendaMascota" placeholder="Buscar mascota..." style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem; flex:1; min-width:100px;">
            <button id="btnFiltrarAgenda" class="btn-primary" style="padding:0.4rem 0.75rem; font-size:0.82rem; white-space:nowrap;">Filtrar</button>
        `;
        agendaWaiting.insertBefore(filterBar, container);

        document.getElementById('btnFiltrarAgenda')?.addEventListener('click', loadAgenda);
    }

    // Read filter values
    const filtroFecha = document.getElementById('filtroAgendaFecha')?.value || '';
    const filtroEstado = document.getElementById('filtroAgendaEstado')?.value || '';
    const filtroMascota = (document.getElementById('filtroAgendaMascota')?.value || '').toLowerCase().trim();

    try {
        // Un veterinario ve solo su agenda; admin y recepción, la de todos
        // (mismo criterio que la bandeja "Hoy", Tarea 09).
        await whenReady;
        const soloMias = getRole() === 'veterinario' && getUserId();

        const citasParams = new URLSearchParams({ skip: 0, limit: 200 });
        if (filtroEstado) citasParams.set('estado', filtroEstado);
        if (filtroFecha) citasParams.set('fecha_inicio', filtroFecha);
        if (soloMias) citasParams.set('veterinario_id', getUserId());

        const consultasParams = new URLSearchParams({ skip: 0, limit: 100 });
        if (soloMias) consultasParams.set('veterinario_id', getUserId());

        const [citasRaw, consultasRaw, mascotas] = await Promise.all([
            fetchAPI(`/citas/?${citasParams.toString()}`).catch(() => []),
            fetchAPI(`/consultas/?${consultasParams.toString()}`).catch(() => []),
            fetchAPI('/mascotas/?skip=0&limit=300').catch(() => [])
        ]);
        const mascotasMap = {};
        if (Array.isArray(mascotas)) {
            mascotas.forEach(m => mascotasMap[m.id] = m.nombre);
        }

        // 1. Render List (Órdenes / Espera)
        // If a date filter is set use it; otherwise default to today
        const hoy = filtroFecha || new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
        const safeCitas = Array.isArray(citasRaw) ? citasRaw : [];
        let hoyCitas = safeCitas.filter(c => {
            if (!c) return false;
            const fecha = (c.fecha_cita || c.fecha || '').toString();
            return fecha && typeof fecha.startsWith === 'function' && fecha.startsWith(hoy);
        });

        // Client-side filter by mascota name
        if (filtroMascota) {
            hoyCitas = hoyCitas.filter(c => {
                const nombre = (mascotasMap[c.mascota_id] || '').toLowerCase();
                return nombre.includes(filtroMascota);
            });
        }

        if (hoyCitas.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No hay pacientes en espera.</p>';
        } else {
            container.innerHTML = hoyCitas.map(cita => `
                <div class="card-item">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div>
                            <strong style="color: var(--text-primary); font-size: 0.9rem;">${new Date(cita.fecha || cita.fecha_cita).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                            <span class="badge" style="background: ${getStatusColor(cita.estado)}; margin-left: 0.5rem;">${cita.estado}</span>
                        </div>
                    </div>
                    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.25rem;">${mascotasMap[cita.mascota_id] || `Mascota ID: #${cita.mascota_id}`}</p>
                    <p style="font-size: 0.875rem; font-weight: 500;">${cita.motivo}</p>
                    <div style="margin-top: 1rem; text-align: right;">
                        ${cita.estado === 'PENDIENTE' ? `<button onclick="checkInCita(${cita.id})" class="btn-secondary btn-sm">Marcar Check-in</button>` : ''}
                        ${(cita.estado === 'EN_ESPERA' || cita.estado === 'PENDIENTE') ? `<button onclick="atenderDesdeOrden(${cita.mascota_id}, ${cita.id})" class="btn-primary btn-sm">Atender</button>` : ''}
                    </div>
                </div>
            `).join('');
        }

        // 2. Prepare combined events for Calendar
        const allEvents = [];
        safeCitas.forEach(c => {
            const petName = mascotasMap[c.mascota_id] || `Mascota #${c.mascota_id}`;
            allEvents.push({
                id: 'cita_' + c.id,
                title: `${petName} - ${c.motivo || c.tipo}`,
                start: c.fecha_cita || c.fecha,
                backgroundColor: getStatusColor(c.estado),
                borderColor: getStatusColor(c.estado),
                extendedProps: { ...c, mascota_nombre: petName, esConsultaPasada: false }
            });
        });

        const safeConsultas = Array.isArray(consultasRaw) ? consultasRaw : [];
        safeConsultas.forEach(c => {
            const petName = mascotasMap[c.mascota_id] || `Mascota #${c.mascota_id}`;
            allEvents.push({
                id: 'cons_' + c.id,
                title: `${petName} - Cons. Histórica`,
                start: c.fecha_consulta || c.fecha,
                backgroundColor: '#10b981', // Verde estilo consulta completada past
                borderColor: '#059669',
                extendedProps: { ...c, mascota_nombre: petName, esConsultaPasada: true }
            });
        });

        // 3. Render Calendar
        const calEl = document.getElementById('calendar');
        if (!calendarInstance) {
            calendarInstance = new FullCalendar.Calendar(calEl, {
                initialView: 'dayGridMonth',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,timeGridDay'
                },
                locale: 'es',
                // Shell nuevo (etapa 7): altura fija, #sec-agenda fija su
                // propia cadena de altura al 100% en shell.css — 'auto' era
                // el parche del shell 1A (content-height, bridge.css), que ya
                // no se carga (navegacion-v2.md, Decisión 5, hallazgo 4).
                height: '100%',
                events: allEvents,
                eventClick: function (info) {
                    mostrarResumenDia(info.event.startStr.split('T')[0], calendarInstance.getEvents());
                },
                dateClick: function (info) {
                    mostrarResumenDia(info.dateStr, calendarInstance.getEvents());
                }
            });
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    calendarInstance.updateSize();
                    calendarInstance.render();
                    observer.disconnect();
                }
            });
            observer.observe(calEl);
        } else {
            calendarInstance.removeAllEvents();
            allEvents.forEach(evt => calendarInstance.addEvent(evt));
            setTimeout(() => {
                calendarInstance.updateSize();
                calendarInstance.render();
            }, 300);
        }

    } catch (error) {
        container.innerHTML = `<p style="color: red; text-align: center;">Error: ${error.message}</p>`;
    }
};

const getStatusColor = (status) => {
    switch (status) {
        case 'PENDIENTE': return 'var(--info)'; // blue
        case 'EN_ESPERA': return 'var(--warning)'; // warning
        case 'EN_CONSULTA': return 'var(--warning)'; // warning
        case 'FINALIZADO': return 'var(--secondary)'; // green
        case 'CANCELADA': return 'var(--accent)'; // red
        default: return 'var(--text-muted)'; // gray
    }
};

export const checkInCita = async (id, nuevoEstado = 'EN_ESPERA') => {
    try {
        await fetchAPI(`/citas/${id}/checkin`, {
            method: 'PUT',
            body: JSON.stringify({ estado: nuevoEstado })
        });
        loadAgenda();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const atenderDesdeOrden = (mascotaId, citaId) => {
    // Redirigir al consultorio por el router del shell (oculta el resto con [hidden]).
    showSection('sec-consultorio');

    // Seleccionar mascota y enfocar
    seleccionarMascotaBasica(mascotaId); // Carga la mascota, podemos optimizar si tuvieramos el endpoint
};

export const handleCitaSubmit = async (e) => {
    e.preventDefault();
    try {
        const mascotaId = parseInt(document.getElementById('citaMascotaId').value);
        // Fetch pet to get owner ID
        const mascota = await fetchAPI(`/mascotas/${mascotaId}`);

        const data = {
            mascota_id: mascotaId,
            propietario_id: mascota.propietario_id,
            fecha_cita: document.getElementById('citaFecha').value,
            tipo: document.getElementById('citaMotivo').value,
            veterinario_id: parseInt(document.getElementById('citaVeterinarioId').value),
            observaciones: "Orden creada desde administración"
        };
        await fetchAPI('/citas/', { method: 'POST', body: JSON.stringify(data) });
        alert('Cita/Orden agendada correctamente.');
        closeModal('modalCita');
        loadAgenda();
        cargarBadgeOrdenes();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const mostrarResumenDia = (dateStr, allEvents) => {
    const resumenFecha = document.getElementById('resumenDiaFecha');
    const resumenCuerpo = document.getElementById('resumenDiaCuerpo');
    if (!resumenFecha || !resumenCuerpo) return;

    resumenFecha.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString();

    const safeAllEvents = Array.isArray(allEvents) ? allEvents : [];
    const eventosDia = safeAllEvents.filter(ev => {
        if (!ev) return false;
        // Fullcalendar Event Object has 'startStr' for the ISO string (YYYY-MM-DD...)
        const evStart = ev.startStr || (ev.start ? ev.start.toISOString() : '');
        return evStart.startsWith(dateStr);
    });

    if (eventosDia.length === 0) {
        resumenCuerpo.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No hubo actividad este día.</p>';
    } else {
        resumenCuerpo.innerHTML = eventosDia.map(ev => {
            const type = ev.extendedProps?.type;
            let icon = ICONS.calendar;
            let color = 'var(--info)';
            let label = 'Cita';
            let detail = ev.extendedProps?.motivo || ev.extendedProps?.tipo || 'Sin motivo';

            if (type === 'consulta') { icon = ICONS.stethoscope; color = 'var(--primary)'; label = 'Consulta'; }
            if (type === 'cirugia') { icon = ICONS.scalpel; color = 'var(--accent)'; label = 'Cirugía'; detail = ev.extendedProps?.tipo_procedimiento; }
            if (type === 'prueba') { icon = ICONS.flask; color = 'var(--warning-dark)'; label = 'Prueba/Lab'; detail = ev.extendedProps?.tipo; }

            return `
                <div style="padding: 1rem; border-bottom: 1px solid var(--border-light); border-left: 4px solid ${color}; margin-bottom: 0.8rem; background: var(--surface-hover); border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 700; color: ${color}; font-size: 0.9rem; text-transform: uppercase;">
                            ${icon} ${label}
                        </span>
                        <span style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div style="margin-top: 0.5rem; font-size: 1.05rem; color: var(--text-primary); font-weight: 600;">
                        ${ev.extendedProps?.mascota_nombre || `Paciente ID #${ev.extendedProps?.mascota_id}`}
                    </div>
                    <div style="font-size: 0.95rem; color: var(--text-secondary); margin-top: 0.25rem;">
                        ${detail}
                    </div>
                    <div style="margin-top: 0.8rem;">
                        <button class="btn-primary btn-sm" onclick="verDetallesDesdeAgenda(${ev.extendedProps?.mascota_id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Ver Consultas</button>
                    </div>
                </div>
            `;
        }).join('');
    }
    openModal('modalResumenDia');
};

export const verDetallesDesdeAgenda = (mascotaId) => {
    closeModal('modalResumenDia');
    seleccionarMascotaBasica(mascotaId);
    showSection('sec-consultorio');
    setTimeout(() => { switchPetTab('consultas'); }, 100);
};

export { loadAgenda as init };
