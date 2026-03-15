// Configuración de la API
const API_BASE_URL = '/api'; // Relative path for deployment

// Utilidades
const fetchAPI = async (endpoint, options = {}) => {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: headers,
        });

        if (response.status === 401) {
            logout();
            return;
        }

        let data = null;
        if (response.status !== 204) {
            data = await response.json();
        }

        if (!response.ok) {
            throw new Error((data && data.detail) || 'Error en la petición');
        }

        return data;
    } catch (error) {
        console.error('Error en fetchAPI:', error);
        throw error;
    }
};

/**
 * Crea un selector premium con búsqueda integrada
 * @param {string} containerId - ID del contenedor donde se renderizará
 * @param {Array} options - Array de objetos { value, label, subtext }
 * @param {string} placeholder - Texto inicial
 * @param {Function} onChange - Callback al seleccionar
 */
const createPrettySelect = (containerId, options = [], placeholder = 'Seleccionar...', onChange = null) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Generar IDs únicos
    const dropdownId = `${containerId}-dropdown`;
    const searchId = `${containerId}-search`;

    container.innerHTML = `
        <div class="custom-select-trigger" id="${containerId}-trigger">
            <span class="trigger-text">${placeholder}</span>
            <span class="trigger-icon">▼</span>
        </div>
        <div class="custom-select-dropdown" id="${dropdownId}">
            <div class="custom-select-search-wrapper">
                <input type="text" class="custom-select-search" id="${searchId}" placeholder="Buscar...">
            </div>
            <div class="custom-select-options">
                <!-- Opciones dinámicas -->
            </div>
        </div>
    `;

    const trigger = container.querySelector('.custom-select-trigger');
    const dropdown = container.querySelector('.custom-select-dropdown');
    const search = container.querySelector('.custom-select-search');
    const optionsList = container.querySelector('.custom-select-options');
    const triggerText = trigger.querySelector('.trigger-text');

    let selectedValue = null;

    const renderOptions = (filter = '') => {
        const filtered = options.filter(opt => 
            opt.label.toLowerCase().includes(filter.toLowerCase()) || 
            (opt.subtext && opt.subtext.toLowerCase().includes(filter.toLowerCase()))
        );

        if (filtered.length === 0) {
            optionsList.innerHTML = `<div class="custom-select-option no-results">No hay resultados</div>`;
            return;
        }

        optionsList.innerHTML = filtered.map(opt => `
            <div class="custom-select-option ${opt.value === selectedValue ? 'selected' : ''}" data-value="${opt.value}">
                <div style="font-weight: 500;">${opt.label}</div>
                ${opt.subtext ? `<div style="font-size: 0.75rem; opacity: 0.7;">${opt.subtext}</div>` : ''}
            </div>
        `).join('');

        // Eventos para las opciones
        optionsList.querySelectorAll('.custom-select-option').forEach(el => {
            el.addEventListener('click', () => {
                const value = el.getAttribute('data-value');
                const label = el.querySelector('div').textContent;
                selectOption(value, label);
            });
        });
    };

    const selectOption = (value, label) => {
        selectedValue = value;
        triggerText.textContent = label;
        trigger.classList.remove('active');
        dropdown.classList.remove('show');
        
        if (onChange) onChange(value, label);
    };

    // Al hacer clic en el trigger
    trigger.addEventListener('click', (e) => {
        const isOpen = dropdown.classList.contains('show');
        
        // Cerrar otros dropdowns primero if needed
        document.querySelectorAll('.custom-select-dropdown').forEach(d => {
            if (d.id !== dropdownId) d.classList.remove('show');
        });
        document.querySelectorAll('.custom-select-trigger').forEach(t => {
            if (t.id !== `${containerId}-trigger`) t.classList.remove('active');
        });

        trigger.classList.toggle('active');
        dropdown.classList.toggle('show');
        
        if (!isOpen) {
            search.value = '';
            renderOptions();
            setTimeout(() => search.focus(), 50);
        }
    });

    // Búsqueda
    search.addEventListener('input', (e) => {
        renderOptions(e.target.value);
    });

    // Cerrar al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            trigger.classList.remove('active');
            dropdown.classList.remove('show');
        }
    });

    // Renderizado inicial
    renderOptions();

    // Retornar objeto para manipularlo manualmente si es necesario
    return {
        setValue: (value, label) => selectOption(value, label),
        getValue: () => selectedValue,
        setOptions: (newOptions) => {
            options = newOptions;
            renderOptions();
        }
    };
};

// ============ STATE MANAGEMENT ============
let currentMascotaId = null;

