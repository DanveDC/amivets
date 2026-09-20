// sections/consultorio.js — Consultorio: riel de pacientes, perfil del paciente,
// consulta clínica, expediente/servicios, notas, dictado por voz, clínica
// extendida (vacunas/desparasitaciones/hospitalizaciones/cirugías/pruebas),
// recetas, gráfica de peso, edición/transferencia de mascota y selects premium.
//
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// Únicas diferencias mecánicas:
//   - `currentMascotaId` sigue siendo el estado compartido; se escribe con
//     setCurrentMascotaId() que además sincroniza `window.currentMascotaId` para
//     el único onclick inline que lo referencia por nombre (editarNota()).
//   - Los 4 listeners de nivel superior de #modalDetalleConsulta llevan `?.`.
//   - Relación cíclica (segura) con facturacion.js y ordenes.js: sólo se usan
//     dentro de handlers, nunca en la evaluación del módulo.

import { fetchAPI, API_BASE_URL } from '../core/api.js';
import { ICONS, showNotification, openModal, closeModal, debounce } from '../core/ui.js';
import { createPrettySelect, initSearchableSelect } from '../core/select.js';
import { cargarFacturasMascota } from './facturacion.js';
import { cargarBadgeOrdenes } from './ordenes.js';
// Relación cíclica segura con hoy.js (hoy.js importa de este módulo). Sólo se usa
// dentro de un handler ("+ Servicio directo" en la pestaña Servicios).
import { abrirServicioDirectoParaMascota } from './hoy.js';
// Relación cíclica segura con core/router.js (router importa initConsultorio de
// este módulo). showSection es una función exportada hoisted; sólo se usa dentro
// de handlers, nunca en la evaluación del módulo.
import { showSection } from '../core/router.js';

// Estados de ServicioConsulta que ya descontaron insumos del stock (Tarea 06,
// decisión 4 — espejo de consumo_service.ESTADOS_CONSUMIDOS en el backend).
// El punto verde "aplicado" cubre los dos: un servicio FACTURADO sigue estando
// del lado ejecutado de la frontera.
const ESTADOS_SERVICIO_CONSUMIDOS = ['EJECUTADO', 'FACTURADO'];

// ============ STATE MANAGEMENT ============
export let currentMascotaId = null;
const setCurrentMascotaId = (value) => {
    currentMascotaId = value;
    // El único onclick inline que referencia currentMascotaId por nombre
    // (editarNota -> "cargarNotasPet(currentMascotaId)") corre en scope global;
    // en un módulo eso ya no resuelve, así que lo espejamos en window.
    window.currentMascotaId = value;
};

let weightChart = null;
let transferSelectInstance = null;

const RAZAS_PERROS = [
    "Labrador Retriever", "Pastor Alemán", "Golden Retriever", "Bulldog Francés",
    "Beagle", "Poodle (Caniche)", "Rottweiler", "Yorkshire Terrier", "Boxer",
    "Dachshund (Salchicha)", "Siberian Husky", "Chihuahua", "Gran Danés",
    "Pinscher", "Doberman", "Basset Hound", "Shih Tzu", "Pug (Carlino)",
    "Border Collie", "Cocker Spaniel", "Pitbull", "Mestizo / Otros"
];

let razaSelectInstance = null;
export let ownerSelectInstance = null;
let editRazaSelectInstance = null;

let currentViewedConsultaId = null;
let currentInventoryItems = [];
let _catalogSuggestTimeout = null;

const NOTA_CATEGORIA_LABELS = {
    general: 'General',
    seguimiento: 'Seguimiento',
    llamada: 'Llamada',
    incidencia: 'Incidencia',
};

// ============ DICTADO POR VOZ (Web Speech API) ============
// Sin prefijo en navegadores modernos, con prefijo webkit en Chrome/Chromium.
// Si ninguna existe (Firefox, Safari) queda undefined y el botón nunca se genera.
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let dictadoRecognition = null;
let dictadoActivoBtn = null;

let medicamentosCache = [];

// ============ EVOLUCION DE PESO (CHART) ============
const loadWeightChart = async () => {
    const container = document.getElementById('chartContainer');
    if (!container || !currentMascotaId) return;

    try {
        const data = await fetchAPI(`/mascotas/${currentMascotaId}/peso-history`);
        if (!data || data.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#6b7280;padding:2rem;">No hay registros de peso para mostrar la gráfica.</p>';
            return;
        }

        container.style.display = 'block';

        // Ensure canvas exists if container was overwritten previously
        if (!document.getElementById('weightChart')) {
            container.innerHTML = '<canvas id="weightChart"></canvas>';
        }

        const ctx = document.getElementById('weightChart').getContext('2d');

        if (weightChart) weightChart.destroy();

        weightChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.fecha).toLocaleDateString()),
                datasets: [{
                    label: 'Peso (kg)',
                    data: data.map(d => d.peso),
                    borderColor: '#4F46E5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: 'Evolución de Peso' }
                },
                scales: {
                    y: { beginAtZero: false, title: { display: true, text: 'kg' } }
                }
            }
        });
    } catch (error) {
        alert('Error al cargar gráfica: ' + error.message);
    }
};

const abrirTransferirMascota = async (id, nombre) => {
    try {
        const displayNombre = document.getElementById('transferNombreMascota');
        if (displayNombre) displayNombre.textContent = nombre;

        document.getElementById('transferNuevoPropietarioId').value = '';
        document.getElementById('transferMotivo').value = '';

        const propietarios = await fetchAPI('/propietarios/');
        const activePropietarios = propietarios.filter(p => p.activo !== false);
        const ownerOptions = activePropietarios.map(p => ({
            value: p.id,
            label: `${p.nombre} ${p.apellido}`,
            subtext: `Cédula: ${p.cedula}`
        }));

        if (!transferSelectInstance) {
            transferSelectInstance = createPrettySelect('transferPropietarioContainer',
                ownerOptions,
                'Buscar por cédula o nombre...',
                (val) => { document.getElementById('transferNuevoPropietarioId').value = val; }
            );
        } else {
            transferSelectInstance.setOptions(ownerOptions);
            transferSelectInstance.setValue('', 'Buscar por cédula o nombre...');
        }

        openModal('modalTransferir');
    } catch (error) {
        alert("Error al cargar propietarios para la transferencia: " + error.message);
    }
};

export const handleTransferirSubmit = async (e) => {
    e.preventDefault();
    if (!currentMascotaId) return;
    try {
        const data = {
            nuevo_propietario_id: parseInt(document.getElementById('transferNuevoPropietarioId').value),
            motivo: document.getElementById('transferMotivo').value
        };
        await fetchAPI(`/mascotas/${currentMascotaId}/transferir`, { method: 'POST', body: JSON.stringify(data) });
        alert('Mascota transferida correctamente.');
        closeModal('modalTransferir');
        // Recargar info
        if (currentMascotaId) seleccionarMascota(currentMascotaId, document.getElementById('displayNombreMascota').textContent);
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const initCustomSelects = async () => {
    // 1. Breed Select for Registration
    razaSelectInstance = createPrettySelect('selectMascotaRazaContainer',
        RAZAS_PERROS.map(r => ({ value: r, label: r })),
        'Escriba para buscar raza...',
        (val) => { document.getElementById('mascotaRaza').value = val; }
    );

    // 2. Owner Select for Registration
    try {
        const propietarios = await fetchAPI('/propietarios/');
        const ownerOptions = propietarios.map(p => ({
            value: p.id,
            label: `${p.nombre} ${p.apellido}`,
            subtext: `Cédula: ${p.cedula}`
        }));

        ownerSelectInstance = createPrettySelect('selectMascotaPropietarioContainer',
            ownerOptions,
            'Buscar por cédula o nombre...',
            (val) => { document.getElementById('mascotaPropietarioId').value = val; }
        );
    } catch (e) {
        console.error("Error loading owners for select", e);
    }

    // 3. Breed Select for Editing
    editRazaSelectInstance = createPrettySelect('editSelectMascotaRazaContainer',
        RAZAS_PERROS.map(r => ({ value: r, label: r })),
        'Escriba para buscar raza...',
        (val) => { document.getElementById('editMascotaRaza').value = val; }
    );
};

export const setupRazasPerro = () => {
    // This function is now mostly handled by initCustomSelects
    const especieSelect = document.getElementById('mascotaEspecie');
    if (!especieSelect) return;

    especieSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Perro') {
            razaSelectInstance?.setOptions(RAZAS_PERROS.map(r => ({ value: r, label: r })));
        } else {
            razaSelectInstance?.setOptions([]);
        }
    });

    // Same for edit modal
    const editEspecieSelect = document.getElementById('editMascotaEspecie');
    if (editEspecieSelect) {
        editEspecieSelect.addEventListener('change', (e) => {
            if (e.target.value === 'Perro') {
                editRazaSelectInstance?.setOptions(RAZAS_PERROS.map(r => ({ value: r, label: r })));
            } else {
                editRazaSelectInstance?.setOptions([]);
            }
        });
    }
};

export const handleMascotaSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            nombre: document.getElementById('mascotaNombre').value,
            especie: document.getElementById('mascotaEspecie').value,
            raza: document.getElementById('mascotaRaza').value || null,
            fecha_nacimiento: document.getElementById('mascotaFechaNacimiento').value || null,
            sexo: document.getElementById('mascotaSexo').value || null,
            color: document.getElementById('mascotaColor').value || null,
            estado_reproductivo: document.getElementById('mascotaEstadoReproductivo').value || null,
            propietario_id: parseInt(document.getElementById('mascotaPropietarioId').value)
        };
        const result = await fetchAPI('/mascotas/', { method: 'POST', body: JSON.stringify(data) });
        alert(`Mascota registrada: ${result.nombre}`);
        closeModal('modalMascota');
        // Refresh list if in consultorio (sección visible en el shell 1A).
        const secConsultorio = document.getElementById('sec-consultorio');
        if (secConsultorio && !secConsultorio.hidden) initConsultorio();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

