"""Backfill de rezagados sin orden_id (Tarea 06, FASE 2, previo a etapa 4)

Revision ID: f7a8b9c0d1e2
Revises: b4c5d6e1f2a3
Create Date: 2026-09-20 05:10:00.000000

El backfill de la etapa 3 (b4c5d6e1f2a3) garantizó "0 filas sin orden_id" en
el momento en que corrió. Pero entre esa corrida y el wiring completo de la
etapa 4 (commit 025319c, que recién agregó orden_id a servicios.py, clinico.py,
cirugias.py, hospitalizaciones.py y pruebas.py), algunos endpoints todavía
creaban `ServicioConsulta` sin orden -- ese hueco temporal dejó filas nuevas
huérfanas que la migración c5d6e1f2a3b4 (SET NOT NULL) encuentra al querer
correr. Confirmado en vivo contra el dev DB: 26 filas, todas con
`created_at` de un run de pruebas anterior a la etapa 4 (2026-09-14/15).

Mismo criterio que b4c5d6e1f2a3 (Decisión 2 de docs/diseno/ordenes-de-servicio.md),
aplicado solo a lo que sigue huérfano hoy:

    Bloque A  una orden nueva por cada Consulta que tenga AL MENOS una fila
              huérfana y NINGUNA fila ya enganchada (evita crear una orden
              duplicada si la consulta ya tiene una vía otra fila, p.ej. su
              línea CONSULTA de la etapa 4).
    Bloque B  una orden nueva por cada grupo (mascota_id, date(created_at))
              de servicios directos huérfanos sin consulta.
    Bloque C  enganche de las filas huérfanas a la orden que les toca.

Deliberadamente NO se reintenta reusar una orden ya existente del mismo
mascota+día para el bloque B, aunque exista una en la base: atribuirle a una
fila huérfana la orden de una visita distinta (coincidencia de fecha) sería
inventar un vínculo que no está en el dato. Se prefiere una orden nueva y
honesta, mismo criterio que ya usó b4c5d6e1f2a3.

Nada clínico se toca: no hay DELETE ni UPDATE sobre consultas ni ninguna tabla
de detalle clínico. Idempotente: si no queda ninguna fila con orden_id NULL,
upgrade() es un no-op.

Estilo (docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
backfill en SQL crudo via op.execute, downgrade() implementado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'b4c5d6e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ORIGEN = "MIGRACION_06_REZAGO"
_TMP = "tmp_ordenes_rezago"
_NUMERO_SEQ = "ordenes_servicio_numero_seq"

# Mismas reglas de derivación que b4c5d6e1f2a3 (ver ese archivo para el porqué
# de cada campo), acotadas acá a lo que sigue huérfano.
_STAGING_SQL = f"""
CREATE TEMP TABLE {_TMP} ON COMMIT DROP AS
WITH responsable AS (
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
consultas_huerfanas AS (
    -- Solo consultas donde TODAS las filas propias siguen sin orden: si
    -- alguna fila de la consulta ya está enganchada (p.ej. su línea CONSULTA
    -- de la etapa 4), el bloque C de abajo la engancha ahí directamente sin
    -- pasar por acá.
    SELECT DISTINCT sc.consulta_id
      FROM servicios_consulta sc
     WHERE sc.consulta_id IS NOT NULL
     GROUP BY sc.consulta_id
    HAVING bool_and(sc.orden_id IS NULL)
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
            ELSE 'ABIERTA'
        END                                           AS estado,
        CASE
            WHEN c.estado IN ('CERRADA', 'ANULADA')
                THEN COALESCE(f.fecha_emision, c.fecha_consulta)
            ELSE NULL
        END                                           AS fecha_cierre
      FROM consultas c
      JOIN consultas_huerfanas ch ON ch.consulta_id = c.id
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
     WHERE sc.consulta_id IS NULL AND sc.orden_id IS NULL
     GROUP BY sc.mascota_id, (sc.created_at)::date, m.propietario_id
)
SELECT
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
    primero = conn.execute(sa.text(f"SELECT nextval({secuencia_sql})")).scalar()
    conn.execute(
        sa.text(f"SELECT setval({secuencia_sql}, :ultimo)"),
        {"ultimo": primero + cantidad - 1},
    )
    return int(primero)


def upgrade() -> None:
    conn = op.get_bind()

    # --- 0. Idempotencia: no hay nada huérfano, no hay nada que hacer ---
    huerfanas_antes = conn.execute(sa.text(
        "SELECT count(*) FROM servicios_consulta WHERE orden_id IS NULL"
    )).scalar() or 0
    if huerfanas_antes == 0:
        return

    # --- 1. Staging de los bloques A y B ---
    conn.execute(sa.text(_STAGING_SQL))

    total = conn.execute(sa.text(f"SELECT count(*) FROM {_TMP}")).scalar() or 0
    if total > 0:
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

        # --- 4. Bloque C: enganche de las filas de bloque A/B recién creadas ---
        conn.execute(sa.text(f"""
            UPDATE servicios_consulta sc
               SET orden_id = t.id
              FROM {_TMP} t
             WHERE t.bloque = 'A'
               AND sc.consulta_id = t.consulta_id
               AND sc.orden_id IS NULL
        """))
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

    # --- 6. Bloque D: filas cuya consulta YA tenía una orden enganchada por
    # otra vía (p.ej. su línea CONSULTA de la etapa 4) -- no necesitan una
    # orden nueva, solo copiar la que ya existe para esa misma consulta.
    conn.execute(sa.text("""
        UPDATE servicios_consulta sc
           SET orden_id = existente.orden_id
          FROM (
                SELECT DISTINCT ON (consulta_id) consulta_id, orden_id
                  FROM servicios_consulta
                 WHERE consulta_id IS NOT NULL AND orden_id IS NOT NULL
              ORDER BY consulta_id, id
          ) existente
         WHERE sc.consulta_id = existente.consulta_id
           AND sc.orden_id IS NULL
    """))

    # --- 7. Verificacion dura ---
    sueltos = conn.execute(sa.text(
        "SELECT count(*) FROM servicios_consulta WHERE orden_id IS NULL"
    )).scalar() or 0
    if sueltos:
        raise RuntimeError(
            f"Backfill {_ORIGEN}: quedaron {sueltos} filas de servicios_consulta "
            "con orden_id IS NULL. Se aborta la migracion."
        )


def downgrade() -> None:
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
