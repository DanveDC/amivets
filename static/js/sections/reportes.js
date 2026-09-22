// sections/reportes.js — Informes: KPIs básicos, KPIs por período (Unidad C),
// consultas por veterinario (Unidad D) y liquidación a veterinarios (Unidad E).
// Movido verbatim desde app.js (etapa 2a). Sin cambio de comportamiento.
// Nota: `verConsultaCompleta` (usada en un onclick generado) vive en window,
// expuesta por el bootstrap desde sections/consultorio.js.

import { fetchAPI } from '../core/api.js';
import { showNotification, escapeHtml } from '../core/ui.js';

// ============ REPORTES MODULE ============
export const loadReportes = async () => {
    initRpDashboard();
    initKpiRango();
    initConsultasPorVeterinario();
    if (localStorage.getItem('role') === 'admin') {
        initLiquidaciones();
    }
};

// ============ PANEL SUPERIOR (Tarea 11 — boceto Reportes.html) ============
// Cuatro KPI + "Ingresos por servicio" + "Producción por médico" + "Por tipo
// de mascota". Reemplaza el bloque anterior (Citas Hoy/Pacientes Atendidos/
// Bajo Stock), que el propio código admitía como aproximado ("simulamos
// stats básicos con las APIs existentes") y nunca llegó a mostrar el stock
// real. "Patologías más frecuentes" no se implementa -- ver el estado vacío
// fijo en index.html y docs/revision-integral-11.md.

const RP_TIPO_LABELS = {
    CONSULTA: { nombre: 'Consultas', unidad: 'atenciones' },
    CIRUGIA: { nombre: 'Cirugías', unidad: 'procedimientos' },
    HOSPITALIZACION: { nombre: 'Hospitalización', unidad: 'días-cama' },
    LABORATORIO: { nombre: 'Laboratorio', unidad: 'estudios' },
    ESTETICA: { nombre: 'Estética', unidad: 'servicios' },
    VACUNACION: { nombre: 'Vacunas', unidad: 'dosis' },
    INSUMO: { nombre: 'Productos', unidad: 'ventas' },
    PROCEDIMIENTO: { nombre: 'Procedimientos', unidad: 'procedimientos' },
    IMAGEN: { nombre: 'Imágenes', unidad: 'estudios' },
};

const rpTipoInfo = (tipo) => RP_TIPO_LABELS[tipo] || { nombre: tipo, unidad: 'servicios' };

const rpRangoTrimestre = () => {
    const hoy = new Date();
    const anio = hoy.getUTCFullYear();
    const mes = hoy.getUTCMonth();
    return {
        inicio: kpiFechaISOUTC(new Date(Date.UTC(anio, mes - 2, 1))),
        fin: kpiFechaISOUTC(hoy)
    };
};

const rpRango = (tipo) => (tipo === 'trimestre' ? rpRangoTrimestre() : kpiCalcularRango(tipo));

const rpDiasEnRango = (inicio, fin) => {
    const d1 = new Date(`${inicio}T00:00:00Z`);
    const d2 = new Date(`${fin}T00:00:00Z`);
    return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
};

