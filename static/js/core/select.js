// core/select.js — selectores premium con búsqueda integrada.
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.

/**
 * Crea un selector premium con búsqueda integrada
 * @param {string} containerId - ID del contenedor donde se renderizará
 * @param {Array} options - Array de objetos { value, label, subtext }
 * @param {string} placeholder - Texto inicial
 * @param {Function} onChange - Callback al seleccionar
 */
export const createPrettySelect = (containerId, options = [], placeholder = 'Seleccionar...', onChange = null) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Generar IDs únicos
    const dropdownId = `${containerId}-dropdown`;
    const searchId = `${containerId}-search`;

    container.innerHTML = `
        <div class="custom-select-trigger" id="${containerId}-trigger">
            <span class="trigger-text">${placeholder}</span>
            <span class="trigger-icon"><svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
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

export const initSearchableSelect = (input, options, onSelect) => {
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
