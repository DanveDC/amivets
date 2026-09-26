// app.js — bootstrap fino del SPA (etapa 2a: troceo de app.js en módulos ES).
//
// Este archivo reemplaza al monolito de 4608 líneas. Ahora sólo:
//   1. importa core/* y las 11 secciones,
//   2. re-expone en window.* los handlers referenciados por onclick/onchange/…
//      inline (en index.html y en el HTML que generan los renderers),
//   3. corre el arranque existente en DOMContentLoaded, sin cambiar su lógica.
//
// La navegación por pestañas del shell 1A vive en core/router.js (reemplaza al
// viejo core/legacy-nav.js); el command palette en core/cmdk.js.
//
// Se carga como <script type="module">; auth.js sigue siendo un script clásico
// cargado antes (expone window.logout, usado por core/api.js).

import { fetchAPI } from './core/api.js';
import { openModal, closeModal, debounce, showNotification } from './core/ui.js';
import { initSearchableSelect } from './core/select.js';
import { initSession } from './core/session.js';
import * as router from './core/router.js';
import * as cmdk from './core/cmdk.js';
import * as notificaciones from './core/notificaciones.js';

import * as consultorio from './sections/consultorio.js';
import * as hoy from './sections/hoy.js';
import * as agenda from './sections/agenda.js';
import * as propietarios from './sections/propietarios.js';
import * as inventario from './sections/inventario.js';
import * as facturacion from './sections/facturacion.js';
import * as ordenes from './sections/citas-pendientes.js';
import * as citasWeb from './sections/citas-web.js';
import * as catalogo from './sections/catalogo.js';
import * as usuarios from './sections/usuarios.js';
import * as perfil from './sections/perfil.js';
import * as historialPrecios from './sections/historial-precios.js';
import * as ordenAbierta from './sections/orden-abierta.js';
import * as bandejaGestor from './sections/bandeja-gestor.js';

// ─────────────────────────────────────────────────────────────────────────────
// window.* — handlers referenciados por atributos on*= inline. En el monolito
// estos vivían en el global del script clásico (por nombre) o en window.*
// explícito; como módulo nada es global, así que se re-exponen acá.
// ─────────────────────────────────────────────────────────────────────────────
Object.assign(window, {
    // core/ui
    showNotification,
    // core/router (eran globales del script clásico)
    showSection: router.showSection,
    // agenda
    checkInCita: agenda.checkInCita,
    atenderDesdeOrden: agenda.atenderDesdeOrden,
    verDetallesDesdeAgenda: agenda.verDetallesDesdeAgenda,
    // consultorio
    seleccionarMascota: consultorio.seleccionarMascota,
    switchPetTab: consultorio.switchPetTab,
    verConsultaCompleta: consultorio.verConsultaCompleta,
    facturarConsultaSinOrden: consultorio.facturarConsultaSinOrden,
    cambiarEstadoServicio: consultorio.cambiarEstadoServicio,
    eliminarServicioConsulta: consultorio.eliminarServicioConsulta,
    editarServicioConsulta: consultorio.editarServicioConsulta,
    toggleForm: consultorio.toggleForm,
    setQuickAction: consultorio.setQuickAction,
    abrirRegistroClinico: consultorio.abrirRegistroClinico,
    verServicioDetalle: consultorio.verServicioDetalle,
    exportarConsultaPDF: consultorio.exportarConsultaPDF,
    exportarRecetaPDF: consultorio.exportarRecetaPDF,
    submitClinico: consultorio.submitClinico,
    submitNota: consultorio.submitNota,
    cargarNotasPet: consultorio.cargarNotasPet,
    editarNota: consultorio.editarNota,
    guardarEdicionNota: consultorio.guardarEdicionNota,
    borrarNota: consultorio.borrarNota,
    abrirModalReceta: consultorio.abrirModalReceta,
    abrirEditarMascota: consultorio.abrirEditarMascota,
    confirmEliminarMascota: consultorio.confirmEliminarMascota,
    // propietarios
    abrirEditarPropietario: propietarios.abrirEditarPropietario,
    confirmEliminarPropietario: propietarios.confirmEliminarPropietario,
    verMascotasPropietario: propietarios.verMascotasPropietario,
    // inventario
    abrirEditarProducto: inventario.abrirEditarProducto,
    abrirMovimientoStock: inventario.abrirMovimientoStock,
    confirmarEliminarProducto: inventario.confirmarEliminarProducto,
    abrirHistorialProducto: inventario.abrirHistorialProducto,
    // reportes
    // ordenes
    atenderOrden: ordenes.atenderOrden,
    abrirOrden: ordenAbierta.abrirOrden,
    // facturacion
    exportarFacturaPDF: facturacion.exportarFacturaPDF,
    exportarAbonoPDF: facturacion.exportarAbonoPDF,
    abrirModalAbono: facturacion.abrirModalAbono,
    abrirPreviewFactura: facturacion.abrirPreviewFactura,
    // citas-web
    cargarCitasQR: citasWeb.cargarCitasQR,
    cancelarCitaQR: citasWeb.cancelarCitaQR,
    cargarHorariosVet: citasWeb.cargarHorariosVet,
    eliminarHorario: citasWeb.eliminarHorario,
    abrirModalNuevoHorario: citasWeb.abrirModalNuevoHorario,
    guardarHorario: citasWeb.guardarHorario,
    // catalogo
    cargarCatalogo: catalogo.cargarCatalogo,
    cargarCategoriasSelect: catalogo.cargarCategoriasSelect,
    abrirModalServicio: catalogo.abrirModalServicio,
    guardarServicio: catalogo.guardarServicio,
    desactivarServicio: catalogo.desactivarServicio,
    // usuarios
    abrirEditarUsuario: usuarios.abrirEditarUsuario,
    toggleUsuarioActivo: usuarios.toggleUsuarioActivo,
    deleteUsuario: usuarios.deleteUsuario,
});

