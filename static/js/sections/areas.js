// ============================================
// ÁREAS Y GESTORES (areas-y-gestores)
// ============================================
// Pantalla de admin: alta/edición de áreas de despacho, qué usuarios las
// atienden (gestor_area) y qué servicios del catálogo despachan
// (CatalogoServicio.area_id). Al confirmar una orden, los servicios de un área
// con gestores quedan ASIGNADOS y aparecen en "Mi bandeja" de ese gestor.

import { fetchAPI } from '../core/api.js';
import { showNotification, escapeHtml, openModal, closeModal, ICONS } from '../core/ui.js';

// Roles que pueden atender un área: el gestor, y el veterinario que además
// despacha un área (decisión 5, "una persona con varios roles").
const ROLES_ATIENDEN = ['gestor', 'veterinario'];

const METODOS_PAGO_LABEL = {
    TRANSFERENCIA: 'Transferencia',
    EFECTIVO: 'Efectivo',
    ZELLE: 'Zelle',
    CHEQUE: 'Cheque',
    OTRO: 'Otro',
};

let areas = [];
let selectedId = null;
let wired = false;

// ── Gestores externos (gestor-externo-crud) ─────────────────────────────────
let gestoresExternos = [];
let geAreasGestorId = null; // gestor cuyo modal de áreas está abierto
let geUltimoFoco = null;    // elemento a devolver el foco al cerrar un modal

export async function loadAreas() {
    wire();
    try {
        areas = (await fetchAPI('/areas/')) || [];
    } catch (err) {
        showNotification(err.message || 'No se pudieron cargar las áreas', 'error');
        return;
    }
    renderLista();
    if (selectedId && areas.some(a => a.id === selectedId)) {
        await seleccionarArea(selectedId);
    } else {
        nuevaArea();
    }

    // Si la pestaña "Gestores externos" ya estaba activa (reingreso a la
    // sección), refresca su tabla también -- mismo criterio que `areas`
    // arriba, que siempre se recarga al entrar.
    const tabExternos = document.getElementById('tab-gestores-externos');
    if (tabExternos && !tabExternos.hidden) {
        await cargarGestoresExternos();
    }
}

function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('btnAreaNueva')?.addEventListener('click', nuevaArea);
    document.getElementById('formArea')?.addEventListener('submit', guardarArea);
    document.getElementById('btnAreaAgregarGestor')?.addEventListener('click', agregarGestor);
    document.getElementById('btnAreaAgregarServicio')?.addEventListener('click', asignarServicio);
    document.getElementById('areasLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-area-id]');
        if (btn) seleccionarArea(Number(btn.dataset.areaId));
    });
    document.getElementById('areaGestoresLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-gestor]');
        if (btn) quitarGestor(Number(btn.dataset.quitarGestor));
    });
    document.getElementById('areaServiciosLista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-servicio]');
        if (btn) quitarServicio(Number(btn.dataset.quitarServicio));
    });

    wireTabs();
    wireGestoresExternos();
}

// ── Sub-tabs "Áreas internas" / "Gestores externos" ────────────────────────
function wireTabs() {
    document.querySelectorAll('#sec-areas .ar-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => cambiarArTab(btn.dataset.arTab));
    });
}

function cambiarArTab(target) {
    document.querySelectorAll('#sec-areas .ar-tab-btn').forEach(b => {
        const activo = b.dataset.arTab === target;
        b.classList.toggle('active', activo);
        b.setAttribute('aria-selected', String(activo));
    });
    document.querySelectorAll('#sec-areas .ar-tab-content').forEach(c => {
        c.hidden = c.id !== target;
    });
    if (target === 'tab-gestores-externos') cargarGestoresExternos();
}