export const handleEditarMascotaSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editMascotaId').value;
    const data = {
        nombre: document.getElementById('editMascotaNombre').value,
        especie: document.getElementById('editMascotaEspecie').value,
        raza: document.getElementById('editMascotaRaza').value || null,
        estado_reproductivo: document.getElementById('editMascotaEstadoReproductivo').value || null,
        fecha_nacimiento: document.getElementById('editMascotaFechaNacimiento').value || null,
        sexo: document.getElementById('editMascotaSexo').value || null,
        color: document.getElementById('editMascotaColor').value || null
    };
    try {
        await fetchAPI(`/mascotas/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        alert("Mascota actualizada correctamente");
        closeModal('modalEditarMascota');
        // Actualizar vista actual
        if (currentMascotaId == id) seleccionarMascota(id, data.nombre, data.especie);
        initConsultorio();
    } catch (error) {
        alert("Error: " + error.message);
    }
};

export const abrirEditarMascota = async (id) => {
    try {
        const m = await fetchAPI(`/mascotas/${id}`);
        document.getElementById('editMascotaId').value = m.id;
        document.getElementById('editMascotaNombre').value = m.nombre;
        document.getElementById('editMascotaEspecie').value = m.especie;
        document.getElementById('editMascotaRaza').value = m.raza || '';
        document.getElementById('editMascotaEstadoReproductivo').value = m.estado_reproductivo || 'No especificado';
        document.getElementById('editMascotaFechaNacimiento').value = m.fecha_nacimiento || '';
        document.getElementById('editMascotaSexo').value = m.sexo || '';
        document.getElementById('editMascotaColor').value = m.color || '';

        // Update custom select UI
        if (m.raza) {
            editRazaSelectInstance?.setValue(m.raza, m.raza);
        } else {
            editRazaSelectInstance?.setValue('', 'Escriba para buscar raza...');
        }

        openModal('modalEditarMascota');
    } catch (error) {
        alert("Error al cargar datos de la mascota");
    }
};

export const confirmEliminarMascota = async (id, nombre) => {
    if (confirm(`¿Estás seguro de que deseas eliminar a la mascota ${nombre}?\nEsta acción la desactivará del consultorio.`)) {
        try {
            await fetchAPI(`/mascotas/${id}`, { method: 'DELETE' });
            alert("Mascota eliminada con éxito.");
            document.getElementById('patientWrapper').style.display = 'none';
            document.getElementById('emptyPatientWrapper').style.display = 'flex';
            setCurrentMascotaId(null);
            initConsultorio();
        } catch (error) {
            alert(error.message);
        }
    }
};

export const abrirFormularioConsulta = () => {
    const role = localStorage.getItem('role');
    const isAdmin = (role === 'admin' || role === 'recepcionista');

    // Si es administrador, forzamos la creación de una "Orden de Turno" (Cita en sala), no el registro médico
    if (isAdmin) {
        showNotification("Modo Administración: Usted generará una orden para atención médica.", "info");
        document.getElementById('citaMascotaId').value = currentMascotaId;
        const inputSearch = document.getElementById('citaMascotaSearch');
        const nom = document.getElementById('displayNombreMascota')?.textContent || 'Paciente Seleccionado';
        if (inputSearch) inputSearch.value = nom;

        // Cargar fecha actual
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
        document.getElementById('citaFecha').value = localISOTime;
        document.getElementById('citaMotivo').value = "Turno para evaluación médica";

        openModal('modalCita');
        return;
    }

    const clinFields = document.querySelector('.clinical-field');
    const adminMsg = document.getElementById('adminConsultaMsg');
    const examenTextarea = document.getElementById('consultaExamen');

    // Pre-poblar fecha actual
    const consultaFecha = document.getElementById('consultaFecha');
    if (consultaFecha) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
        consultaFecha.value = localISOTime;
    }

    // Modo Médico (Doctor)
    if (clinFields) clinFields.style.display = 'block';
    if (adminMsg) adminMsg.style.display = 'none';
    if (examenTextarea) examenTextarea.required = true;

    // Pre-seleccionar al doctor actual si está logueado
    const user = localStorage.getItem('username');
    const selectVet = document.getElementById('consultaVeterinario');
    if (selectVet && user) {
        for (let opt of selectVet.options) {
            if (opt.text.toLowerCase().includes(user.toLowerCase())) {
                selectVet.value = opt.value;
                break;
            }
        }
    }

    openModal('modalConsulta');
};

export const handleConsultaSubmit = async (e) => {
    e.preventDefault();
    try {
        const isAdmin = localStorage.getItem('role') === 'admin';

        const vetSelect = document.getElementById('consultaVeterinario');
        const vetOption = vetSelect.options[vetSelect.selectedIndex];
        const veterinarioId = vetSelect.value ? parseInt(vetSelect.value) : null;
        const veterinarioNombre = vetOption?.dataset.username || null;

        // El backend ahora exige veterinario_id (Unidad E): no dejar pasar
        // un submit sin seleccion, aunque el atributo required del select
        // sea saltado (ej. si el modal se dispara programaticamente).
        if (!veterinarioId) {
            alert('Debe seleccionar un veterinario para registrar la consulta.');
            return;
        }

        const data = {
            mascota_id: parseInt(document.getElementById('consultaMascotaId').value),
            veterinario_id: veterinarioId,
            veterinario: veterinarioNombre,
            motivo: document.getElementById('consultaMotivo').value,
            sintomas: document.getElementById('consultaExamen').value || "Evaluación Clínica",
            diagnostico: document.getElementById('consultaProblemas').value || "No especificado",
            peso: parseFloat(document.getElementById('consultaPeso').value) || null,
            temperatura: parseFloat(document.getElementById('consultaTemperatura').value) || null,
            fecha_consulta: document.getElementById('consultaFecha')?.value || null,
            observaciones: `Pruebas: ${document.getElementById('consultaPruebas')?.value || 'N/A'}`
        };
        const creada = await fetchAPI('/consultas/', { method: 'POST', body: JSON.stringify(data) });
        showNotification('Consulta abierta.', 'success');
        closeModal('modalConsulta');
        if (currentMascotaId) cargarConsultas(currentMascotaId);
        cargarBadgeOrdenes();
        // Tarea 09, etapa 4: al crear la consulta se entra directo a la pantalla
        // de consulta abierta.
        if (creada && creada.id) verConsultaCompleta(creada.id, data.mascota_id);
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// Filtro de propietario pendiente (seteado por verMascotasPropietario antes de
// navegar). initConsultorio lo consume una sola vez: evita la carrera donde su
// propio fetch sin filtrar pisaba la lista ya filtrada por propietario.
let ownerFilterId = null;
export const setOwnerFilter = (propietarioId) => { ownerFilterId = propietarioId; };

export const initConsultorio = async () => {
    const listContainer = document.getElementById('consultorioMascotasList');
    if (!listContainer) return;
    const filtroPropietario = ownerFilterId;
    ownerFilterId = null;
    listContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Cargando pacientes...</p>';
    try {
        const url = filtroPropietario
            ? `/mascotas/?propietario_id=${filtroPropietario}`
            : '/mascotas/?skip=0&limit=50';
        const mascotas = await fetchAPI(url);
        // Filtrar inactivas
        const activas = mascotas.filter(m => m.activo !== false);
        renderMascotasList(activas, listContainer);
        if (filtroPropietario && activas.length === 1) {
            const m = activas[0];
            seleccionarMascota(m.id, m.nombre, m.especie, m.codigo_historia);
        }
    } catch (e) {
        listContainer.innerHTML = `<p style="color: var(--accent); text-align:center; padding: 1.5rem; font-weight: 500;">${ICONS.xCircle} Error al cargar pacientes</p>`;
    }
};

export const setupConsultorioSearch = () => {
    const listContainer = document.getElementById('consultorioMascotasList');
    const searchInput = document.getElementById('consultorioSearchMascota');

    // Inject mascota filter bar above the list
    const filterBarId = 'mascotaFilterBar';
    if (searchInput && !document.getElementById(filterBarId)) {
        const filterBar = document.createElement('div');
        filterBar.id = filterBarId;
        filterBar.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;';
        filterBar.innerHTML = `
            <select id="filtroMascotaEspecie" style="flex: 1; min-width: 100px; padding: 0.4rem 0.5rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.8rem;">
                <option value="">Todas las especies</option>
                <option value="Perro">Perro</option>
                <option value="Gato">Gato</option>
                <option value="Ave">Ave</option>
                <option value="Conejo">Conejo</option>
                <option value="Otro">Otro</option>
            </select>
            <select id="filtroMascotaSexo" style="flex: 1; min-width: 90px; padding: 0.4rem 0.5rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.8rem;">
                <option value="">Todos los sexos</option>
                <option value="Macho">Macho</option>
                <option value="Hembra">Hembra</option>
            </select>
            <select id="filtroMascotaEstadoReproductivo" style="flex: 1; min-width: 130px; padding: 0.4rem 0.5rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.8rem;">
                <option value="">Estado reproductivo</option>
                <option value="Entero">Entero</option>
                <option value="Castrado">Castrado/Esterilizado</option>
            </select>
            <input type="text" id="filtroMascotaRaza" placeholder="Raza..." style="flex: 1; min-width: 80px; padding: 0.4rem 0.5rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.8rem;">
            <button id="btnFiltrarMascotas" class="btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; white-space: nowrap;">Filtrar</button>
        `;
        searchInput.parentNode.insertBefore(filterBar, listContainer);
    }

    const buscarMascotasConFiltros = async () => {
        const query = searchInput ? searchInput.value.trim() : '';
        const especie = document.getElementById('filtroMascotaEspecie')?.value || '';
        const sexo = document.getElementById('filtroMascotaSexo')?.value || '';
        const estadoReproductivo = document.getElementById('filtroMascotaEstadoReproductivo')?.value || '';
        const raza = document.getElementById('filtroMascotaRaza')?.value.trim() || '';

        const params = new URLSearchParams({ skip: 0, limit: 100 });
        if (query.length >= 2) params.set('search', query);
        if (especie) params.set('especie', especie);
        if (sexo) params.set('sexo', sexo);
        if (estadoReproductivo) params.set('estado_reproductivo', estadoReproductivo);
        if (raza) params.set('raza', raza);

        try {
            const result = await fetchAPI(`/mascotas/?${params.toString()}`);
            renderMascotasList(result, listContainer);
        } catch (err) {
            console.error("Search error:", err);
        }
    };

    if (searchInput && listContainer) {
        searchInput.addEventListener('input', debounce(buscarMascotasConFiltros, 400));
    }

    document.getElementById('btnFiltrarMascotas')?.addEventListener('click', buscarMascotasConFiltros);
};

export const renderMascotasList = (mascotas, container) => {
    if (!mascotas || mascotas.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No se encontraron pacientes.</p>';
        return;
    }
    container.innerHTML = mascotas.map(m => `
        <div class="search-item pet-list-item" onclick="seleccionarMascota(${m.id}, '${m.nombre}', '${m.especie}', '${m.codigo_historia || ''}')"
             style="cursor: pointer; padding: 1rem; border-bottom: 1px solid var(--border-light); transition: all 0.2s ease; display: flex; flex-direction: column; gap: 6px; border-radius: 8px; margin-bottom: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 700; color: var(--text-primary); font-size: 1.05rem; letter-spacing: -0.01em;">${m.nombre}</div>
                <span style="color: var(--primary); font-weight: 800; font-size: 0.75rem; background: var(--primary-subtle); padding: 2px 8px; border-radius: 6px;">#${m.codigo_historia || m.id}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">
                ${ICONS.paw} ${m.especie}
            </div>
        </div>
    `).join('');
};

// Estado de la consulta abierta actualmente en pantalla (Tarea 09, etapa 3).
let currentConsultaAbierta = null;

// Abre la PANTALLA de consulta abierta (antes el modal #modalDetalleConsulta).
// El nombre se conserva: lo referencian facturacion.js, ordenes/hoy y varios
// onclick inline del HTML generado.
export const verConsultaCompleta = async (consultaId, mascotaId) => {
    try {
        currentViewedConsultaId = consultaId;
        if (mascotaId) setCurrentMascotaId(mascotaId);
        showSection('sec-consulta-abierta');

        const c = await fetchAPI(`/consultas/${consultaId}`);
        currentConsultaAbierta = c;
        if (!mascotaId && c.mascota_id) setCurrentMascotaId(c.mascota_id);

        document.getElementById('detalleConsultaTitle').textContent = `Consulta #${c.id}`;
        const badge = document.getElementById('consultaAbiertaEstado');
        if (badge) {
            const estado = (c.estado || 'ABIERTA').toUpperCase();
            badge.textContent = estado;
            badge.className = 'status-pill ' + (estado === 'ABIERTA' ? 'status-pill--warn' : 'status-pill--muted');
        }

        // Cabecera del paciente: nombre, especie/raza/peso, dueño + teléfono,
        // veterinario y alertas (observaciones de la mascota).
        _renderPacienteConsultaAbierta(c);

        // Franja de vitales editable + motivo.
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v ?? '') === '' ? '' : v; };
        setVal('vitalPeso', c.peso ?? '');
        setVal('vitalTemp', c.temperatura ?? '');
        setVal('vitalFC', c.frecuencia_cardiaca ?? '');
        setVal('caMotivo', c.motivo || '');
        setVal('caDiagnostico', c.diagnostico || '');
        setVal('caTratamiento', c.tratamiento || '');

        document.getElementById('addServicioConsultaId').value = c.id;
        renderDetalleServicios(c.servicios || []);
        _cargarRecetasConsultaAbierta(c.id);
        _cargarNotasConsultaAbierta(c.mascota_id);

        // El botón "Cerrar y facturar" no aplica a una consulta ya cerrada.
        const btnFact = document.getElementById('btnConsultaCerrarFacturar');
        if (btnFact) btnFact.hidden = (c.estado || 'ABIERTA').toUpperCase() !== 'ABIERTA';
    } catch (e) {
        showNotification('Error cargando la consulta: ' + e.message, 'error');
    }
};

const _renderPacienteConsultaAbierta = async (c) => {
    const box = document.getElementById('consultaAbiertaPaciente');
    if (!box) return;
    try {
        const m = await fetchAPI(`/mascotas/${c.mascota_id}`);
        let tel = '';
        let duenoNombre = '';
        if (m.propietario_id) {
            try {
                const p = await fetchAPI(`/propietarios/${m.propietario_id}`);
                duenoNombre = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                tel = p.telefono || '';
            } catch (_) { /* opcional */ }
        }
        const alerta = m.observaciones
            ? `<p class="av-ca-patient-alert"><i class="ph ph-warning" aria-hidden="true"></i> ${m.observaciones}</p>`
            : '';
        box.innerHTML = `
            <div class="av-ca-patient-main">
                <h3 class="av-ca-patient-name">${m.nombre || 'Paciente'}</h3>
                <p class="av-ca-patient-meta">
                    ${[m.especie, m.raza, m.peso ? parseFloat(m.peso).toFixed(1) + ' kg' : null]
                        .filter(Boolean).join(' · ')}
                </p>
                ${alerta}
            </div>
            <div class="av-ca-patient-side">
                <p><span class="av-eyebrow">Propietario</span><br>${duenoNombre || '—'}${tel ? ` · <a href="tel:${tel}">${tel}</a>` : ''}</p>
                <p><span class="av-eyebrow">Veterinario</span><br>${c.veterinario || '—'}</p>
            </div>`;
    } catch (e) {
        box.innerHTML = '<p class="av-text-danger">No se pudieron cargar los datos del paciente.</p>';
    }
};

const _cargarRecetasConsultaAbierta = async (consultaId) => {
    const list = document.getElementById('caRecetasList');
    const count = document.getElementById('caRecetasCount');
    if (!list) return;
    try {
        const recetas = await fetchAPI(`/consultas/${consultaId}/recetas`);
        if (count) count.textContent = recetas.length ? `(${recetas.length})` : '';
        if (!recetas.length) {
            list.innerHTML = '<p class="av-muted">Sin recetas para esta consulta.</p>';
            return;
        }
        list.innerHTML = recetas.map(r => `
            <div class="av-ca-mini-item">
                <span>Receta del ${new Date(r.fecha_emision).toLocaleDateString()} · ${r.detalles.length} ítem(s)</span>
                <button type="button" class="btn-secondary btn-sm" onclick="exportarRecetaPDF(${r.consulta_id}, ${r.id})">${ICONS.printer} PDF</button>
            </div>`).join('');
    } catch (e) {
        list.innerHTML = '<p class="av-text-danger">Error cargando recetas.</p>';
    }
};

const _cargarNotasConsultaAbierta = async (mascotaId) => {
    const list = document.getElementById('caNotasList');
    if (!list || !mascotaId) return;
    try {
        const notas = await fetchAPI(`/notas/mascota/${mascotaId}`);
        if (!notas.length) { list.innerHTML = '<p class="av-muted">Sin notas.</p>'; return; }
        list.innerHTML = notas.slice().reverse().slice(0, 5).map(n => `
            <div class="av-ca-mini-item">
                <span><b>${NOTA_CATEGORIA_LABELS[n.categoria] || n.categoria}</b> · ${new Date(n.fecha_creacion).toLocaleDateString()} — ${n.texto}</span>
            </div>`).join('');
    } catch (e) {
        list.innerHTML = '<p class="av-text-danger">Error cargando notas.</p>';
    }
};

