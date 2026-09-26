// sections/orden-abierta.js — sec-orden-abierta (Tarea 06, etapa 7).
//
// La pantalla de trabajo de una orden de servicio: paciente/tutor, servicios
// anexados con su estado, total acumulado, y las acciones de ciclo de vida
// (confirmar, facturar, cerrar, anular). tab:false — se abre desde el panel
// del día, la bandeja del gestor o la ficha del paciente vía abrirOrden(id).
// docs/diseno/navegacion-v2.md, Decisión 3; docs/diseno/pantallas/OrdenAbierta.html
// y AnexarServicio.html.
//
// LÍMITES DOCUMENTADOS (ver también hoy.js):
// - ServicioConsultaResponse no expone qué insumos consumió cada línea, así
//   que la fila de servicio no pinta el sub-texto "Alcohol 50ml · Gasas 2u"
//   que muestra la maqueta — sólo el nombre.
// - AnexarServicio.html lista "Consultas" como categoría del picker, pero
//   POST /api/ordenes/{id}/servicios RECHAZA con 400 tipo_servicio=CONSULTA
//   (esa línea es exclusiva de POST /api/consultas/, orden_service.py). Se
//   excluye la categoría CONSULTA del picker para no ofrecer una acción que
//   el backend va a rechazar siempre.
// - Facturar una orden usa su propio endpoint (orden-servicio-carrito,
//   decisión 6): GET /api/ordenes/{id}/pendientes-facturar arma la vista
//   previa (ítems + total) y POST /api/ordenes/{id}/facturar arma la factura
//   en el servidor con TODOS los servicios sin facturar de la orden CERRADA
//   -- el cliente ya no manda detalles[] ni servicio_id. El servidor también
//   resuelve solo el consulta_id de la orden (si tiene una línea CONSULTA
//   viva), así que la liquidación del veterinario (Decisión 3, docs/diseno/
//   ordenes-de-servicio.md) sigue enganchada sin que el front tenga que
//   conocer ese detalle.

import { fetchAPI } from '../core/api.js';
import { showNotification, openModal, closeModal, debounce, escapeHtml, submitWithLoading } from '../core/ui.js';
import { money, totalServicios } from '../core/format.js';
import { showSection } from '../core/router.js';

const ESTADO_LABEL_ORDEN = { ABIERTA: 'Abierta', EN_ATENCION: 'En atención', CERRADA: 'Cerrada', ANULADA: 'Anulada' };

const ESTADO_PILL_SRV = {
    SOLICITADO: 'av-pill--neutral', ASIGNADO: 'av-pill--warn', EN_PROCESO: 'av-pill--info',
    EJECUTADO: 'av-pill--ok', FACTURADO: 'av-pill--ok', CANCELADO: 'av-pill--neutral',
};
const ESTADO_LABEL_SRV = {
    SOLICITADO: 'Solicitado', ASIGNADO: 'Asignado', EN_PROCESO: 'En proceso',
    EJECUTADO: 'Ejecutado', FACTURADO: 'Facturado', CANCELADO: 'Cancelado',
};

// Categoría del catálogo -> tipo_servicio que acepta OrdenServicioAnexarServicio
// (no hay un enum estricto del lado del backend — sólo importa para el gate
// de recepcionista, ver TIPOS_SERVICIO_CLINICOS en routers/servicios.py).
const CATEGORIA_TIPO = {
    LABORATORIO: 'LABORATORIO',
    IMAGENOLOGIA: 'LABORATORIO',
    QUIROFANO: 'CIRUGIA',
    HOSPITALIZACION: 'HOSPITALIZACION',
    PELUQUERIA: 'ESTETICA',
    FARMACIA: 'INSUMO',
    SERVICIOS: 'OTRO',
    'ADMINISTRACION VARIOS': 'OTRO',
};

let _ordenId = null;
let _ordenData = null;
let _catalogo = [];
let _catActual = null;
let _svcSeleccionado = null;
let _consumos = [];
let _wired = false;

/** Abre la orden `ordenId`: navega a sec-orden-abierta y carga sus datos. */
export const abrirOrden = async (ordenId) => {
    _ordenId = ordenId;
    showSection('sec-orden-abierta');
    cerrarAnexarPanel();
    await cargarOrden();
};