// Estado compartido que un onclick inline referencia por nombre
// (editarNota -> "cargarNotasPet(currentMascotaId)"). consultorio.js lo mantiene
// sincronizado con setCurrentMascotaId(); acá sólo se fija el valor inicial.
window.currentMascotaId = consultorio.currentMascotaId;

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    router.init();
    cmdk.init();
    notificaciones.init();
    initSession();
    historialPrecios.initHistorialPreciosModal();
    consultorio.setupRazasPerro();
    consultorio.setupSearch();
    consultorio.setupConsultorioSearch();
    consultorio.initConsultorio();
    consultorio.initConsultaAbierta();
    hoy.initHoy();
    ordenAbierta.initOrdenAbierta();
    bandejaGestor.initBandejaGestor();

    // Initialize custom selects logic
    consultorio.initCustomSelects();

    // Listeners para botones de modal
    document.getElementById('btnRegistrarPropietario')?.addEventListener('click', () => openModal('modalPropietario'));
    document.getElementById('btnRegistrarMascota')?.addEventListener('click', async () => {
        // Mismo hallazgo que sections/mascotas.js::wireNuevaMascota: sin
        // esperar esto, initCustomSelects() (fire-and-forget más arriba)
        // puede no haber terminado y ownerSelectInstance sigue null.
        await consultorio.whenCustomSelectsReady();
        // Refresh owners list when opening pet registration
        try {
            const propietariosList = await fetchAPI('/propietarios/');
            const ownerOptions = propietariosList.map(p => ({
                value: p.id,
                label: `${p.nombre} ${p.apellido}`,
                subtext: `Cédula: ${p.cedula}`
            }));
            consultorio.ownerSelectInstance?.setOptions(ownerOptions);
        } catch (e) { }
        openModal('modalMascota');
    });
    document.getElementById('btnRegistrarConsulta')?.addEventListener('click', () => {
        if (!consultorio.currentMascotaId) {
            alert('Por favor selecciona un paciente primero.');
            return;
        }
        consultorio.abrirFormularioConsulta();
    });
    document.getElementById('btnGenerarOrden')?.addEventListener('click', () => {
        if (!consultorio.currentMascotaId) {
            alert('Para generar una orden, primero busque y seleccione el paciente en el Módulo de Consultorio.');
            router.showSection('sec-consultorio');
            return;
        }
        consultorio.abrirFormularioConsulta();
    });
    document.getElementById('btnNuevaCita')?.addEventListener('click', async () => {
        const input = document.getElementById('citaMascotaSearch');
        if (input && !input.dataset.initialized) {
            input.dataset.initialized = 'true';
            try {
                const mascotas = await fetchAPI('/mascotas/?skip=0&limit=300');
                const options = mascotas.map(m => ({
                    value: m.id,
                    label: `${m.nombre} - [${m.especie}] (Cód: ${m.codigo_historia || m.id})`
                }));
                initSearchableSelect(input, options, (val) => {
                    document.getElementById('citaMascotaId').value = val;
                });
            } catch (e) {
                console.error("Error fetching mascotas for select", e);
            }
        }
        openModal('modalCita');
    });

    // Forms Handlers
    document.getElementById('formPropietario')?.addEventListener('submit', propietarios.handlePropietarioSubmit);
    document.getElementById('searchPropietario')?.addEventListener('input', (e) => propietarios.loadPropietarios(e.target.value));
    document.getElementById('btnRegistrarPropietarioAlt')?.addEventListener('click', () => openModal('modalPropietario'));
    document.getElementById('formMascota')?.addEventListener('submit', consultorio.handleMascotaSubmit);
    document.getElementById('formEditarPropietario')?.addEventListener('submit', propietarios.handleEditarPropietarioSubmit);
    document.getElementById('formEditarMascota')?.addEventListener('submit', consultorio.handleEditarMascotaSubmit);
    document.getElementById('formConsulta')?.addEventListener('submit', consultorio.handleConsultaSubmit);
    document.getElementById('formCita')?.addEventListener('submit', agenda.handleCitaSubmit);
    document.getElementById('formProducto')?.addEventListener('submit', inventario.handleProductoSubmit);
    document.getElementById('formEditarProducto')?.addEventListener('submit', inventario.handleEditarProductoSubmit);
    document.getElementById('formMovimientoStock')?.addEventListener('submit', inventario.handleMovimientoStockSubmit);
    document.getElementById('btnNuevoProducto')?.addEventListener('click', () => openModal('modalProducto'));
    document.getElementById('searchInventario')?.addEventListener('input', debounce((e) => inventario.loadInventario(e.target.value), 300));
    // Tarea 11: el botón "Bajo Stock" (que duplicaba todo el renderizado de
    // loadInventario inline, contra una tabla vieja de 7 columnas) se
    // reemplaza por la pill "Bajo mínimo" de la propia sec-inventario --
    // mismo filtro, un solo renderer (inventario.js::loadInventario).
    document.getElementById('btnShowModalUser')?.addEventListener('click', () => openModal('modalNuevoUsuario'));
    document.getElementById('formNuevoUsuario')?.addEventListener('submit', usuarios.handleNuevoUsuarioSubmit);
    document.getElementById('formEditarUsuario')?.addEventListener('submit', usuarios.handleEditarUsuarioSubmit);
    document.getElementById('formTransferir')?.addEventListener('submit', consultorio.handleTransferirSubmit);
    document.getElementById('formReceta')?.addEventListener('submit', consultorio.handleRecetaSubmit);

    document.querySelectorAll('.pet-nav-item').forEach(el => {
        el.addEventListener('click', () => consultorio.switchPetTab(el.dataset.tab));
    });

    consultorio.cargarVeterinarios();
    ordenes.cargarBadgeOrdenes();

    // Global modal close handlers
    document.addEventListener('click', (e) => {
        // Close via 'X' or 'Cancelar'
        const closeBtn = e.target.closest('.close');
        if (closeBtn && closeBtn.dataset.modal) {
            closeModal(closeBtn.dataset.modal);
            return;
        }
        const cancelBtn = e.target.closest('[data-close]');
        if (cancelBtn) {
            closeModal(cancelBtn.dataset.close);
            return;
        }
        // Close via backdrop click
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });

    // Profile Form Handlers
    const formPerfil = document.getElementById('formPerfilPassword');
    if (formPerfil) {
        formPerfil.addEventListener('submit', perfil.handlePerfilPasswordSubmit);
    }
    // The initial section is chosen by router.init() (from the URL hash,
    // default sec-consultorio) — no explicit showSection() needed here.
});