const renderDetalleServicios = (servicios) => {
    const listDiv = document.getElementById('detalleConsultaServiciosList');
    if (!listDiv) return;
    const activos = (servicios || []).filter(s => !s.is_deleted);

    if (activos.length === 0) {
        listDiv.innerHTML = '<p class="av-muted" style="padding:0.75rem 0;">No hay servicios anexados todavía.</p>';
        const el = document.getElementById('detalleConsultaTotal');
        if (el) el.textContent = '$0.00';
        return;
    }

    let total = 0;
    listDiv.innerHTML = activos.map(s => {
        const sub = (s.cantidad || 0) * (s.precio_unitario || 0);
        total += sub;
        const consumido = ESTADOS_SERVICIO_CONSUMIDOS.includes(s.estado);
        const facturado = s.estado === 'FACTURADO';
        const dot = consumido
            ? '<span class="av-ca-dot av-ca-dot--on" aria-hidden="true"></span>'
            : '<span class="av-ca-dot" aria-hidden="true"></span>';
        const det = s.detalles_clinicos
            ? `<p class="av-ca-srow-det">${s.detalles_clinicos}</p>` : '';
        // Un servicio FACTURADO no se edita desde este select: EJECUTADO y
        // FACTURADO comparten "consumido" (ESTADOS_SERVICIO_CONSUMIDOS), y el
        // select solo ofrece SOLICITADO/EJECUTADO -- si se mostrara editable,
        // elegir SOLICITADO revertiria stock de un servicio ya facturado
        // (hallazgo de revision, etapa 2b de la Tarea 06).
        const estadoControl = facturado
            ? `<span class="av-ca-srow-estado av-ca-srow-estado--fija" title="Ya facturado: el estado no se edita desde acá">FACTURADO</span>`
            : `<label class="av-ca-srow-estado">
                        <span class="av-visually-hidden">Estado del servicio ${s.nombre_servicio || s.tipo_servicio}</span>
                        <select onchange="cambiarEstadoServicio(${s.id}, this.value)">
                            <option value="SOLICITADO" ${!consumido ? 'selected' : ''}>SOLICITADO</option>
                            <option value="EJECUTADO" ${consumido ? 'selected' : ''}>EJECUTADO</option>
                        </select>
                    </label>`;
        return `
            <div class="av-ca-srow" data-servicio-id="${s.id}">
                <div class="av-ca-srow-main">
                    <div class="av-ca-srow-title">${dot} ${s.nombre_servicio || s.tipo_servicio}</div>
                    <div class="av-ca-srow-sub">${s.tipo_servicio} · ${(s.cantidad || 0)} × $${(s.precio_unitario || 0).toFixed(2)}</div>
                    ${det}
                </div>
                <div class="av-ca-srow-right">
                    <span class="av-ca-srow-amount">$${sub.toFixed(2)}</span>
                    ${estadoControl}
                    <button type="button" class="av-iconbtn" aria-label="Editar servicio" title="Editar"
                            onclick="editarServicioConsulta(${s.id})">${ICONS.edit}</button>
                    <button type="button" class="av-iconbtn av-iconbtn--danger" aria-label="Quitar servicio" title="Quitar"
                            onclick="eliminarServicioConsulta(${s.id})">${ICONS.trash}</button>
                </div>
            </div>`;
    }).join('');

    const el = document.getElementById('detalleConsultaTotal');
    if (el) el.textContent = `$${total.toFixed(2)}`;
};

const _refrescarConsultaAbierta = () => {
    if (currentViewedConsultaId) verConsultaCompleta(currentViewedConsultaId, currentMascotaId);
};

export const cambiarEstadoServicio = async (servicioId, newState) => {
    try {
        const resp = await fetchAPI(`/servicios/${servicioId}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: newState })
        });
        _avisarFaltantesStock(resp);
        _refrescarConsultaAbierta();
    } catch (e) {
        showNotification('No se pudo cambiar el estado: ' + e.message, 'error');
        _refrescarConsultaAbierta(); // revierte la GUI al valor real
    }
};

export const editarServicioConsulta = (servicioId) => {
    const row = document.querySelector(`.av-ca-srow[data-servicio-id="${servicioId}"]`);
    if (!row || row.querySelector('.av-ca-srow-edit')) return;
    const s = (currentConsultaAbierta?.servicios || []).find(x => x.id === servicioId) || {};
    const edit = document.createElement('form');
    edit.className = 'av-ca-srow-edit';
    edit.innerHTML = `
        <label>Cantidad <input type="number" step="0.1" min="0.1" value="${s.cantidad ?? 1}" name="cant"></label>
        <label>Precio <input type="number" step="0.01" min="0" value="${s.precio_unitario ?? 0}" name="precio"></label>
        <button type="submit" class="btn-primary btn-sm">Guardar</button>
        <button type="button" class="btn-secondary btn-sm" data-cancel>Cancelar</button>`;
    edit.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetchAPI(`/servicios/${servicioId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    cantidad: parseFloat(edit.cant.value) || 1,
                    precio_unitario: parseFloat(edit.precio.value) || 0,
                })
            });
            _refrescarConsultaAbierta();
        } catch (err) {
            showNotification('No se pudo editar el servicio: ' + err.message, 'error');
        }
    });
    edit.querySelector('[data-cancel]').addEventListener('click', () => edit.remove());
    row.appendChild(edit);
};

export const eliminarServicioConsulta = async (servicioId) => {
    if (!confirm('¿Quitar este servicio? Se revierte el stock si estaba EJECUTADO o FACTURADO.')) return;
    try {
        await fetchAPI(`/servicios/${servicioId}`, { method: 'DELETE' });
        _refrescarConsultaAbierta();
    } catch (e) {
        showNotification('No se pudo quitar el servicio: ' + e.message, 'error');
    }
};

// ── Handlers de la pantalla de consulta abierta ─────────────────────────────
export const guardarVitalesConsulta = async (e) => {
    if (e) e.preventDefault();
    if (!currentViewedConsultaId) return;
    const num = (id) => {
        const v = document.getElementById(id)?.value;
        return v === '' || v == null ? null : parseFloat(v);
    };
    const body = { motivo: document.getElementById('caMotivo')?.value || undefined };
    const peso = num('vitalPeso'), temp = num('vitalTemp'), fc = num('vitalFC');
    if (peso != null) body.peso = peso;
    if (temp != null) body.temperatura = temp;
    if (fc != null) body.frecuencia_cardiaca = fc;
    try {
        await fetchAPI(`/consultas/${currentViewedConsultaId}`, { method: 'PUT', body: JSON.stringify(body) });
        showNotification('Vitales actualizados.', 'success');
        _refrescarConsultaAbierta();
    } catch (err) {
        showNotification('No se pudieron guardar los vitales: ' + err.message, 'error');
    }
};

export const guardarDiagnosticoConsulta = async (e) => {
    if (e) e.preventDefault();
    if (!currentViewedConsultaId) return;
    const body = {
        diagnostico: document.getElementById('caDiagnostico')?.value || null,
        tratamiento: document.getElementById('caTratamiento')?.value || null,
    };
    try {
        await fetchAPI(`/consultas/${currentViewedConsultaId}`, { method: 'PUT', body: JSON.stringify(body) });
        showNotification('Diagnóstico y tratamiento guardados.', 'success');
    } catch (err) {
        showNotification('No se pudo guardar: ' + err.message, 'error');
    }
};

export const guardarNotaConsultaAbierta = async (e) => {
    if (e) e.preventDefault();
    const texto = document.getElementById('caNotaTexto')?.value.trim();
    if (!texto || !currentMascotaId) return;
    try {
        await fetchAPI('/notas/', {
            method: 'POST',
            body: JSON.stringify({ mascota_id: currentMascotaId, categoria: 'general', texto }),
        });
        document.getElementById('caNotaTexto').value = '';
        _cargarNotasConsultaAbierta(currentMascotaId);
        showNotification('Nota guardada.', 'success');
    } catch (err) {
        showNotification('No se pudo guardar la nota: ' + err.message, 'error');
    }
};

export const cerrarYFacturarConsulta = async () => {
    if (!currentViewedConsultaId) return;
    if (!confirm('¿Emitir la factura de esta consulta y cerrarla?')) return;
    const id = currentViewedConsultaId;
    try {
        // Un paso (Tarea 09, decisión 8): el servidor arma los detalles desde
        // consulta.servicios + honorario y deja la consulta CERRADA.
        await fetchAPI(`/facturas/from-consulta/${id}`, { method: 'POST', body: JSON.stringify({}) });
        showNotification('Factura emitida. Consulta cerrada.', 'success');
        showSection('sec-consultorio');
        if (currentMascotaId) actualizarCountsPet(currentMascotaId);
    } catch (err) {
        showNotification('No se pudo facturar: ' + err.message, 'error');
    }
};

// Enlaza los controles estáticos de la pantalla (una sola vez).
export const initConsultaAbierta = () => {
    document.getElementById('formVitalesConsulta')?.addEventListener('submit', guardarVitalesConsulta);
    document.getElementById('formDiagnosticoConsulta')?.addEventListener('submit', guardarDiagnosticoConsulta);
    document.getElementById('formNotaConsultaAbierta')?.addEventListener('submit', guardarNotaConsultaAbierta);
    document.getElementById('btnConsultaCerrarFacturar')?.addEventListener('click', cerrarYFacturarConsulta);
    document.getElementById('btnConsultaGuardarSalir')?.addEventListener('click', () => showSection('sec-consultorio'));
    document.getElementById('btnNuevaRecetaCA')?.addEventListener('click', () => {
        if (currentViewedConsultaId) abrirModalReceta(currentViewedConsultaId);
    });
};