const rpFormatMoney = (valor) => `$ ${Number(valor || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

const rpSetDelta = (elId, actual, anterior) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (anterior === null || anterior === undefined || anterior === 0 || actual === null || actual === undefined) {
        el.textContent = anterior === 0 && actual ? 'sin datos del período anterior' : '';
        el.className = 'rp-kpi-delta';
        return;
    }
    const variacion = ((actual - anterior) / anterior) * 100;
    const signo = variacion >= 0 ? '+' : '';
    el.textContent = `${signo}${variacion.toFixed(0)}% vs. período anterior`;
    el.className = `rp-kpi-delta ${variacion >= 0 ? 'rp-kpi-value--up' : 'rp-kpi-value--down'}`;
};

const cargarRpKpis = async () => {
    const actual = kpiCalcularRango('este_mes');
    const anterior = kpiCalcularRango('mes_anterior');

    try {
        const [ingActual, ingAnterior, consActual, nuevos] = await Promise.all([
            fetchAPI(`/reportes/finanzas/ingresos?fecha_inicio=${actual.inicio}&fecha_fin=${actual.fin}`),
            fetchAPI(`/reportes/finanzas/ingresos?fecha_inicio=${anterior.inicio}&fecha_fin=${anterior.fin}`),
            fetchAPI(`/reportes/kpi/consultas?fecha_inicio=${actual.inicio}&fecha_fin=${actual.fin}`),
            fetchAPI(`/reportes/kpi/pacientes-nuevos?fecha_inicio=${actual.inicio}&fecha_fin=${actual.fin}`),
        ]);

        document.getElementById('rpKpiIngresos').textContent = rpFormatMoney(ingActual?.total_ingresos);
        rpSetDelta('rpKpiIngresosDelta', ingActual?.total_ingresos, ingAnterior?.total_ingresos);

        const dias = rpDiasEnRango(actual.inicio, actual.fin);
        const atenciones = consActual?.consultas_atendidas || 0;
        document.getElementById('rpKpiAtenciones').textContent = atenciones.toLocaleString('es-AR');
        const promedioEl = document.getElementById('rpKpiAtencionesDelta');
        if (promedioEl) {
            promedioEl.textContent = `promedio ${(atenciones / dias).toFixed(1)} por día`;
            promedioEl.className = 'rp-kpi-delta';
        }

        document.getElementById('rpKpiTicket').textContent = rpFormatMoney(ingActual?.ticket_promedio);
        rpSetDelta('rpKpiTicketDelta', ingActual?.ticket_promedio, ingAnterior?.ticket_promedio);

        const pacientesNuevos = nuevos?.pacientes_nuevos || 0;
        document.getElementById('rpKpiNuevos').textContent = pacientesNuevos.toLocaleString('es-AR');
        const nuevosEl = document.getElementById('rpKpiNuevosDelta');
        if (nuevosEl) {
            const totalAtendido = consActual?.pacientes_unicos || 0;
            // "Pacientes nuevos" (registros nuevos, /kpi/pacientes-nuevos) y
            // "total atendido" (mascotas con consulta, /kpi/consultas) miden
            // cosas distintas -- un alta sin turno agendado todavía no queda
            // "atendida". No son subconjunto uno del otro necesariamente, así
            // que el "% del total atendido" del boceto solo se muestra cuando
            // es una lectura razonable (<=100%); si no, el número crudo solo
            // dice menos mentiras que un porcentaje de más de 100%.
            const pct = totalAtendido ? (pacientesNuevos / totalAtendido) * 100 : null;
            nuevosEl.textContent = (pct !== null && pct <= 100)
                ? `${pct.toFixed(0)}% del total atendido`
                : 'altas del mes (no todas con turno atendido todavía)';
            nuevosEl.className = 'rp-kpi-delta';
        }
    } catch (error) {
        console.error('Error cargando KPIs del panel de reportes', error);
    }
};

const cargarRpServicios = async (tipoRango) => {
    const wrap = document.getElementById('rpServiciosBars');
    const sub = document.getElementById('rpServiciosSub');
    if (!wrap) return;
    const { inicio, fin } = rpRango(tipoRango);
    if (sub) {
        const etiquetas = { este_mes: 'Este mes', trimestre: 'Último trimestre', este_anio: 'Este año' };
        sub.textContent = `${etiquetas[tipoRango] || 'Este mes'} · en pesos`;
    }

    wrap.innerHTML = '<p class="rp-empty-text">Cargando…</p>';
    try {
        const filas = await fetchAPI(`/reportes/kpi/ingresos-por-tipo-servicio?fecha_inicio=${inicio}&fecha_fin=${fin}`);
        const datos = Array.isArray(filas) ? filas.filter(f => f.total_ingresos > 0) : [];
        if (datos.length === 0) {
            wrap.innerHTML = '<p class="rp-empty-text">Sin servicios facturados en el rango seleccionado.</p>';
            return;
        }
        const max = Math.max(...datos.map(d => d.total_ingresos));
        wrap.innerHTML = datos.map(d => {
            const info = rpTipoInfo(d.tipo_servicio);
            const pct = Math.max(2, (d.total_ingresos / max) * 100);
            return `
                <div class="rp-bar-row">
                    <span class="rp-bar-label">${escapeHtml(info.nombre)}</span>
                    <div class="rp-bar-track">
                        <div class="rp-bar-fill" style="width:${pct.toFixed(1)}%"></div>
                        <span class="rp-bar-amount">${rpFormatMoney(d.total_ingresos)}</span>
                        <span class="rp-bar-count">${d.cantidad} ${info.unidad}</span>
                    </div>
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error cargando ingresos por tipo de servicio', error);
        wrap.innerHTML = '<p class="rp-empty-text">Error al cargar. Reintentá más tarde.</p>';
    }
};

