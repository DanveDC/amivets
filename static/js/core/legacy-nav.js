// core/legacy-nav.js — navegación SPA existente (sidebar .menu-item + secciones
// .spa-section), movida SIN CAMBIOS desde app.js en la etapa 2a. El router por
// pestañas del shell 1A (etapa 2b) reemplaza este archivo; hasta entonces la app
// navega exactamente como hoy.

import { initConsultorio } from '../sections/consultorio.js';
import { loadAgenda } from '../sections/agenda.js';
import { loadInventario } from '../sections/inventario.js';
import { loadReportes } from '../sections/reportes.js';
import { loadPropietarios } from '../sections/propietarios.js';
import { loadUsuarios } from '../sections/usuarios.js';
import { loadPerfil } from '../sections/perfil.js';
import { cargarHistorialFacturas } from '../sections/facturacion.js';
import { cargarCategoriasSelect, cargarCatalogo } from '../sections/catalogo.js';

// ============ NAVIGATION (SPA) ============
export const setupNavigation = () => {
    const menuItems = document.querySelectorAll('.menu-item[data-target]');
    const sections = document.querySelectorAll('.spa-section');

    const updateActiveLinks = (targetId) => {
        menuItems.forEach(item => {
            if (item.getAttribute('data-target') === targetId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    };

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');

            updateActiveLinks(targetId);

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
            if (targetId === 'sec-facturacion') cargarHistorialFacturas();
            if (targetId === 'sec-catalogo') { cargarCategoriasSelect(); cargarCatalogo(); }
        });
    });
};

export const showSection = (targetId) => {
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
