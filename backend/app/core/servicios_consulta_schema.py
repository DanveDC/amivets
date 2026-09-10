"""Esquema + backfill de "servicios desde la consulta" para el arranque (Tarea 09).

El repo despliega SIN correr `alembic upgrade`: `start.sh` llama a
`scripts/init_db.py` (solo `Base.metadata.create_all`) y `app.main` re-corre
`create_all` al importar. `create_all` crea tablas nuevas, pero **no altera
tablas existentes**: sobre una base ya poblada no agrega `consultas.estado` ni
`servicios_consulta.mascota_id` / `.origen`, no crea el CHECK, y no corre los
backfills del `upgrade()` de la migracion `d0e1f2a3b4c5`.

Este modulo replica ese DDL + los backfills de forma **idempotente** para
invocarlo justo despues de `create_all`, igual que `price_history_backfill`
(Tarea 08). La migracion Alembic queda intacta y sigue siendo el head; esto solo
la hace efectiva en el modelo de deploy real.

Todo corre en Postgres. `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
son nativos; el CHECK y el `DROP NOT NULL` se guardan a mano.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Mismos pares que `_ESPEJOS` en la migracion d0e1f2a3b4c5. Cada tupla:
# (tabla_detalle, tipo_servicio, tipos_espejo_existentes, expr_nombre,
#  expr_cantidad, join_inventario)
_ESPEJOS = [
    (
        "vacunaciones", "VACUNACION", ("VACUNACION",),
        "'VACUNA: ' || COALESCE(i.nombre, 'N/D')", "1.0",
        "LEFT JOIN inventario i ON i.id = d.vacuna_id",
    ),
    (
        "desparasitaciones", "DESPARASITACION", ("DESPARASITACION",),
        "'DESPARASITACION: ' || COALESCE(i.nombre, 'N/D')", "1.0",
        "LEFT JOIN inventario i ON i.id = d.producto_id",
    ),
    (
        "cirugias", "CIRUGIA", ("CIRUGIA",),
        "'CIRUGIA: ' || COALESCE(d.tipo_procedimiento, 'N/D')", "1.0", "",
    ),
    (
        "hospitalizaciones", "HOSPITALIZACION", ("HOSPITALIZACION",),
        "'HOSPITALIZACION: ' || COALESCE(substr(d.motivo, 1, 50), 'N/D')",
        "COALESCE(d.dias_cama, 1)", "",
    ),
    (
        "pruebas_complementarias", "LABORATORIO", ("LABORATORIO", "DIAGNOSTICO"),
        "'ESTUDIO: ' || COALESCE(d.tipo, 'N/D')", "1.0", "",
    ),
]


def ensure_servicios_consulta_schema(engine) -> None:
    """Aplica el esquema y los backfills de la Tarea 09 si aun no estan.

    Idempotente: cada paso se guarda por inspeccion o por `IF NOT EXISTS` /
    `WHERE NOT EXISTS`. Si las tablas base todavia no existen (jamas deberia,
    `create_all` corre antes) se omite en silencio. Todo en una transaccion.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "servicios_consulta" not in tables or "consultas" not in tables:
        logger.warning("servicios_consulta_schema: faltan tablas base, se omite")
        return

    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    consulta_cols = {c["name"] for c in inspector.get_columns("consultas")}
    sc_checks = {ck["name"] for ck in inspector.get_check_constraints("servicios_consulta")}

    with engine.begin() as conn:
        # --- 1. consulta_id -> nullable (no-op si ya lo es) ---
        conn.execute(text(
            "ALTER TABLE servicios_consulta ALTER COLUMN consulta_id DROP NOT NULL"
        ))

        # --- 2. servicios_consulta.mascota_id (FK nullable + index) ---
        if "mascota_id" not in sc_cols:
            conn.execute(text(
                "ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS mascota_id INTEGER "
                "REFERENCES mascotas(id)"
            ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_servicios_consulta_mascota_id "
            "ON servicios_consulta (mascota_id)"
        ))

        # --- 3. servicios_consulta.origen (marcador de reversibilidad) ---
        conn.execute(text(
            "ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS origen VARCHAR(20)"
        ))

        # --- 4. Backfill de mascota_id desde la consulta ---
        conn.execute(text(
            """
            UPDATE servicios_consulta
            SET mascota_id = (
                SELECT c.mascota_id FROM consultas c
                WHERE c.id = servicios_consulta.consulta_id
            )
            WHERE consulta_id IS NOT NULL AND mascota_id IS NULL
            """
        ))

        # --- 5. Backfill de espejos ServicioConsulta ---
        for tabla, tipo, tipos_existentes, expr_nombre, expr_cant, join_inv in _ESPEJOS:
            if tabla not in tables:
                continue
            tipos_lista = ", ".join(f"'{t}'" for t in tipos_existentes)
            conn.execute(text(
                f"""
                INSERT INTO servicios_consulta
                    (consulta_id, mascota_id, tipo_servicio, referencia_id,
                     nombre_servicio, cantidad, precio_unitario, estado,
                     facturado, is_deleted, origen)
                SELECT
                    d.consulta_id, c.mascota_id, '{tipo}', d.id,
                    {expr_nombre}, {expr_cant}, COALESCE(d.precio_aplicado, 0),
                    'Aplicado', COALESCE(d.facturado, false), false, 'MIGRACION_09'
                FROM {tabla} d
                JOIN consultas c ON c.id = d.consulta_id
                {join_inv}
                WHERE d.consulta_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM servicios_consulta s
                    WHERE s.referencia_id = d.id
                      AND s.consulta_id = d.consulta_id
                      AND s.tipo_servicio IN ({tipos_lista})
                  )
                """
            ))

        # --- 6. CHECK ck_servicio_consulta_scope (tras los backfills) ---
        if "ck_servicio_consulta_scope" not in sc_checks:
            conn.execute(text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'ck_servicio_consulta_scope'
                    ) THEN
                        ALTER TABLE servicios_consulta
                        ADD CONSTRAINT ck_servicio_consulta_scope
                        CHECK (consulta_id IS NOT NULL OR mascota_id IS NOT NULL);
                    END IF;
                END $$;
                """
            ))

        # --- 7. consultas.estado (historico 'CERRADA', default 'ABIERTA') ---
        if "estado" not in consulta_cols:
            conn.execute(text(
                "ALTER TABLE consultas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) "
                "NOT NULL DEFAULT 'CERRADA'"
            ))
            conn.execute(text(
                "ALTER TABLE consultas ALTER COLUMN estado SET DEFAULT 'ABIERTA'"
            ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_consultas_estado ON consultas (estado)"
        ))

        # --- 8. servicios_consulta.created_at (migracion e1f2a3b4c5d6): fecha
        # propia para el timeline unificado de la pestana "Servicios". ---
        if "created_at" not in sc_cols:
            conn.execute(text(
                "ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS created_at "
                "TIMESTAMPTZ NOT NULL DEFAULT now()"
            ))
            conn.execute(text(
                """
                UPDATE servicios_consulta sc
                SET created_at = c.fecha_consulta
                FROM consultas c
                WHERE sc.consulta_id = c.id AND c.fecha_consulta IS NOT NULL
                """
            ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_servicios_consulta_mascota_created "
            "ON servicios_consulta (mascota_id, created_at)"
        ))