const cargarRpProduccion = async () => {
    const body = document.getElementById('rpProduccionBody');
    const sub = document.getElementById('rpProduccionSub');
    if (!body) return;
    const { inicio, fin } = kpiCalcularRango('este_mes');
    if (sub) sub.textContent = kpiFormatFecha(fin).slice(3); // "mm/yyyy" a mes/año legible corto

    try {
        const filas = await fetchAPI(`/reportes/kpi/rendimiento?fecha_inicio=${inicio}&fecha_fin=${fin}`);
        const datos = Array.isArray(filas) ? filas : [];
        if (datos.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="rp-empty-text">Sin consultas este mes.</td></tr>';
            return;
        }
        // El total de la participación va sobre TODO el dataset (es "cuánto
        // de la producción total es mía"), pero la tabla solo muestra el
        // top 10 por ingresos -- boceto: 4 médicos. Una clínica real tiene
        // un puñado; una tabla de centenas de filas no es "Producción por
        // médico", es un volcado.
        const totalIngresos = datos.reduce((acc, d) => acc + (d.ingresos || 0), 0);
        const ordenados = [...datos].sort((a, b) => (b.ingresos || 0) - (a.ingresos || 0));
        const TOP_N = 10;
        const visibles = ordenados.slice(0, TOP_N);
        body.innerHTML = visibles.map(d => {
            const pct = totalIngresos > 0 ? (d.ingresos / totalIngresos) * 100 : 0;
            return `
                <tr>
                    <td>${escapeHtml(d.veterinario || '—')}</td>
                    <td class="rp-num" style="color:var(--text-secondary)">${d.consultas_realizadas}</td>
                    <td class="rp-num" style="font-weight:500">${rpFormatMoney(d.ingresos)}</td>
                    <td><div class="rp-progress"><div class="rp-progress-fill" style="width:${pct.toFixed(0)}%"></div></div></td>
                    <td class="rp-num" style="color:var(--text-secondary); text-align:right;">${pct.toFixed(0)}%</td>
                </tr>`;
        }).join('') + (ordenados.length > TOP_N
            ? `<tr><td colspan="5" class="rp-empty-text">+ ${ordenados.length - TOP_N} veterinario(s) más, no mostrados.</td></tr>`
            : '');
    } catch (error) {
        console.error('Error cargando producción por médico', error);
        body.innerHTML = '<tr><td colspan="5" class="rp-empty-text">Error al cargar.</td></tr>';
    }
};

const RP_ESPECIE_BUCKET = (especie) => {
    const e = (especie || '').trim().toLowerCase();
    if (e === 'perro') return 'Perros';
    if (e === 'gato') return 'Gatos';
    return 'Otras';
};

