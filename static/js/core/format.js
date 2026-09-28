// core/format.js — helpers de formato compartidos (Tarea 06, etapa 7).
//
// Antes vivían duplicados en hoy.js, orden-abierta.js, bandeja-gestor.js,
// notificaciones.js e inicio.js — cada copia era casi idéntica, salvo
// `haceCuanto`, que tenía DOS formas de retorno distintas (string en
// notificaciones.js vs `{texto, minutos}` en bandeja-gestor.js): un bug
// latente, no sólo duplicación (hallazgo de revisión, etapa 7).

/** Fecha para mostrar. Una fecha sola 'YYYY-MM-DD' (un `date` del backend)
 * se toma como día LOCAL: `new Date('2026-09-01')` es medianoche UTC y en
 * Venezuela (UTC-4) se mostraba el día anterior. Un datetime se muestra en
 * hora local como siempre. */
export const fechaCorta = (v) => {
    if (!v) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
    return d.toLocaleDateString();
};

/** Formatea un monto como moneda con dos decimales, ej. `$120.00`. */
export const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/** Suma cantidad × precio_unitario de las líneas de servicio no borradas. */
export const totalServicios = (servicios) =>
    (servicios || [])
        .filter(s => !s.is_deleted)
        .reduce((acc, s) => acc + (s.cantidad || 0) * (s.precio_unitario || 0), 0);

/** Toma exclusiva por gestor (toma-exclusiva-servicio-gestor, decisiones 2 y
 * 6; asignacion-directa-servicio-gestor, decisiones 8 y 9): clase `av-pill` y
 * etiqueta legible de `servicio.estado_toma`, compartidas entre
 * orden-abierta.js y hoy.js (antes duplicadas cada una por su lado).
 * "tomada" suma el nombre de quien lo tomó (`asignado_a_nombre`,
 * `schemas.py::ServicioConsultaResponse`) cuando el backend lo manda, y
 * distingue si ese "quien lo tomó" es el mismo al que se lo despacharon
 * directamente (`asignado_directo_a_id`) — sigue mostrando "Asignado a"
 * porque para el usuario es la misma asignación, ahora en proceso. "asignada"
 * es el caso ASIGNADO con asignación directa que todavía nadie tomó. */
export const ESTADO_TOMA_PILL = {
    disponible: 'av-pill--ok', tomada: 'av-pill--info',
    completada: 'av-pill--neutral', liberada: 'av-pill--warn',
    asignada: 'av-pill--info',
};

export const estadoTomaLabel = (servicio) => {
    switch (servicio?.estado_toma) {
        case 'disponible': return 'Disponible';
        case 'asignada': return servicio.asignado_directo_a_nombre ? `Asignado a ${servicio.asignado_directo_a_nombre}` : 'Asignado';
        case 'tomada':
            if (servicio.asignado_directo_a_id != null && servicio.asignado_directo_a_id === servicio.asignado_a_id) {
                return `Asignado a ${servicio.asignado_a_nombre} · en proceso`;
            }
            return servicio.asignado_a_nombre ? `Tomada por ${servicio.asignado_a_nombre}` : 'Tomada';
        case 'completada': return 'Completada';
        case 'liberada': return 'Liberada';
        default: return '';
    }
};

/** Fecha larga en es-VE con mayúscula inicial, ej. "Lunes 21 de septiembre". */
export const fechaLargaEsVE = (date = new Date()) => {
    const fecha = date.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
    return fecha.charAt(0).toUpperCase() + fecha.slice(1);
};

/**
 * Agrupa una lista plana de servicios/ítems en `{ grupos, sueltos }`
 * (servicio-base-paquete-items): cada `grupo` es un servicio base con sus
 * items adicionales anidados (`items`) y el subtotal del paquete (base +
 * items); `sueltos` son los que no son base ni tienen padre. Se comparte
 * entre `orden-abierta.js` (objetos `ServicioConsultaResponse` completos) y
 * `facturacion.js`/el preview de `pendientes-facturar` (ítems planos de
 * factura, con otros nombres de campo) — cada caller indica cómo leer
 * id/padre/base/subtotal de su propia forma vía `opts`.
 */
export function agruparPorPaquete(items, opts = {}) {
    const getId = opts.getId || (it => it.id);
    const getPadreId = opts.getPadreId || (it => it.servicio_padre_id);
    const getEsBase = opts.getEsBase || (it => !!it.es_base);
    const getSubtotal = opts.getSubtotal || (it => (it.cantidad || 0) * (it.precio_unitario || 0));

    const lista = items || [];
    const bases = lista.filter(getEsBase);
    const idsBase = new Set(bases.map(getId));
    const itemsPorPadre = new Map();
    // Un hijo cuyo padre no está en la lista (padre ya facturado en otra
    // factura, soft-deleted o cancelado) va a `sueltos`: si no, no entraba en
    // ningún grupo y desaparecía, y las líneas dejaban de sumar el total.
    const sueltos = [];
    lista.filter(it => !getEsBase(it)).forEach(it => {
        const padreId = getPadreId(it);
        if (padreId == null || !idsBase.has(padreId)) {
            sueltos.push(it);
            return;
        }
        const arr = itemsPorPadre.get(padreId) || [];
        arr.push(it);
        itemsPorPadre.set(padreId, arr);
    });
    const grupos = bases.map(base => {
        const hijos = itemsPorPadre.get(getId(base)) || [];
        const subtotalPaquete = getSubtotal(base) + hijos.reduce((acc, h) => acc + getSubtotal(h), 0);
        return { base, items: hijos, subtotalPaquete };
    });
    return { grupos, sueltos };
}

/**
 * Tiempo transcurrido desde `iso`, con una única forma de retorno:
 * `{ texto, minutos }`. `minutos` sirve para ordenar/comparar (ej. la cola
 * de la bandeja del gestor); `texto` es la versión legible que cada caller
 * puede envolver en su propia copia (ej. notificaciones.js antepone "hace ").
 */
export function haceCuanto(iso) {
    if (!iso) return { texto: '—', minutos: 0 };
    const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutos < 60) return { texto: `${minutos} min`, minutos };
    const horas = Math.floor(minutos / 60);
    if (horas < 24) {
        const resto = minutos % 60;
        return { texto: `${horas} h ${resto} min`, minutos };
    }
    const dias = Math.floor(horas / 24);
    return { texto: `${dias} d`, minutos };
}