function renderLista() {
    const cont = document.getElementById('areasLista');
    if (!cont) return;
    if (!areas.length) {
        cont.innerHTML = '<p class="rp-empty-text">Todavía no hay áreas. Creá la primera.</p>';
        return;
    }
    cont.innerHTML = areas.map(a => `
        <button type="button" class="cat-item${a.id === selectedId ? ' cat-item--active' : ''}${a.activo ? '' : ' cat-item--inactivo'}" data-area-id="${a.id}">
            <div class="cat-item-info">
                <span class="cat-item-nombre">${escapeHtml(a.nombre)}</span>
                <span class="cat-item-sub">${escapeHtml(a.codigo)}${a.requiere_adjunto ? ' · exige adjunto' : ''}${a.activo ? '' : ' · inactiva'}</span>
            </div>
        </button>`).join('');
}

function nuevaArea() {
    selectedId = null;
    document.getElementById('formArea')?.reset();
    document.getElementById('areaId').value = '';
    document.getElementById('areaCodigo').disabled = false;
    document.getElementById('areaActiva').checked = true;
    document.getElementById('areaAsignaciones').hidden = true;
    renderLista();
    document.getElementById('areaNombre')?.focus();
}

async function seleccionarArea(id) {
    const area = areas.find(a => a.id === id);
    if (!area) return;
    selectedId = id;
    renderLista();
    document.getElementById('areaId').value = String(area.id);
    document.getElementById('areaNombre').value = area.nombre;
    document.getElementById('areaCodigo').value = area.codigo;
    // El código es la clave única del área: no se edita (AreaServicioUpdate no lo acepta).
    document.getElementById('areaCodigo').disabled = true;
    document.getElementById('areaRequiereAdjunto').checked = !!area.requiere_adjunto;
    document.getElementById('areaActiva').checked = !!area.activo;
    document.getElementById('areaAsignaciones').hidden = false;
    await Promise.all([cargarGestores(), cargarServicios()]);
}