// SMART FORM LOGIC: Category Change
document.getElementById('addServicioTipo')?.addEventListener('change', async (e) => {
    const tipo = e.target.value;
    const searchInput = document.getElementById('addServicioItemSearch');
    const label = document.getElementById('labelSeleccionDinamica');
    const datalist = document.getElementById('listadoInventario');
    const dynContainer = document.getElementById('containerCamposDinamicos');

    // Reset basic fields
    searchInput.value = '';
    document.getElementById('addServicioReferenciaId').value = '';
    _clearServicioReceta();
    datalist.innerHTML = '';
    currentInventoryItems = [];

    // Reset dynamic container
    if (dynContainer) {
        dynContainer.innerHTML = '';
        dynContainer.style.display = 'none';
    }

    // A. Inventory Logic
    if (tipo === 'INSUMO' || tipo === 'VACUNACION') {
        label.textContent = tipo === 'VACUNACION' ? 'BUSCAR VACUNA EN STOCK' : 'BUSCAR PRODUCTO / MEDICAMENTO';
        searchInput.placeholder = 'Escriba nombre o código...';
        try {
            const cat = tipo === 'VACUNACION' ? 'Vacuna' : null;
            const items = await fetchAPI(`/inventario/?limit=200${cat ? `&categoria=${encodeURIComponent(cat)}` : ''}`);
            currentInventoryItems = items;
            datalist.innerHTML = items.map(i => `<option value="${i.nombre} [Stock: ${i.stock_actual}]" data-id="${i.id}">`).join('');
        } catch (err) { console.error("Error fetching inventory", err); }
    } else {
        label.textContent = 'REFERENCIA ADICIONAL';
        searchInput.placeholder = 'Ej: Nombre de la cirugía o examen...';
    }

    // B. Dynamic Fields Logic (Medical Detail)
    if (dynContainer && tipo) {
        let fieldsHtml = '';
        const now = new Date().toISOString().slice(0, 16);

        if (tipo === 'HOSPITALIZACION') {
            fieldsHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.calendar} FECHA INGRESO</label>
                    <input type="datetime-local" class="dinamico-hosp-ingreso" value="${now}" style="padding:0.4rem; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.flag} FECHA EGRESO (OPC)</label>
                    <input type="datetime-local" class="dinamico-hosp-egreso" style="padding:0.4rem; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.heartPulse} ESTADO PACIENTE</label>
                    <select class="dinamico-hosp-estado" style="padding:0.4rem; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;">
                        <option>Estable</option><option>Crítico</option><option>Reservado</option>
                    </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.home} NRO. JAULA</label>
                    <input type="text" placeholder="Ej: A-01" class="dinamico-hosp-jaula" style="padding:0.4rem; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;">
                </div>
            `;
            document.getElementById('addServicioNombre').value = "Ingreso a Hospitalización";
        } else if (tipo === 'VACUNACION') {
            fieldsHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.box} LOTE / SERIE</label>
                    <input type="text" placeholder="Lote" class="dinamico-vac-lote" style="padding:0.5rem; border:1px solid var(--border); border-radius:8px; font-size:0.9rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.calendar} FECHA REFUERZO</label>
                    <input type="date" class="dinamico-vac-refuerzo" style="padding:0.5rem; border:1px solid var(--border); border-radius:8px; font-size:0.9rem;">
                </div>
            `;
        } else if (tipo === 'CIRUGIA') {
            fieldsHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:var(--info-dark); font-weight:bold;">${ICONS.heartPulse} RIESGO ASA</label>
                    <select class="dinamico-cir-asa" style="padding:0.5rem; border:1px solid var(--border); border-radius:8px; font-size:0.9rem;">
                        <option>I</option><option>II</option><option>III</option><option>IV</option><option>V</option>
                    </select>
                </div>
            `;
            document.getElementById('addServicioNombre').value = "Cirugía / Procedimiento";
        }

        if (fieldsHtml) {
            dynContainer.innerHTML = fieldsHtml;
            dynContainer.style.display = 'grid';
        }
    }
});

// SMART FORM LOGIC: Item Selection
// Catalog suggestion dropdown (async, for all types)
document.getElementById('addServicioItemSearch')?.addEventListener('input', (e) => {
    const val = e.target.value;
    const tipo = document.getElementById('addServicioTipo').value;

    // Editar el texto a mano rompe el vínculo con el servicio de catálogo elegido.
    _clearServicioReceta();

    if (tipo === 'INSUMO' || tipo === 'VACUNACION') {
        // Find if the value matches one of our inventory options
        const match = currentInventoryItems.find(i => `${i.nombre} [Stock: ${i.stock_actual}]` === val);
        if (match) {
            document.getElementById('addServicioNombre').value = match.nombre;
            document.getElementById('addServicioPrecio').value = match.precio_unitario;
            document.getElementById('addServicioReferenciaId').value = match.id;

            // Pre-fill clinical data with template for lot/expiry
            const detField = document.getElementById('addServicioDetalles');
            if (!detField.value) {
                detField.value = `Lote: \nExp: \nVia: \nObs: `;
            }
            // Focus quantity
            document.getElementById('addServicioCantidad').focus();
            _hideCatalogSuggestions();
            return;
        }
    } else {
        // For other types, just copy search to name
        document.getElementById('addServicioNombre').value = val;
    }

    // Async catalog search for all types
    clearTimeout(_catalogSuggestTimeout);
    if (val.trim().length < 2) { _hideCatalogSuggestions(); return; }
    _catalogSuggestTimeout = setTimeout(() => _searchCatalogSuggestions(val, tipo), 250);
});

document.getElementById('addServicioItemSearch')?.addEventListener('blur', () => {
    // Delay so click on suggestion fires first
    setTimeout(_hideCatalogSuggestions, 200);
});

async function _searchCatalogSuggestions(query, tipo) {
    const categoryMap = {
        'INSUMO': 'FARMACIA',
        'VACUNACION': 'FARMACIA',
        'LABORATORIO': 'LABORATORIO',
        'CIRUGIA': 'QUIROFANO',
        'HOSPITALIZACION': 'HOSPITALIZACION',
        'ESTETICA': 'PELUQUERIA',
        'CONSULTA': 'CONSULTA',
    };
    const cat = categoryMap[tipo] || '';
    let url = `/catalogo?q=${encodeURIComponent(query)}&limit=10`;
    if (cat) url += `&categoria=${encodeURIComponent(cat)}`;
    try {
        const items = await fetchAPI(url);
        _renderCatalogSuggestions(items || []);
    } catch (err) {
        // Silently fail — catalog search is optional
    }
}

function _renderCatalogSuggestions(items) {
    let dropdown = document.getElementById('catalogSuggestDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'catalogSuggestDropdown';
        dropdown.style.cssText = `
            position:absolute; z-index:9999; background:var(--surface); border:1px solid var(--border);
            border-radius:8px; box-shadow:var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12));
            max-height:220px; overflow-y:auto; width:100%;
        `;
        const searchInput = document.getElementById('addServicioItemSearch');
        const wrapper = searchInput.parentElement;
        if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
        wrapper.appendChild(dropdown);
    }

    if (!items.length) { _hideCatalogSuggestions(); return; }

    dropdown.innerHTML = items.map(item => `
        <div class="catalog-suggest-item"
             data-id="${item.id}"
             data-nombre="${item.nombre.replace(/"/g, '&quot;')}"
             data-precio="${item.precio_ref}"
             style="padding:0.6rem 0.9rem; cursor:pointer; border-bottom:1px solid var(--border); font-size:0.875rem;">
            <span style="font-weight:600;">${item.nombre}</span>
            <span style="color:var(--text-muted); font-size:0.8rem; margin-left:0.5rem;">${item.categoria}</span>
            <span style="float:right; color:var(--color-success, #059669); font-weight:700;">$${item.precio_ref}</span>
        </div>
    `).join('');

    dropdown.querySelectorAll('.catalog-suggest-item').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-hover)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('mousedown', () => {
            const nombre = el.dataset.nombre;
            const precio = parseFloat(el.dataset.precio) || 0;
            document.getElementById('addServicioItemSearch').value = nombre;
            document.getElementById('addServicioNombre').value = nombre;
            document.getElementById('addServicioPrecio').value = precio;
            const catId = el.dataset.id || '';
            document.getElementById('addServicioCatalogoId').value = catId;
            _loadServicioReceta(catId);
            _hideCatalogSuggestions();
            document.getElementById('addServicioCantidad').focus();
        });
    });

    dropdown.style.display = 'block';
}

// ============ RECETA DE MATERIALES DEL SERVICIO (Tarea 07, slice D) ============
// Al elegir un servicio del catálogo con receta, precargamos sus materiales
// como cantidades editables. Lo que el veterinario deja en cada input se manda
// como `consumos` (override por material) al aplicar el servicio.
function _clearServicioReceta() {
    const catInput = document.getElementById('addServicioCatalogoId');
    if (catInput) catInput.value = '';
    const block = document.getElementById('addServicioRecetaBlock');
    const lista = document.getElementById('addServicioRecetaLista');
    if (lista) lista.innerHTML = '';
    if (block) block.hidden = true;
}

async function _loadServicioReceta(catalogoId) {
    _clearServicioReceta();
    if (!catalogoId) return;
    document.getElementById('addServicioCatalogoId').value = catalogoId;
    const block = document.getElementById('addServicioRecetaBlock');
    const lista = document.getElementById('addServicioRecetaLista');
    if (!block || !lista) return;
    try {
        const recetas = await fetchAPI(`/catalogo/${catalogoId}/recetas`);
        if (!recetas || !recetas.length) return;
        lista.innerHTML = recetas.map(r => `
            <div style="display:grid; grid-template-columns:1fr 90px 44px; gap:0.5rem; align-items:center;">
                <span style="font-size:0.8rem; color:var(--info-dark); font-weight:600;">${r.inventario_nombre || ('#' + r.inventario_id)}</span>
                <input type="number" class="consumo-cantidad" data-inventario-id="${r.inventario_id}" step="0.001" min="0" value="${Number(r.cantidad)}"
                    style="padding:0.4rem; border:1px solid var(--border); border-radius:var(--radius-md); font-size:0.85rem; font-weight:600; text-align:center;">
                <span style="font-size:0.72rem; color:var(--text-muted);">${r.unidad_medida || ''}</span>
            </div>
        `).join('');
        block.hidden = false;
    } catch (err) {
        // La receta es opcional: si falla el fetch, el formulario sigue usable.
    }
}

function _hideCatalogSuggestions() {
    const dropdown = document.getElementById('catalogSuggestDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

export const setQuickAction = (tipo, fallbackSearch = '', jump = false) => {
    // Tarea 09: el alta clínica pesada vive detrás de "+ Registrar" en la
    // pestaña unificada "Servicios" de la ficha del paciente.
    const registroPorTipo = {
        'CIRUGIA': 'cirugia',
        'HOSPITALIZACION': 'hospitalizacion',
        'LABORATORIO': 'prueba',
        'VACUNACION': 'vacuna',
        'DESPARASITACION': 'desparasitacion',
    };

    if (jump && registroPorTipo[tipo]) {
        showSection('sec-consultorio');
        switchPetTab('servicios');
        // switchPetTab pinta el feed de forma asíncrona; esperamos a que el
        // contenedor del formulario exista antes de inyectar el form clínico.
        setTimeout(() => {
            const picker = document.getElementById('serviciosRegistrarPicker');
            const trigger = document.getElementById('btnServiciosRegistrar');
            if (picker) picker.hidden = false;
            if (trigger) trigger.setAttribute('aria-expanded', 'true');
            abrirRegistroClinico(registroPorTipo[tipo]);
            const el = document.getElementById('petTabContent');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
        return;
    }

    // Default: Acto en el formulario azul del modal
    const selector = document.getElementById('addServicioTipo');
    if (selector) {
        selector.value = tipo;
        selector.dispatchEvent(new Event('change'));
    }

    // Enfocar búsqueda de item para que el usuario pueda escribir (ej: nombre de vacuna o fármaco)
    const search = document.getElementById('addServicioItemSearch');
    if (search) {
        if (fallbackSearch) search.value = fallbackSearch;
        search.focus();
    }
};

document.getElementById('formAgregarServicio')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cid = document.getElementById('addServicioConsultaId').value;
    const refId = document.getElementById('addServicioReferenciaId').value;
    const tipo = document.getElementById('addServicioTipo').value;
    const nombre = document.getElementById('addServicioNombre').value;

    let detallesExtra = "";

    if (tipo === 'HOSPITALIZACION') {
        const ing = e.target.querySelector('.dinamico-hosp-ingreso')?.value;
        const egr = e.target.querySelector('.dinamico-hosp-egreso')?.value;
        const est = e.target.querySelector('.dinamico-hosp-estado')?.value;
        const jau = e.target.querySelector('.dinamico-hosp-jaula')?.value;
        detallesExtra = `ENTRADA: ${ing || 'N/D'} | SALIDA: ${egr || 'En curso'} | JAULA: ${jau || 'N/A'} | ESTADO: ${est}\n`;
    } else if (tipo === 'VACUNACION') {
        const lote = e.target.querySelector('.dinamico-vac-lote')?.value;
        const refu = e.target.querySelector('.dinamico-vac-refuerzo')?.value;
        detallesExtra = `LOTE: ${lote || 'N/D'} | REFUERZO: ${refu || 'N/D'}\n`;
    } else if (tipo === 'CIRUGIA') {
        const asa = e.target.querySelector('.dinamico-cir-asa')?.value;
        const px = e.target.querySelector('.dinamico-cir-precio')?.value;
        detallesExtra = `RIESGO ASA: ${asa} ${px ? `| RECARGO: $${px}` : ''}\n`;
    } else if (tipo === 'LABORATORIO') {
        const labTipo = e.target.querySelector('.dinamico-lab-tipo')?.value;
        detallesExtra = `MUESTRA/TIPO: ${labTipo || 'N/D'}\n`;
    }

    const body = {
        consulta_id: parseInt(cid),
        tipo_servicio: tipo,
        nombre_servicio: (tipo + ": " + nombre).toUpperCase(),
        referencia_id: refId ? parseInt(refId) : null,
        cantidad: parseFloat(document.getElementById('addServicioCantidad').value) || 1.0,
        precio_unitario: parseFloat(document.getElementById('addServicioPrecio').value) || 0,
        detalles_clinicos: detallesExtra + document.getElementById('addServicioDetalles').value,
        estado: 'EJECUTADO'
    };

    // Servicio anclado al catálogo: su receta se consume al aplicar. Cada input
    // de la receta puede ajustarse; se manda como override por material.
    const catalogoId = document.getElementById('addServicioCatalogoId').value;
    if (catalogoId) {
        body.catalogo_servicio_id = Number(catalogoId);
        const consumos = [...document.querySelectorAll('#addServicioRecetaLista .consumo-cantidad')]
            .filter(el => el.value.trim() !== '' && Number(el.value) > 0)
            .map(el => ({ inventario_id: Number(el.dataset.inventarioId), cantidad: Number(el.value) }));
        if (consumos.length) body.consumos = consumos;
    }

    try {
        const resp = await fetchAPI(`/consultas/${cid}/servicios`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        e.target.reset();
        document.getElementById('addServicioReferenciaId').value = '';
        _clearServicioReceta();
        const container = document.getElementById('containerCamposDinamicos');
        if (container) { container.innerHTML = ''; container.style.display = 'none'; }

        verConsultaCompleta(cid, currentMascotaId);
        showNotification("Acto médico y registro clínico guardados.", "success");
        _avisarFaltantesStock(resp);
    } catch (err) {
        alert("Error agregando cargo: " + err.message);
    }
});

// Muestra una advertencia por cada faltante de stock devuelto al aplicar un
// servicio (Tarea 07, decisión 4). El guardado sigue siendo exitoso (200/201).
function _avisarFaltantesStock(resp) {
    if (!resp || !Array.isArray(resp.advertencias) || !resp.advertencias.length) return;
    resp.advertencias.forEach(a => {
        showNotification(`Stock insuficiente de ${a.material}: faltaron ${a.faltante} ${a.unidad}`, 'warning');
    });
}

export const exportarConsultaPDF = async (consultaId) => {
    try {
        const token = localStorage.getItem('token');
        showNotification('Generando PDF de consulta...', 'info');
        const response = await fetch(`${API_BASE_URL}/consultas/${consultaId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Error al generar el PDF');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `consulta-${consultaId}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        alert('Error descargando PDF de consulta: ' + e.message);
    }
};

