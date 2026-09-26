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

/** Fecha larga en es-VE con mayúscula inicial, ej. "Lunes 21 de septiembre". */
export const fechaLargaEsVE = (date = new Date()) => {
    const fecha = date.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
    return fecha.charAt(0).toUpperCase() + fecha.slice(1);
};

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
