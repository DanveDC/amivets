"""Backfill de ordenes historicas (Tarea 06, FASE 2 etapa 3)

Revision ID: b4c5d6e1f2a3
Revises: a3b4c5d6e1f2
Create Date: 2026-09-13 21:55:00.000000

Decision 2 de docs/diseno/ordenes-de-servicio.md. Esta revision NO toca el
esquema: todo el DDL ya entro en f2a3b4c5d6e1. Aca solo se crean filas y se
setea una FK, para poder revertir el backfill sin revertir el esquema (que es
el caso que realmente pasa cuando algo sale mal).

    Bloque A  una orden por cada Consulta existente (1:1).
    Bloque B  una orden por cada grupo (mascota_id, date(created_at)) de
              servicios directos huerfanos (consulta_id IS NULL, los que dejo
              la Tarea 09).
    Bloque C  enganche: servicios_consulta.orden_id apunta a la orden que le
              corresponde por consulta (A) o por grupo (B).

Nada clinico se toca: no hay DELETE ni UPDATE sobre consultas, vacunaciones,
desparasitaciones, cirugias, hospitalizaciones, pruebas_complementarias,
recetas ni notas_clinicas. La orden es una capa por encima.

--------------------------------------------------------------------------
DESVIO DELIBERADO SOBRE EL DOC: orden_id SIGUE NULLABLE
--------------------------------------------------------------------------
La decision 3 dice "nullable -> NOT NULL tras backfill". Ese ALTER COLUMN
queda DIFERIDO A LA ETAPA 4 por secuenciacion (ver
docs/diseno/ordenes-de-servicio.md, decision 3).

Motivo: los endpoints que hoy crean filas en servicios_consulta
(POST /api/servicios/, POST /api/consultas/{id}/servicios, POST /api/clinico/*,
POST /api/cirugias/, POST /api/hospitalizaciones/, POST /api/pruebas/) todavia
NO setean orden_id -- eso recien lo hacen los endpoints de orden de la etapa 4.
Con el NOT NULL puesto ahora, la primera alta nueva de cualquiera de esos
endpoints (y la suite e2e los ejercita a todos) violaria el constraint y la
aplicacion quedaria rota hasta que exista la etapa 4.

Lo que SI se garantiza aca: el 100% de las filas historicas queda con orden.
La migracion lo verifica al final y aborta si queda aunque sea una suelta. El
SET NOT NULL se hace en la etapa 4, junto con los endpoints que garantizan que
toda fila nueva tambien nazca con orden.

--------------------------------------------------------------------------
Numeracion
--------------------------------------------------------------------------
Un solo espacio de numeracion (decision 2): las historicas consumen la misma
SEQUENCE ordenes_servicio_numero_seq que las altas normales, en orden
cronologico (fecha_apertura), y al final la secuencia queda por encima del
maximo usado. Por eso el numero NO se deja al server_default de la columna: el
orden en que Postgres evalua el default de un INSERT ... SELECT no es parte del
contrato. En su lugar se reserva un rango de la secuencia por adelantado y se
asigna con row_number() sobre el orden cronologico, que si es determinista.
Lo mismo con el id, para poder mapear cada orden a su origen (bloque C) sin
inventar una columna de correlacion en la tabla real.

Idempotencia: si ya existe una sola orden con origen = 'MIGRACION_06', el
upgrade es un no-op completo. No hay FK de orden a consulta (el vinculo vive en
servicios_consulta, y una consulta sin servicios no dejaria rastro), asi que la
marca de origen es el unico criterio honesto de "esto ya corrio".

Estilo (docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
backfill en SQL crudo via op.execute, downgrade() implementado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e1f2a3'
down_revision: Union[str, None] = 'a3b4c5d6e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ORIGEN = "MIGRACION_06"
_TMP = "tmp_ordenes_migracion_06"
_NUMERO_SEQ = "ordenes_servicio_numero_seq"

# Staging de las ordenes a crear. Se materializa en una temporal (ON COMMIT
# DROP) porque hace falta leerla tres veces: para contar, para insertar y para
# enganchar los servicios (bloque C) por la clave de origen de cada fila.
#
# Notas sobre los criterios, todos de la decision 2:
#
# - fecha_apertura sale SIEMPRE de un dato real que ya existe (fecha_consulta /
#   MIN(created_at)). Poner now() convertiria las ordenes historicas en
#   "abiertas hoy" y arruinaria cualquier reporte por periodo.
# - "la factura" de una consulta es la VIVA (estado <> 'ANULADA'). El indice
#   unico parcial de e5f6a7b8c9d0 garantiza que hay a lo sumo una. Una factura
#   anulada no aporta ni el tutor que pago ni una fecha de cierre: anular
#   ademas reabre la consulta (facturacion_service.anular_factura), asi que esa
#   orden es ABIERTA y no tiene por que tener fecha_cierre.
# - abierta_por_id del bloque A es consulta.veterinario_id: es la unica
#   atribucion honesta disponible (Consulta no tiene "quien la creo") y es
#   NOT NULL desde d4e5f6a7b8c9, asi que nunca queda vacio.
# - cerrada_por_id queda NULL siempre: no se sabe y no se inventa.
# - fecha_cierre del bloque B queda NULL a proposito: la tabla de campos del
#   bloque B en la decision 2 no lo lista, y no hay un "momento de cierre" real
#   registrado para una visita de mostrador. MAX(created_at) seria el ultimo
#   servicio cargado, no un cierre.
_STAGING_SQL = f"""
CREATE TEMP TABLE {_TMP} ON COMMIT DROP AS
WITH responsable AS (
    -- Fallback determinista para el bloque B, que no tiene veterinario:
    -- primer admin activo por id. Las dos alternativas de abajo solo entran en
    -- una base sin admin, para que la migracion no muera por un NOT NULL en
    -- lugar de por el problema real.
    SELECT COALESCE(
        (SELECT u.id FROM usuarios u
          WHERE u.role = 'admin' AND COALESCE(u.is_active, true) IS TRUE
          ORDER BY u.id LIMIT 1),
        (SELECT u.id FROM usuarios u
          WHERE COALESCE(u.is_active, true) IS TRUE
          ORDER BY u.id LIMIT 1),
        (SELECT u.id FROM usuarios u ORDER BY u.id LIMIT 1)
    ) AS id
),
bloque_a AS (
    SELECT
        'A'::text                                     AS bloque,
        c.id                                          AS consulta_id,
        NULL::integer                                 AS grupo_mascota_id,
        NULL::date                                    AS grupo_dia,
        c.mascota_id                                  AS mascota_id,
        COALESCE(f.propietario_id, m.propietario_id)  AS propietario_id,
        c.veterinario_id                              AS veterinario_id,
        c.veterinario_id                              AS abierta_por_id,
        c.fecha_consulta                              AS fecha_apertura,
        c.motivo::varchar(255)                        AS motivo_visita,
        CASE
            WHEN c.estado = 'ANULADA' THEN 'ANULADA'
            WHEN c.estado = 'CERRADA' AND f.id IS NOT NULL THEN 'FACTURADA'
            WHEN c.estado = 'CERRADA' THEN 'CERRADA'
            -- 'ABIERTA' y cualquier valor desconocido o NULL: se cae del lado
            -- del default del modelo, que es el conservador (una orden abierta
            -- se puede cerrar despues; una cerrada de mas oculta trabajo).
            ELSE 'ABIERTA'
        END                                           AS estado,
        CASE
            WHEN c.estado IN ('CERRADA', 'ANULADA')
                THEN COALESCE(f.fecha_emision, c.fecha_consulta)
            ELSE NULL
        END                                           AS fecha_cierre
      FROM consultas c
      -- LEFT JOIN a proposito: mascota_id es FK NOT NULL, pero si alguna vez
      -- quedara colgada, es mejor que reviente el NOT NULL de propietario_id
      -- (ruidoso) a que la consulta desaparezca del backfill (silencioso).
      LEFT JOIN mascotas m ON m.id = c.mascota_id
      LEFT JOIN LATERAL (
          SELECT fa.id, fa.propietario_id, fa.fecha_emision
            FROM facturas fa
           WHERE fa.consulta_id = c.id
             AND fa.estado <> 'ANULADA'
           ORDER BY fa.fecha_emision DESC NULLS LAST, fa.id DESC
           LIMIT 1
      ) f ON TRUE
),
bloque_b AS (
    SELECT
        'B'::text                                     AS bloque,
        NULL::integer                                 AS consulta_id,
        sc.mascota_id                                 AS grupo_mascota_id,
        (sc.created_at)::date                         AS grupo_dia,
        sc.mascota_id                                 AS mascota_id,
        m.propietario_id                              AS propietario_id,
        NULL::integer                                 AS veterinario_id,
        (SELECT r.id FROM responsable r)              AS abierta_por_id,
        MIN(sc.created_at)                            AS fecha_apertura,
        NULL::varchar(255)                            AS motivo_visita,
        CASE
            WHEN bool_and(COALESCE(sc.facturado, false)) THEN 'FACTURADA'
            ELSE 'CERRADA'
        END                                           AS estado,
        NULL::timestamptz                             AS fecha_cierre
      FROM servicios_consulta sc
      LEFT JOIN mascotas m ON m.id = sc.mascota_id
     WHERE sc.consulta_id IS NULL
     GROUP BY sc.mascota_id, (sc.created_at)::date, m.propietario_id
)
SELECT
    -- Orden cronologico global sobre los dos bloques (decision 2). El bloque y
    -- la clave de origen entran como desempate para que el numero asignado sea
    -- reproducible corrida a corrida.
    row_number() OVER (
        ORDER BY u.fecha_apertura,
                 u.bloque,
                 COALESCE(u.consulta_id, u.grupo_mascota_id),
                 u.grupo_dia
    )                       AS rn,
    NULL::integer           AS id,
    NULL::varchar(20)       AS numero,
    u.*
  FROM (
        SELECT * FROM bloque_a
        UNION ALL
        SELECT * FROM bloque_b
  ) u
