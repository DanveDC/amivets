// sections/servicio-directo.js — venta de mostrador sin registrar cliente
// (servicio-directo, decisión 8).
//
// Buscar productos/servicios (GET /api/servicio-directo/items), armar un carrito en
// memoria y cobrar en un solo paso (POST /api/servicio-directo/ventas). El servidor
// fija los precios: el que se muestra acá es solo referencia, salvo en los
// servicios de precio variable, donde el precio lo escribe el usuario.
// Sin onclick inline: los botones de las tablas usan data-* y listeners, así
// no hace falta exponer nada en window.

import { fetchAPI } from '../core/api.js';
import { showNotification, debounce, escapeHtml, submitWithLoading } from '../core/ui.js';
import { money } from '../core/format.js';
import { exportarFacturaPDF } from './facturacion.js';

let _resultados = [];
// clave `${tipo}:${id}` -> { tipo, id, nombre, precio, precio_variable, stock, cantidad }
let _carrito = new Map();
let _ultimaFacturaId = null;
// Descarta respuestas de búsqueda que llegan fuera de orden (tipeo rápido).
let _busquedaSeq = 0;
let _wired = false;

const clave = (it) => `${it.tipo}:${it.id}`;

async function buscar(q) {
    const body = document.getElementById('servicioDirectoResultadosBody');
    if (!body) return;
    const texto = (q || '').trim();
    if (!texto) {
        _resultados = [];
        body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Escribí para buscar.</td></tr>';
        return;
    }
    const seq = ++_busquedaSeq;
    try {
        const items = await fetchAPI(`/servicio-directo/items?q=${encodeURIComponent(texto)}`);
        if (seq !== _busquedaSeq) return;
        _resultados = items || [];
        pintarResultados();
    } catch (e) {
        if (seq !== _busquedaSeq) return;
        body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--accent); padding:1.5rem;">No se pudo buscar: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function pintarResultados() {
    const body = document.getElementById('servicioDirectoResultadosBody');
    if (_resultados.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Sin resultados.</td></tr>';
        return;
    }
    body.innerHTML = _resultados.map((it, i) => `
        <tr>
            <td style="padding:0.6rem 0.75rem; overflow-wrap:anywhere;">
                ${escapeHtml(it.nombre)}
                <span class="av-pill ${it.tipo === 'PRODUCTO' ? 'av-pill--info' : 'av-pill--neutral'}" style="margin-left:6px;">${it.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}</span>
            </td>
            <td class="num" style="padding:0.6rem 0.75rem;">${it.precio_variable ? 'Variable' : money(it.precio)}</td>
            <td class="num" style="padding:0.6rem 0.75rem;">${it.tipo === 'PRODUCTO' ? escapeHtml(it.stock) : '—'}</td>
            <td style="padding:0.6rem 0.75rem; text-align:right;">
                <button type="button" class="btn-secondary btn-sm" data-servicio-directo-agregar="${i}">Agregar</button>
            </td>
        </tr>`).join('');
}

function agregar(item) {
    const k = clave(item);
    const actual = _carrito.get(k);
    if (actual) {
        actual.cantidad += 1;
    } else {
        _carrito.set(k, {
            ...item,
            cantidad: 1,
            // Precio variable: arranca vacío, lo tiene que escribir el usuario.
            precio: item.precio_variable ? 0 : item.precio,
        });
    }
    pintarCarrito();
}

function totalCarrito() {
    let total = 0;
    for (const it of _carrito.values()) total += (it.precio || 0) * it.cantidad;
    return total;
}

function carritoValido() {
    if (_carrito.size === 0) return false;
    for (const it of _carrito.values()) {
        if (!(it.cantidad >= 1)) return false;
        if (it.precio_variable && !(it.precio > 0)) return false;
    }
    return true;
}

function pintarCarrito() {
    const body = document.getElementById('servicioDirectoCarritoBody');
    if (!body) return;
    if (_carrito.size === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.25rem;">El carrito está vacío.</td></tr>';
    } else {
        body.innerHTML = [..._carrito.entries()].map(([k, it]) => `
            <tr>
                <td style="padding:0.5rem; overflow-wrap:anywhere;">${escapeHtml(it.nombre)}</td>
                <td style="padding:0.5rem;">
                    <input type="number" min="1" step="1" value="${it.cantidad}" data-servicio-directo-cantidad="${escapeHtml(k)}" aria-label="Cantidad de ${escapeHtml(it.nombre)}" style="width:64px; margin:0;">
                </td>
                <td style="padding:0.5rem;">
                    ${it.precio_variable
                        ? `<input type="number" min="0" step="0.01" value="${it.precio || ''}" placeholder="Precio" data-servicio-directo-precio="${escapeHtml(k)}" aria-label="Precio de ${escapeHtml(it.nombre)}" style="width:96px; margin:0;">`
                        : `<span class="num">${money(it.precio)}</span>`}
                </td>
                <td class="num" style="padding:0.5rem; text-align:right; font-weight:500;" data-servicio-directo-subtotal="${escapeHtml(k)}">${money((it.precio || 0) * it.cantidad)}</td>
                <td style="padding:0.5rem; text-align:right;">
                    <button type="button" class="btn-secondary btn-sm" data-servicio-directo-quitar="${escapeHtml(k)}" aria-label="Quitar ${escapeHtml(it.nombre)}">&times;</button>
                </td>
            </tr>`).join('');
    }
    actualizarTotales();
}