export const exportarRecetaPDF = async (consultaId, recetaId) => {
    try {
        const token = localStorage.getItem('token');
        showNotification('Generando PDF de receta...', 'info');
        const response = await fetch(`${API_BASE_URL}/consultas/${consultaId}/recetas/${recetaId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Error al generar el PDF');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receta-${recetaId}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        alert('Error descargando PDF de receta: ' + e.message);
    }
};

const cargarConsultas = async (mascotaId, extraParams = {}) => {
    const tableBody = document.getElementById('consultasTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Cargando...</td></tr>';
    try {
        const params = new URLSearchParams({ mascota_id: mascotaId });
        if (extraParams.veterinario) params.set('veterinario', extraParams.veterinario);
        if (extraParams.fecha_inicio) params.set('fecha_inicio', extraParams.fecha_inicio);
        if (extraParams.fecha_fin) params.set('fecha_fin', extraParams.fecha_fin);
        if (extraParams.estado_pago) params.set('estado_pago', extraParams.estado_pago);

        const consultas = await fetchAPI(`/consultas/?${params.toString()}`);
        if (!consultas || consultas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No hay historial clínico.</td></tr>';
            return;
        }
        tableBody.innerHTML = consultas.map(c => {
            const fecha = c.fecha_consulta ? new Date(c.fecha_consulta).toLocaleDateString() : 'N/D';
            const motivo = c.motivo || 'Sin motivo';
            const diagn = c.diagnostico || '-';
            const peso = c.peso ? parseFloat(c.peso).toFixed(2) : '-';
            const temp = c.temperatura ? parseFloat(c.temperatura).toFixed(2) : '-';

            return `
            <tr>
                <td>${fecha}</td>
                <td>${motivo}</td>
                <td>${diagn}</td>
                <td style="font-size: 0.9em;">
                    ${c.peso ? `<b>Peso:</b> ${peso}kg<br>` : ''}
                    ${c.temperatura ? `<b>Temp:</b> ${temp}C` : ''}
                </td>
                <td><span class="status-pill ${c.estado_pago==='COBRADO'?'status-pill--ok':'status-pill--warn'}" style="padding:2px 6px; border-radius:4px; background:${c.estado_pago==='COBRADO'?'var(--secondary-subtle)':'var(--warning-subtle)'};">${c.estado_pago||'POR_COBRAR'}</span></td>
                <td style="text-align: right;">
                    <button class="btn-primary btn-sm" onclick="verConsultaCompleta(${c.id}, ${mascotaId})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-bottom: 4px;">${ICONS.search} Completa</button><br>
                    <button class="btn-secondary btn-sm" onclick="exportarConsultaPDF(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-bottom: 4px; background:var(--primary-subtle); color:var(--primary-dark); border-color:var(--primary-subtle);">${ICONS.printer} PDF</button><br>
                    <button class="btn-secondary btn-sm" onclick="abrirModalReceta(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: var(--secondary-subtle); color: var(--secondary-dark); border-color: var(--secondary);">${ICONS.pill} Recetar</button>
                    ${c.factura_id ?
                        `<button class="btn-primary btn-sm" onclick="abrirPreviewFactura(${c.factura_id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: var(--info); border-color: var(--info-dark); margin-top: 4px;">${ICONS.fileText} Facturado</button>` :
                        `<button class="btn-secondary btn-sm" onclick="facturarConsulta(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 4px; background: var(--warning-subtle); color: var(--warning-dark); border-color: var(--warning);">${ICONS.dollar} Facturar</button>`
                    }
                    <button class="btn-secondary btn-sm" onclick="switchPetTab('servicios'); setTimeout(()=>abrirRegistroClinico('hospitalizacion'), 300);" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 4px; background: var(--accent-subtle); color: var(--accent-dark); border-color: var(--accent);">${ICONS.hospital} Internar</button>
                </td>
            </tr>`;
        }).join('');
        const btnVerPeso = document.getElementById('btnVerPeso');
        if (btnVerPeso) btnVerPeso.style.display = 'inline-block';
    } catch (error) {
        console.error("Error cargando consultas:", error);
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--accent);">Error loading.</td></tr>';
    }
};

const seleccionarMascota = async (id, nombre, especie, codigo) => {
    setCurrentMascotaId(id);

    // UI placeholder while loading full data
    document.getElementById('displayNombreMascota').textContent = nombre || 'Cargando...';
    document.getElementById('displayInfoMascota').textContent = especie || '...';
    document.getElementById('consultaMascotaId').value = id;

    // Set default tab to Resumen (Tarea 09: funde historia + peso + alertas)
    switchPetTab('resumen');

    // Load full data to show breed and reproductive status
    try {
        const m = await fetchAPI(`/mascotas/${id}`);
        document.getElementById('displayNombreMascota').textContent = m.nombre;
        document.getElementById('displayInfoMascota').innerHTML = `
            ${m.especie} ${m.raza ? `(${m.raza})` : ''}
            ${m.codigo_historia ? `- ID: ${m.codigo_historia}` : ''}
            <br>
            <span style="font-size: 0.85rem; color: var(--primary);">
                ${m.sexo || ''} | ${m.estado_reproductivo || 'Reprod: N/D'}
            </span>
        `;
    } catch (e) {
        console.warn("Could not load full pet details", e);
    }

    // Mostrar layout
    document.getElementById('emptyPatientWrapper').style.display = 'none';
    document.getElementById('patientWrapper').style.display = 'block';

    actualizarCountsPet(id);

    // Bind Edit/Delete/Transfer buttons
    const btnEdit = document.getElementById('btnEditarMascota');
    const btnDel = document.getElementById('btnEliminarMascota');
    const btnTrans = document.getElementById('btnTransferirMascota');
    if (btnEdit) btnEdit.onclick = () => abrirEditarMascota(id);
    if (btnDel) btnDel.onclick = () => confirmEliminarMascota(id, nombre);
    if (btnTrans) btnTrans.onclick = () => abrirTransferirMascota(id, nombre);

    const btnAction = document.getElementById('btnActionAdd');
    if (btnAction) btnAction.onclick = () => {
        document.getElementById('consultaMascotaId').value = id;
        abrirFormularioConsulta();
    };

    // Removed non-existent setTimeout(updatePetNavArrows, 500);
};

// Como no tenemos todos los params (nombre, etc), cargamos la mascota del endpoint
const seleccionarMascotaBasica = async (id) => {
    try {
        const mascotas = await fetchAPI(`/mascotas/?search=${id}`);
        const m = mascotas.find(x => x.id === id);
        if (m) {
            seleccionarMascota(m.id, m.nombre, m.especie, m.codigo_historia);
        } else {
            // Fallback si la busqueda no sirve asi
            seleccionarMascota(id, 'Mascota #' + id, 'Cargando...', '');
        }
    } catch (e) { console.error(e); }
};

// Tarea 09: la ficha pasa de 12 pestañas a 6. Las pestañas por tipo de servicio
// (vacunas, desparasitaciones, hospitalizaciones, procedimientos, laboratorio,
// imagenes) se colapsan en "Servicios" (historia unificada). "historia" y "peso"
// se funden en "Resumen". Este mapa mantiene vivos los onclick/llamadas viejas.
const PET_TAB_LEGACY = {
    historia: 'resumen',
    peso: 'resumen',
    ordenes: 'resumen',
    vacunas: 'servicios',
    desparasitaciones: 'servicios',
    hospitalizaciones: 'servicios',
    procedimientos: 'servicios',
    laboratorio: 'servicios',
    imagenes: 'servicios',
};

const switchPetTab = (rawTabName) => {
    detenerDictado(); // cambiar de pestaña destruye el DOM de notas; no dejar el micrófono escuchando de fondo
    const tabName = PET_TAB_LEGACY[rawTabName] || rawTabName;
    // UI Update Active State
    document.querySelectorAll('.pet-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabName);
    });

    const contentArea = document.getElementById('petTabContent');
    const actionsArea = document.getElementById('petTabActions');
    contentArea.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">Cargando...</p>';
    actionsArea.innerHTML = '';

    switch (tabName) {
        case 'resumen':
            contentArea.innerHTML = `
                <div id="resumenAlertas"></div>
                <div id="historiaResumen" style="width: 100%; text-align: left;"></div>
                <div style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; margin-top: 1.25rem;">
                    <h3 style="margin-top: 0; color: var(--text-primary); text-align: center; font-size: 1.05rem;">Evolución de Peso</h3>
                    <div id="chartContainer" style="width: 100%; max-width: 600px; margin: 0 auto; display: block;">
                        <canvas id="weightChart"></canvas>
                    </div>
                </div>`;
            renderResumenTab();
            setTimeout(loadWeightChart, 100);
            break;
        case 'servicios':
            actionsArea.innerHTML = `
                <button class="btn-secondary" id="btnServiciosServicioDirecto">+ Servicio directo</button>
                <button class="btn-primary" id="btnServiciosRegistrar" aria-expanded="false" aria-controls="serviciosRegistrarPicker">+ Registrar</button>`;
            document.getElementById('btnServiciosServicioDirecto').onclick = () => abrirServicioDirectoFicha();
            document.getElementById('btnServiciosRegistrar').onclick = (e) => toggleRegistrarPicker(e.currentTarget);
            cargarServiciosPet(currentMascotaId);
            break;
        case 'consultas':
            actionsArea.innerHTML = `<button class="btn-primary" id="btnRegistrarConsulta">+ Nueva Consulta</button>`;
            document.getElementById('btnRegistrarConsulta').onclick = () => {
                if (!currentMascotaId) return;
                document.getElementById('consultaMascotaId').value = currentMascotaId;
                abrirFormularioConsulta();
            };
            contentArea.innerHTML = `
                <div id="consultasFilterBar" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem; padding:0.75rem; background:var(--surface-hover); border-radius:8px; border:1px solid var(--border);">
                    <input type="text" id="filtroConsultaVet" placeholder="Veterinario..." style="flex:1; min-width:120px; padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem;">
                    <input type="date" id="filtroConsultaFechaInicio" style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem;">
                    <input type="date" id="filtroConsultaFechaFin" style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem;">
                    <select id="filtroConsultaEstadoPago" style="padding:0.4rem 0.6rem; border:1px solid var(--border); border-radius:6px; font-size:0.82rem;">
                        <option value="">Todos los pagos</option>
                        <option value="POR_COBRAR">Por Cobrar</option>
                        <option value="COBRADO">Cobrado</option>
                    </select>
                    <button id="btnFiltrarConsultas" class="btn-primary" style="padding:0.4rem 0.75rem; font-size:0.82rem;">Filtrar</button>
                </div>
                <table class="consultas-table">
                    <thead>
                        <tr><th>Fecha</th><th>Motivo</th><th>Diagnóstico</th><th>Signos</th><th>Pago</th><th style="text-align:right;">Acciones</th></tr>
                    </thead>
                    <tbody id="consultasTableBody"></tbody>
                </table>`;
            cargarConsultas(currentMascotaId);
            document.getElementById('btnFiltrarConsultas')?.addEventListener('click', () => {
                const extraParams = {
                    veterinario: document.getElementById('filtroConsultaVet')?.value.trim(),
                    fecha_inicio: document.getElementById('filtroConsultaFechaInicio')?.value,
                    fecha_fin: document.getElementById('filtroConsultaFechaFin')?.value,
                    estado_pago: document.getElementById('filtroConsultaEstadoPago')?.value,
                };
                cargarConsultas(currentMascotaId, extraParams);
            });
            break;
        case 'notas':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formNota')">+ Nueva Nota</button>`;
            cargarNotasPet(currentMascotaId);
            break;
        case 'recetas':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="alert('Las recetas se crean desde una consulta')">Ver Recetas</button>`;
            cargarRecetasPet(currentMascotaId);
            break;
        case 'facturacion':
            contentArea.innerHTML = `
                <div class="card" style="padding: 1rem; border: none; box-shadow: none;">
                    <h3 style="font-size: 1.1rem; margin-bottom: 1rem; color: #374151;">Historial de Cobros del Paciente</h3>
                    <div class="table-container">
                        <table class="consultas-table" style="width: 100%;">
                            <thead>
                                <tr>
                                    <th># Factura</th>
                                    <th>Fecha</th>
                                    <th>Estado</th>
                                    <th>Total</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="petFacturasTableBody">
                                <tr><td colspan="5" style="text-align:center;">Cargando...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>`;
            cargarFacturasMascota(currentMascotaId);
            break;
        default:
            contentArea.innerHTML = `<div class="empty-state">Módulo <b>${tabName}</b> en desarrollo.</div>`;
    }
};

const renderHistoriaTab = async () => {
    const res = document.getElementById('historiaResumen');
    try {
        const m = await fetchAPI(`/mascotas/${currentMascotaId}`);
        const v = await fetchAPI(`/clinico/vacunaciones/${currentMascotaId}`).catch(() => []);

        let vacunasHTML = '';
        if (v.length > 0) {
            vacunasHTML = `<div style="margin-top:1rem;"><b>Vacunas aplicadas:</b><br><ul style="margin:0; padding-left:1.5rem; color:var(--text-secondary);">` +
                v.map(vac => `<li>${vac.vacuna_nombre} (Lote: ${vac.lote})</li>`).join('') +
                `</ul></div>`;
        }

        res.innerHTML = `
            <div style="background: var(--surface-hover); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div><b>Especie:</b> ${m.especie}</div>
                    <div><b>Raza:</b> ${m.raza || 'N/A'}</div>
                    <div><b>Sexo:</b> ${m.sexo || 'N/A'}</div>
                    <div><b>Color:</b> ${m.color || 'N/A'}</div>
                    <div><b>Peso actual:</b> ${m.peso ? parseFloat(m.peso).toFixed(2) : 'N/A'} kg</div>
                    <div><b>Estado:</b> ${m.estado_reproductivo || 'N/A'}</div>
                </div>
                <hr style="margin: 1rem 0; border: 0; border-top: 1px solid var(--border);">
                <div><b>Observaciones:</b><br>${m.observaciones || 'Sin observaciones.'}</div>
                ${vacunasHTML}
            </div>`;
    } catch (e) {
        res.innerHTML = '<p style="color: var(--accent);">No se pudo cargar el resumen de la historia clínica.</p>';
    }
};

// Tarea 09: "Resumen" funde la vieja pestaña "Historia Clínica" + "Evol. Peso" +
// una franja de alertas del paciente (observaciones) arriba de todo.
const renderResumenTab = async () => {
    const alertBox = document.getElementById('resumenAlertas');
    renderHistoriaTab();
    if (!alertBox) return;
    try {
        const m = await fetchAPI(`/mascotas/${currentMascotaId}`);
        if (m.observaciones && m.observaciones.trim()) {
            alertBox.innerHTML = `
                <div class="pet-resumen-alert" role="note">
                    <span class="pet-resumen-alert-icon" aria-hidden="true">${ICONS.alertTriangle}</span>
                    <span><b>Alertas del paciente:</b> ${m.observaciones}</span>
                </div>`;
        } else {
            alertBox.innerHTML = '';
        }
    } catch (e) {
        alertBox.innerHTML = '';
    }
};

export const toggleForm = (formId) => {
    const el = document.getElementById(formId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// ===========================================================================
// PESTAÑA "SERVICIOS" — historia unificada del paciente (Tarea 09)
// Reemplaza las 6 pestañas por tipo (vacunas/desparasitaciones/hospitalizaciones/
// procedimientos/laboratorio/imagenes). Feed: GET /api/servicios/?mascota_id&alcance=todos
// Cada fila abre un detalle type-aware. El alta clínica sigue disponible detrás
// de "+ Registrar"; el alta suelta detrás de "+ Servicio directo".
// ===========================================================================

const SERVICIO_TIPO_META = {
    VACUNACION:      { label: 'Vacunación',      cls: 'vac' },
    DESPARASITACION: { label: 'Desparasitación', cls: 'desp' },
    CIRUGIA:         { label: 'Cirugía',         cls: 'cir' },
    HOSPITALIZACION: { label: 'Hospitalización', cls: 'hosp' },
    LABORATORIO:     { label: 'Laboratorio',     cls: 'lab' },
    DIAGNOSTICO:     { label: 'Estudio',         cls: 'lab' },
    INSUMO:          { label: 'Insumo',          cls: 'ins' },
    ESTETICA:        { label: 'Estética',        cls: 'est' },
    PROCEDIMIENTO:   { label: 'Procedimiento',   cls: 'proc' },
    CONSULTA:        { label: 'Consulta',        cls: 'cons' },
    OTRO:            { label: 'Otro',            cls: 'otro' },
};
const _servTipoMeta = (t) => SERVICIO_TIPO_META[t] || { label: t || 'Servicio', cls: 'otro' };

// Formularios clínicos que "+ Registrar" reexpone (mantiene clinico.spec.js vivo).
const REGISTRO_CLINICO_TIPOS = [
    { tipo: 'cirugia',          label: 'Cirugía',         formId: 'formCirugia' },
    { tipo: 'vacuna',           label: 'Vacunación',      formId: 'formVacuna' },
    { tipo: 'hospitalizacion',  label: 'Hospitalización', formId: 'formHospitalizacion' },
    { tipo: 'desparasitacion',  label: 'Desparasitación', formId: 'formDesparasitacion' },
    { tipo: 'prueba',           label: 'Estudio / Lab.',  formId: 'formPrueba' },
];

const _serviciosState = { mascotaId: null, raw: [], detalleCache: {} };

const _fmtFecha = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};
const _money = (n) => `$${Number(n || 0).toFixed(2)}`;

export const cargarServiciosPet = async (mascotaId) => {
    const cnt = document.getElementById('petTabContent');
    if (!cnt) return;
    _serviciosState.mascotaId = mascotaId;
    _serviciosState.detalleCache = {};

    const tipoOpts = Object.entries(SERVICIO_TIPO_META)
        .map(([v, m]) => `<option value="${v}">${m.label}</option>`).join('');

    cnt.innerHTML = `
        <div id="serviciosRegistrarPicker" class="serv-registrar-picker" hidden>
            <span class="serv-registrar-picker-label">Registrar:</span>
            ${REGISTRO_CLINICO_TIPOS.map(r => `
                <button type="button" class="btn-secondary btn-sm serv-registrar-opt" data-tipo="${r.tipo}">+ ${r.label}</button>`).join('')}
        </div>
        <div id="serviciosRegistrarFormWrap"></div>

        <form id="serviciosFiltros" class="serv-filtros" role="search" aria-label="Filtrar servicios del paciente">
            <div class="serv-filtro-field serv-filtro-field--grow">
                <label for="servFiltroTexto">Buscar</label>
                <input type="text" id="servFiltroTexto" placeholder="Nombre del servicio...">
            </div>
            <div class="serv-filtro-field">
                <label for="servFiltroTipo">Tipo</label>
                <select id="servFiltroTipo"><option value="">Todos</option>${tipoOpts}</select>
            </div>
            <div class="serv-filtro-field">
                <label for="servFiltroEstado">Estado</label>
                <select id="servFiltroEstado">
                    <option value="">Todos</option>
                    <option value="SOLICITADO">SOLICITADO</option>
                    <option value="EJECUTADO">EJECUTADO</option>
                    <option value="FACTURADO">FACTURADO</option>
                    <option value="CANCELADO">CANCELADO</option>
                </select>
            </div>
            <div class="serv-filtro-field">
                <label for="servFiltroFacturado">Facturado</label>
                <select id="servFiltroFacturado">
                    <option value="">Todos</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                </select>
            </div>
            <div class="serv-filtro-field">
                <label for="servFiltroDesde">Desde</label>
                <input type="date" id="servFiltroDesde">
            </div>
            <div class="serv-filtro-field">
                <label for="servFiltroHasta">Hasta</label>
                <input type="date" id="servFiltroHasta">
            </div>
            <div class="serv-filtro-actions">
                <button type="submit" class="btn-primary btn-sm">Filtrar</button>
                <button type="button" class="btn-secondary btn-sm" id="servFiltroLimpiar">Limpiar</button>
            </div>
        </form>

        <div id="serviciosFeed" class="serv-feed" aria-live="polite"></div>`;

    // Wiring de filtros.
    document.getElementById('serviciosFiltros').addEventListener('submit', (e) => {
        e.preventDefault();
        cargarServiciosFeed();
    });
    document.getElementById('servFiltroLimpiar').addEventListener('click', () => {
        ['servFiltroTexto', 'servFiltroTipo', 'servFiltroEstado', 'servFiltroFacturado', 'servFiltroDesde', 'servFiltroHasta']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        cargarServiciosFeed();
    });
    document.getElementById('servFiltroTexto').addEventListener('input', debounce(_renderServiciosFeedFromState, 200));

    // Wiring del selector "+ Registrar".
    document.querySelectorAll('.serv-registrar-opt').forEach(btn => {
        btn.addEventListener('click', () => abrirRegistroClinico(btn.dataset.tipo));
    });

    await cargarServiciosFeed();
};

export const cargarServiciosFeed = async () => {
    const box = document.getElementById('serviciosFeed');
    const mascotaId = _serviciosState.mascotaId;
    if (!box || !mascotaId) return;
    box.innerHTML = '<p class="serv-feed-msg">Cargando servicios…</p>';

    const params = new URLSearchParams({ mascota_id: mascotaId, alcance: 'todos' });
    const tipo = document.getElementById('servFiltroTipo')?.value;
    const estado = document.getElementById('servFiltroEstado')?.value;
    const facturado = document.getElementById('servFiltroFacturado')?.value;
    const desde = document.getElementById('servFiltroDesde')?.value;
    const hasta = document.getElementById('servFiltroHasta')?.value;
    if (tipo) params.set('tipo_servicio', tipo);
    if (estado) params.set('estado', estado);
    if (facturado) params.set('facturado', facturado);
    if (desde) params.set('fecha_desde', desde);
    if (hasta) params.set('fecha_hasta', hasta);

    try {
        const data = await fetchAPI(`/servicios/?${params.toString()}`);
        _serviciosState.raw = Array.isArray(data) ? data : [];
        _renderServiciosFeedFromState();
    } catch (e) {
        box.innerHTML = `<p class="serv-feed-msg serv-feed-msg--error">${ICONS.xCircle} No se pudieron cargar los servicios. ${e.message || ''}</p>`;
    }
};

// Aplica solo el filtro de texto (cliente) sobre lo ya traído y pinta la lista.
const _renderServiciosFeedFromState = () => {
    const box = document.getElementById('serviciosFeed');
    if (!box) return;
    const q = (document.getElementById('servFiltroTexto')?.value || '').trim().toLowerCase();
    let items = _serviciosState.raw;
    if (q) items = items.filter(s => (s.nombre_servicio || '').toLowerCase().includes(q));

    if (!items.length) {
        box.innerHTML = `
            <div class="empty-state">
                <div class="icon">${ICONS.clipboard}</div>
                <p>${_serviciosState.raw.length ? 'Ningún servicio coincide con los filtros.' : 'Este paciente todavía no tiene servicios registrados.'}</p>
            </div>`;
        return;
    }

    box.innerHTML = `
        <div class="serv-feed-head" role="row">
            <span>Fecha</span><span>Tipo</span><span>Servicio</span><span>Cant. × precio</span><span>Estado</span>
        </div>
        ${items.map(_renderServicioRow).join('')}`;

    box.querySelectorAll('.serv-row').forEach(row => {
        row.addEventListener('click', () => verServicioDetalle(Number(row.dataset.id)));
    });
};

const _renderServicioRow = (s) => {
    const meta = _servTipoMeta(s.tipo_servicio);
    const consumido = ESTADOS_SERVICIO_CONSUMIDOS.includes(s.estado);
    const cancelado = s.estado === 'CANCELADO';
    const estadoDot = cancelado
        ? '<span class="serv-dot serv-dot--off" aria-hidden="true"></span>'
        : (consumido ? '<span class="serv-dot serv-dot--on" aria-hidden="true"></span>'
                     : '<span class="serv-dot" aria-hidden="true"></span>');
    const sub = `${Number(s.cantidad || 0)} × ${_money(s.precio_unitario)}`;
    const factTag = s.facturado ? ' <span class="serv-row-fact" title="Ya facturado">facturado</span>' : '';
    return `
        <button type="button" class="serv-row" data-id="${s.id}" aria-expanded="false" aria-controls="serv-detail-${s.id}">
            <span class="serv-row-date">${_fmtFecha(s.created_at)}</span>
            <span><span class="serv-badge serv-badge--${meta.cls}">${meta.label}</span></span>
            <span class="serv-row-name">${s.nombre_servicio || meta.label}${s.consulta_id ? ' <span class="serv-row-origin">· Consulta</span>' : ''}${factTag}</span>
            <span class="serv-row-qty">${sub}</span>
            <span class="serv-row-estado">${estadoDot}${s.estado || 'SOLICITADO'}</span>
        </button>
        <div class="serv-detail" id="serv-detail-${s.id}" hidden></div>`;
};

export const verServicioDetalle = async (servicioId) => {
    const row = document.querySelector(`.serv-row[data-id="${servicioId}"]`);
    const panel = document.getElementById(`serv-detail-${servicioId}`);
    if (!row || !panel) return;

    const isOpen = !panel.hidden;
    // Cerrar cualquier otro detalle abierto (acordeón de una sola fila).
    document.querySelectorAll('.serv-detail').forEach(p => { p.hidden = true; });
    document.querySelectorAll('.serv-row').forEach(r => r.setAttribute('aria-expanded', 'false'));
    if (isOpen) return;

    panel.hidden = false;
    row.setAttribute('aria-expanded', 'true');
    panel.innerHTML = '<p class="serv-feed-msg">Cargando detalle…</p>';

    const s = _serviciosState.raw.find(x => x.id === servicioId) || {};
    try {
        panel.innerHTML = await _renderServicioDetalle(s);
    } catch (e) {
        panel.innerHTML = `<p class="serv-feed-msg serv-feed-msg--error">${ICONS.xCircle} No se pudo cargar el detalle. ${e.message || ''}</p>`;
    }
};

// Escapa texto que va a insertarse vía innerHTML (Tarea 06, decisión 7 --
// fix del XSS almacenado de PruebaComplementaria.archivo_url).
const _escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Trae la fila clínica de detalle (por tipo) y devuelve una tabla clave→valor.
const _detalleClinicoPorTipo = async (tipo, referenciaId, mascotaId) => {
    const endpoints = {
        VACUNACION: `/clinico/vacunaciones/${mascotaId}`,
        DESPARASITACION: `/clinico/desparasitaciones/${mascotaId}`,
        CIRUGIA: `/clinico/cirugias/${mascotaId}`,
        HOSPITALIZACION: `/clinico/hospitalizaciones/${mascotaId}`,
        LABORATORIO: `/clinico/pruebas_complementarias/${mascotaId}`,
        DIAGNOSTICO: `/clinico/pruebas_complementarias/${mascotaId}`,
    };
    const url = endpoints[tipo];
    if (!url) return null;
    if (!_serviciosState.detalleCache[url]) {
        _serviciosState.detalleCache[url] = fetchAPI(url).catch(() => []);
    }
    const lista = await _serviciosState.detalleCache[url];
    if (!Array.isArray(lista) || !lista.length) return null;
    const fila = referenciaId ? lista.find(x => x.id === referenciaId) : null;
    const d = fila || lista[0]; // sin referencia_id: mostramos el más reciente como aproximación
    const rows = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push([k, v]); };

    if (tipo === 'VACUNACION') {
        add('Vacuna', d.vacuna_nombre);
        add('Lote', d.lote);
        add('Fecha de aplicación', d.fecha_aplicacion ? new Date(d.fecha_aplicacion).toLocaleDateString() : null);
        add('Próximo refuerzo', d.fecha_refuerzo ? new Date(d.fecha_refuerzo).toLocaleDateString() : null);
    } else if (tipo === 'DESPARASITACION') {
        add('Producto', d.producto_nombre);
        add('Tipo', d.tipo);
        add('Dosis', d.dosis);
        add('Fecha de aplicación', d.fecha_aplicacion ? new Date(d.fecha_aplicacion).toLocaleDateString() : null);
    } else if (tipo === 'CIRUGIA') {
        add('Procedimiento', d.tipo_procedimiento);
        add('Riesgo ASA', d.riesgo_asa);
        add('Fecha', d.fecha_cirugia ? new Date(d.fecha_cirugia).toLocaleDateString() : null);
        add('Informe quirúrgico', d.informe_quirurgico);
    } else if (tipo === 'HOSPITALIZACION') {
        add('Motivo', d.motivo);
        add('Ingreso', d.fecha_ingreso ? new Date(d.fecha_ingreso).toLocaleString() : null);
        add('Egreso', d.fecha_egreso ? new Date(d.fecha_egreso).toLocaleString() : 'En curso');
        add('Estado del paciente', d.estado_paciente);
        add('Jaula', d.jaula_nro);
    } else { // LABORATORIO / DIAGNOSTICO
        add('Tipo de estudio', d.tipo);
        add('Resultado', d.resultado);
        // Tarea 06, decisión 7: archivo_url es texto histórico (no se dropea,
        // tiene datos reales), pero ya no se ofrece como link -- interpolarlo
        // crudo en un href es XSS almacenado (una URL "javascript:" tipeada a
        // mano se ejecuta al hacer clic). Se muestra como texto plano; el
        // adjunto real de esta etapa en adelante se sube y descarga por
        // /api/adjuntos, no por esta columna.
        add('Archivo (histórico)', d.archivo_url ? _escapeHtml(d.archivo_url) : null);
        add('Fecha', d.fecha ? new Date(d.fecha).toLocaleDateString() : null);
    }
    if (!rows.length) return null;
    return `<dl class="serv-detail-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
};

const _renderServicioDetalle = async (s) => {
    const meta = _servTipoMeta(s.tipo_servicio);
    const mascotaId = _serviciosState.mascotaId;
    let cuerpo = '';

    const clinico = await _detalleClinicoPorTipo(s.tipo_servicio, s.referencia_id, mascotaId);
    if (clinico) {
        cuerpo += clinico;
    }

    // Datos del catálogo si el servicio está anclado.
    if (s.catalogo_servicio_id) {
        try {
            const cat = await fetchAPI(`/catalogo/${s.catalogo_servicio_id}`);
            if (cat) {
                cuerpo += `<dl class="serv-detail-dl">
                    <div><dt>Servicio de catálogo</dt><dd>${cat.nombre || '—'}</dd></div>
                    <div><dt>Categoría</dt><dd>${cat.categoria || '—'}</dd></div>
                    <div><dt>Precio de referencia</dt><dd>${_money(cat.precio_ref)}</dd></div>
                </dl>`;
            }
        } catch (_) { /* opcional */ }
    }

    if (s.detalles_clinicos && s.detalles_clinicos.trim()) {
        cuerpo += `<div class="serv-detail-notes"><dt>Detalle clínico</dt><pre>${s.detalles_clinicos}</pre></div>`;
    }

    if (!cuerpo) {
        cuerpo = '<p class="serv-feed-msg">Sin detalle clínico adicional para este servicio.</p>';
    }

    const consultaLink = s.consulta_id
        ? `<button type="button" class="btn-secondary btn-sm" onclick="verConsultaCompleta(${s.consulta_id}, ${mascotaId})">Abrir consulta #${s.consulta_id}</button>`
        : '<span class="serv-detail-tag">Servicio directo (sin consulta)</span>';

    return `
        <div class="serv-detail-head">
            <span class="serv-badge serv-badge--${meta.cls}">${meta.label}</span>
            <span class="serv-detail-title">${s.nombre_servicio || meta.label}</span>
            ${consultaLink}
        </div>
        ${cuerpo}`;
};

// "+ Registrar" — despliega el selector de tipo de formulario clínico.
const toggleRegistrarPicker = (btn) => {
    const picker = document.getElementById('serviciosRegistrarPicker');
    if (!picker) return;
    const show = picker.hidden;
    picker.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    if (!show) {
        const wrap = document.getElementById('serviciosRegistrarFormWrap');
        if (wrap) wrap.innerHTML = '';
    }
};

// Inyecta el formulario clínico elegido (reusa buildClinicoForm + submitClinico).
export const abrirRegistroClinico = (tipo) => {
    const wrap = document.getElementById('serviciosRegistrarFormWrap');
    if (!wrap) return;
    wrap.innerHTML = buildClinicoForm(tipo);
    const form = wrap.querySelector('form');
    if (form) {
        form.style.display = 'block';
        const combo = form.querySelector('.combo-consultas');
        if (combo && currentViewedConsultaId) combo.value = currentViewedConsultaId;
    }
    hydrateCombos();
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

// "+ Servicio directo" desde la ficha: reusa el modal #modalServicioDirecto
// (mismo flujo/endpoint que "Hoy"), salteando el selector de paciente.
const abrirServicioDirectoFicha = () => {
    if (!currentMascotaId) return;
    const nombre = document.getElementById('displayNombreMascota')?.textContent || `#${currentMascotaId}`;
    abrirServicioDirectoParaMascota(currentMascotaId, nombre);
};

// Refrescar el feed cuando "Hoy"/ficha crea un servicio directo.
document.addEventListener('av:servicio-directo-creado', () => {
    const tab = document.querySelector('.pet-nav-item.active')?.dataset.tab;
    if (tab === 'servicios' && _serviciosState.mascotaId) {
        cargarServiciosFeed();
        actualizarCountsPet(_serviciosState.mascotaId);
    }
});

const buildClinicoForm = (type) => {
    // Shared select for Consultas
    const comboConsultas = `<div class="form-group">
        <label>Asociar a Consulta (Requiere consulta previa)</label>
        <select name="consulta_id" class="form-control combo-consultas" required><option value="">Seleccione consulta...</option></select>
    </div>`;

    if (type === 'vacuna') return `<form onsubmit="submitClinico(event, 'vacunacion')" id="formVacuna" class="clinico-inline-form" style="display:none;">
        <h4>Aplicar Vacunación</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Vacuna (ID Inventario)</label><input type="number" name="vacuna_id" class="form-control" required placeholder="Ej: 3"></div>
            <div class="form-group"><label>Lote</label><input type="text" name="lote" class="form-control" required></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'desparasitacion') return `<form onsubmit="submitClinico(event, 'desparasitacion')" id="formDesparasitacion" class="clinico-inline-form" style="display:none;">
        <h4>Aplicar Desparasitante</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Producto (ID Inventario)</label><input type="number" name="producto_id" class="form-control" required></div>
            <div class="form-group"><label>Tipo</label><select name="tipo" class="form-control"><option>Interna</option><option>Externa</option></select></div>
            <div class="form-group"><label>Dosis</label><input type="text" name="dosis" class="form-control" required></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'hospitalizacion') return `<form onsubmit="submitClinico(event, 'hospitalizacion')" id="formHospitalizacion" class="clinico-inline-form" style="display:none;">
        <h4>Registrar Ingreso Hospitalario</h4>
        ${comboConsultas}
        <div class="form-group"><label>Motivo</label><input type="text" name="motivo" class="form-control" required></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Fecha Ingreso</label><input type="datetime-local" name="fecha_ingreso" class="form-control"></div>
            <div class="form-group"><label>Fecha Egreso (Opcional)</label><input type="datetime-local" name="fecha_egreso" class="form-control"></div>
            <div class="form-group"><label>Estado Paciente</label><select name="estado_paciente" class="form-control"><option>Estable</option><option>Crítico</option><option>Reservado</option></select></div>
            <div class="form-group"><label>Jaula No.</label><input type="text" name="jaula_nro" class="form-control"></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'cirugia') return `<form onsubmit="submitClinico(event, 'cirugia')" id="formCirugia" class="clinico-inline-form" style="display:none;">
        <h4>Registrar Intervención Quirúrgica</h4>
        ${comboConsultas}
        <div class="form-group"><label>Procedimiento</label><input type="text" name="tipo_procedimiento" class="form-control" required></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Riesgo ASA</label><select name="riesgo_asa" class="form-control"><option>I</option><option>II</option><option>III</option><option>IV</option><option>V</option></select></div>
            <div class="form-group"><label>Cirujano ID</label><input type="number" name="cirujano_id" class="form-control"></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'prueba') return `<form onsubmit="submitClinico(event, 'prueba_complementaria')" id="formPrueba" class="clinico-inline-form" style="display:none;">
        <h4>Registrar Estudio</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Tipo</label><select name="tipo" class="form-control"><option>Laboratorio</option><option>Rayos X</option><option>Ecografía</option></select></div>
        </div>
        <!-- Tarea 06, decisión 7: ya no se ofrece cargar por URL -- el
             resultado se sube como adjunto real (POST /api/servicios/{id}/adjuntos)
             una vez que el servicio de LABORATORIO/IMAGEN pasa por el despacho. -->

        <div class="form-group"><label>Resultados</label><input type="text" name="resultado" class="form-control" required></div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;
    return '';
};

const hydrateCombos = async () => {
    try {
        const consultas = await fetchAPI(`/consultas/?mascota_id=${currentMascotaId}`);
        const opts = consultas.map(c => `<option value="${c.id}">Cons #${c.id} - ${new Date(c.fecha_consulta).toLocaleDateString()}</option>`).join('');
        document.querySelectorAll('.combo-consultas').forEach(el => el.innerHTML = opts);
    } catch (e) { }
};