const cargarRpEspecies = async () => {
    const wrap = document.getElementById('rpEspecies');
    if (!wrap) return;
    const { inicio, fin } = kpiCalcularRango('este_mes');

    wrap.innerHTML = '<p class="rp-empty-text">Cargando…</p>';
    try {
        const filas = await fetchAPI(`/reportes/kpi/mascotas-por-especie?fecha_inicio=${inicio}&fecha_fin=${fin}`);
        const datos = Array.isArray(filas) ? filas : [];
        if (datos.length === 0) {
            wrap.innerHTML = '<p class="rp-empty-text">Sin atenciones este mes.</p>';
            return;
        }
        const buckets = {};
        let total = 0;
        datos.forEach(d => {
            const key = RP_ESPECIE_BUCKET(d.especie);
            buckets[key] = (buckets[key] || 0) + d.atenciones;
            total += d.atenciones;
        });
        const orden = ['Perros', 'Gatos', 'Otras'].filter(k => buckets[k]);
        wrap.innerHTML = orden.map(nombre => {
            const count = buckets[nombre];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return `
                <div class="rp-especie-row">
                    <div class="rp-especie-head">
                        <span class="rp-especie-nombre">${nombre}</span>
                        <span class="rp-especie-pct">${pct.toFixed(0)}%</span>
                    </div>
                    <div class="rp-progress" style="width:100%;"><div class="rp-progress-fill" style="width:${pct.toFixed(0)}%"></div></div>
                    <span class="rp-especie-count">${count} atenciones</span>
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error cargando distribución por especie', error);
        wrap.innerHTML = '<p class="rp-empty-text">Error al cargar.</p>';
    }
};

let rpListenersBound = false;

const initRpDashboard = () => {
    cargarRpKpis();
    cargarRpServicios('este_mes');
    cargarRpProduccion();
    cargarRpEspecies();

    if (!rpListenersBound) {
        document.querySelectorAll('#rpServiciosRango .rp-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#rpServiciosRango .rp-pill').forEach(b => b.classList.remove('rp-pill--active'));
                btn.classList.add('rp-pill--active');
                cargarRpServicios(btn.dataset.rpRango);
            });
        });
        rpListenersBound = true;
    }
};

// ============ KPIs POR PERÍODO (Unidad C) ============
let kpiServiciosChart = null;
let kpiListenersBound = false;

const kpiFechaISOUTC = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const kpiFormatFecha = (yyyyMmDd) => {
    if (!yyyyMmDd) return '';
    const [y, m, d] = yyyyMmDd.split('-');
    return `${d}/${m}/${y}`;
};

const kpiCalcularRango = (tipo) => {
    const hoy = new Date();
    const anio = hoy.getUTCFullYear();
    const mes = hoy.getUTCMonth();

    if (tipo === 'hoy') {
        const iso = kpiFechaISOUTC(hoy);
        return { inicio: iso, fin: iso };
    }
    if (tipo === 'este_mes') {
        return {
            inicio: kpiFechaISOUTC(new Date(Date.UTC(anio, mes, 1))),
            fin: kpiFechaISOUTC(hoy)
        };
    }
    if (tipo === 'mes_anterior') {
        return {
            inicio: kpiFechaISOUTC(new Date(Date.UTC(anio, mes - 1, 1))),
            fin: kpiFechaISOUTC(new Date(Date.UTC(anio, mes, 0)))
        };
    }
    if (tipo === 'este_anio') {
        return {
            inicio: kpiFechaISOUTC(new Date(Date.UTC(anio, 0, 1))),
            fin: kpiFechaISOUTC(hoy)
        };
    }
    return { inicio: null, fin: null };
};

const kpiFormatMoney = (valor) => `$${Number(valor).toFixed(2)}`;

const kpiSetContador = (elId, valor) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = (valor === null || valor === undefined || valor === 0) ? 'Sin datos' : valor;
};

const kpiSetMonto = (elId, valor) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = (valor === null || valor === undefined) ? 'Sin datos' : kpiFormatMoney(valor);
};

const cargarKpisPeriodo = async (fechaInicio, fechaFin) => {
    const rangoLabel = document.getElementById('kpiRangoActual');
    if (rangoLabel) {
        rangoLabel.textContent = `Rango seleccionado: ${kpiFormatFecha(fechaInicio)} a ${kpiFormatFecha(fechaFin)}`;
    }

    const params = new URLSearchParams({ fecha_inicio: fechaInicio, fecha_fin: fechaFin }).toString();

    try {
        const [consultas, ingresos, cuentas, servicios] = await Promise.all([
            fetchAPI(`/reportes/kpi/consultas?${params}`),
            fetchAPI(`/reportes/finanzas/ingresos?${params}`),
            fetchAPI(`/reportes/finanzas/cuentas-por-cobrar?${params}`),
            fetchAPI(`/reportes/kpi/servicios?${params}`)
        ]);

        kpiSetContador('kpiConsultasAtendidas', consultas?.consultas_atendidas);
        kpiSetContador('kpiPacientesUnicos', consultas?.pacientes_unicos);
        kpiSetMonto('kpiIngresosPeriodo', ingresos?.total_ingresos);
        kpiSetMonto('kpiTicketPromedio', ingresos?.ticket_promedio);
        kpiSetMonto('kpiCuentasPorCobrar', cuentas?.total_pendiente);

        renderKpiServiciosChart(Array.isArray(servicios) ? servicios : []);
    } catch (error) {
        console.error('Error cargando KPIs del período', error);
    }
};

const renderKpiServiciosChart = (servicios) => {
    const wrap = document.getElementById('kpiServiciosChartWrap');
    if (!wrap) return;

    if (!servicios || servicios.length === 0) {
        if (kpiServiciosChart) {
            kpiServiciosChart.destroy();
            kpiServiciosChart = null;
        }
        wrap.innerHTML = '<p style="text-align:center;color:#6b7280;padding:2rem;">Sin datos para el rango seleccionado.</p>';
        return;
    }

    if (!document.getElementById('kpiServiciosChart')) {
        wrap.innerHTML = '<canvas id="kpiServiciosChart"></canvas>';
    }
    const ctx = document.getElementById('kpiServiciosChart').getContext('2d');

    if (kpiServiciosChart) kpiServiciosChart.destroy();

    // Tarea 11 (revisión de bocetos): el índigo (#4F46E5) no es del sistema
    // -- var(--primary) es el único acento (docs/diseno/pantallas/README.md).
    const tealChart = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0C7A89';
    kpiServiciosChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: servicios.map(s => s.servicio),
            datasets: [{
                label: 'Unidades vendidas',
                data: servicios.map(s => s.total_solicitudes),
                backgroundColor: tealChart,
                borderColor: tealChart,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Servicios Más Solicitados' }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
};

const initKpiRango = () => {
    const fechaInicioInput = document.getElementById('kpiFechaInicio');
    const fechaFinInput = document.getElementById('kpiFechaFin');
    if (!fechaInicioInput || !fechaFinInput) return;

    const aplicarRango = (inicio, fin) => {
        fechaInicioInput.value = inicio;
        fechaFinInput.value = fin;
        cargarKpisPeriodo(inicio, fin);
    };

    if (!kpiListenersBound) {
        document.querySelectorAll('.kpi-rango-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const { inicio, fin } = kpiCalcularRango(btn.dataset.kpiRango);
                aplicarRango(inicio, fin);
            });
        });

        document.getElementById('btnAplicarRangoKpi')?.addEventListener('click', () => {
            const inicio = fechaInicioInput.value;
            const fin = fechaFinInput.value;
            if (!inicio || !fin) {
                alert('Seleccioná una fecha de inicio y una fecha de fin.');
                return;
            }
            cargarKpisPeriodo(inicio, fin);
        });

        kpiListenersBound = true;
    }

    if (!fechaInicioInput.value || !fechaFinInput.value) {
        const { inicio, fin } = kpiCalcularRango('este_mes');
        aplicarRango(inicio, fin);
    }
};

// ============ CONSULTAS POR VETERINARIO (Unidad D) ============
let consVetListenersBound = false;

const cargarSelectorVeterinarios = async () => {
    const select = document.getElementById('consVetSelect');
    if (!select) return;
    try {
        const vets = await fetchAPI('/usuarios/veterinarios');
        const previo = select.value;
        select.innerHTML = '<option value="">Seleccioná un veterinario...</option>' +
            (Array.isArray(vets) ? vets : []).map(v => `<option value="${v.id}">${escapeHtml(v.username)}</option>`).join('');
        if (previo) select.value = previo;
    } catch (error) {
        console.error('Error cargando veterinarios', error);
    }
};

const cargarConsultasPorVeterinario = async (veterinarioId, fechaInicio, fechaFin) => {
    const rangoLabel = document.getElementById('consVetRangoActual');
    const listaDiv = document.getElementById('consVetLista');
    if (!listaDiv) return;

    if (!veterinarioId) {
        if (rangoLabel) rangoLabel.textContent = '';
        listaDiv.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Seleccioná un veterinario para ver su detalle.</p>';
        return;
    }

    if (rangoLabel) {
        rangoLabel.textContent = `Rango seleccionado: ${kpiFormatFecha(fechaInicio)} a ${kpiFormatFecha(fechaFin)}`;
    }

    const params = new URLSearchParams({ veterinario_id: veterinarioId, fecha_inicio: fechaInicio, fecha_fin: fechaFin }).toString();

    try {
        const data = await fetchAPI(`/reportes/consultas-por-veterinario?${params}`);
        renderConsultasPorVeterinario(data);
    } catch (error) {
        console.error('Error cargando consultas por veterinario', error);
        listaDiv.innerHTML = '<p style="text-align:center; color: #dc2626; padding: 1rem;">Error al cargar el detalle.</p>';
    }
};

const renderConsultasPorVeterinario = (data) => {
    const listaDiv = document.getElementById('consVetLista');
    if (!listaDiv) return;

    const consultas = data?.consultas || [];

    if (consultas.length === 0) {
        listaDiv.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Sin datos para el rango seleccionado.</p>';
        return;
    }

    const filas = consultas.map(c => {
        const fecha = c.fecha_consulta ? new Date(c.fecha_consulta).toLocaleDateString() : '-';
        const servicios = (c.servicios || []).map(s => s.nombre_servicio || s.tipo_servicio).join(', ') || '-';
        return `
            <tr>
                <td style="padding: 0.75rem 1rem;">${fecha}</td>
                <td style="padding: 0.75rem 1rem;">${c.mascota || '-'}</td>
                <td style="padding: 0.75rem 1rem;">${c.propietario || '-'}</td>
                <td style="padding: 0.75rem 1rem;">${c.motivo || '-'}</td>
                <td style="padding: 0.75rem 1rem;">${servicios}</td>
                <td style="padding: 0.75rem 1rem; text-align: right;">
                    <button class="av-btn" onclick="verConsultaCompleta(${c.id}, ${c.mascota_id})" style="height:30px; padding:0 10px; font-size:12.5px;">Ver consulta</button>
                </td>
            </tr>`;
    }).join('');

    listaDiv.innerHTML = `
        <p style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.75rem;">Consultas en el período: ${data.total_consultas}</p>
        <table class="consultas-table" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: var(--surface-hover); border-bottom: 1.5px solid var(--border);">
                    <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Fecha</th>
                    <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Mascota</th>
                    <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Propietario</th>
                    <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Motivo</th>
                    <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Servicios</th>
                    <th style="padding: 0.75rem 1rem; text-align: right; font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary);">Acciones</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
};

const initConsultasPorVeterinario = () => {
    const select = document.getElementById('consVetSelect');
    const fechaInicioInput = document.getElementById('consVetFechaInicio');
    const fechaFinInput = document.getElementById('consVetFechaFin');
    if (!select || !fechaInicioInput || !fechaFinInput) return;

    cargarSelectorVeterinarios();

    const aplicar = () => {
        if (!fechaInicioInput.value || !fechaFinInput.value) {
            const { inicio, fin } = kpiCalcularRango('este_mes');
            fechaInicioInput.value = inicio;
            fechaFinInput.value = fin;
        }
        cargarConsultasPorVeterinario(select.value, fechaInicioInput.value, fechaFinInput.value);
    };

    if (!consVetListenersBound) {
        select.addEventListener('change', aplicar);

        document.querySelectorAll('.cons-vet-rango-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const { inicio, fin } = kpiCalcularRango(btn.dataset.consVetRango);
                fechaInicioInput.value = inicio;
                fechaFinInput.value = fin;
                aplicar();
            });
        });

        document.getElementById('btnAplicarConsVet')?.addEventListener('click', () => {
            if (!fechaInicioInput.value || !fechaFinInput.value) {
                alert('Seleccioná una fecha de inicio y una fecha de fin.');
                return;
            }
            aplicar();
        });

        consVetListenersBound = true;
    }
};

