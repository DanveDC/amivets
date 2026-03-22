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
};const showNotification = (message, type = 'info') => {
    const container = document.getElementById('notification-container') || document.body;
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 9999;
        background: ${type === 'success' ? '#10b981' : '#4F46E5'};
        color: white; padding: 1rem 1.5rem; border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        display: flex; align-items: center; gap: 0.75rem;
        transform: translateX(120%); transition: transform 0.3s ease;
        font-weight: 500;
    `;
    notification.innerHTML = `
        <span>${type === 'success' ? '✅' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    container.appendChild(notification);
    setTimeout(() => notification.style.transform = 'translateX(0)', 10);
    setTimeout(() => {
        notification.style.transform = 'translateX(120%)';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
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
            if (targetId === 'sec-perfil') loadPerfil();
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
        const [citasRaw, consultasRaw, mascotas] = await Promise.all([
            fetchAPI('/citas/?skip=0&limit=100').catch(()=>[]),
            fetchAPI('/consultas/?skip=0&limit=100').catch(()=>[]),
            fetchAPI('/mascotas/?skip=0&limit=300').catch(()=>[])
        ]);
        const mascotasMap = {};
        if (Array.isArray(mascotas)) {
            mascotas.forEach(m => mascotasMap[m.id] = m.nombre);
        }

        // 1. Render List (Órdenes / Espera) (Solo Citas de Hoy)
        const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
        const safeCitas = Array.isArray(citasRaw) ? citasRaw : [];
        const hoyCitas = safeCitas.filter(c => {
            if (!c) return false;
            const fecha = (c.fecha_cita || c.fecha || '').toString();
            return fecha && typeof fecha.startsWith === 'function' && fecha.startsWith(hoy);
        });

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
                        ${cita.estado === 'Programada' ? `<button onclick="checkInCita(${cita.id})" class="btn-secondary btn-sm">Marcar Check-in</button>` : ''}
                        ${(cita.estado === 'En Sala' || cita.estado === 'Programada') ? `<button onclick="atenderDesdeOrden(${cita.mascota_id}, ${cita.id})" class="btn-primary btn-sm">Atender</button>` : ''}
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
        
        openModal('modalEditarPropietario');
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
        const today = new Date().toLocaleDateString('en-CA');
        const safeCitas = Array.isArray(citas) ? citas : [];
        const citasHoy = safeCitas.filter(c => {
            if (!c) return false;
            const fecha = (c.fecha_cita || c.fecha || '').toString();
            return fecha && typeof fecha.startsWith === 'function' && fecha.startsWith(today);
        }).length;

        // const reporteKpis = await fetchAPI('/reportes/kpis'); // Si existiera

        document.getElementById('kpiCitas').textContent = citasHoy;
        document.getElementById('kpiPacientes').textContent = safeCitas.filter(c => c && c.estado === 'Finalizada').length; // Approx

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

        openModal('modalEditarMascota');
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

const abrirFormularioConsulta = () => {
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

const handleConsultaSubmit = async (e) => {
    e.preventDefault();
    try {
        const isAdmin = localStorage.getItem('role') === 'admin';
        const icc = document.getElementById('consultaICC').value || 'N/D';
        const tllc = document.getElementById('consultaTLLC').value || 'N/D';

        const data = {
            mascota_id: parseInt(document.getElementById('consultaMascotaId').value),
            veterinario: document.getElementById('consultaVeterinario').value,
            motivo: document.getElementById('consultaMotivo').value,
            sintomas: document.getElementById('consultaExamen').value || "Evaluación Clínica",
            diagnostico: document.getElementById('consultaProblemas').value || "No especificado",
            peso: parseFloat(document.getElementById('consultaPeso').value) || null,
            temperatura: parseFloat(document.getElementById('consultaTemperatura').value) || null,
            fecha_consulta: document.getElementById('consultaFecha')?.value || null,
            observaciones: `ICC: ${icc}, TLLC: ${tllc} | Pruebas: ${document.getElementById('consultaPruebas')?.value || 'N/A'}`
        };
        await fetchAPI('/consultas/', { method: 'POST', body: JSON.stringify(data) });
        showNotification('📜 Consulta registrada y archivada correctamente.', 'success');
        closeModal('modalConsulta');
        if (currentMascotaId) cargarConsultas(currentMascotaId);
        cargarBadgeOrdenes();
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

let currentViewedConsultaId = null;

window.verConsultaCompleta = async (consultaId, mascotaId) => {
    try {
        currentViewedConsultaId = consultaId;
        const c = await fetchAPI(`/consultas/${consultaId}`);
        document.getElementById('detalleConsultaTitle').textContent = `Expediente Clínico - C.${c.id}`;
        
        let htmlMed = `
            <p><strong>Fecha:</strong> ${new Date(c.fecha_consulta).toLocaleString()}</p>
            <p><strong>Profesional:</strong> ${c.veterinario}</p>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #e5e7eb;">
            <p><strong>Motivo:</strong> ${c.motivo}</p>
            <p><strong>Síntomas:</strong> ${c.sintomas || 'N/A'}</p>
            <p><strong>Diagnóstico:</strong> ${c.diagnostico || 'N/A'}</p>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #e5e7eb;">
            <div style="display:flex; gap: 1rem;">
                <span><strong>Peso:</strong> ${c.peso ? parseFloat(c.peso).toFixed(2) : '-'} kg</span>
                <span><strong>Temp:</strong> ${c.temperatura ? parseFloat(c.temperatura).toFixed(2) : '-'} °C</span>
                <span><strong>FC:</strong> ${c.frecuencia_cardiaca || '-'} bpm</span>
            </div>
            <p><strong>Tratamiento Médico Pautado:</strong><br/> ${c.tratamiento ? c.tratamiento.replace(/\\n/g, '<br>') : 'N/A'}</p>
        `;
        document.getElementById('detalleConsultaMedica').innerHTML = htmlMed;

        document.getElementById('addServicioConsultaId').value = c.id;
        
        // Render Servicios Carrito
        renderDetalleServicios(c.servicios || []);

        openModal('modalDetalleConsulta');
    } catch (e) {
        alert("Error cargando expediente: " + e.message);
    }
};

const renderDetalleServicios = (servicios) => {
    const listDiv = document.getElementById('detalleConsultaServiciosList');
    if (!servicios || servicios.length === 0) {
        listDiv.innerHTML = '<p style="color: #6b7280; font-style: italic; text-align: center; padding: 1rem;">No hay registros clínicos o cargos anexados.</p>';
        const el = document.getElementById('detalleConsultaTotal');
        if (el) el.textContent = "$0.00";
        return;
    }

    let total = 0;
    const activos = servicios.filter(s => !s.is_deleted);
    
    let html = activos.map(s => {
        total += (s.cantidad * s.precio_unitario);
        
        let statusIcon = s.estado === 'Aplicado' ? '✅' : '⏳';
        let badgeColor = s.estado === 'Aplicado' ? 'background: #f8fafc; border: 1px solid #e2e8f0;' : 'background: #fffbeb; border: 1px solid #fde68a;';
        let accentLine = s.estado === 'Aplicado' ? '#4F46E5' : '#d97706';
        
        // Parse clinical details if they follow the "Key: Value | Key: Value" format
        let detailsHtml = '';
        if (s.detalles_clinicos) {
            const parts = s.detalles_clinicos.split('|');
            if (parts.length > 1) {
                // If it looks like structured data, render as a grid of labels
                detailsHtml = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px dashed #e2e8f0;">
                        ${parts.map(p => {
                            const [k, v] = p.trim().split(':');
                            if (v) return `<div style="font-size: 0.75rem; color: #475569;"><span style="font-weight: 700; color: #1e293b; text-transform: uppercase; font-size: 0.65rem; opacity: 0.7;">${k}:</span> ${v}</div>`;
                            return `<div style="grid-column: span 2; font-size: 0.75rem; color: #475569; font-style: italic;">${p.trim()}</div>`;
                        }).join('')}
                    </div>
                `;
            } else {
                // Regular text block
                detailsHtml = `
                    <div style="margin-top: 0.6rem; padding: 0.6rem; background: #f8fafc; border-radius: 6px; font-size: 0.8rem; color: #334155; border-left: 3px solid #cbd5e1;">
                         📄 ${s.detalles_clinicos}
                    </div>
                `;
            }
        }

        return `
            <div class="clinical-data-row" style="${badgeColor} margin-bottom: 1rem; border-radius: 12px; padding: 1rem; position: relative; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${accentLine};"></div>
                
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="font-weight: 800; color: #1e293b; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.02em;">
                        ${statusIcon} ${s.nombre_servicio || s.tipo_servicio}
                    </div>
                    <div style="display: flex; gap:0.5rem; align-items: center;">
                        <button onclick="eliminarServicioConsulta(${s.id})" title="Eliminar registro" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.2rem; hover: color: #ef4444;">×</button>
                    </div>
                </div>
                
                <div style="display: flex; gap: 0.75rem; margin-top: 0.25rem;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 600;">
                         CATEGORÍA: <span style="color: #4F46E5;">${s.tipo_servicio}</span>
                    </div>
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 600;">
                         VALOR: <span style="color: #059669;">$${(s.cantidad * s.precio_unitario).toFixed(2)}</span>
                    </div>
                </div>

                ${detailsHtml}

                <div style="margin-top: 0.75rem; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 0.65rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Estado:</span>
                        <select onchange="cambiarEstadoServicio(${s.id}, this.value)" style="padding: 3px 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 0.75rem; cursor: pointer; background: white; font-weight: 600; color: #475569;">
                            <option value="Pendiente" ${s.estado === 'Pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
                            <option value="Aplicado" ${s.estado === 'Aplicado' ? 'selected' : ''}>✅ Aplicado</option>
                        </select>
                    </div>
                    <span style="font-size: 0.6rem; color: #94a3b8; font-style: italic;">Ref ID: #${s.id}</span>
                </div>
            </div>
        `;
    }).join('');

    listDiv.innerHTML = html;
    const el = document.getElementById('detalleConsultaTotal');
    if (el) el.textContent = `$${total.toFixed(2)}`;
};

const cambiarEstadoServicio = async (servicioId, newState) => {
    try {
        await fetchAPI(`/consultas/servicios/${servicioId}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: newState })
        });
        // Refrescar
        verConsultaCompleta(currentViewedConsultaId, currentMascotaId);
    } catch (e) {
        alert("Error cambiando estado: " + e.message);
        verConsultaCompleta(currentViewedConsultaId, currentMascotaId); // revert GUI
    }
};

const eliminarServicioConsulta = async (servicioId) => {
    if (!confirm("¿Seguro que desea quitar este cargo? Se revertirá stock si estaba Aplicado.")) return;
    try {
        await fetchAPI(`/consultas/servicios/${servicioId}`, { method: 'DELETE' });
        verConsultaCompleta(currentViewedConsultaId, currentMascotaId);
    } catch (e) {
        alert("Error quitando servicio: " + e.message);
    }
};

let currentInventoryItems = [];

// SMART FORM LOGIC: Category Change
document.getElementById('addServicioTipo').addEventListener('change', async (e) => {
    const tipo = e.target.value;
    const searchInput = document.getElementById('addServicioItemSearch');
    const label = document.getElementById('labelSeleccionDinamica');
    const datalist = document.getElementById('listadoInventario');
    const dynContainer = document.getElementById('containerCamposDinamicos');
    
    // Reset basic fields
    searchInput.value = '';
    document.getElementById('addServicioReferenciaId').value = '';
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
            const cat = tipo === 'VACUNACION' ? 'Vacunas' : null;
            const items = await fetchAPI(`/inventario/?limit=200${cat ? `&categoria=${cat}` : ''}`);
            currentInventoryItems = items;
            datalist.innerHTML = items.map(i => `<option value="${i.nombre} [Stock: ${i.stock_actual}]" data-id="${i.id}">`).join('');
        } catch(err) { console.error("Error fetching inventory", err); }
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
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">🔥 FECHA INGRESO</label>
                    <input type="datetime-local" class="dinamico-hosp-ingreso" value="${now}" style="padding:0.4rem; border:1px solid #bfdbfe; border-radius:6px; font-size:0.8rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">🏁 FECHA EGRESO (OPC)</label>
                    <input type="datetime-local" class="dinamico-hosp-egreso" style="padding:0.4rem; border:1px solid #bfdbfe; border-radius:6px; font-size:0.8rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">🌡️ ESTADO PACIENTE</label>
                    <select class="dinamico-hosp-estado" style="padding:0.4rem; border:1px solid #bfdbfe; border-radius:6px; font-size:0.8rem;">
                        <option>Estable</option><option>Crítico</option><option>Reservado</option>
                    </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">🏠 NRO. JAULA</label>
                    <input type="text" placeholder="Ej: A-01" class="dinamico-hosp-jaula" style="padding:0.4rem; border:1px solid #bfdbfe; border-radius:6px; font-size:0.8rem;">
                </div>
            `;
            document.getElementById('addServicioNombre').value = "Ingreso a Hospitalización";
        } else if (tipo === 'VACUNACION') {
            fieldsHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">📦 LOTE / SERIE</label>
                    <input type="text" placeholder="Lote" class="dinamico-vac-lote" style="padding:0.5rem; border:1px solid #bfdbfe; border-radius:8px; font-size:0.9rem;">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">📅 FECHA REFUERZO</label>
                    <input type="date" class="dinamico-vac-refuerzo" style="padding:0.5rem; border:1px solid #bfdbfe; border-radius:8px; font-size:0.9rem;">
                </div>
            `;
        } else if (tipo === 'CIRUGIA') {
            fieldsHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; color:#1e40af; font-weight:bold;">🫀 RIESGO ASA</label>
                    <select class="dinamico-cir-asa" style="padding:0.5rem; border:1px solid #bfdbfe; border-radius:8px; font-size:0.9rem;">
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
document.getElementById('addServicioItemSearch').addEventListener('input', (e) => {
    const val = e.target.value;
    const tipo = document.getElementById('addServicioTipo').value;
    
    if (tipo === 'INSUMO' || tipo === 'VACUNACION') {
        // Find if the value matches one of our options
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
        }
    } else {
        // For other types, just copy search to name
        document.getElementById('addServicioNombre').value = val;
    }
});

const setQuickAction = (tipo, fallbackSearch = '', jump = false) => {
    // Complex modules configuration
    const complexModules = {
        'CIRUGIA': { tab: 'procedimientos', formId: 'formCirugia' },
        'HOSPITALIZACION': { tab: 'hospitalizaciones', formId: 'formHospitalizacion' },
        'LABORATORIO': { tab: 'laboratorio', formId: 'formPrueba' },
        'VACUNACION': { tab: 'vacunas', formId: 'formVacuna' }
    };

    if (jump && complexModules[tipo]) {
        const config = complexModules[tipo];
        
        // Cerramos el modal actual para permitir navegación en el fondo
        closeModal('modalDetalleConsulta');
        
        // Cambiar a la pestaña correspondiente en el perfil de paciente (abajo)
        switchPetTab(config.tab);
        
        // Scroll hacia abajo para que el usuario note que se abrió la sección
        setTimeout(() => {
            const el = document.getElementById('petTabContent');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // Abrir el formulario correspondiente
            const form = document.getElementById(config.formId);
            if (form) {
                form.style.display = 'block';
                const combo = form.querySelector('.combo-consultas');
                if (combo) combo.value = currentViewedConsultaId;
            }
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

document.getElementById('formAgregarServicio').addEventListener('submit', async (e) => {
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
        detallesExtra = `📅 ENTRADA: ${ing || 'N/D'} | 🏁 SALIDA: ${egr || 'En curso'} | 🏥 JAULA: ${jau || 'N/A'} | 🌡️ ESTADO: ${est}\n`;
    } else if (tipo === 'VACUNACION') {
        const lote = e.target.querySelector('.dinamico-vac-lote')?.value;
        const refu = e.target.querySelector('.dinamico-vac-refuerzo')?.value;
        detallesExtra = `💉 LOTE: ${lote || 'N/D'} | 📅 REFUERZO: ${refu || 'N/D'}\n`;
    } else if (tipo === 'CIRUGIA') {
        const asa = e.target.querySelector('.dinamico-cir-asa')?.value;
        const px = e.target.querySelector('.dinamico-cir-precio')?.value;
        detallesExtra = `🔪 RIESGO ASA: ${asa} ${px ? `| 💰 RECARGO: $${px}` : ''}\n`;
    } else if (tipo === 'LABORATORIO') {
        const labTipo = e.target.querySelector('.dinamico-lab-tipo')?.value;
        detallesExtra = `🔬 MUESTRA/TIPO: ${labTipo || 'N/D'}\n`;
    }

    const body = {
        consulta_id: parseInt(cid),
        tipo_servicio: tipo,
        nombre_servicio: (tipo + ": " + nombre).toUpperCase(),
        referencia_id: refId ? parseInt(refId) : null,
        cantidad: parseFloat(document.getElementById('addServicioCantidad').value) || 1.0,
        precio_unitario: parseFloat(document.getElementById('addServicioPrecio').value) || 0,
        detalles_clinicos: detallesExtra + document.getElementById('addServicioDetalles').value,
        estado: 'Aplicado'
    };
    
    try {
        await fetchAPI(`/consultas/${cid}/servicios`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        e.target.reset(); 
        document.getElementById('addServicioReferenciaId').value = '';
        const container = document.getElementById('containerCamposDinamicos');
        if (container) { container.innerHTML = ''; container.style.display = 'none'; }
        
        verConsultaCompleta(cid, currentMascotaId);
        showNotification("🎨 Acto médico y registro clínico guardados.", "success");
    } catch(err) {
        alert("Error agregando cargo: " + err.message);
    }
});

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
                    ${c.peso ? `<b>Peso:</b> ${parseFloat(c.peso).toFixed(2)}kg<br>` : ''}
                    ${c.temperatura ? `<b>Temp:</b> ${parseFloat(c.temperatura).toFixed(2)}°C` : ''}
                </td>
                <td style="text-align: right;">
                    <button class="btn-primary btn-sm" onclick="verConsultaCompleta(${c.id}, ${mascotaId})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-bottom: 4px;">🔍 Completa</button><br>
                    <button class="btn-secondary btn-sm" onclick="abrirModalReceta(${c.id})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; background: #ecfdf5; color: #047857; border-color: #059669;">💊 Recetar</button>
                    <button class="btn-secondary btn-sm" onclick="switchPetTab('hospitalizaciones'); setTimeout(()=>toggleForm('formHospitalizacion'), 200);" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 4px; background: #fee2e2; color: #b91c1c; border-color: #ef4444;">🏥 Internar</button>
                </td>
            </tr>
        `).join('');
        const btnVerPeso = document.getElementById('btnVerPeso');
        if (btnVerPeso) btnVerPeso.style.display = 'inline-block';
    } catch (error) {
        console.error("Error cargando consultas:", error);
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
    
    const btnAction = document.getElementById('btnActionAdd');
    if (btnAction) btnAction.onclick = () => {
        document.getElementById('consultaMascotaId').value = id;
        abrirFormularioConsulta();
    };
    
    setTimeout(updatePetNavArrows, 500);
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
                if (!currentMascotaId) return;
                document.getElementById('consultaMascotaId').value = currentMascotaId;
                abrirFormularioConsulta();
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
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formVacuna')">+ Registrar Vacuna</button>`;
            cargarVacunasPet(currentMascotaId);
            break;
        case 'desparasitaciones':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formDesparasitacion')">+ Registrar Desparasitante</button>`;
            cargarDesparasitacionesPet(currentMascotaId);
            break;
        case 'hospitalizaciones':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formHospitalizacion')">+ Registrar Hosp.</button>`;
            cargarHospitalizacionesPet(currentMascotaId);
            break;
        case 'procedimientos':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formCirugia')">+ Registrar Cirugía</button>`;
            cargarCirugiasPet(currentMascotaId);
            break;
        case 'laboratorio':
        case 'imagenes':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="toggleForm('formPrueba')">+ Registrar Prueba</button>`;
            cargarPruebasPet(currentMascotaId, tabName);
            break;
        case 'recetas':
            actionsArea.innerHTML = `<button class="btn-primary" onclick="alert('Las recetas se crean desde una consulta')">Ver Recetas</button>`;
            cargarRecetasPet(currentMascotaId);
            break;
        case 'ordenes':
            contentArea.innerHTML = '<div class="empty-state">No hay órdenes registradas.</div>';
            break;
        case 'peso':
            contentArea.innerHTML = `
                <div style="background: white; border-radius: 8px; padding: 1.5rem;">
                    <h3 style="margin-top: 0; color: #1f2937; text-align: center;">Evolución de Peso</h3>
                    <div id="chartContainer" style="width: 100%; max-width: 600px; margin: 0 auto; display: block;">
                        <canvas id="weightChart"></canvas>
                    </div>
                </div>
            `;
            setTimeout(loadWeightChart, 100);
            break;
        default:
            contentArea.innerHTML = `<div class="empty-state">Módulo <b>${tabName}</b> en desarrollo.</div>`;
    }
};

const renderHistoriaTab = async () => {
    const res = document.getElementById('historiaResumen');
    try {
        const m = await fetchAPI(`/mascotas/${currentMascotaId}`);
        const v = await fetchAPI(`/clinico/vacunaciones/${currentMascotaId}`).catch(()=>[]);
        
        let vacunasHTML = '';
        if (v.length > 0) {
            vacunasHTML = `<div style="margin-top:1rem;"><b>Vacunas aplicadas:</b><br><ul style="margin:0; padding-left:1.5rem; color:#4b5563;">` +
                v.map(vac => `<li>${vac.vacuna_nombre} (Lote: ${vac.lote})</li>`).join('') +
                `</ul></div>`;
        }

        res.innerHTML = `
            <div style="background: #f8fafc; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div><b>Especie:</b> ${m.especie}</div>
                    <div><b>Raza:</b> ${m.raza || 'N/A'}</div>
                    <div><b>Sexo:</b> ${m.sexo || 'N/A'}</div>
                    <div><b>Color:</b> ${m.color || 'N/A'}</div>
                    <div><b>Peso actual:</b> ${m.peso ? parseFloat(m.peso).toFixed(2) : 'N/A'} kg</div>
                    <div><b>Estado:</b> ${m.estado_reproductivo || 'N/A'}</div>
                </div>
                <hr style="margin: 1rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                <div><b>Observaciones:</b><br>${m.observaciones || 'Sin observaciones.'}</div>
                ${vacunasHTML}
            </div>`;
    } catch (e) {}
};

const toggleForm = (formId) => {
    const el = document.getElementById(formId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

const buildClinicoForm = (type) => {
    // Shared select for Consultas
    const comboConsultas = `<div class="form-group">
        <label>Asociar a Consulta (Requiere consulta previa)</label>
        <select name="consulta_id" class="form-control combo-consultas" required><option value="">Seleccione consulta...</option></select>
    </div>`;

    if (type === 'vacuna') return `<form onsubmit="submitClinico(event, 'vacunacion')" id="formVacuna" style="display:none; background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid #e2e8f0;">
        <h4 style="margin-top:0; color:#4F46E5;">Aplicar Vacunación</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Vacuna (ID Inventario)</label><input type="number" name="vacuna_id" class="form-control" required placeholder="Ej: 3"></div>
            <div class="form-group"><label>Lote</label><input type="text" name="lote" class="form-control" required></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'desparasitacion') return `<form onsubmit="submitClinico(event, 'desparasitacion')" id="formDesparasitacion" style="display:none; background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid #e2e8f0;">
        <h4 style="margin-top:0; color:#4F46E5;">Aplicar Desparasitante</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Producto (ID Inventario)</label><input type="number" name="producto_id" class="form-control" required></div>
            <div class="form-group"><label>Tipo</label><select name="tipo" class="form-control"><option>Interna</option><option>Externa</option></select></div>
            <div class="form-group"><label>Dosis</label><input type="text" name="dosis" class="form-control" required></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'hospitalizacion') return `<form onsubmit="submitClinico(event, 'hospitalizacion')" id="formHospitalizacion" style="display:none; background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid #e2e8f0;">
        <h4 style="margin-top:0; color:#4F46E5;">Registrar Ingreso Hospitalario</h4>
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

    if (type === 'cirugia') return `<form onsubmit="submitClinico(event, 'cirugia')" id="formCirugia" style="display:none; background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid #e2e8f0;">
        <h4 style="margin-top:0; color:#4F46E5;">Registrar Intervención Quirúrgica</h4>
        ${comboConsultas}
        <div class="form-group"><label>Procedimiento</label><input type="text" name="tipo_procedimiento" class="form-control" required></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Riesgo ASA</label><select name="riesgo_asa" class="form-control"><option>I</option><option>II</option><option>III</option><option>IV</option><option>V</option></select></div>
            <div class="form-group"><label>Cirujano ID</label><input type="number" name="cirujano_id" class="form-control"></div>
        </div>
        <button type="submit" class="btn-primary">Guardar Registro</button>
    </form>`;

    if (type === 'prueba') return `<form onsubmit="submitClinico(event, 'prueba_complementaria')" id="formPrueba" style="display:none; background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid #e2e8f0;">
        <h4 style="margin-top:0; color:#4F46E5;">Registrar Estudio</h4>
        ${comboConsultas}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <div class="form-group"><label>Tipo</label><select name="tipo" class="form-control"><option>Laboratorio</option><option>Rayos X</option><option>Ecografía</option></select></div>
            <div class="form-group"><label>URL Resultado</label><input type="text" name="archivo_url" class="form-control"></div>
        </div>
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
    } catch (e) {}
};

const submitClinico = async (e, endpoint) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (data.consulta_id) data.consulta_id = parseInt(data.consulta_id);
    if (data.vacuna_id) data.vacuna_id = parseInt(data.vacuna_id);
    if (data.producto_id) data.producto_id = parseInt(data.producto_id);
    if (data.cirujano_id) data.cirujano_id = parseInt(data.cirujano_id);
    data.mascota_id = currentMascotaId;
    
    try {
        await fetchAPI(`/clinico/${endpoint}`, { method: 'POST', body: JSON.stringify(data) });
        showNotification('📜 Registro clínico guardado y vinculado a la consulta.', 'success');
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

const cargarVacunasPet = async (mascotaId) => {
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildClinicoForm('vacuna') + `<div style="background:white; border-radius:8px;"><table class="consultas-table"><thead><tr><th>Fecha</th><th>Vacuna (ID:Nombre)</th><th>Lote</th></tr></thead><tbody id="tblVac"><tr><td colspan="3" style="text-align:center;color:#9ca3af;">Cargando...</td></tr></tbody></table></div>`;
    hydrateCombos();
    try {
        const data = await fetchAPI(`/clinico/vacunaciones/${mascotaId}`);
        const tbody = document.getElementById('tblVac');
        if (!data.length) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No hay vacunas registradas.</td></tr>`;
        else tbody.innerHTML = data.map(v => `<tr><td>${new Date(v.fecha_aplicacion).toLocaleDateString()}</td><td>${v.vacuna_nombre}</td><td>${v.lote || '-'}</td></tr>`).join('');
    } catch (e) {}
};

const cargarDesparasitacionesPet = async (mascotaId) => {
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildClinicoForm('desparasitacion') + `<div style="background:white; border-radius:8px;"><table class="consultas-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Dosis</th></tr></thead><tbody id="tblDesp"><tr><td colspan="4" style="text-align:center;color:#9ca3af;">Cargando...</td></tr></tbody></table></div>`;
    hydrateCombos();
    try {
        const data = await fetchAPI(`/clinico/desparasitaciones/${mascotaId}`);
        const tbody = document.getElementById('tblDesp');
        if (!data.length) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#9ca3af;">No hay registros.</td></tr>`;
        else tbody.innerHTML = data.map(d => `<tr><td>${new Date(d.fecha_aplicacion).toLocaleDateString()}</td><td>${d.tipo}</td><td>${d.producto_nombre}</td><td>${d.dosis}</td></tr>`).join('');
    } catch (e) {}
};

const cargarHospitalizacionesPet = async (mascotaId) => {
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildClinicoForm('hospitalizacion') + `<div style="background:white; border-radius:8px;"><table class="consultas-table"><thead><tr><th>Ingreso</th><th>Egreso</th><th>Motivo</th><th>Estado</th><th>Jaula</th></tr></thead><tbody id="tblHosp"><tr><td colspan="5" style="text-align:center;color:#9ca3af;">Cargando...</td></tr></tbody></table></div>`;
    hydrateCombos();
    try {
        const data = await fetchAPI(`/clinico/hospitalizaciones/${mascotaId}`);
        const tbody = document.getElementById('tblHosp');
        if (!data.length) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;">No hay registros de hospitalización.</td></tr>`;
        else tbody.innerHTML = data.map(d => `<tr>
            <td>${new Date(d.fecha_ingreso).toLocaleString()}</td>
            <td>${d.fecha_egreso ? new Date(d.fecha_egreso).toLocaleString() : '<span style="color:#d97706; font-style:italic;">En curso</span>'}</td>
            <td>${d.motivo}</td>
            <td><span class="badge" style="background:#f3f4f6; color:#374151;">${d.estado_paciente||'-'}</span></td>
            <td>${d.jaula_nro||'-'}</td>
        </tr>`).join('');
    } catch (e) {}
};

const cargarCirugiasPet = async (mascotaId) => {
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildClinicoForm('cirugia') + `<div style="background:white; border-radius:8px;"><table class="consultas-table"><thead><tr><th>Fecha</th><th>Procedimiento</th><th>Riesgo ASA</th></tr></thead><tbody id="tblCir"><tr><td colspan="3" style="text-align:center;color:#9ca3af;">Cargando...</td></tr></tbody></table></div>`;
    hydrateCombos();
    try {
        const data = await fetchAPI(`/clinico/cirugias/${mascotaId}`);
        const tbody = document.getElementById('tblCir');
        if (!data.length) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No hay cirugías registradas.</td></tr>`;
        else tbody.innerHTML = data.map(d => `<tr><td>${new Date(d.fecha_cirugia).toLocaleDateString()}</td><td>${d.tipo_procedimiento}</td><td>${d.riesgo_asa||'-'}</td></tr>`).join('');
    } catch (e) {}
};

const cargarPruebasPet = async (mascotaId, filterType) => {
    const cnt = document.getElementById('petTabContent');
    cnt.innerHTML = buildClinicoForm('prueba') + `<div style="background:white; border-radius:8px;"><table class="consultas-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Resultados</th></tr></thead><tbody id="tblPrueba"><tr><td colspan="3" style="text-align:center;color:#9ca3af;">Cargando...</td></tr></tbody></table></div>`;
    hydrateCombos();
    try {
        const data = await fetchAPI(`/clinico/pruebas_complementarias/${mascotaId}`);
        const tbody = document.getElementById('tblPrueba');
        
        let filtered = data;
        if (filterType === 'laboratorio') filtered = data.filter(d => d.tipo === 'Laboratorio');
        if (filterType === 'imagenes') filtered = data.filter(d => d.tipo !== 'Laboratorio');

        if (!filtered.length) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No hay estudios registrados.</td></tr>`;
        else tbody.innerHTML = filtered.map(d => `<tr><td>${new Date(d.fecha).toLocaleDateString()}</td><td>${d.tipo}</td><td>${d.resultado} ${d.archivo_url ? `<a href="${d.archivo_url}" target="_blank">[Ver Link]</a>` : ''}</td></tr>`).join('');
    } catch (e) {}
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

// Removida duplicación antigua de verConsultaCompleta

const actualizarCountsPet = async (mascotaId) => {
    try {
        const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        
        Promise.all([
            fetchAPI(`/consultas/?mascota_id=${mascotaId}`).catch(()=>[]),
            fetchAPI(`/clinico/vacunaciones/${mascotaId}`).catch(()=>[]),
            fetchAPI(`/clinico/desparasitaciones/${mascotaId}`).catch(()=>[]),
            fetchAPI(`/clinico/hospitalizaciones/${mascotaId}`).catch(()=>[]),
            fetchAPI(`/clinico/cirugias/${mascotaId}`).catch(()=>[]),
            fetchAPI(`/clinico/pruebas_complementarias/${mascotaId}`).catch(()=>[])
        ]).then(([cons, vac, desp, hosp, cir, pru]) => {
            setTxt('count-consultas', cons?.length || 0);
            setTxt('count-vacunas', vac?.length || 0);
            setTxt('count-desparasitaciones', desp?.length || 0);
            setTxt('count-hosp', hosp?.length || 0);
            setTxt('count-proc', cir?.length || 0);
            
            const p = pru || [];
            setTxt('count-lab', p.filter(x => x.tipo === 'Laboratorio').length);
            setTxt('count-img', p.filter(x => x.tipo !== 'Laboratorio').length);
        }).catch(e => console.warn(e));

        setTxt('count-recetas', '-');
        setTxt('count-ordenes', '-');
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
        try {
            const form = modal.querySelector('form');
            if (form) form.reset();
        } catch (err) {
            console.warn("Error resetting form in modal:", err);
        }
    }
};

const showSection = (targetId) => {
    const btn = document.querySelector(`.menu-item[data-target="${targetId}"]`);
    if (btn) {
        btn.click(); // Trigger native SPA routing
    } else {
        document.querySelectorAll('.spa-section').forEach(s => s.style.display = 'none');
        const target = document.getElementById(targetId);
        if (target) {
            target.style.display = 'block';
        }
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
        abrirFormularioConsulta();
    });
    document.getElementById('btnGenerarOrden')?.addEventListener('click', () => {
        if (!currentMascotaId) {
            alert('Para generar una orden, primero busque y seleccione el paciente en el Módulo de Consultorio.');
            showSection('sec-consultorio');
            return;
        }
        abrirFormularioConsulta();
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
        formPerfil.addEventListener('submit', async (e) => {
            e.preventDefault();
            const curr = document.getElementById('profileCurrentPassword').value;
            const nuev = document.getElementById('profileNewPassword').value;
            const conf = document.getElementById('profileConfirmPassword').value;
            if (nuev !== conf) { alert("Las contraseñas no coinciden"); return; }
            try {
                await fetchAPI('/usuarios/me/password', {
                    method: 'PUT',
                    body: JSON.stringify({ current_password: curr, new_password: nuev })
                });
                alert('Contraseña actualizada con éxito');
                e.target.reset();
            } catch (err) { alert('Error: ' + err.message); }
        });
    }

    // Set default section
    showSection('sec-consultorio');
});

const cargarVeterinarios = async () => {
    try {
        const usuarios = await fetchAPI('/usuarios/veterinarios');
        const opts1 = '<option value="">Seleccionar médico...</option>' + 
            usuarios.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
        const opts2 = '<option value="">Seleccionar médico...</option>' + 
            usuarios.map(u => `<option value="${u.username}">${u.username} (${u.role})</option>`).join('');
            
        const scita = document.getElementById('citaVeterinarioId');
        if (scita) scita.innerHTML = opts1;
        
        const scons = document.getElementById('consultaVeterinario');
        if (scons) scons.innerHTML = opts2;
    } catch (e) {
        console.warn("No se pudieron cargar vets", e);
    }
};

const loadPerfil = async () => {
    try {
        const user = await fetchAPI('/usuarios/me');
        const elInitial = document.getElementById('profileInitial');
        const elUser = document.getElementById('profileUsername');
        const elRole = document.getElementById('profileUserRole');
        
        if (elInitial) elInitial.textContent = user.username ? user.username.charAt(0).toUpperCase() : 'U';
        if (elUser) elUser.textContent = user.username || 'Usuario';
        if (elRole) elRole.textContent = user.role === 'admin' ? 'Administrador' : user.role;
    } catch (e) {
        console.warn('Error fetching profile', e);
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

const mostrarResumenDia = (dateStr, allEvents) => {
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
        resumenCuerpo.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 2rem;">No hubo actividad este día.</p>';
    } else {
        resumenCuerpo.innerHTML = eventosDia.map(ev => {
            const type = ev.extendedProps?.type;
            let icon = '📅';
            let color = '#4F46E5';
            let label = 'Cita';
            let detail = ev.extendedProps?.motivo || ev.extendedProps?.tipo || 'Sin motivo';

            if (type === 'consulta') { icon = '🩺'; color = '#10b981'; label = 'Consulta'; }
            if (type === 'cirugia') { icon = '🔪'; color = '#ef4444'; label = 'Cirugía'; detail = ev.extendedProps?.tipo_procedimiento; }
            if (type === 'prueba') { icon = '🧪'; color = '#8b5cf6'; label = 'Prueba/Lab'; detail = ev.extendedProps?.tipo; }

            return `
                <div style="padding: 1rem; border-bottom: 1px solid #f3f4f6; border-left: 4px solid ${color}; margin-bottom: 0.8rem; background: #f8fafc; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 700; color: ${color}; font-size: 0.9rem; text-transform: uppercase;">
                            ${icon} ${label}
                        </span>
                        <span style="font-size: 0.85rem; color: #6b7280;">
                            ${new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div style="margin-top: 0.5rem; font-size: 1.05rem; color: #1f2937; font-weight: 600;">
                        ${ev.extendedProps?.mascota_nombre || `Paciente ID #${ev.extendedProps?.mascota_id}`}
                    </div>
                    <div style="font-size: 0.95rem; color: #4b5563; margin-top: 0.25rem;">
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

const atenderOrden = (citaId, mascotaId) => {
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

window.verDetallesDesdeAgenda = (mascotaId) => {
    closeModal('modalResumenDia');
    seleccionarMascotaBasica(mascotaId);
    showSection('sec-consultorio');
    setTimeout(() => { switchPetTab('consultas'); }, 100);
};

/* --- PET PROFILE UI --- */
// Logic for horizontal scroll has been removed in favor of a vertical sidebar as per user feedback