// ============ NAVIGATION (SPA) ============
const setupNavigation = () => {
    const menuItems = document.querySelectorAll('.menu-item[data-target]');
    const sections = document.querySelectorAll('.spa-section');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');

            // Actualizar menú activo
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Mostrar sección correspondiente
            sections.forEach(section => {
                section.style.display = (section.id === targetId) ? 'block' : 'none';
            });

            // Cargar datos de la sección si es necesario
            if (targetId === 'sec-agenda') loadAgenda();
            if (targetId === 'sec-consultorio') initConsultorio();
            if (targetId === 'sec-inventario') loadInventario();
            if (targetId === 'sec-reportes') loadReportes();
            if (targetId === 'sec-propietarios') loadPropietarios();
            if (targetId === 'sec-usuarios') loadUsuarios();
        });
    });
};

const checkAdminAccess = async () => {
    try {
        const user = await fetchAPI('/usuarios/me');
        if (user) {
            const display = document.getElementById('userNameDisplay');
            if (display) display.textContent = `Hola, ${user.username}`;

            if (user.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    el.style.display = 'flex';
                });
            }
        }
    } catch (error) {
        console.warn("Could not verify admin status:", error.message);
    }
};

// ============ AGENDA MODULE ============
let calendarInstance = null;

const loadAgenda = async () => {
    const container = document.getElementById('agenda-list');
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Cargando agenda...</p>';

    try {
        const citas = await fetchAPI('/citas/?skip=0&limit=100'); // Fetch more for calendar

        // 1. Render List (Órdenes / Espera)
        const hoy = new Date().toISOString().split('T')[0];
        const hoyCitas = citas.filter(c => c.fecha.startsWith(hoy));

        if (hoyCitas.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No hay pacientes en espera.</p>';
        } else {
            container.innerHTML = hoyCitas.map(cita => `
                <div class="card-item">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div>
                            <strong style="color: var(--text-primary); font-size: 0.9rem;">${new Date(cita.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                            <span class="badge" style="background: ${getStatusColor(cita.estado)}; margin-left: 0.5rem;">${cita.estado}</span>
                        </div>
                    </div>
                    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Mascota ID: ${cita.mascota_id}</p>
                    <p style="font-size: 0.875rem; font-weight: 500;">${cita.motivo}</p>
                    <div style="margin-top: 1rem; text-align: right;">
                        ${cita.estado === 'Programada' ? `<button onclick="checkInCita(${cita.id})" class="btn-secondary btn-sm">Marcar Check-in</button>` : ''}
                        ${(cita.estado === 'En Sala' || cita.estado === 'Programada') ? `<button onclick="atenderDesdeOrden(${cita.mascota_id}, ${cita.id})" class="btn-primary btn-sm">Atender</button>` : ''}
                    </div>
                </div>
            `).join('');
        }

        // 2. Render Calendar
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
                height: '100%',
                events: citas.map(c => ({
                    id: c.id,
                    title: `Mascota #${c.mascota_id} - ${c.motivo}`,
                    start: c.fecha,
                    backgroundColor: getStatusColor(c.estado),
                    borderColor: getStatusColor(c.estado)
                })),
                eventClick: function (info) {
                    alert('Cita: ' + info.event.title);
                }
            });
            calendarInstance.render();
        } else {
            calendarInstance.removeAllEvents();
            citas.forEach(c => {
                calendarInstance.addEvent({
                    id: c.id,
                    title: `Pac: #${c.mascota_id} - ${c.tipo}`,
                    start: c.fecha_cita,
                    backgroundColor: getStatusColor(c.estado),
                    borderColor: getStatusColor(c.estado),
                    extendedProps: { ...c }
                });
            });
        }

    } catch (error) {
        container.innerHTML = `<p style="color: red; text-align: center;">Error: ${error.message}</p>`;
    }
};

const getStatusColor = (status) => {
    switch (status) {
        case 'Programada': return '#3b82f6'; // blue
        case 'En Sala': return '#f59e0b'; // warning
        case 'Finalizada': return '#10b981'; // green
        case 'Cancelada': return '#ef4444'; // red
        default: return '#9ca3af'; // gray
    }
};