// Refresca subtotales/total sin repintar las filas: repintar en cada tecla
// haría perder el foco del input de cantidad o precio.
function actualizarTotales() {
    for (const [k, it] of _carrito.entries()) {
        const celda = document.querySelector(`[data-servicio-directo-subtotal="${CSS.escape(k)}"]`);
        if (celda) celda.textContent = money((it.precio || 0) * it.cantidad);
    }
    document.getElementById('servicioDirectoTotal').textContent = money(totalCarrito());
    document.getElementById('btnServicioDirectoEmitir').disabled = !carritoValido();
}

async function cobrar() {
    if (!carritoValido()) {
        showNotification('Revisá el carrito: cantidades mayores a 0 y precio en los servicios de precio variable.', 'warning');
        return;
    }
    const metodoPago = document.querySelector('input[name="servicioDirectoMetodo"]:checked')?.value || 'EFECTIVO';
    const items = [..._carrito.values()].map(it => ({
        tipo: it.tipo,
        id: it.id,
        cantidad: it.cantidad,
        ...(it.precio_variable ? { precio_unitario: it.precio } : {}),
    }));
    try {
        const factura = await fetchAPI('/servicio-directo/ventas', {
            method: 'POST',
            body: JSON.stringify({ metodo_pago: metodoPago, items }),
        });
        _ultimaFacturaId = factura.id;
        _carrito = new Map();
        pintarCarrito();
        document.getElementById('servicioDirectoFacturaNumero').textContent = `Factura #${factura.numero_factura || factura.id}`;
        document.getElementById('servicioDirectoFacturaTotal').textContent = money(factura.total);
        document.getElementById('servicioDirectoVenta').hidden = true;
        document.getElementById('servicioDirectoConfirmacion').hidden = false;
        showNotification(`Factura #${factura.numero_factura || factura.id} emitida y cobrada.`, 'success');
    } catch (e) {
        // El carrito se conserva: el usuario corrige y reintenta.
        showNotification('No se pudo cobrar: ' + e.message, 'error');
    }
}

function nuevaVenta() {
    _ultimaFacturaId = null;
    _carrito = new Map();
    pintarCarrito();
    document.getElementById('servicioDirectoConfirmacion').hidden = true;
    document.getElementById('servicioDirectoVenta').hidden = false;
    const buscador = document.getElementById('servicioDirectoBuscar');
    if (buscador) {
        buscador.value = '';
        buscar('');
        buscador.focus();
    }
}

function wire() {
    if (_wired) return;
    _wired = true;

    const buscarDebounced = debounce((q) => buscar(q), 250);
    document.getElementById('servicioDirectoBuscar')?.addEventListener('input', (e) => buscarDebounced(e.target.value));

    document.getElementById('servicioDirectoResultadosBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-servicio-directo-agregar]');
        if (!btn) return;
        const item = _resultados[Number(btn.dataset.servicioDirectoAgregar)];
        if (item) agregar(item);
    });

    const carrito = document.getElementById('servicioDirectoCarritoBody');
    carrito?.addEventListener('input', (e) => {
        const cant = e.target.closest('[data-servicio-directo-cantidad]');
        const precio = e.target.closest('[data-servicio-directo-precio]');
        if (cant) {
            const it = _carrito.get(cant.dataset.servicioDirectoCantidad);
            if (it) it.cantidad = Math.floor(Number(cant.value)) || 0;
        } else if (precio) {
            const it = _carrito.get(precio.dataset.servicioDirectoPrecio);
            if (it) it.precio = Number(precio.value) || 0;
        }
        actualizarTotales();
    });
    carrito?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-servicio-directo-quitar]');
        if (!btn) return;
        _carrito.delete(btn.dataset.servicioDirectoQuitar);
        pintarCarrito();
    });

    document.getElementById('btnServicioDirectoEmitir')?.addEventListener('click', (e) => submitWithLoading(e.currentTarget, cobrar));
    document.getElementById('btnServicioDirectoNueva')?.addEventListener('click', nuevaVenta);
    document.getElementById('btnServicioDirectoPdf')?.addEventListener('click', () => {
        if (_ultimaFacturaId) exportarFacturaPDF(_ultimaFacturaId);
    });
}

// initFn de la sección (router.js). El carrito sobrevive a salir y volver a
// la sección: una venta a medio armar no se pierde por un cambio de pantalla.
export const initServicioDirecto = () => {
    wire();
    pintarCarrito();
    document.getElementById('servicioDirectoBuscar')?.focus();
};