async function cargarOrden() {
    const patient = document.getElementById('oaPatient');
    if (patient) patient.innerHTML = '<p class="av-muted">Cargando datos de la orden…</p>';
    try {
        const orden = await fetchAPI(`/ordenes/${_ordenId}`);
        _ordenData = orden;
        pintarHeader(orden);
        pintarPaciente(orden);
        pintarServicios(orden);
        pintarResumen(orden);
        pintarMeta(orden);
        pintarAcciones(orden);
    } catch (e) {
        if (patient) patient.innerHTML = `<p class="av-text-danger">Error cargando la orden: ${escapeHtml(e.message)}</p>`;
    }
}

function pintarHeader(orden) {
    const title = document.getElementById('avHeaderTitleText');
    const sub = document.getElementById('avHeaderSubtitleText');
    if (title) title.textContent = `Orden ${orden.numero}`;
    if (sub) sub.textContent = `${ESTADO_LABEL_ORDEN[orden.estado] || orden.estado} · ${orden.mascota_nombre || 'Sin paciente'} / ${orden.propietario_nombre || 'Sin tutor'}`;
}

function pintarPaciente(orden) {
    const el = document.getElementById('oaPatient');
    if (!el) return;
    const iniciales = (orden.mascota_nombre || orden.propietario_nombre || '?').slice(0, 2).toUpperCase();
    el.innerHTML = `
        <div class="oa-patient-avatar">${iniciales}</div>
        <div class="oa-patient-main">
            <div class="oa-patient-namerow">
                <span class="ser">${escapeHtml(orden.mascota_nombre || 'Sin paciente (venta de mostrador)')}</span>
                <span class="av-pill av-pill--neutral">${ESTADO_LABEL_ORDEN[orden.estado] || orden.estado}</span>
            </div>
            <span class="oa-patient-meta">Orden <span class="num">${orden.numero}</span> · Motivo: ${escapeHtml(orden.motivo_visita || 'Sin especificar')}</span>
        </div>
        <div class="oa-divider"></div>
        <div class="oa-owner">
            <span class="av-eyebrow">Tutor</span>
            <strong>${escapeHtml(orden.propietario_nombre || '—')}</strong>
        </div>
        <div class="av-spacer"></div>
        <button type="button" class="av-btn av-btn--primary" id="btnOaAnexarInline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Anexar servicio
        </button>`;
    document.getElementById('btnOaAnexarInline')?.addEventListener('click', abrirAnexarPanel);
}

function pintarServicios(orden) {
    const body = document.getElementById('oaServiciosBody');
    const count = document.getElementById('oaServiciosCount');
    const resumen = document.getElementById('oaServiciosResumen');
    if (!body) return;
    const servicios = (orden.servicios || []).filter(s => !s.is_deleted);
    if (count) count.textContent = `${servicios.length} de esta orden`;
    if (resumen) {
        const aplicados = servicios.filter(s => s.estado === 'EJECUTADO' || s.estado === 'FACTURADO').length;
        const pendientes = servicios.length - aplicados;
        resumen.textContent = `${aplicados} aplicado${aplicados === 1 ? '' : 's'} · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}`;
    }
    if (servicios.length === 0) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Todavía no se anexó ningún servicio.</td></tr>';
        return;
    }
    body.innerHTML = servicios.map(s => `
        <tr>
            <td><span class="oa-service-name">${escapeHtml(s.nombre_servicio || '—')}</span></td>
            <td><span class="av-pill av-pill--info">${escapeHtml(s.tipo_servicio || '—')}</span></td>
            <td class="num">${s.cantidad}</td>
            <td class="num" style="font-weight:500;">${money(s.precio_unitario)}</td>
            <td class="num" style="font-weight:500;">${money((s.cantidad || 0) * (s.precio_unitario || 0))}</td>
            <td><span class="av-pill ${ESTADO_PILL_SRV[s.estado] || 'av-pill--neutral'}">${ESTADO_LABEL_SRV[s.estado] || s.estado}</span></td>
            <td></td>
        </tr>`).join('');
}