"""


def _reservar(conn, secuencia_sql: str, cantidad: int) -> int:
    """Reserva `cantidad` valores consecutivos de una secuencia y devuelve el
    primero. nextval entrega el primero; setval deja la secuencia parada en el
    ultimo reservado, asi que el proximo nextval de la aplicacion arranca
    despues del rango. Sin esto habria que confiar en el orden de evaluacion
    del server_default dentro de un INSERT ... SELECT, que no esta garantizado.
    """
    primero = conn.execute(sa.text(f"SELECT nextval({secuencia_sql})")).scalar()
    conn.execute(
        sa.text(f"SELECT setval({secuencia_sql}, :ultimo)"),
        {"ultimo": primero + cantidad - 1},
    )
    return int(primero)


def upgrade() -> None:
    conn = op.get_bind()

    # --- 0. Idempotencia ---
    # Una sola orden con la marca de origen alcanza para saber que este backfill
    # ya corrio. Se sale sin tocar nada: repetir los bloques duplicaria ordenes,
    # y repetir solo el enganche del bloque C podria absorber servicios directos
    # nuevos (etapa 4) dentro de un grupo historico del mismo dia.
    ya_migrado = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM ordenes_servicio WHERE origen = :origen)"
    ), {"origen": _ORIGEN}).scalar()
    if ya_migrado:
        return

    # --- 1. Staging de los bloques A y B ---
    conn.execute(sa.text(_STAGING_SQL))

    total = conn.execute(sa.text(f"SELECT count(*) FROM {_TMP}")).scalar() or 0
    if total == 0:
        # Base vacia (o sin consultas ni servicios sueltos): nada que migrar.
        return

    # --- 2. Reserva de id y numero, en orden cronologico ---
    id_primero = _reservar(
        conn, "pg_get_serial_sequence('ordenes_servicio', 'id')", total
    )
    numero_primero = _reservar(conn, f"'{_NUMERO_SEQ}'", total)

    conn.execute(sa.text(
        f"UPDATE {_TMP} "
        "   SET id = :id_primero - 1 + rn, "
        "       numero = 'OS-' || lpad((:numero_primero - 1 + rn)::text, 6, '0')"
    ), {"id_primero": id_primero, "numero_primero": numero_primero})

    # --- 3. Bloques A y B: alta de las ordenes ---
    # cerrada_por_id, anulada_por_id, motivo_anulacion y observaciones quedan
    # NULL: no hay dato historico para ninguno y no se inventa.
    conn.execute(sa.text(f"""
        INSERT INTO ordenes_servicio (
            id, numero, propietario_id, mascota_id, veterinario_id, estado,
            abierta_por_id, fecha_apertura, fecha_cierre, motivo_visita, origen
        )
        SELECT
            t.id, t.numero, t.propietario_id, t.mascota_id, t.veterinario_id,
            t.estado, t.abierta_por_id, t.fecha_apertura, t.fecha_cierre,
            t.motivo_visita, '{_ORIGEN}'
          FROM {_TMP} t
         ORDER BY t.rn
    """))

    # --- 4. Bloque C: enganche de los servicios ---
    # A: todo servicio de la consulta cuelga de la orden de esa consulta.
    # Incluye los soft-deleted a proposito: la garantia de "ninguna fila sin
    # orden" es sobre la tabla entera, no solo sobre las vivas.
    conn.execute(sa.text(f"""
        UPDATE servicios_consulta sc
           SET orden_id = t.id
          FROM {_TMP} t
         WHERE t.bloque = 'A'
           AND sc.consulta_id = t.consulta_id
           AND sc.orden_id IS NULL
    """))

    # B: cada servicio directo cae en la orden de su grupo (mascota, dia). La
    # expresion de fecha es la misma que agrupo en el staging y corre en la
    # misma sesion, asi que la zona horaria no puede desalinear los dos lados.
    conn.execute(sa.text(f"""
        UPDATE servicios_consulta sc
           SET orden_id = t.id
          FROM {_TMP} t
         WHERE t.bloque = 'B'
           AND sc.consulta_id IS NULL
           AND sc.mascota_id = t.grupo_mascota_id
           AND (sc.created_at)::date = t.grupo_dia
           AND sc.orden_id IS NULL
    """))

    # --- 5. Secuencia de numeracion por encima del maximo usado ---
    # La reserva del paso 2 ya la dejo ahi; este setval es la garantia explicita
    # que pide la decision 2, y cubre el caso de una base que ya tuviera ordenes
    # numeradas por otra via.
    conn.execute(sa.text(f"""
        SELECT setval(
            '{_NUMERO_SEQ}',
            GREATEST(
                (SELECT COALESCE(MAX(
                     NULLIF(regexp_replace(o.numero, '\\D', '', 'g'), '')::bigint
                 ), 0) FROM ordenes_servicio o),
                (SELECT s.last_value FROM {_NUMERO_SEQ} s),
                1
            )
        )
    """))

    # --- 6. Verificacion dura ---
    # El SET NOT NULL de orden_id esta diferido a la etapa 4 (ver encabezado),
    # asi que la base no va a defender sola esta invariante todavia. Se verifica
    # aca y se aborta la transaccion si falla: una fila historica sin orden
    # significa que el enganche no cubrio algun caso, y descubrirlo despues es
    # mucho mas caro que no aplicar la migracion.
    sueltos = conn.execute(sa.text(
        "SELECT count(*) FROM servicios_consulta WHERE orden_id IS NULL"
    )).scalar() or 0
    if sueltos:
        raise RuntimeError(
            f"Backfill {_ORIGEN}: quedaron {sueltos} filas de servicios_consulta "
            "con orden_id IS NULL. Se aborta la migracion."
        )


def downgrade() -> None:
    # Mismo patron que la Tarea 09 (migracion d0e1f2a3b4c5) y que la decision 2:
    # se desengancha por la marca de origen y despues se borran las ordenes. Una
    # orden creada por un alta normal tiene origen IS NULL y no se toca nunca.
    op.execute(sa.text(f"""
        UPDATE servicios_consulta
           SET orden_id = NULL
         WHERE orden_id IN (
               SELECT id FROM ordenes_servicio WHERE origen = '{_ORIGEN}'
         )
    """))
    op.execute(sa.text(
        f"DELETE FROM ordenes_servicio WHERE origen = '{_ORIGEN}'"
    ))
    # Las secuencias NO se retroceden a proposito: un numero de orden ya emitido
    # no se reutiliza, ni siquiera despues de borrar la fila que lo llevaba.