export const submitClinico = async (e, endpoint) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    // Numeric fields: coerce when present, but DROP blanks entirely — an
    // empty optional <input type="number"> (e.g. "Cirujano ID") serializes as
    // "" and the backend rejects "" for an int column with a 422.
    for (const key of ['consulta_id', 'vacuna_id', 'producto_id', 'cirujano_id']) {
        if (data[key] === '' || data[key] == null) delete data[key];
        else data[key] = parseInt(data[key], 10);
    }
    data.mascota_id = currentMascotaId;

    try {
        await fetchAPI(`/clinico/${endpoint}`, { method: 'POST', body: JSON.stringify(data) });
        showNotification('Registro clínico guardado y vinculado a la consulta.', 'success');
        e.target.reset();
        e.target.style.display = 'none';

        // Refrescar counts y tab actual
        actualizarCountsPet(currentMascotaId);
        const activeTab = document.querySelector('.pet-nav-item.active')?.dataset.tab;
        if (activeTab) switchPetTab(activeTab);

        // Si tenemos el expediente abierto en el fondo o acabamos de llenarlo,
        // refrescamos la vista de cargos/servicios del expediente actual
        if (currentViewedConsultaId) {
            verConsultaCompleta(currentViewedConsultaId, currentMascotaId);
        }
    } catch (err) { alert('Error: ' + err.message); }
};

