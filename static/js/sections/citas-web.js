// sections/citas-web.js — módulo Citas Web / QR (citas recibidas, horarios, vets).
// Movido verbatim desde app.js (etapa 2a). Los listeners de nivel superior
// (sub-tabs .qr-tab-btn, entrada a la sección, filtro, badge diferido) se
// mantienen a nivel de módulo: corren una sola vez al cargar el módulo, igual
// que antes corrían una sola vez al parsear el script.

import { fetchAPI } from '../core/api.js';
import { ICONS, showNotification } from '../core/ui.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO: CITAS WEB / QR
// ═══════════════════════════════════════════════════════════════════════════════

const DIAS_LABEL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ── Sub-tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.qr-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.qr-tab-btn').forEach(b => {
            b.style.color = 'var(--text-secondary)';
            b.style.borderBottom = 'none';
            b.style.fontWeight = '500';
        });
        btn.style.color = 'var(--primary)';
        btn.style.borderBottom = '2px solid var(--primary)';
        btn.style.marginBottom = '-2px';
        btn.style.fontWeight = '600';
        document.querySelectorAll('.qr-tab-content').forEach(c => c.style.display = 'none');
        document.getElementById(target).style.display = 'block';

        if (target === 'tab-citas-qr')  cargarCitasQR();
        if (target === 'tab-horarios')  inicializarTabHorarios();
        if (target === 'tab-vets-qr')   cargarVetsQR();
    });
});

// Cargar al entrar a la sección
document.querySelector('[data-target="sec-citas-web"]')?.addEventListener('click', () => {
    cargarCitasQR();
    actualizarBadgeCitasQR();
});

// ── Badge de pendientes ───────────────────────────────────────────────────────
async function actualizarBadgeCitasQR() {
    try {
        const data = await fetchAPI('/admin/supabase/citas-qr?estado=pendiente&limit=50');
        const badge = document.getElementById('badgeCitasQR');
        if (badge) badge.textContent = Array.isArray(data) ? data.length : 0;
    } catch (_) {}
}