const checkInCita = async (id) => {
    try {
        await fetchAPI(`/citas/${id}/checkin`, { method: 'PUT' });
        loadAgenda();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

window.atenderDesdeOrden = (mascotaId, citaId) => {
    // Redirigir al consultorio
    const menuItems = document.querySelectorAll('.menu-item[data-target]');
    const sections = document.querySelectorAll('.spa-section');
    menuItems.forEach(i => i.classList.remove('active'));
    document.querySelector('.menu-item[data-target="sec-consultorio"]').classList.add('active');
    sections.forEach(s => s.style.display = 'none');
    document.getElementById('sec-consultorio').style.display = 'block';

    // Seleccionar mascota y enfocar
    seleccionarMascotaBasica(mascotaId); // Carga la mascota, podemos optimizar si tuvieramos el endpoint
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

const handleCitaSubmit = async (e) => {
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


// ============ PROPIETARIOS MODULE ============
const loadPropietarios = async (filter = '') => {
    const tbody = document.getElementById('propietariosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Cargando propietarios...</td></tr>';
    try {
        let propietarios = await fetchAPI('/propietarios/');
        // Filtrar inactivos
        propietarios = propietarios.filter(p => p.activo !== false);
        
        if (filter) {
            const f = filter.toLowerCase();
            propietarios = propietarios.filter(p => 
                p.nombre.toLowerCase().includes(f) || 
                p.apellido.toLowerCase().includes(f) || 
                p.cedula.includes(f)
            );
        }

        if (propietarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #9ca3af;">No se encontraron propietarios.</td></tr>';
            return;
        }

        tbody.innerHTML = propietarios.map(p => `
            <tr class="table-row-hover">
                <td><span class="badge-id">#${p.id}</span></td>
                <td style="font-weight: 500;">${p.nombre} ${p.apellido}</td>
                <td>${p.cedula}</td>
                <td>${p.telefono}</td>
                <td>${p.email || '<span style="color: #9ca3af;">N/D</span>'}</td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                        <button class="btn-secondary btn-sm" onclick="verMascotasPropietario(${p.id}, '${p.nombre}')" title="Ver mascotas">🐾 Mascotas</button>
                        <button class="btn-secondary btn-sm" onclick="abrirEditarPropietario(${p.id})" title="Editar">✏️</button>
                        <button class="btn-secondary btn-sm" onclick="confirmEliminarPropietario(${p.id}, '${p.nombre} ${p.apellido}')" title="Eliminar" style="color: #ef4444; border-color: #fca5a5;">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 2rem;">Error: ${error.message}</td></tr>`;
    }
};

const abrirEditarPropietario = async (id) => {
    try {
        const p = await fetchAPI(`/propietarios/${id}`);
        document.getElementById('editPropietarioId').value = p.id;
        document.getElementById('editPropietarioNombre').value = p.nombre;
        document.getElementById('editPropietarioApellido').value = p.apellido;
        document.getElementById('editPropietarioCedula').value = p.cedula;
        document.getElementById('editPropietarioTelefono').value = p.telefono;
        document.getElementById('editPropietarioEmail').value = p.email || '';
        document.getElementById('editPropietarioDireccion').value = p.direccion || '';
        
        document.getElementById('modalEditarPropietario').style.display = 'block';
    } catch (error) {
        alert("Error al cargar datos del propietario");
    }
};

const confirmEliminarPropietario = async (id, nombre) => {
    if (confirm(`¿Estás seguro de que deseas eliminar al propietario ${nombre}?\nEsta acción lo desactivará del sistema.`)) {
        try {
            await fetchAPI(`/propietarios/${id}`, { method: 'DELETE' });
            alert("Propietario eliminado con éxito.");
            loadPropietarios();
        } catch (error) {
            alert(error.message);
        }
    }
};

const verMascotasPropietario = async (propietarioId, nombre) => {
    try {
        const mascotas = await fetchAPI(`/mascotas/?propietario_id=${propietarioId}`);
        // Redirect to Consultorio and filter
        const listContainer = document.getElementById('consultorioMascotasList');
        const searchInput = document.getElementById('consultorioSearchMascota');
        
        // Switch section manually to avoid race conditions with DOM elements
        const menuItems = document.querySelectorAll('.menu-item[data-target]');
        const sections = document.querySelectorAll('.spa-section');
        menuItems.forEach(i => i.classList.remove('active'));
        document.querySelector('.menu-item[data-target="sec-consultorio"]').classList.add('active');
        sections.forEach(s => s.style.display = 'none');
        document.getElementById('sec-consultorio').style.display = 'block';

        if (searchInput) {
            searchInput.value = `ID Propietario: ${propietarioId}`; // UI feedback
        }

        renderMascotasList(mascotas, listContainer);
        
        if (mascotas.length === 1) {
            const m = mascotas[0];
            seleccionarMascota(m.id, m.nombre, m.especie, m.codigo_historia);
        }
    } catch (e) {
        alert("Error cargando mascotas del propietario");
    }
};

// ============ USUARIOS MODULE ============
const loadUsuarios = async () => {
    const tbody = document.getElementById('usuariosTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Cargando...</td></tr>';
    try {
        const usuarios = await fetchAPI('/usuarios/');
        tbody.innerHTML = usuarios.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.email}</td>
                <td><span class="badge" style="background: ${u.role === 'admin' ? '#4F46E5' : '#9ca3af'}">${u.role}</span></td>
                <td>${u.is_active ? '✅ Activo' : '❌ Inactivo'}</td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Error: ${error.message}</td></tr>`;
    }
};

const handleNuevoUsuarioSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            username: document.getElementById('userUsername').value,
            email: document.getElementById('userEmail').value,
            password: document.getElementById('userPassword').value,
            role: document.getElementById('userRole').value
        };
        await fetchAPI('/usuarios/', { method: 'POST', body: JSON.stringify(data) });
        alert('Usuario creado correctamente.');
        closeModal('modalNuevoUsuario');
        loadUsuarios();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// ============ EVOLUCION DE PESO (CHART) ============
let weightChart = null;

const toggleWeightChart = async () => {
    const container = document.getElementById('chartContainer');
    if (container.style.display === 'block') {
        container.style.display = 'none';
        return;
    }

    if (!currentMascotaId) return;

    try {
        const data = await fetchAPI(`/mascotas/${currentMascotaId}/peso-history`);
        if (data.length === 0) {
            alert('No hay suficientes datos de peso para mostrar la gráfica.');
            return;
        }

        container.style.display = 'block';
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
const handleTransferirSubmit = async (e) => {
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

const loadInventario = async () => {
    const tbody = document.getElementById('inventarioTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';

    try {
        const productos = await fetchAPI('/inventario/');

        if (productos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Inventario vacío.</td></tr>';
            return;
        }

        tbody.innerHTML = productos.map(p => `
            <tr>
                <td>${p.nombre}</td>
                <td>${p.tipo}</td>
                <td style="font-weight: bold; color: ${p.stock <= p.stock_minimo ? 'red' : 'inherit'}">
                    ${p.stock} units
                </td>
                <td>$${p.precio_unitario || '-'}</td>
                <td>${p.stock <= p.stock_minimo ? '⚠️ Bajo Stock' : '✅ OK'}</td>
            </tr>
        `).join('');

        // Actualizar badge
        const lowStock = productos.filter(p => p.stock <= p.stock_minimo).length;
        document.getElementById('badgeStock').textContent = lowStock > 0 ? lowStock : '';

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error: ${error.message}</td></tr>`;
    }
};

const handleProductoSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            nombre: document.getElementById('prodNombre').value,
            tipo: document.getElementById('prodTipo').value,
            stock: parseInt(document.getElementById('prodStock').value),
            stock_minimo: parseInt(document.getElementById('prodMinimo').value),
            precio_unitario: parseFloat(document.getElementById('prodPrecio').value) || 0
        };
        await fetchAPI('/inventario/', { method: 'POST', body: JSON.stringify(data) });
        alert('Producto creado.');
        closeModal('modalProducto');
        loadInventario();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// ============ REPORTES MODULE ============
const loadReportes = async () => {
    try {
        // En un caso real, llamaríamos a endpoints de reportes/stats
        // Simulamos stats básicos con las APIs existentes por ahora
        const citas = await fetchAPI('/citas/?skip=0&limit=100');
        const today = new Date().toISOString().split('T')[0];
        const citasHoy = citas.filter(c => c.fecha.startsWith(today)).length;

        // const reporteKpis = await fetchAPI('/reportes/kpis'); // Si existiera

        document.getElementById('kpiCitas').textContent = citasHoy;
        document.getElementById('kpiPacientes').textContent = citas.filter(c => c.estado === 'Finalizada').length; // Approx

        // El stock ya se actualiza en loadInventario si se visita
    } catch (error) {
        console.error('Error cargando reportes', error);
    }
};

// ============ EXISTING & SHARED FUNCTIONS ============

const handlePropietarioSubmit = async (e) => {
    e.preventDefault();
    try {
        const data = {
            nombre: document.getElementById('propietarioNombre').value,
            apellido: document.getElementById('propietarioApellido').value,
            cedula: document.getElementById('propietarioCedula').value,
            telefono: document.getElementById('propietarioTelefono').value,
            email: document.getElementById('propietarioEmail').value || null,
            direccion: document.getElementById('propietarioDireccion').value || null
        };
        const result = await fetchAPI('/propietarios/', { method: 'POST', body: JSON.stringify(data) });
        alert(`Propietario registrado: ${result.nombre} ${result.apellido}`);
        closeModal('modalPropietario');
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

const RAZAS_PERROS = [
    "Labrador Retriever", "Pastor Alemán", "Golden Retriever", "Bulldog Francés",
    "Beagle", "Poodle (Caniche)", "Rottweiler", "Yorkshire Terrier", "Boxer",
    "Dachshund (Salchicha)", "Siberian Husky", "Chihuahua", "Gran Danés",
    "Pinscher", "Doberman", "Basset Hound", "Shih Tzu", "Pug (Carlino)",
    "Border Collie", "Cocker Spaniel", "Pitbull", "Mestizo / Otros"
];

let razaSelectInstance = null;
let ownerSelectInstance = null;
let editRazaSelectInstance = null;

const initCustomSelects = async () => {
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

const setupRazasPerro = () => {
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

const handleMascotaSubmit = async (e) => {
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
        // Refresh list if in consultorio
        const currentTarget = document.querySelector('.menu-item.active')?.dataset.target;
        if (currentTarget === 'sec-consultorio') initConsultorio();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

const handleEditarPropietarioSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editPropietarioId').value;
    const data = {
        nombre: document.getElementById('editPropietarioNombre').value,
        apellido: document.getElementById('editPropietarioApellido').value,
        cedula: document.getElementById('editPropietarioCedula').value,
        telefono: document.getElementById('editPropietarioTelefono').value,
        email: document.getElementById('editPropietarioEmail').value || null,
        direccion: document.getElementById('editPropietarioDireccion').value || null
    };
    try {
        await fetchAPI(`/propietarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        alert("Propietario actualizado correctamente");
        closeModal('modalEditarPropietario');
        loadPropietarios();
    } catch (error) {
        alert("Error: " + error.message);
    }
};

const handleEditarMascotaSubmit = async (e) => {
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

const abrirEditarMascota = async (id) => {
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

        document.getElementById('modalEditarMascota').style.display = 'block';
    } catch (error) {
        alert("Error al cargar datos de la mascota");
    }
};

const confirmEliminarMascota = async (id, nombre) => {
    if (confirm(`¿Estás seguro de que deseas eliminar a la mascota ${nombre}?\nEsta acción la desactivará del consultorio.`)) {
        try {
            await fetchAPI(`/mascotas/${id}`, { method: 'DELETE' });
            alert("Mascota eliminada con éxito.");
            document.getElementById('patientWrapper').style.display = 'none';
            document.getElementById('emptyPatientWrapper').style.display = 'flex';
            currentMascotaId = null;
            initConsultorio();
        } catch (error) {
            alert(error.message);
        }
    }
};

const handleConsultaSubmit = async (e) => {
    e.preventDefault();
    try {
        const pruebas = document.getElementById('consultaPruebas')?.value || 'Ninguna prueba registrada';
        const icc = document.getElementById('consultaICC').value || 'N/D';
        const tllc = document.getElementById('consultaTLLC').value || 'N/D';

        const data = {
            mascota_id: parseInt(document.getElementById('consultaMascotaId').value),
            motivo: document.getElementById('consultaMotivo').value,
            sintomas: document.getElementById('consultaExamen').value,
            diagnostico: document.getElementById('consultaProblemas').value || "No especificado",
            peso: parseFloat(document.getElementById('consultaPeso').value) || null,
            temperatura: parseFloat(document.getElementById('consultaTemperatura').value) || null,
            observaciones: `ICC: ${icc}, TLLC: ${tllc} | Pruebas: ${pruebas}`
        };
        await fetchAPI('/consultas/', { method: 'POST', body: JSON.stringify(data) });
        alert('Consulta registrada correctamente.');
        closeModal('modalConsulta');
        if (currentMascotaId) cargarConsultas(currentMascotaId);
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

const initConsultorio = async () => {
    const listContainer = document.getElementById('consultorioMascotasList');
    if (!listContainer) return;
    listContainer.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 1.5rem;">Cargando pacientes...</p>';
    try {
        const mascotas = await fetchAPI('/mascotas/?skip=0&limit=50');
        // Filtrar inactivas
        const activas = mascotas.filter(m => m.activo !== false);
        renderMascotasList(activas, listContainer);
    } catch (e) {
        listContainer.innerHTML = '<p style="color: #ef4444; text-align:center; padding: 1.5rem; font-weight: 500;">❌ Error al cargar pacientes</p>';
    }
};

const setupConsultorioSearch = () => {
    const listContainer = document.getElementById('consultorioMascotasList');
    const searchInput = document.getElementById('consultorioSearchMascota');
    
    if (searchInput && listContainer) {
        searchInput.addEventListener('input', debounce(async (e) => {
            const query = e.target.value.trim();
            const endpoint = query.length >= 2 ? `/mascotas/?search=${encodeURIComponent(query)}` : '/mascotas/?skip=0&limit=50';
            try {
                const result = await fetchAPI(endpoint);
                renderMascotasList(result, listContainer);
            } catch (err) {
                console.error("Search error:", err);
            }
        }, 400));
    }
};

const renderMascotasList = (mascotas, container) => {
    if (!mascotas || mascotas.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 1rem;">No se encontraron pacientes.</p>';
        return;
    }
    container.innerHTML = mascotas.map(m => `
        <div class="search-item pet-list-item" onclick="seleccionarMascota(${m.id}, '${m.nombre}', '${m.especie}', '${m.codigo_historia || ''}')" 
             style="cursor: pointer; padding: 12px; border-bottom: 1px solid #f3f4f6; transition: background 0.2s; display: flex; flex-direction: column; gap: 4px;">
            <div style="font-weight: 600; color: #1f2937; font-size: 1rem;">${m.nombre}</div>
            <div style="font-size: 0.85rem; color: #6b7280; display: flex; justify-content: space-between;">
                <span>${m.especie}</span>
                <span style="color: #6366f1; font-weight: 500;">#${m.codigo_historia || m.id}</span>
            </div>
        </div>
    `).join('');
};

const cargarConsultas = async (mascotaId) => {
    const tableBody = document.getElementById('consultasTableBody');
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';
    try {
        const consultas = await fetchAPI(`/consultas/?mascota_id=${mascotaId}`);
        if (consultas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No hay historial clínico.</td></tr>';
            return;
        }
        tableBody.innerHTML = consultas.map(c => `
            <tr>
                <td>${new Date(c.fecha_consulta).toLocaleDateString()}</td>
                <td>${c.motivo}</td>
                <td>${c.diagnostico || '-'}</td>
                <td style="font-size: 0.9em;">
                    ${c.peso ? `<b>Peso:</b> ${c.peso}kg<br>` : ''}
                    ${c.temperatura ? `<b>Temp:</b> ${c.temperatura}°C` : ''}
                </td>
                <td style="text-align: right;">
                    <button class="btn-secondary btn-sm" onclick="abrirModalReceta(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: #ecfdf5; color: #047857; border-color: #059669;">💊 Recetar</button>
                    <button class="btn-secondary btn-sm" onclick="verRecetas(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 4px;">Ver Recetas</button>
                </td>
            </tr>
        `).join('');
        document.getElementById('btnVerPeso').style.display = 'inline-block';
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error loading.</td></tr>';
    }
};

const seleccionarMascota = async (id, nombre, especie, codigo) => {
    currentMascotaId = id;
    
    // UI placeholder while loading full data
    document.getElementById('displayNombreMascota').textContent = nombre || 'Cargando...';
    document.getElementById('displayInfoMascota').textContent = especie || '...';
    document.getElementById('consultaMascotaId').value = id;

    // Set default tab to Historia
    switchPetTab('historia');

    // Load full data to show breed and reproductive status
    try {
        const m = await fetchAPI(`/mascotas/${id}`);
        document.getElementById('displayNombreMascota').textContent = m.nombre;
        document.getElementById('displayInfoMascota').innerHTML = `
            ${m.especie} ${m.raza ? `(${m.raza})` : ''} 
            ${m.codigo_historia ? `- ID: ${m.codigo_historia}` : ''}
            <br>
            <span style="font-size: 0.85rem; color: #6366f1;">
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

    // Bind Edit/Delete buttons
    const btnEdit = document.getElementById('btnEditarMascota');
    const btnDel = document.getElementById('btnEliminarMascota');
    if (btnEdit) btnEdit.onclick = () => abrirEditarMascota(id);
    if (btnDel) btnDel.onclick = () => confirmEliminarMascota(id, nombre);
};

const switchPetTab = (tabName) => {
    // UI Update Active State
    document.querySelectorAll('.pet-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabName);
    });

    const contentArea = document.getElementById('petTabContent');
    const actionsArea = document.getElementById('petTabActions');
    contentArea.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 2rem;">Cargando...</p>';
    actionsArea.innerHTML = '';

    switch (tabName) {
        case 'historia':
            contentArea.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📄</div>
                    <p>Resumen de Historia Clínica</p>
                    <div id="historiaResumen" style="width: 100%; text-align: left; margin-top: 1rem;"></div>
                </div>`;
            renderHistoriaTab();
            break;
        case 'consultas':
            actionsArea.innerHTML = `<button class="btn-primary" id="btnRegistrarConsulta">+ Nueva Consulta</button>`;
            document.getElementById('btnRegistrarConsulta').onclick = () => {
                document.getElementById('consultaMascotaId').value = currentMascotaId;
                openModal('modalConsulta');
            };
            contentArea.innerHTML = `
                <table class="consultas-table">
                    <thead>
                        <tr><th>Fecha</th><th>Motivo</th><th>Diagnóstico</th><th>Signos</th><th style="text-align:right;">Acciones</th></tr>
                    </thead>
                    <tbody id="consultasTableBody"></tbody>
                </table>`;
            cargarConsultas(currentMascotaId);
            break;
        case 'vacunas':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="alert('Funcionalidad de registro de vacunas próximamente')">+ Registrar Vacuna</button>`;
            cargarVacunasPet(currentMascotaId);
            break;
        case 'recetas':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="alert('Las recetas se crean desde una consulta')">Ver Recetas</button>`;
            cargarRecetasPet(currentMascotaId);
            break;
        case 'ordenes':
            contentArea.innerHTML = '<div class="empty-state">No hay órdenes registradas.</div>';
            break;
        default:
            contentArea.innerHTML = `<div class="empty-state">Módulo <b>${tabName}</b> en desarrollo.</div>`;
    }
};

const renderHistoriaTab = async () => {
    const res = document.getElementById('historiaResumen');
    try {
        const m = await fetchAPI(`/mascotas/${currentMascotaId}`);
        res.innerHTML = `
            <div style="background: #f8fafc; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div><b>Especie:</b> ${m.especie}</div>
                    <div><b>Raza:</b> ${m.raza || 'N/A'}</div>
                    <div><b>Sexo:</b> ${m.sexo || 'N/A'}</div>
                    <div><b>Color:</b> ${m.color || 'N/A'}</div>
                    <div><b>Peso actual:</b> ${m.peso || 'N/A'} kg</div>
                    <div><b>Estado:</b> ${m.estado_reproductivo || 'N/A'}</div>
                </div>
                <hr style="margin: 1rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                <div><b>Observaciones:</b><br>${m.observaciones || 'Sin observaciones.'}</div>
            </div>`;
    } catch (e) {}
};

const cargarVacunasPet = async (mascotaId) => {
    const contentArea = document.getElementById('petTabContent');
    contentArea.innerHTML = `
        <div style="background: white; border-radius: 8px;">
            <table class="consultas-table">
                <thead><tr><th>Fecha</th><th>Vacuna</th><th>Lote</th><th>Próxima</th></tr></thead>
                <tbody><tr><td colspan="4" style="text-align:center; padding:2rem; color:#9ca3af;">No hay vacunas registradas.</td></tr></tbody>
            </table>
        </div>`;
};

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
            contentArea.innerHTML = '<div class="empty-state"><div class="icon">💊</div><p>No hay fórmulas médicas registradas.</p></div>';
            return;
        }

        contentArea.innerHTML = allRecetas.map(r => `
            <div class="card-item" style="border-left: 4px solid #10b981;">
                <div style="font-weight: 700; color: #059669;">Receta - ${new Date(r.fecha_emision).toLocaleDateString()}</div>
                <div style="font-size: 0.85rem; color: #6b7280; margin-bottom: 0.5rem;">Consulta del ${new Date(r.consulta_fecha).toLocaleDateString()}</div>
                <div style="background: #f0fdf4; padding: 0.75rem; border-radius: 8px; font-size: 0.9rem;">
                    <b>Indicaciones:</b> ${r.indicaciones_generales || 'Ninguna'}
                    <ul style="margin-top: 0.5rem; padding-left: 1.2rem;">
                        ${r.detalles.map(d => `<li>${d.medicamento_id}: ${d.dosis} (${d.frecuencia} / ${d.duracion})</li>`).join('')}
                    </ul>
                </div>
            </div>
        `).join('');
    } catch (e) {
        contentArea.innerHTML = '<p>Error cargando recetas.</p>';
    }
};

const actualizarCountsPet = async (mascotaId) => {
    try {
        const consultas = await fetchAPI(`/consultas/?mascota_id=${mascotaId}`);
        document.getElementById('count-consultas').textContent = consultas.length;
        
        // Mocking others for now to show the UI works
        document.getElementById('count-recetas').textContent = '...';
        document.getElementById('count-vacunas').textContent = '0';
        document.getElementById('count-proc').textContent = '0';
    } catch (e) {}
};

const initSearchableSelect = (input, options, onSelect) => {
    const container = input.parentElement;
    container.classList.add('searchable-select');
    
    let dropdown = container.querySelector('.searchable-dropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'searchable-dropdown';
        container.appendChild(dropdown);
    }

    const renderOptions = (filter = '') => {
        const filtered = options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase()));
        dropdown.innerHTML = filtered.map(o => `
            <div class="searchable-option" data-value="${o.value}">${o.label}</div>
        `).join('');
        dropdown.style.display = filtered.length ? 'block' : 'none';
        
        dropdown.querySelectorAll('.searchable-option').forEach(opt => {
            opt.onclick = () => {
                input.value = opt.textContent;
                input.dataset.value = opt.dataset.value;
                dropdown.style.display = 'none';
                if (onSelect) onSelect(opt.dataset.value);
            };
        });
    };

    input.onfocus = () => renderOptions(input.value);
    input.oninput = () => renderOptions(input.value);
    
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) dropdown.style.display = 'none';
    });
};

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

const setupSearch = () => {
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

window.checkInCita = checkInCita;

const openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
};

const closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = 'auto';
        const form = modal.querySelector('form');
        if (form) form.reset();
    }
};

// ============ RECETAS LOGIC ============
let medicamentosCache = [];

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
    div.className = 'form-row receta-item';
    div.style = 'align-items: end; background: #f8fafc; padding: 1rem; border-radius: 12px; margin-bottom: 1rem; position: relative; border: 1px solid #e2e8f0;';

    const removeBtn = isFirst ? '' : `<button type="button" class="btn-sm" style="position: absolute; top: 0.5rem; right: 0.5rem; background: # fee2e2; border: none; color: #ef4444; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;" onclick="this.parentElement.remove()">✕</button>`;

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

const abrirModalReceta = async (consultaId) => {
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

const handleRecetaSubmit = async (e) => {
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

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupRazasPerro();
    setupSearch();
    setupConsultorioSearch();
    initConsultorio();

    // Initialize custom selects logic
    initCustomSelects();

    // Listeners para botones de modal
    document.getElementById('btnRegistrarPropietario')?.addEventListener('click', () => openModal('modalPropietario'));
    document.getElementById('btnRegistrarMascota')?.addEventListener('click', async () => {
        // Refresh owners list when opening pet registration
        try {
            const propietarios = await fetchAPI('/propietarios/');
            const ownerOptions = propietarios.map(p => ({
                value: p.id,
                label: `${p.nombre} ${p.apellido}`,
                subtext: `Cédula: ${p.cedula}`
            }));
            ownerSelectInstance?.setOptions(ownerOptions);
        } catch (e) {}
        openModal('modalMascota');
    });
    document.getElementById('btnRegistrarConsulta')?.addEventListener('click', () => {
        if (!currentMascotaId) {
            alert('Por favor selecciona un paciente primero.');
            return;
        }
        openModal('modalConsulta');
    });
    document.getElementById('btnNuevaCita')?.addEventListener('click', () => openModal('modalCita'));

    // Forms Handlers
    document.getElementById('formPropietario')?.addEventListener('submit', handlePropietarioSubmit);
    document.getElementById('searchPropietario')?.addEventListener('input', (e) => loadPropietarios(e.target.value));
    document.getElementById('btnRegistrarPropietarioAlt')?.addEventListener('click', () => openModal('modalPropietario'));
    document.getElementById('formMascota')?.addEventListener('submit', handleMascotaSubmit);
    document.getElementById('formEditarPropietario')?.addEventListener('submit', handleEditarPropietarioSubmit);
    document.getElementById('formEditarMascota')?.addEventListener('submit', handleEditarMascotaSubmit);
    document.getElementById('formConsulta')?.addEventListener('submit', handleConsultaSubmit);
    document.getElementById('formCita')?.addEventListener('submit', handleCitaSubmit);
    document.getElementById('formProducto')?.addEventListener('submit', handleProductoSubmit);
    document.getElementById('formNuevoUsuario')?.addEventListener('submit', handleNuevoUsuarioSubmit);
    document.getElementById('formTransferir')?.addEventListener('submit', handleTransferirSubmit);
    document.getElementById('formReceta')?.addEventListener('submit', handleRecetaSubmit);

    document.querySelectorAll('.pet-nav-item').forEach(el => {
        el.addEventListener('click', () => switchPetTab(el.dataset.tab));
    });

    cargarVeterinarios();
    cargarBadgeOrdenes();
});

const cargarVeterinarios = async () => {
    const select = document.getElementById('citaVeterinarioId');
    if (!select) return;
    try {
        const usuarios = await fetchAPI('/auth/users'); // Need this endpoint or similar
        select.innerHTML = '<option value="">Seleccionar médico...</option>' + 
            usuarios.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
    } catch (e) {
        // Fallback or demo
        select.innerHTML = '<option value="">Seleccionar médico...</option><option value="1">Dr. Smith</option>';
    }
};

const cargarBadgeOrdenes = async () => {
    const badge = document.getElementById('badgeOrdenesMedico');
    if (!badge) return;
    try {
        const citas = await fetchAPI('/citas/');
        const mIsAdmin = localStorage.getItem('role') === 'admin';
        const mUser = localStorage.getItem('username');
        // Simple logic: filter pending ones assigned to me (or all if admin)
        const misOrdenes = citas.filter(c => c.estado === 'pendiente');
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
                            <div style="font-size: 0.9rem; color: #6b7280;">${new Date(c.fecha_cita).toLocaleString()}</div>
                            <div style="margin-top: 0.5rem;"><b>Motivo:</b> ${c.tipo}</div>
                        </div>
                        <button class="btn-primary" onclick="atenderOrden(${c.id}, ${c.mascota_id})">Tomar Orden</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {}
};

const atenderOrden = (citaId, mascotaId) => {
    // Show pet profile and open consultation
    seleccionarMascotaBasica(mascotaId);
    showSection('sec-consultorio');
    // Ensure the ID is set for the consultation modal
    setTimeout(() => {
        const input = document.getElementById('consultaMascotaId');
        if (input) input.value = mascotaId;
        openModal('modalConsulta');
    }, 500);
};