const dictadoBotonHTML = (targetId) => {
    if (!SpeechRecognitionAPI) return '';
    return `
        <div class="dictado-wrap">
            <button type="button" class="btn-dictado" data-target="${targetId}" aria-pressed="false" aria-label="Dictar nota por voz">
                ${ICONS.mic} Dictar
            </button>
            <span class="dictado-status" role="status" aria-live="polite"></span>
        </div>`;
};

const detenerDictado = () => {
    if (dictadoRecognition) dictadoRecognition.stop();
};

const iniciarDictado = (btn) => {
    // Un solo micrófono abierto a la vez: si había otro botón dictando, se corta antes de empezar el nuevo.
    if (dictadoActivoBtn && dictadoActivoBtn !== btn) detenerDictado();

    const textarea = document.getElementById(btn.getAttribute('data-target'));
    const statusEl = btn.parentElement.querySelector('.dictado-status');
    if (!textarea) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'es-VE'; // el sistema ya usa cédula/formato venezolano (import de pacientes); sin locale explícito previo
    recognition.interimResults = true; // se necesita ver el texto mientras se habla, no solo al terminar
    recognition.continuous = true; // no cortar el dictado en la primera pausa entre frases

    const textoBase = textarea.value ? textarea.value.trim() + ' ' : '';
    let textoFinal = '';

    recognition.onstart = () => {
        dictadoRecognition = recognition;
        dictadoActivoBtn = btn;
        btn.classList.add('dictado-activo');
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-label', 'Detener dictado');
        btn.innerHTML = `${ICONS.recordDot} Escuchando...`;
        if (statusEl) statusEl.textContent = 'Escuchando...';
    };

    recognition.onresult = (event) => {
        let interino = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) textoFinal += transcript + ' ';
            else interino += transcript;
        }
        // El texto queda editable en todo momento: esto solo actualiza el value del textarea, nunca lo bloquea.
        textarea.value = textoBase + textoFinal + interino;
    };

    recognition.onerror = (event) => {
        // 'not-allowed'/'service-not-allowed': el usuario bloqueó el micrófono o nunca dio el permiso.
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            showNotification('No se pudo acceder al micrófono. Revisá los permisos del navegador para dictar la nota.', 'error');
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            showNotification('Hubo un problema con el dictado por voz. Podés seguir escribiendo la nota a mano.', 'warning');
        }
    };

    recognition.onend = () => {
        btn.classList.remove('dictado-activo');
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Dictar nota por voz');
        btn.innerHTML = `${ICONS.mic} Dictar`;
        if (statusEl) statusEl.textContent = '';
        dictadoRecognition = null;
        dictadoActivoBtn = null;
    };

    recognition.start();
};

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-dictado');
    if (!btn) return;
    if (btn.classList.contains('dictado-activo')) detenerDictado();
    else iniciarDictado(btn);
});

const buildNotaForm = () => `
    <form onsubmit="submitNota(event)" id="formNota" class="clinico-inline-form" style="display:none;">
        <h4>Nueva Nota</h4>
        <div style="display:grid; grid-template-columns:1fr 3fr; gap:1rem;">
            <div class="form-group">
                <label>Categoría</label>
                <select name="categoria" class="form-control">
                    ${Object.entries(NOTA_CATEGORIA_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="notaTextoInput">Texto</label>
                <textarea name="texto" id="notaTextoInput" class="form-control" rows="3" required placeholder="Ej: la dueña llamó, el animal sigue sin comer..."></textarea>
                ${dictadoBotonHTML('notaTextoInput')}
            </div>
        </div>
        <button type="submit" class="btn-primary">Guardar Nota</button>
    </form>`;

export const submitNota = async (event) => {
    event.preventDefault();
    detenerDictado();
    const form = event.target;
    const data = {
        mascota_id: currentMascotaId,
        categoria: form.categoria.value,
        texto: form.texto.value,
    };
    try {
        await fetchAPI('/notas/', { method: 'POST', body: JSON.stringify(data) });
        form.reset();
        form.style.display = 'none';
        cargarNotasPet(currentMascotaId);
        actualizarCountsPet(currentMascotaId);
    } catch (error) {
        alert('Error al guardar la nota: ' + error.message);
    }
};

const renderNotaCard = (n) => {
    const currentUserId = parseInt(localStorage.getItem('user_id'), 10);
    const role = localStorage.getItem('role');
    const puedeModificar = role === 'admin' || n.usuario_id === currentUserId;
    const fecha = new Date(n.fecha_creacion).toLocaleString();
    const editada = n.fecha_edicion ? `<span style="font-style:italic; color:var(--text-muted);"> (editada ${new Date(n.fecha_edicion).toLocaleString()}${n.editado_por_username ? ' por ' + n.editado_por_username : ''})</span>` : '';

    return `
        <div class="card-item" id="nota-${n.id}" style="border-left: 4px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <div>
                    <span class="badge" style="background:var(--primary-subtle); color:var(--primary);">${NOTA_CATEGORIA_LABELS[n.categoria] || n.categoria}</span>
                    <span style="font-size:0.85rem; color:var(--text-secondary); margin-left:0.5rem;">${fecha} · <b>${n.autor || 'Desconocido'}</b>${editada}</span>
                </div>
                ${puedeModificar ? `
                <div class="row-actions">
                    <button class="btn-secondary btn-sm" onclick="editarNota(${n.id})" style="padding:0.15rem 0.5rem; font-size:0.78rem;">Editar</button>
                    <button class="btn-secondary btn-sm btn-row-danger" onclick="borrarNota(${n.id})" style="padding:0.15rem 0.5rem; font-size:0.78rem;">Borrar</button>
                </div>` : ''}
            </div>
            <div class="nota-texto" style="margin-top:0.5rem; white-space:pre-wrap;">${n.texto}</div>
        </div>`;
};