// ── TAB: Citas Recibidas ──────────────────────────────────────────────────────
async function cargarCitasQR() {
    const estado = document.getElementById('filtroCitasQR')?.value || '';
    const url = '/admin/supabase/citas-qr' + (estado ? `?estado=${estado}` : '');
    const tbody = document.getElementById('citasQRBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Cargando…</td></tr>';
    try {
        const data = await fetchAPI(url);
        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary);">No hay citas.</td></tr>';
            return;
        }
        const estadoColor = { pendiente: 'var(--warning)', sincronizada: 'var(--secondary)', rechazada: 'var(--accent)', cancelada: 'var(--text-muted)' };
        tbody.innerHTML = data.map(c => {
            const vetNombre = c.veterinarios?.nombre || '—';
            const color = estadoColor[c.estado] || 'var(--text-muted)';
            const fecha = new Date(c.created_at).toLocaleString('es', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
            return `<tr>
                <td><strong>${c.fecha_cita}</strong><br><small>${c.hora_cita?.slice(0,5)}</small></td>
                <td>${c.nombre_cliente}<br><small style="color:var(--text-secondary);">${c.telefono}</small></td>
                <td>${c.nombre_mascota}<br><small style="color:var(--text-secondary);">${c.tipo_mascota || ''}</small></td>
                <td>${vetNombre}</td>
                <td><span class="badge" style="background:${color}; color:#fff;">${c.estado}</span></td>
                <td style="font-size:0.8rem;">${fecha}</td>
                <td>${c.estado === 'pendiente'
                    ? `<button onclick="cancelarCitaQR('${c.id}')" class="av-btn" style="height:28px; padding:0 10px; font-size:12px;">Cancelar</button>`
                    : '—'
                }</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
    }
}

async function cancelarCitaQR(id) {
    if (!confirm('¿Cancelar esta cita?')) return;
    try {
        await fetchAPI(`/admin/supabase/citas-qr/${id}`, { method: 'DELETE' });
        showNotification('Cita cancelada', 'success');
        cargarCitasQR();
    } catch (err) {
        showNotification('Error al cancelar: ' + err.message, 'error');
    }
}

document.getElementById('filtroCitasQR')?.addEventListener('change', cargarCitasQR);

// ── TAB: Horarios ─────────────────────────────────────────────────────────────
async function inicializarTabHorarios() {
    await cargarSelectVetsHorario();
}

async function cargarSelectVetsHorario() {
    try {
        const vets = await fetchAPI('/admin/supabase/veterinarios');
        const sel = document.getElementById('selectVetHorario');
        const selModal = document.getElementById('horarioVetId');
        if (!sel) return;
        const opts = (Array.isArray(vets) ? vets.filter(v => v.activo) : [])
            .map(v => `<option value="${v.id}">${v.nombre}</option>`).join('');
        sel.innerHTML = '<option value="">Seleccionar veterinario…</option>' + opts;
        if (selModal) selModal.innerHTML = '<option value="">Seleccionar…</option>' + opts;
    } catch (_) {}
}

async function cargarHorariosVet() {
    const vetId = document.getElementById('selectVetHorario')?.value;
    const grid = document.getElementById('horariosGrid');
    if (!grid) return;
    if (!vetId) {
        grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:var(--text-secondary);">Seleccioná un veterinario.</p>';
        return;
    }
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Cargando…</p>';
    try {
        const horarios = await fetchAPI(`/admin/supabase/horarios?amivets_usuario_id=${vetId}`);

        // Agrupar por día
        const porDia = Array.from({ length: 7 }, () => []);
        (Array.isArray(horarios) ? horarios : []).forEach(h => porDia[h.dia_semana].push(h));

        grid.innerHTML = DIAS_LABEL.map((dia, idx) => {
            const bloques = porDia[idx];
            const bloquesHTML = bloques.length
                ? bloques.map(b => `
                    <div style="background:var(--secondary-subtle); border:1px solid var(--primary); border-radius:8px; padding:6px 8px; margin-bottom:6px; font-size:.8rem;">
                        <div style="font-weight:600; color:var(--primary);">${b.hora_inicio.slice(0,5)} – ${b.hora_fin.slice(0,5)}</div>
                        <div style="color:var(--text-secondary);">${b.duracion_consulta_minutos} min / bloque</div>
                        <button onclick="eliminarHorario(${b.id})" style="margin-top:4px; background:none; border:none; color:var(--accent); cursor:pointer; font-size:.75rem; padding:0;">${ICONS.close} Eliminar</button>
                    </div>`).join('')
                : '<p style="font-size:.8rem; color:var(--text-secondary); text-align:center;">Sin horario</p>';
            return `
                <div style="background:var(--surface,#fff); border:1px solid var(--border); border-radius:12px; padding:.75rem;">
                    <div style="font-weight:700; font-size:.85rem; margin-bottom:.5rem; color:var(--text-primary);">${dia}</div>
                    ${bloquesHTML}
                </div>`;
        }).join('');
    } catch (err) {
        grid.innerHTML = `<p style="grid-column:1/-1; color:red;">Error: ${err.message}</p>`;
    }
}

async function eliminarHorario(id) {
    if (!confirm('¿Eliminar este bloque de horario?')) return;
    try {
        await fetchAPI(`/admin/supabase/horarios/${id}`, { method: 'DELETE' });
        showNotification('Horario eliminado', 'success');
        cargarHorariosVet();
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
}

function abrirModalNuevoHorario() {
    document.getElementById('horarioEditId').value = '';
    document.getElementById('formNuevoHorario').reset();
    // Pre-seleccionar el vet activo en el select del modal
    const vetId = document.getElementById('selectVetHorario')?.value;
    if (vetId) document.getElementById('horarioVetId').value = vetId;
    document.getElementById('modalHorarioTitulo').textContent = 'Agregar Bloque de Horario';
    document.getElementById('modalNuevoHorario').classList.add('show');
}

async function guardarHorario(e) {
    e.preventDefault();
    const payload = {
        amivets_usuario_id: parseInt(document.getElementById('horarioVetId').value),
        dia_semana:         parseInt(document.getElementById('horarioDia').value),
        hora_inicio:     document.getElementById('horarioInicio').value,
        hora_fin:        document.getElementById('horarioFin').value,
        duracion_consulta_minutos: parseInt(document.getElementById('horarioDuracion').value),
        activo:          true,
    };
    const editId = document.getElementById('horarioEditId').value;
    try {
        if (editId) {
            await fetchAPI(`/admin/supabase/horarios/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await fetchAPI('/admin/supabase/horarios', { method: 'POST', body: JSON.stringify(payload) });
        }
        showNotification('Horario guardado', 'success');
        document.getElementById('modalNuevoHorario').classList.remove('show');
        cargarHorariosVet();
    } catch (err) {
        showNotification('Error: ' + err.message, 'error');
    }
}

// ── TAB: Veterinarios QR (solo lectura — fuente: DB principal) ────────────────
async function cargarVetsQR() {
    const tbody = document.getElementById('vetsQRBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Cargando…</td></tr>';
    try {
        const vets = await fetchAPI('/admin/supabase/veterinarios');
        if (!Array.isArray(vets) || vets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-secondary);">No hay veterinarios activos. Agregalos en la sección Usuarios.</td></tr>';
            return;
        }
        tbody.innerHTML = vets.map(v => `<tr>
            <td>${v.id}</td>
            <td>${v.nombre}</td>
            <td>${v.activo
                ? `<span class="status-pill status-pill--ok">${ICONS.checkCircle} Activo</span>`
                : `<span class="status-pill status-pill--muted">${ICONS.xCircle} Inactivo</span>`}</td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
    }
}

// Actualizar badge al cargar la app
setTimeout(actualizarBadgeCitasQR, 2000);

export { cargarCitasQR, cancelarCitaQR, cargarHorariosVet, eliminarHorario, abrirModalNuevoHorario, guardarHorario, actualizarBadgeCitasQR };

// El router del shell 1A (etapa 2b) llama a init(); la nav actual lo hace vía el
// listener [data-target="sec-citas-web"] de arriba.
export function init() {
    cargarCitasQR();
    actualizarBadgeCitasQR();
}