async function guardarArea(e) {
    e.preventDefault();
    const id = document.getElementById('areaId').value;
    const nombre = document.getElementById('areaNombre').value.trim();
    const requiere_adjunto = document.getElementById('areaRequiereAdjunto').checked;
    const activo = document.getElementById('areaActiva').checked;
    try {
        let area;
        if (id) {
            area = await fetchAPI(`/areas/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ nombre, requiere_adjunto, activo }),
            });
        } else {
            const codigo = document.getElementById('areaCodigo').value.trim().toUpperCase();
            area = await fetchAPI('/areas/', {
                method: 'POST',
                body: JSON.stringify({ nombre, codigo, requiere_adjunto, activo }),
            });
        }
        if (!area) return;
        showNotification(id ? 'Área actualizada' : 'Área creada', 'success');
        selectedId = area.id;
        await loadAreas();
    } catch (err) {
        showNotification(err.message || 'No se pudo guardar el área', 'error');
    }
}

async function cargarGestores() {
    const lista = document.getElementById('areaGestoresLista');
    const select = document.getElementById('areaGestorSelect');
    let gestores = [];
    let usuarios = [];
    try {
        [gestores, usuarios] = await Promise.all([
            fetchAPI(`/areas/${selectedId}/gestores`),
            fetchAPI('/usuarios/'),
        ]);
    } catch (err) {
        showNotification(err.message || 'No se pudieron cargar los gestores', 'error');
        return;
    }
    gestores = gestores || [];
    lista.innerHTML = gestores.length
        ? gestores.map(g => `
            <li>
                <span>${escapeHtml(g.username)} <small class="text-muted">(${escapeHtml(g.role)}${g.activo ? '' : ', inactivo'})</small></span>
                <button type="button" class="av-btn av-btn--ghost" data-quitar-gestor="${g.usuario_id}">Quitar</button>
            </li>`).join('')
        : '<li class="ar-vacio">Sin gestores: los servicios de esta área quedan sin asignar al confirmar la orden.</li>';

    const asignados = new Set(gestores.map(g => g.usuario_id));
    const candidatos = (usuarios || []).filter(u => u.is_active && ROLES_ATIENDEN.includes(u.role) && !asignados.has(u.id));
    select.innerHTML = candidatos.length
        ? '<option value="">Elegí un usuario…</option>' + candidatos
            .map(u => `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`).join('')
        : '<option value="">No hay gestores ni veterinarios activos sin asignar</option>';
}

async function agregarGestor() {
    const usuarioId = Number(document.getElementById('areaGestorSelect').value);
    if (!usuarioId) {
        showNotification('Elegí un usuario para sumar como gestor', 'warning');
        return;
    }
    try {
        await fetchAPI(`/areas/${selectedId}/gestores`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: usuarioId }),
        });
        showNotification('Gestor agregado al área', 'success');
        await cargarGestores();
    } catch (err) {
        showNotification(err.message || 'No se pudo agregar el gestor', 'error');
    }
}

async function quitarGestor(usuarioId) {
    try {
        await fetchAPI(`/areas/${selectedId}/gestores/${usuarioId}`, { method: 'DELETE' });
        showNotification('Gestor quitado del área', 'success');
        await cargarGestores();
    } catch (err) {
        showNotification(err.message || 'No se pudo quitar el gestor', 'error');
    }
}

async function cargarServicios() {
    const lista = document.getElementById('areaServiciosLista');
    const select = document.getElementById('areaServicioSelect');
    let servicios = [];
    try {
        servicios = (await fetchAPI('/catalogo/?solo_activos=true&limit=1000')) || [];
    } catch (err) {
        showNotification(err.message || 'No se pudo cargar el catálogo', 'error');
        return;
    }
    const propios = servicios.filter(s => s.area_id === selectedId);
    lista.innerHTML = propios.length
        ? propios.map(s => `
            <li>
                <span>${escapeHtml(s.nombre)} <small class="text-muted">${escapeHtml(s.categoria)}</small></span>
                <button type="button" class="av-btn av-btn--ghost" data-quitar-servicio="${s.id}">Quitar</button>
            </li>`).join('')
        : '<li class="ar-vacio">Esta área todavía no despacha ningún servicio.</li>';

    // Solo los servicios sin área: mover uno de otra área se hace quitándolo allá primero.
    const libres = servicios.filter(s => !s.area_id);
    select.innerHTML = libres.length
        ? '<option value="">Elegí un servicio…</option>' + libres
            .map(s => `<option value="${s.id}">${escapeHtml(s.nombre)} — ${escapeHtml(s.categoria)}</option>`).join('')
        : '<option value="">No hay servicios sin área</option>';
}

async function setAreaServicio(servicioId, areaId) {
    await fetchAPI(`/catalogo/${servicioId}`, {
        method: 'PUT',
        body: JSON.stringify({ area_id: areaId }),
    });
}

async function asignarServicio() {
    const servicioId = Number(document.getElementById('areaServicioSelect').value);
    if (!servicioId) {
        showNotification('Elegí un servicio del catálogo', 'warning');
        return;
    }
    try {
        await setAreaServicio(servicioId, selectedId);
        showNotification('Servicio asignado al área', 'success');
        await cargarServicios();
    } catch (err) {
        showNotification(err.message || 'No se pudo asignar el servicio', 'error');
    }
}

async function quitarServicio(servicioId) {
    try {
        await setAreaServicio(servicioId, null);
        showNotification('Servicio quitado del área', 'success');
        await cargarServicios();
    } catch (err) {
        showNotification(err.message || 'No se pudo quitar el servicio', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTORES EXTERNOS (gestor-externo-crud): proveedores/laboratorios de
// referencia sin login que reciben trabajo despachado a su área. CRUD +
// asignación de áreas, mismo criterio admin-only que el resto de la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

function wireGestoresExternos() {
    document.getElementById('btnGestorExternoNuevo')?.addEventListener('click', abrirModalGestorExternoNuevo);
    document.getElementById('formGestorExterno')?.addEventListener('submit', guardarGestorExterno);

    document.getElementById('gestoresExternosBody')?.addEventListener('click', (e) => {
        const btnEditar = e.target.closest('[data-ge-editar]');
        if (btnEditar) { abrirModalGestorExternoEditar(Number(btnEditar.dataset.geEditar)); return; }
        const btnAreas = e.target.closest('[data-ge-areas]');
        if (btnAreas) { abrirModalAreasGestorExterno(Number(btnAreas.dataset.geAreas)); return; }
        const btnToggle = e.target.closest('[data-ge-toggle-activo]');
        if (btnToggle) {
            toggleActivoGestorExterno(Number(btnToggle.dataset.geToggleActivo), btnToggle.dataset.geActivoActual === 'true');
            return;
        }
        const btnEliminar = e.target.closest('[data-ge-eliminar]');
        if (btnEliminar) { confirmarEliminarGestorExterno(Number(btnEliminar.dataset.geEliminar), btnEliminar.dataset.geNombre); }
    });

    document.getElementById('geAreasChecklist')?.addEventListener('change', (e) => {
        const check = e.target.closest('[data-ge-area-id]');
        if (check) toggleAreaGestorExterno(Number(check.dataset.geAreaId), check.checked);
    });

    // Foco: al abrir cualquiera de los dos modales nuevos se guarda quién
    // disparó la apertura, para devolvérselo al cerrar (fixing-accessibility:
    // "focus must move INTO modal on open and RETURN to trigger on close").
    ['modalGestorExterno', 'modalGestorExternoAreas'].forEach(id => {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target.closest('.close') || e.target.closest('[data-close]') || e.target === modal) {
                devolverFoco();
            }
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeModal(id); devolverFoco(); return; }
            if (e.key === 'Tab') trapFocusModal(modal, e);
        });
    });
}

function devolverFoco() {
    if (geUltimoFoco && typeof geUltimoFoco.focus === 'function') geUltimoFoco.focus();
    geUltimoFoco = null;
}

function trapFocusModal(modal, e) {
    const focusables = modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

async function cargarGestoresExternos() {
    const tbody = document.getElementById('gestoresExternosBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Cargando…</td></tr>';
    try {
        gestoresExternos = (await fetchAPI('/gestores-externos/?limit=200')) || [];
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent);">Error: ${escapeHtml(err.message)}</td></tr>`;
        return;
    }
    renderGestoresExternos();
}

function renderGestoresExternos() {
    const tbody = document.getElementById('gestoresExternosBody');
    if (!tbody) return;
    if (!gestoresExternos.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary);">Todavía no hay gestores externos.</td></tr>';
        return;
    }
    tbody.innerHTML = gestoresExternos.map(g => `
        <tr>
            <td>${escapeHtml(g.rif)}</td>
            <td>${escapeHtml(g.nombre)} <small class="text-muted">${escapeHtml(g.telefono)}</small></td>
            <td>${escapeHtml(METODOS_PAGO_LABEL[g.metodo_pago] || g.metodo_pago)}</td>
            <td>${g.areas.length ? g.areas.map(a => escapeHtml(a.nombre)).join(', ') : '<span class="text-muted">Sin áreas</span>'}</td>
            <td>${g.activo
                ? `<span class="status-pill status-pill--ok">${ICONS.checkCircle} Activo</span>`
                : `<span class="status-pill status-pill--muted">${ICONS.xCircle} Inactivo</span>`}</td>
            <td style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="av-btn" data-ge-editar="${g.id}" title="Editar" aria-label="Editar ${escapeHtml(g.nombre)}">${ICONS.edit}</button>
                <button type="button" class="av-btn" data-ge-areas="${g.id}">Áreas</button>
                <button type="button" class="av-btn" data-ge-toggle-activo="${g.id}" data-ge-activo-actual="${g.activo}">${g.activo ? 'Desactivar' : 'Activar'}</button>
                <button type="button" class="av-btn av-btn--ghost" data-ge-eliminar="${g.id}" data-ge-nombre="${escapeHtml(g.nombre)}" title="Eliminar" aria-label="Eliminar ${escapeHtml(g.nombre)}">${ICONS.trash}</button>
            </td>
        </tr>`).join('');
}

async function cargarUsuariosSelectGestorExterno(usuarioIdActual) {
    const select = document.getElementById('geUsuarioId');
    if (!select) return;
    let usuarios = [];
    try {
        usuarios = (await fetchAPI('/usuarios/')) || [];
    } catch (err) {
        usuarios = [];
    }
    select.innerHTML = '<option value="">Sin vincular</option>' + usuarios
        .map(u => `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`).join('');
    select.value = usuarioIdActual ? String(usuarioIdActual) : '';
}

function abrirModalGestorExternoNuevo() {
    geUltimoFoco = document.activeElement;
    document.getElementById('formGestorExterno')?.reset();
    document.getElementById('geId').value = '';
    document.getElementById('geRif').disabled = false;
    document.getElementById('geRifHint').hidden = true;
    document.getElementById('geActivoRow').hidden = true;
    document.getElementById('geActivo').checked = true;
    document.getElementById('gestorExternoTitulo').textContent = 'Nuevo gestor externo';
    cargarUsuariosSelectGestorExterno(null);
    openModal('modalGestorExterno');
    document.getElementById('geNombre')?.focus();
}

function abrirModalGestorExternoEditar(id) {
    const gestor = gestoresExternos.find(g => g.id === id);
    if (!gestor) return;
    geUltimoFoco = document.activeElement;
    document.getElementById('formGestorExterno')?.reset();
    document.getElementById('geId').value = String(gestor.id);
    document.getElementById('geNombre').value = gestor.nombre;
    document.getElementById('geRif').value = gestor.rif;
    // RIF inmutable con áreas asignadas (spec): se deshabilita en vez de
    // dejar que el backend rechace con 422 después de escribir.
    const tieneAreas = gestor.areas.length > 0;
    document.getElementById('geRif').disabled = tieneAreas;
    document.getElementById('geRifHint').hidden = !tieneAreas;
    document.getElementById('geTelefono').value = gestor.telefono;
    document.getElementById('geEsMovil').checked = !!gestor.es_movil;
    document.getElementById('geMetodoPago').value = gestor.metodo_pago;
    document.getElementById('geNumeroCuenta').value = gestor.numero_cuenta || '';
    document.getElementById('geZelle').value = gestor.zelle || '';
    document.getElementById('geActivoRow').hidden = false;
    document.getElementById('geActivo').checked = !!gestor.activo;
    document.getElementById('gestorExternoTitulo').textContent = 'Editar gestor externo';
    cargarUsuariosSelectGestorExterno(gestor.usuario_id);
    openModal('modalGestorExterno');
    document.getElementById('geNombre')?.focus();
}

async function guardarGestorExterno(e) {
    e.preventDefault();
    const id = document.getElementById('geId').value;
    const usuarioIdRaw = document.getElementById('geUsuarioId').value;
    const payload = {
        nombre: document.getElementById('geNombre').value.trim(),
        telefono: document.getElementById('geTelefono').value.trim(),
        metodo_pago: document.getElementById('geMetodoPago').value,
        numero_cuenta: document.getElementById('geNumeroCuenta').value.trim() || null,
        es_movil: document.getElementById('geEsMovil').checked,
        zelle: document.getElementById('geZelle').value.trim() || null,
        usuario_id: usuarioIdRaw ? Number(usuarioIdRaw) : null,
    };
    // El RIF solo viaja si el campo está habilitado (alta, o edición sin
    // áreas asignadas): mandarlo deshabilitado igual no rompe nada porque
    // el navegador no serializa inputs disabled, pero el valor tampoco tiene
    // por qué construirse a partir de un campo bloqueado.
    // Nombre, RIF y teléfono requeridos (spec 6.6): ya los bloquea el atributo
    // `required` de cada input -- este handler ni corre si el form no es
    // válido. El RIF duplicado (409) lo valida y reporta el backend.
    if (!id || !document.getElementById('geRif').disabled) {
        payload.rif = document.getElementById('geRif').value.trim();
    }
    if (id) {
        payload.activo = document.getElementById('geActivo').checked;
    }

    try {
        if (id) {
            await fetchAPI(`/gestores-externos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
            showNotification('Gestor externo actualizado', 'success');
        } else {
            await fetchAPI('/gestores-externos/', { method: 'POST', body: JSON.stringify(payload) });
            showNotification('Gestor externo creado', 'success');
        }
        closeModal('modalGestorExterno');
        devolverFoco();
        await cargarGestoresExternos();
    } catch (err) {
        showNotification(err.message || 'No se pudo guardar el gestor externo', 'error');
    }
}

async function toggleActivoGestorExterno(id, activoActual) {
    try {
        await fetchAPI(`/gestores-externos/${id}`, { method: 'PATCH', body: JSON.stringify({ activo: !activoActual }) });
        showNotification(activoActual ? 'Gestor externo desactivado' : 'Gestor externo activado', 'success');
        await cargarGestoresExternos();
    } catch (err) {
        showNotification(err.message || 'No se pudo cambiar el estado del gestor', 'error');
    }
}

async function confirmarEliminarGestorExterno(id, nombre) {
    if (!confirm(`¿Eliminar el gestor externo "${nombre}"? Solo es posible si no tiene áreas asignadas ni historial de notificaciones.`)) return;
    try {
        await fetchAPI(`/gestores-externos/${id}`, { method: 'DELETE' });
        showNotification('Gestor externo eliminado', 'success');
        await cargarGestoresExternos();
    } catch (err) {
        showNotification(err.message || 'No se pudo eliminar el gestor externo', 'error');
    }
}

function abrirModalAreasGestorExterno(id) {
    const gestor = gestoresExternos.find(g => g.id === id);
    if (!gestor) return;
    geUltimoFoco = document.activeElement;
    geAreasGestorId = id;
    document.getElementById('geAreasSubtitulo').textContent = `${gestor.nombre} (${gestor.rif})`;
    renderChecklistAreasGestorExterno(gestor);
    openModal('modalGestorExternoAreas');
    document.getElementById('geAreasChecklist')?.querySelector('input')?.focus();
}

function renderChecklistAreasGestorExterno(gestor) {
    const cont = document.getElementById('geAreasChecklist');
    if (!cont) return;
    const asignadas = new Set(gestor.areas.map(a => a.id));
    if (!areas.length) {
        cont.innerHTML = '<li class="ar-vacio">No hay áreas creadas todavía.</li>';
        return;
    }
    cont.innerHTML = areas.map(a => `
        <li>
            <label for="geArea${a.id}">
                <input type="checkbox" id="geArea${a.id}" data-ge-area-id="${a.id}" ${asignadas.has(a.id) ? 'checked' : ''}>
                ${escapeHtml(a.nombre)} <small class="text-muted">${escapeHtml(a.codigo)}${a.activo ? '' : ' · inactiva'}</small>
            </label>
        </li>`).join('');
}

async function toggleAreaGestorExterno(areaId, checked) {
    if (!geAreasGestorId) return;
    try {
        if (checked) {
            await fetchAPI(`/gestores-externos/${geAreasGestorId}/areas/`, {
                method: 'POST',
                body: JSON.stringify({ area_id: areaId }),
            });
        } else {
            await fetchAPI(`/gestores-externos/${geAreasGestorId}/areas/${areaId}`, { method: 'DELETE' });
        }
        showNotification(checked ? 'Área asignada' : 'Área desasignada', 'success');
        await cargarGestoresExternos();
        const gestor = gestoresExternos.find(g => g.id === geAreasGestorId);
        if (gestor) {
            document.getElementById('geAreasSubtitulo').textContent = `${gestor.nombre} (${gestor.rif})`;
        }
    } catch (err) {
        showNotification(err.message || 'No se pudo actualizar la asignación', 'error');
        // Revertir el checkbox visualmente: la petición falló (409/404), el
        // checklist no debe mentir sobre el estado real en el servidor.
        const input = document.querySelector(`#geAreasChecklist [data-ge-area-id="${areaId}"]`);
        if (input) input.checked = !checked;
    }
}