export const cargarNotasPet = async (mascotaId) => {
    detenerDictado(); // este render reemplaza el DOM entero de la pestaña, no dejar un micrófono huérfano abierto
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildNotaForm() + `<div id="notasList"><p style="text-align:center;color:var(--text-muted);">Cargando...</p></div>`;
    try {
        const data = await fetchAPI(`/notas/mascota/${mascotaId}`);
        const list = document.getElementById('notasList');
        if (!data.length) {
            list.innerHTML = `<div class="empty-state"><div class="icon">${ICONS.notePencil}</div><p>Todavía no hay notas para este paciente.<br>Usá "+ Nueva Nota" para registrar la primera.</p></div>`;
        } else {
            // Más reciente primero en pantalla; el backend ya las entrega en orden cronológico ascendente.
            list.innerHTML = data.slice().reverse().map(renderNotaCard).join('');
        }
    } catch (e) {
        document.getElementById('notasList').innerHTML = '<p>Error cargando notas.</p>';
    }
};

export const editarNota = (notaId) => {
    const card = document.getElementById(`nota-${notaId}`);
    if (!card) return;
    const textoDiv = card.querySelector('.nota-texto');
    const textoActual = textoDiv.textContent;
    const targetId = `editNotaTexto-${notaId}`;
    textoDiv.innerHTML = `
        <textarea class="form-control" rows="3" id="${targetId}">${textoActual}</textarea>
        ${dictadoBotonHTML(targetId)}
        <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
            <button class="btn-primary btn-sm" onclick="guardarEdicionNota(${notaId})" style="padding:0.2rem 0.6rem; font-size:0.8rem;">Guardar</button>
            <button class="btn-secondary btn-sm" onclick="cargarNotasPet(currentMascotaId)" style="padding:0.2rem 0.6rem; font-size:0.8rem;">Cancelar</button>
        </div>`;
};

export const guardarEdicionNota = async (notaId) => {
    detenerDictado();
    const textarea = document.getElementById(`editNotaTexto-${notaId}`);
    try {
        await fetchAPI(`/notas/${notaId}`, { method: 'PUT', body: JSON.stringify({ texto: textarea.value }) });
        cargarNotasPet(currentMascotaId);
    } catch (error) {
        alert('Error al editar la nota: ' + error.message);
    }
};

export const borrarNota = async (notaId) => {
    if (!confirm('¿Borrar esta nota? Quedará oculta de la historia del paciente.')) return;
    try {
        await fetchAPI(`/notas/${notaId}`, { method: 'DELETE' });
        cargarNotasPet(currentMascotaId);
        actualizarCountsPet(currentMascotaId);
    } catch (error) {
        alert('Error al borrar la nota: ' + error.message);
    }
};

// Tarea 09: cargarVacunasPet / cargarDesparasitacionesPet / cargarHospitalizacionesPet
// / cargarCirugiasPet / cargarPruebasPet fueron eliminadas. Su lógica de lectura
// vive ahora en el detalle type-aware de la pestaña "Servicios"
// (_detalleClinicoPorTipo). El alta sigue disponible por "+ Registrar"
// (buildClinicoForm + submitClinico).

const cargarRecetasPet = async (mascotaId) => {
    const contentArea = document.getElementById('petTabContent');
    try {
        // We fetch recipes via consultations usually, but let's assume an endpoint exists or we aggregate
        const consultas = await fetchAPI(`/consultas/?mascota_id=${mascotaId}`);
        let allRecetas = [];
        for (const c of consultas) {
            const r = await fetchAPI(`/consultas/${c.id}/recetas`);
            allRecetas = allRecetas.concat(r.map(x => ({ ...x, consulta_fecha: c.fecha_consulta })));
        }

        if (allRecetas.length === 0) {
            contentArea.innerHTML = `<div class="empty-state"><div class="icon">${ICONS.pill}</div><p>No hay fórmulas médicas registradas.</p></div>`;
            return;
        }

        contentArea.innerHTML = allRecetas.map(r => `
            <div class="card-item" style="border-left: 4px solid var(--secondary);">
                <div style="font-weight: 700; color: var(--secondary-dark);">Receta - ${new Date(r.fecha_emision).toLocaleDateString()}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Consulta del ${new Date(r.consulta_fecha).toLocaleDateString()}</div>
                <div style="background: var(--secondary-subtle); padding: 0.75rem; border-radius: 8px; font-size: 0.9rem;">
                    <b>Indicaciones:</b> ${r.indicaciones_generales || 'Ninguna'}
                    <ul style="margin-top: 0.5rem; padding-left: 1.2rem;">
                        ${r.detalles.map(d => `<li>${d.medicamento_id}: ${d.dosis} (${d.frecuencia} / ${d.duracion})</li>`).join('')}
                    </ul>
                </div>
                <button class="btn-secondary btn-sm" onclick="exportarRecetaPDF(${r.consulta_id}, ${r.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 0.5rem; background:var(--primary-subtle); color:var(--primary-dark); border-color:var(--primary-subtle);">${ICONS.printer} PDF</button>
            </div>
        `).join('');
    } catch (e) {
        contentArea.innerHTML = '<p>Error cargando recetas.</p>';
    }
};

// Removida duplicación antigua de verConsultaCompleta

const actualizarCountsPet = async (mascotaId) => {
    try {
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        // Tarea 09: la ficha tiene 6 pestañas. Los contadores por tipo clínico
        // se colapsan en "count-servicios" (feed unificado alcance=todos).
        Promise.all([
            fetchAPI(`/consultas/?mascota_id=${mascotaId}`).catch(() => []),
            fetchAPI(`/servicios/?mascota_id=${mascotaId}&alcance=todos`).catch(() => []),
            fetchAPI(`/facturas/mascota/${mascotaId}`).catch(() => []),
            fetchAPI(`/notas/mascota/${mascotaId}`).catch(() => [])
        ]).then(([cons, serv, fac, notas]) => {
            setTxt('count-consultas', cons?.length || 0);
            setTxt('count-servicios', serv?.length || 0);
            setTxt('count-facturas', fac?.length || 0);
            setTxt('count-notas', notas?.length || 0);
        }).catch(e => console.warn(e));

        setTxt('count-recetas', '-');
    } catch (e) { }
};

export const setupSearch = () => {
    const searchInput = document.getElementById('sidebarSearch');
    const searchResults = document.getElementById('search-results');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(async (e) => {
            const query = e.target.value;
            if (query.length < 2) {
                searchResults.style.display = 'none';
                return;
            }
            try {
                const mascotas = await fetchAPI(`/mascotas/?search=${encodeURIComponent(query)}`);
                searchResults.innerHTML = '';
                if (mascotas.length === 0) {
                    searchResults.innerHTML = '<div class="search-item">No se encontraron resultados</div>';
                } else {
                    mascotas.forEach(m => {
                        const div = document.createElement('div');
                        div.className = 'search-item';
                        div.innerHTML = `
                            <div style="font-weight: 600;">${m.nombre}</div>
                            <div style="font-size: 0.8rem; color: #666;">
                                ${m.especie} - #${m.codigo_historia || m.id}
                            </div>
                        `;
                        div.onclick = () => {
                            seleccionarMascota(m.id, m.nombre, m.especie, m.codigo_historia);
                            searchResults.style.display = 'none';
                        };
                        searchResults.appendChild(div);
                    });
                }
                searchResults.style.display = 'block';
            } catch (error) {
                console.error(error);
            }
        }, 300));

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });
    }
};

// ============ RECETAS LOGIC ============
const cargarMedicamentosParaReceta = async () => {
    if (medicamentosCache.length > 0) return medicamentosCache;
    try {
        const inventario = await fetchAPI('/inventario/');
        // Filtrar aquellos que sean de tipo Medicamento (o dejar todos si así se prefiere)
        medicamentosCache = inventario.filter(i => i.tipo === 'Medicamento' || !i.tipo);
        return medicamentosCache;
    } catch (e) {
        console.error("Error al obtener medicinas", e);
        return [];
    }
};

const renderMedicamentoRow = async (medicamentos, isFirst = false) => {
    const div = document.createElement('div');
    div.className = 'form-row receta-item receta-item-row';

    const removeBtn = isFirst ? '' : `<button type="button" class="btn-sm" style="position: absolute; top: 0.5rem; right: 0.5rem; background: var(--accent-subtle); border: none; color: var(--accent); border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;" onclick="this.parentElement.remove()">${ICONS.close}</button>`;

    div.innerHTML = `
        ${removeBtn}
        <div class="form-group" style="flex: 2; margin-bottom: 0;">
            <label>Medicamento (Buscador)</label>
            <div class="searchable-container">
                <input type="text" class="receta-med-search" placeholder="Escriba para buscar medicamento..." required autocomplete="off">
                <input type="hidden" class="receta-med-id">
            </div>
        </div>
        <div class="form-group" style="flex: 1; margin-bottom: 0;">
            <label>Dosis</label>
            <input type="text" class="receta-dosis" required placeholder="Ej: 1 tab">
        </div>
        <div class="form-row" style="width: 100%; margin-top: 1rem; margin-bottom: 0;">
             <div class="form-group" style="flex:1; margin-bottom: 0;">
                <label>Frecuencia</label>
                <input type="text" class="receta-frecuencia" required placeholder="Ej: Cada 8h">
             </div>
             <div class="form-group" style="flex:1; margin-bottom: 0;">
                <label>Duración</label>
                <input type="text" class="receta-duracion" required placeholder="Ej: 7 días">
             </div>
        </div>
    `;

    document.getElementById('recetaDetallesContainer').appendChild(div);

    initSearchableSelect(
        div.querySelector('.receta-med-search'),
        medicamentos.map(m => ({ label: `${m.nombre} (Stock: ${m.stock_actual})`, value: m.id })),
        (val) => {
            div.querySelector('.receta-med-id').value = val;
        }
    );
};

export const abrirModalReceta = async (consultaId) => {
    document.getElementById('recetaConsultaId').value = consultaId;
    const container = document.getElementById('recetaDetallesContainer');
    container.innerHTML = '<p>Cargando medicamentos...</p>';

    const medicamentos = await cargarMedicamentosParaReceta();
    container.innerHTML = '';
    container.appendChild(renderMedicamentoRow(medicamentos, true));

    openModal('modalReceta');
};

const handleAddMedicamentoReceta = () => {
    if (medicamentosCache.length === 0) return;
    const container = document.getElementById('recetaDetallesContainer');
    container.appendChild(renderMedicamentoRow(medicamentosCache, false));
};

export const handleRecetaSubmit = async (e) => {
    e.preventDefault();
    const consultaId = document.getElementById('recetaConsultaId').value;
    const indicaciones = document.getElementById('recetaIndicaciones').value;

    const items = document.querySelectorAll('.receta-item');
    const detalles = [];

    items.forEach(item => {
        const medId = item.querySelector('.receta-med-id').value;
        if (medId) {
            detalles.push({
                medicamento_id: parseInt(medId),
                dosis: item.querySelector('.receta-dosis').value,
                frecuencia: item.querySelector('.receta-frecuencia').value,
                duracion: item.querySelector('.receta-duracion').value
            });
        }
    });

    if (detalles.length === 0) {
        alert("Debe agregar al menos un medicamento.");
        return;
    }

    try {
        await fetchAPI(`/consultas/${consultaId}/recetas`, {
            method: 'POST',
            body: JSON.stringify({ indicaciones_generales: indicaciones, detalles: detalles })
        });
        alert('Receta creada correctamente.');
        closeModal('modalReceta');
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

const verRecetas = async (consultaId) => {
    try {
        const recetas = await fetchAPI(`/consultas/${consultaId}/recetas`);
        if (recetas.length === 0) {
            alert('No hay recetas para esta consulta.');
            return;
        }
        // Para simplificar, mostraremos un alert detallado o podriamos hacer un modal para ver.
        let msg = "RECETAS RECETADAS:\n";
        recetas.forEach(r => {
            msg += `\nFecha: ${new Date(r.fecha_emision).toLocaleString()}\nIndicaciones: ${r.indicaciones_generales || 'Ninguna'}\nMedicamentos: ${r.detalles.length} item(s).\n`;
        });
        alert(msg);
    } catch (e) {
        alert('Error cargando recetas: ' + e.message);
    }
};

export const cargarVeterinarios = async () => {
    try {
        const usuarios = await fetchAPI('/usuarios/veterinarios');
        const opts1 = '<option value="">Seleccionar médico...</option>' +
            usuarios.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
        const opts2 = '<option value="">Seleccionar médico...</option>' +
            usuarios.map(u => `<option value="${u.id}" data-username="${u.username}">${u.username} (${u.role})</option>`).join('');

        const scita = document.getElementById('citaVeterinarioId');
        if (scita) scita.innerHTML = opts1;

        const scons = document.getElementById('consultaVeterinario');
        if (scons) scons.innerHTML = opts2;
    } catch (e) {
        console.warn("No se pudieron cargar vets", e);
    }
};

// Exports adicionales usados por otros módulos / bootstrap (además de los `export`
// individuales de arriba): seleccionarMascota y seleccionarMascotaBasica no llevan
// `export` inline porque se referencian por nombre dentro del módulo.
export { seleccionarMascota, seleccionarMascotaBasica, switchPetTab, cargarConsultas, actualizarCountsPet };
export { initConsultorio as init };