function pintarResumen(orden) {
    // orden.total lo calcula el servidor al leer (orden-servicio-carrito,
    // decisión 2): presupuesto real, incluye SOLICITADO/ASIGNADO/EN_PROCESO,
    // no solo lo ejecutado. totalServicios queda de fallback por si el
    // backend no lo manda (respuesta vieja en caché, etc.) — decisión 9.
    const total = typeof orden.total === 'number' ? orden.total : totalServicios(orden.servicios);
    document.getElementById('oaResumenServicios').textContent = money(total);
    document.getElementById('oaTotal').textContent = money(total);
}

function pintarMeta(orden) {
    document.getElementById('oaMetaNumero').textContent = orden.numero;
    document.getElementById('oaMetaApertura').textContent = orden.fecha_apertura
        ? new Date(orden.fecha_apertura).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
    document.getElementById('oaMetaVeterinario').textContent = orden.veterinario_nombre || 'Sin asignar';
    document.getElementById('oaMetaEstado').textContent = ESTADO_LABEL_ORDEN[orden.estado] || orden.estado;
}

function pintarAcciones(orden) {
    const terminal = orden.estado === 'CERRADA' || orden.estado === 'ANULADA';
    const hayPendientes = (orden.servicios || []).some(s => !s.is_deleted && s.estado === 'SOLICITADO');
    const btnConfirmar = document.getElementById('btnOaConfirmar');
    const btnFacturar = document.getElementById('btnOaFacturar');
    const btnCerrar = document.getElementById('btnOaCerrar');
    const btnAnular = document.getElementById('btnOaAnular');
    // El botón inline vive dentro de #oaPatient y se recrea en cada
    // pintarPaciente() (que corre antes que pintarAcciones en cargarOrden),
    // así que consultarlo acá siempre encuentra el nodo actual.
    const btnAnexar = document.getElementById('btnOaAnexar');
    const btnAnexarInline = document.getElementById('btnOaAnexarInline');
    if (btnConfirmar) btnConfirmar.disabled = terminal || !hayPendientes;
    // Facturar por orden (decisión 9): solo tiene sentido con la orden
    // CERRADA -- ABIERTA/EN_ATENCION todavía es presupuesto, no factura.
    if (btnFacturar) btnFacturar.disabled = orden.estado !== 'CERRADA';
    if (btnCerrar) btnCerrar.disabled = terminal;
    if (btnAnular) btnAnular.disabled = orden.estado === 'ANULADA';
    // El backend ya bloquea anexar con 409 en una orden CERRADA/ANULADA, pero
    // sin esto el usuario completaba todo el panel "Anexar servicio" y recién
    // ahí se enteraba (hallazgo de revisión, etapa 7).
    if (btnAnexar) btnAnexar.disabled = terminal;
    if (btnAnexarInline) btnAnexarInline.disabled = terminal;
}

// ── acciones de ciclo de vida ────────────────────────────────────────────────