// ============ LIQUIDACIÓN A VETERINARIOS (Unidad E) ============
let liqListenersBound = false;
let liqUltimoPreview = null;

const cargarTarifas = async () => {
    const body = document.getElementById('liqTarifasBody');
    if (!body) return;
    try {
        const vets = await fetchAPI('/liquidaciones/tarifas');
        const lista = Array.isArray(vets) ? vets : [];
        if (lista.length === 0) {
            body.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-secondary); padding: 1rem;">No hay veterinarios registrados.</td></tr>';
            return;
        }
        body.innerHTML = lista.map(v => `
            <tr>
                <td style="padding: 0.6rem 0.75rem;">${escapeHtml(v.username)}</td>
                <td style="padding: 0.6rem 0.75rem;">
                    <input type="number" min="0" step="0.01" id="liqTarifaInput${v.id}" value="${v.tarifa_consulta ?? ''}" placeholder="Sin configurar" style="width:120px; padding:0.35rem 0.5rem; border:1px solid var(--border); border-radius:6px;">
                </td>
                <td style="padding: 0.6rem 0.75rem; text-align:right;">
                    <button class="av-btn" onclick="guardarTarifaVeterinario(${v.id})" style="height:30px; padding:0 10px; font-size:12.5px;">Guardar</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando tarifas', error);
        body.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--accent); padding: 1rem;">Error al cargar tarifas.</td></tr>';
    }
};

const guardarTarifaVeterinario = async (vetId) => {
    const input = document.getElementById(`liqTarifaInput${vetId}`);
    if (!input) return;
    const valor = input.value.trim();
    const tarifa = valor === '' ? null : Number(valor);
    if (tarifa !== null && (isNaN(tarifa) || tarifa < 0)) {
        alert('La tarifa debe ser un número mayor o igual a 0.');
        return;
    }
    try {
        await fetchAPI(`/liquidaciones/tarifa/${vetId}`, {
            method: 'PUT',
            body: JSON.stringify({ tarifa_consulta: tarifa })
        });
        showNotification('Tarifa actualizada.', 'success');
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

const cargarSelectoresVeterinariosLiq = async () => {
    const selects = [document.getElementById('liqVetSelect'), document.getElementById('liqHistVetSelect')];
    try {
        const vets = await fetchAPI('/usuarios/veterinarios');
        const lista = Array.isArray(vets) ? vets : [];
        selects.forEach(select => {
            if (!select) return;
            const previo = select.value;
            const placeholder = select.id === 'liqHistVetSelect' ? 'Todos los veterinarios' : 'Seleccioná un veterinario...';
            select.innerHTML = `<option value="">${placeholder}</option>` +
                lista.map(v => `<option value="${v.id}">${escapeHtml(v.username)}</option>`).join('');
            if (previo) select.value = previo;
        });
    } catch (error) {
        console.error('Error cargando veterinarios para liquidación', error);
    }
};

const renderLiqPreview = (data) => {
    const wrap = document.getElementById('liqPreviewWrap');
    if (!wrap) return;

    const consultas = data?.consultas || [];
    if (consultas.length === 0) {
        wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">No hay consultas nuevas para liquidar en este rango (ya liquidadas, sin factura PAGADA, o sin consultas).</p>';
        return;
    }

    const filas = consultas.map(c => `
        <tr>
            <td style="padding: 0.6rem 0.75rem;">${new Date(c.fecha_consulta).toLocaleDateString()}</td>
            <td style="padding: 0.6rem 0.75rem;">#${c.consulta_id}</td>
            <td style="padding: 0.6rem 0.75rem;">#${c.factura_id}</td>
            <td style="padding: 0.6rem 0.75rem; text-align:right;">${kpiFormatMoney(c.tarifa_aplicada)}</td>
        </tr>
    `).join('');

    wrap.innerHTML = `
        <p style="font-weight:600; color: var(--text-primary); margin-bottom:0.75rem;">
            ${data.total_consultas} consulta(s) elegibles · Tarifa: ${kpiFormatMoney(data.tarifa_consulta)} c/u
        </p>
        <table class="consultas-table" style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="background: var(--surface-hover); border-bottom: 1.5px solid var(--border);">
                    <th style="padding: 0.6rem 0.75rem; text-align:left; font-size:0.8rem; text-transform:uppercase; color:var(--text-secondary);">Fecha</th>
                    <th style="padding: 0.6rem 0.75rem; text-align:left; font-size:0.8rem; text-transform:uppercase; color:var(--text-secondary);">Consulta</th>
                    <th style="padding: 0.6rem 0.75rem; text-align:left; font-size:0.8rem; text-transform:uppercase; color:var(--text-secondary);">Factura</th>
                    <th style="padding: 0.6rem 0.75rem; text-align:right; font-size:0.8rem; text-transform:uppercase; color:var(--text-secondary);">Tarifa Aplicada</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border);">
            <div style="font-size:1.1rem; font-weight:700; color: var(--text-primary);">Total: ${kpiFormatMoney(data.total)}</div>
            <button type="button" id="btnLiqConfirmar" class="av-btn av-btn--primary" style="height:34px; padding:0 14px;">Confirmar cálculo</button>
        </div>
    `;

    document.getElementById('btnLiqConfirmar')?.addEventListener('click', confirmarLiquidacion);
};

const previewLiquidacion = async () => {
    const vetId = document.getElementById('liqVetSelect')?.value;
    const fechaInicio = document.getElementById('liqFechaInicio')?.value;
    const fechaFin = document.getElementById('liqFechaFin')?.value;
    const wrap = document.getElementById('liqPreviewWrap');
    if (!wrap) return;

    if (!vetId) {
        alert('Seleccioná un veterinario.');
        return;
    }
    if (!fechaInicio || !fechaFin) {
        alert('Seleccioná una fecha de inicio y una fecha de fin.');
        return;
    }

    liqUltimoPreview = { veterinario_id: Number(vetId), fecha_inicio: fechaInicio, fecha_fin: fechaFin };

    wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Calculando desglose…</p>';
    try {
        const params = new URLSearchParams({ veterinario_id: vetId, fecha_inicio: fechaInicio, fecha_fin: fechaFin }).toString();
        const data = await fetchAPI(`/liquidaciones/preview?${params}`);
        renderLiqPreview(data);
    } catch (error) {
        wrap.innerHTML = `<p style="text-align:center; color:var(--accent); padding: 1rem;">Error: ${error.message}</p>`;
    }
};

const confirmarLiquidacion = async () => {
    if (!liqUltimoPreview) return;
    if (!confirm('¿Confirmar el cálculo? Las consultas incluidas quedarán liquidadas y no podrán volver a liquidarse.')) return;

    try {
        await fetchAPI('/liquidaciones/calcular', {
            method: 'POST',
            body: JSON.stringify(liqUltimoPreview)
        });
        showNotification('Liquidación calculada y guardada.', 'success');
        document.getElementById('liqPreviewWrap').innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Seleccioná veterinario y rango, y hacé clic en "Ver desglose".</p>';
        liqUltimoPreview = null;
        cargarHistorialLiquidaciones();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

const renderLiqHistorial = (liquidaciones) => {
    const wrap = document.getElementById('liqHistLista');
    if (!wrap) return;

    if (!liquidaciones || liquidaciones.length === 0) {
        wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Todavía no hay liquidaciones calculadas.</p>';
        return;
    }

    wrap.innerHTML = liquidaciones.map(l => {
        const detalles = (l.detalles || []).map(d => `
            <tr>
                <td style="padding: 0.5rem 0.75rem;">${new Date(d.fecha_consulta).toLocaleDateString()}</td>
                <td style="padding: 0.5rem 0.75rem;">#${d.consulta_id}</td>
                <td style="padding: 0.5rem 0.75rem;">#${d.factura_id}</td>
                <td style="padding: 0.5rem 0.75rem; text-align:right;">${kpiFormatMoney(d.tarifa_aplicada)}</td>
            </tr>
        `).join('');

        return `
            <details style="margin-bottom:0.75rem; border:1px solid var(--border); border-radius:8px; padding:0.75rem 1rem; background: var(--surface-hover);">
                <summary style="cursor:pointer; font-weight:600; color: var(--text-primary);">
                    Liquidación #${l.id} · Veterinario #${l.veterinario_id} · ${new Date(l.fecha_inicio).toLocaleDateString()} a ${new Date(l.fecha_fin).toLocaleDateString()} · Total: ${kpiFormatMoney(l.total)}
                </summary>
                <p style="font-size:0.75rem; color: var(--text-secondary); margin: 0.5rem 0;">Calculada el ${new Date(l.fecha_calculo).toLocaleString()} · ${(l.detalles || []).length} consulta(s)</p>
                <table class="consultas-table" style="width:100%; border-collapse:collapse; margin-top:0.5rem;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Fecha</th>
                            <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Consulta</th>
                            <th style="padding: 0.5rem 0.75rem; text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Factura</th>
                            <th style="padding: 0.5rem 0.75rem; text-align:right; font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">Tarifa Aplicada</th>
                        </tr>
                    </thead>
                    <tbody>${detalles}</tbody>
                </table>
            </details>
        `;
    }).join('');
};

const cargarHistorialLiquidaciones = async () => {
    const wrap = document.getElementById('liqHistLista');
    if (!wrap) return;
    const vetId = document.getElementById('liqHistVetSelect')?.value;

    wrap.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 1rem;">Cargando…</p>';
    try {
        const params = vetId ? `?veterinario_id=${vetId}` : '';
        const data = await fetchAPI(`/liquidaciones/${params}`);
        renderLiqHistorial(Array.isArray(data) ? data : []);
    } catch (error) {
        wrap.innerHTML = `<p style="text-align:center; color:var(--accent); padding: 1rem;">Error: ${error.message}</p>`;
    }
};

const initLiquidaciones = () => {
    const seccion = document.getElementById('liqSeccion');
    if (!seccion) return;

    cargarTarifas();
    cargarSelectoresVeterinariosLiq();
    cargarHistorialLiquidaciones();

    if (!liqListenersBound) {
        document.getElementById('btnLiqPreview')?.addEventListener('click', previewLiquidacion);
        document.getElementById('btnLiqHistRefrescar')?.addEventListener('click', cargarHistorialLiquidaciones);
        document.getElementById('liqHistVetSelect')?.addEventListener('change', cargarHistorialLiquidaciones);

        document.querySelectorAll('.liq-rango-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const { inicio, fin } = kpiCalcularRango(btn.dataset.liqRango);
                document.getElementById('liqFechaInicio').value = inicio;
                document.getElementById('liqFechaFin').value = fin;
            });
        });

        liqListenersBound = true;
    }
};

export { guardarTarifaVeterinario };
export { loadReportes as init };