async function confirmarServicios() {
    try {
        await fetchAPI(`/ordenes/${_ordenId}/confirmar`, { method: 'POST' });
        showNotification('Servicios confirmados.', 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo confirmar: ' + e.message, 'error');
    }
}

// orden-servicio-carrito, decisión 9: "Facturar" abre #modalFacturarOrden con
// la vista previa que arma el SERVIDOR (GET /pendientes-facturar), no un
// cálculo local sobre orden.servicios -- así el modal siempre refleja
// exactamente lo que POST /facturar va a cobrar. Solo se ofrece con la orden
// CERRADA (gate en pintarAcciones); acá se repite el chequeo por si el botón
// quedó habilitado con datos viejos.
let _pendientesFacturar = null;

async function facturarOrden() {
    if (_ordenData?.estado !== 'CERRADA') {
        showNotification('Solo se puede facturar una orden CERRADA.', 'warning');
        return;
    }
    try {
        _pendientesFacturar = await fetchAPI(`/ordenes/${_ordenId}/pendientes-facturar`);
    } catch (e) {
        showNotification('No se pudo cargar lo pendiente de facturar: ' + e.message, 'error');
        return;
    }
    const items = _pendientesFacturar?.items || [];
    if (items.length === 0) {
        showNotification('No hay servicios pendientes de facturar en esta orden.', 'warning');
        return;
    }

    document.getElementById('facOrdenNumero').textContent = `orden ${_ordenData.numero || _ordenId}`;
    document.getElementById('facOrdenConceptos').innerHTML = items.map(it => `
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:6px 0;">
            <span style="color:var(--text-secondary);">${escapeHtml(it.descripcion || '—')}</span>
            <span class="rp-num" style="white-space:nowrap;">${money(it.subtotal)}</span>
        </div>`).join('');
    document.getElementById('facOrdenTotal').textContent = money(_pendientesFacturar.total);
    document.querySelector('input[name="facOrdenMetodo"][value="EFECTIVO"]').checked = true;
    document.getElementById('facOrdenPagaAhora').checked = true;
    document.getElementById('facOrdenPendienteNota').hidden = true;

    openModal('modalFacturarOrden');
}

async function confirmarFacturarOrden() {
    if (!_pendientesFacturar || (_pendientesFacturar.items || []).length === 0) return;

    const metodoPago = document.querySelector('input[name="facOrdenMetodo"]:checked')?.value || 'EFECTIVO';
    const pagaAhora = document.getElementById('facOrdenPagaAhora')?.checked;
    const total = _pendientesFacturar.total || 0;

    try {
        // El servidor arma los detalles y resuelve el consulta_id de la
        // orden solo (decisión 6): el front ya no manda detalles[] ni
        // servicio_id, ni tiene que buscar la línea CONSULTA a mano.
        const factura = await fetchAPI(`/ordenes/${_ordenId}/facturar`, {
            method: 'POST',
            body: JSON.stringify({
                // No se manda metodo_pago si no se cobra ahora (total_pagado
                // 0): mandarlo igual dejaba una factura PENDIENTE marcada
                // como cobrada por el método por defecto (hallazgo de
                // revisión 11, se mantiene con el endpoint nuevo).
                ...(pagaAhora ? { metodo_pago: metodoPago } : {}),
                total_pagado: pagaAhora ? total : 0.0,
                descuento: 0.0,
                impuesto: 0.0,
            }),
        });
        closeModal('modalFacturarOrden');
        _pendientesFacturar = null;
        showNotification(`Factura #${factura.numero_factura || factura.id} emitida${pagaAhora ? ' y cobrada' : ''}.`, 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo facturar la orden: ' + e.message, 'error');
    }
}

async function cerrarOrden() {
    if (!window.confirm('¿Cerrar esta orden? No se van a poder anexar más servicios.')) return;
    try {
        await fetchAPI(`/ordenes/${_ordenId}/cerrar`, { method: 'POST' });
        showNotification('Orden cerrada.', 'success');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo cerrar la orden: ' + e.message, 'error');
    }
}

async function anularOrden(motivo) {
    try {
        await fetchAPI(`/ordenes/${_ordenId}/anular`, { method: 'POST', body: JSON.stringify({ motivo_anulacion: motivo }) });
        showNotification('Orden anulada.', 'success');
        closeModal('modalAnularOrden');
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo anular la orden: ' + e.message, 'error');
    }
}

// ── panel "Anexar servicio" (452px, hermano flex del contenido — Decisión 3) ─

function cerrarAnexarPanel() {
    const panel = document.getElementById('oaAnexarPanel');
    const canvas = document.getElementById('oaCanvas');
    if (panel) panel.hidden = true;
    if (canvas) canvas.classList.remove('oa-canvas--compressed');
    _svcSeleccionado = null;
    _consumos = [];
    document.removeEventListener('keydown', onAnexarKeydown);
}

async function abrirAnexarPanel() {
    const panel = document.getElementById('oaAnexarPanel');
    const canvas = document.getElementById('oaCanvas');
    if (!panel) return;
    panel.hidden = false;
    if (canvas) canvas.classList.add('oa-canvas--compressed');
    document.addEventListener('keydown', onAnexarKeydown);
    document.getElementById('oaAnexarSearch')?.focus();
    await cargarCatalogoAnexar();
}

function onAnexarKeydown(e) {
    if (e.key === 'Escape') cerrarAnexarPanel();
}

async function cargarCatalogoAnexar() {
    try {
        _catalogo = await fetchAPI('/catalogo?solo_activos=true&limit=500') || [];
    } catch (_) {
        _catalogo = [];
    }
    // AnexarServicio.html contradicción documentada arriba: se excluye
    // CONSULTA — el backend la rechaza siempre (orden_service.py:238).
    _catalogo = _catalogo.filter(s => (s.categoria || '').toUpperCase() !== 'CONSULTA');
    _catActual = null;
    pintarCategorias();
    pintarServiciosPicker();
}

function pintarCategorias() {
    const cont = document.getElementById('oaCatList');
    if (!cont) return;
    const porCategoria = new Map();
    _catalogo.forEach(s => porCategoria.set(s.categoria, (porCategoria.get(s.categoria) || 0) + 1));
    const cats = Array.from(porCategoria.entries());
    cont.innerHTML = [
        `<button type="button" class="oa-cat-item" data-cat="" aria-current="${_catActual === null ? 'true' : 'false'}"><span>Todas</span><span class="av-nav-num">${_catalogo.length}</span></button>`,
        ...cats.map(([cat, n]) => `<button type="button" class="oa-cat-item" data-cat="${escapeHtml(cat)}" aria-current="${_catActual === cat ? 'true' : 'false'}"><span>${escapeHtml(cat)}</span><span class="av-nav-num">${n}</span></button>`),
    ].join('');
    cont.querySelectorAll('.oa-cat-item').forEach(btn => {
        btn.addEventListener('click', () => {
            _catActual = btn.dataset.cat || null;
            pintarCategorias();
            pintarServiciosPicker();
        });
    });
}

function pintarServiciosPicker() {
    const cont = document.getElementById('oaSvcList');
    if (!cont) return;
    const q = (document.getElementById('oaAnexarSearch')?.value || '').trim().toLowerCase();
    const items = _catalogo.filter(s =>
        (!_catActual || s.categoria === _catActual) &&
        (!q || s.nombre.toLowerCase().includes(q))
    );
    if (items.length === 0) {
        cont.innerHTML = '<p class="av-muted" style="padding:12px;">Sin resultados.</p>';
        return;
    }
    cont.innerHTML = items.map(s => `
        <button type="button" class="oa-svc-item" data-id="${s.id}" aria-checked="${_svcSeleccionado?.id === s.id ? 'true' : 'false'}">
            <span class="oa-svc-radio"><span class="oa-svc-radio-dot"></span></span>
            <span class="oa-svc-info"><strong>${escapeHtml(s.nombre)}</strong><span>${escapeHtml(s.categoria)}</span></span>
            <span class="oa-svc-price num">${money(s.precio_ref)}</span>
        </button>`).join('');
    cont.querySelectorAll('.oa-svc-item').forEach(btn => {
        btn.addEventListener('click', () => seleccionarServicio(Number(btn.dataset.id)));
    });
}

async function seleccionarServicio(id) {
    _svcSeleccionado = _catalogo.find(s => s.id === id) || null;
    pintarServiciosPicker();
    const wrap = document.getElementById('oaConsumosWrap');
    const list = document.getElementById('oaConsumosList');
    if (!_svcSeleccionado || !wrap || !list) return;
    wrap.hidden = false;
    list.innerHTML = '<p class="av-muted" style="padding:8px 0;">Cargando insumos…</p>';
    try {
        const lineas = await fetchAPI(`/catalogo/${_svcSeleccionado.id}/recetas`) || [];
        _consumos = lineas.map(l => ({ inventario_id: l.inventario_id, nombre: l.inventario_nombre, cantidad: Number(l.cantidad), unidad: l.unidad_medida }));
        if (_consumos.length === 0) {
            list.innerHTML = '<p class="av-muted" style="padding:8px 0;">Este servicio no consume insumos con receta fija.</p>';
            return;
        }
        list.innerHTML = _consumos.map((c, i) => `
            <div class="oa-consumo-row">
                <div class="oa-consumo-info"><strong>${escapeHtml(c.nombre || ('#' + c.inventario_id))}</strong><span>Cantidad estándar</span></div>
                <div class="oa-consumo-qty"><input type="number" step="0.001" min="0" value="${c.cantidad}" data-idx="${i}" style="width:100%; border:0; background:transparent; text-align:center; font:inherit;" class="num"> ${escapeHtml(c.unidad || '')}</div>
            </div>`).join('');
        list.querySelectorAll('input[data-idx]').forEach(inp => {
            inp.addEventListener('change', () => {
                const idx = Number(inp.dataset.idx);
                // Vacío queda como null (no como 0): confirmarAnexo lo rechaza.
                _consumos[idx].cantidad = inp.value.trim() === '' ? null : Number(inp.value);
            });
        });
    } catch (_) {
        _consumos = [];
        list.innerHTML = '<p class="av-text-danger" style="padding:8px 0;">No se pudo cargar la receta de este servicio.</p>';
    }
}

async function confirmarAnexo() {
    if (!_svcSeleccionado) {
        showNotification('Elegí un servicio del catálogo primero.', 'warning');
        return;
    }
    const tipo = CATEGORIA_TIPO[(_svcSeleccionado.categoria || '').toUpperCase()] || 'OTRO';
    const body = {
        tipo_servicio: tipo,
        catalogo_servicio_id: _svcSeleccionado.id,
        nombre_servicio: _svcSeleccionado.nombre,
        cantidad: 1,
        precio_unitario: _svcSeleccionado.precio_ref,
    };
    if (_consumos.length) {
        // Vacío o negativo no se adivina: se pide corregir. Se mandan también
        // los 0 ("no se usó"): si se omitían, al ejecutar se descontaba la
        // cantidad de la receta (fix de revisión).
        if (_consumos.some(c => c.cantidad === null || !(c.cantidad >= 0))) {
            showNotification('Completá la cantidad de cada material (0 si no se usó).', 'warning');
            return;
        }
        body.consumos = _consumos.map(c => ({ inventario_id: c.inventario_id, cantidad: c.cantidad }));
    }
    try {
        const resp = await fetchAPI(`/ordenes/${_ordenId}/servicios`, { method: 'POST', body: JSON.stringify(body) });
        showNotification('Servicio anexado a la orden.', 'success');
        if (resp?.advertencias?.length) {
            showNotification(resp.advertencias.map(a => a.mensaje || JSON.stringify(a)).join(' — '), 'warning');
        }
        cerrarAnexarPanel();
        await cargarOrden();
    } catch (e) {
        showNotification('No se pudo anexar el servicio: ' + e.message, 'error');
    }
}

// ── wiring (una sola vez) ────────────────────────────────────────────────────
export const initOrdenAbierta = () => {
    if (_wired) return;
    _wired = true;

    document.getElementById('btnOaAnexar')?.addEventListener('click', abrirAnexarPanel);
    document.getElementById('btnOaAnexarClose')?.addEventListener('click', cerrarAnexarPanel);
    document.getElementById('btnOaAnexarCancelar')?.addEventListener('click', cerrarAnexarPanel);
    document.getElementById('btnOaAnexarConfirmar')?.addEventListener('click', confirmarAnexo);
    document.getElementById('oaAnexarSearch')?.addEventListener('input', debounce(pintarServiciosPicker, 150));

    document.getElementById('btnOaConfirmar')?.addEventListener('click', confirmarServicios);
    document.getElementById('btnOaFacturar')?.addEventListener('click', facturarOrden);
    // Guard contra doble clic (revisión 11): sin esto, dos clics rápidos en
    // "Emitir factura" mandaban dos POST /facturas/ casi simultáneos y
    // creaban dos facturas para los mismos servicios. submitWithLoading
    // deshabilita el botón mientras la request está en vuelo y lo reactiva
    // siempre (éxito o error) vía finally.
    document.getElementById('btnConfirmarFacturarOrden')?.addEventListener('click', (e) => {
        submitWithLoading(e.currentTarget, confirmarFacturarOrden);
    });
    document.getElementById('facOrdenPagaAhora')?.addEventListener('change', (e) => {
        document.getElementById('facOrdenPendienteNota').hidden = e.target.checked;
    });
    document.getElementById('btnOaCerrar')?.addEventListener('click', cerrarOrden);
    document.getElementById('btnOaAnular')?.addEventListener('click', () => {
        document.getElementById('anularOrdenMotivo').value = '';
        openModal('modalAnularOrden');
    });
    document.getElementById('formAnularOrden')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const motivo = document.getElementById('anularOrdenMotivo').value.trim();
        if (!motivo) return;
        anularOrden(motivo);
    });
};
