"""Backfill del ancla inicial del historial de precios (Tarea 08, decision 7).

El repo despliega SIN correr `alembic upgrade`: `start.sh` llama a
`scripts/init_db.py` (que solo hace `Base.metadata.create_all`) y luego uvicorn
re-corre `create_all` al importar `app.main`. El `INSERT ... SELECT` que la
migracion `c9d0e1f2a3b4` ejecuta dentro de `upgrade()` por lo tanto nunca corre,
y toda `Inventario` / `CatalogoServicio` pre-existente queda sin ancla de
historial. Es un hueco conocido del repo (docs/tareas/04-kpis-recetas-y-
veterinarios.md).

Este modulo replica ese backfill de forma idempotente para invocarlo justo
despues de `create_all`, tanto en `app.main` como en `scripts/init_db.py`. El
`WHERE NOT EXISTS` hace que re-correrlo sea un no-op. La migracion Alembic
queda intacta y sigue siendo el head registrado.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# (tabla_historial, tabla_entidad, columna_fk, columna_precio, columna_fecha)
# Mismos pares que `_BACKFILL` en la migracion c9d0e1f2a3b4.
_BACKFILL = [
    (
        "historial_precio_inventario",
        "inventario",
        "inventario_id",
        "precio_unitario",
        "fecha_registro",
    ),
    (
        "historial_precio_servicio",
        "catalogo_servicios",
        "catalogo_servicio_id",
        "precio_ref",
        "created_at",
    ),
]


def backfill_initial_price_history(engine) -> None:
    """Inserta un ancla de precio inicial por entidad que aun no tenga historial.

    Equivalente al `INSERT ... SELECT` del `upgrade()` de la migracion
    `c9d0e1f2a3b4`: `precio_nuevo = COALESCE(precio actual, 0)`,
    `precio_anterior = NULL`, `usuario_id = NULL`,
    `motivo = 'registro inicial (migracion)'`,
    `fecha_cambio = COALESCE(fecha de nacimiento de la entidad, now())`.

    Idempotente via `WHERE NOT EXISTS`: re-correrlo no duplica anclas. Si alguna
    tabla de historial (o su entidad) todavia no existe, se omite en silencio
    -- `create_all` corre justo antes, asi que en la practica siempre existen.
    Toda la operacion va en una sola transaccion (`engine.begin()`).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for tabla_hist, tabla_ent, col_fk, col_precio, col_fecha in _BACKFILL:
            if tabla_hist not in existing_tables or tabla_ent not in existing_tables:
                logger.warning(
                    "price_history backfill: falta la tabla %s o %s, se omite",
                    tabla_hist,
                    tabla_ent,
                )
                continue
            conn.execute(
                text(
                    f"""
                    INSERT INTO {tabla_hist}
                        ({col_fk}, precio_nuevo, precio_anterior, motivo, usuario_id, fecha_cambio)
                    SELECT
                        e.id,
                        COALESCE(e.{col_precio}, 0),
                        NULL,
                        'registro inicial (migracion)',
                        NULL,
                        COALESCE(e.{col_fecha}, now())
                    FROM {tabla_ent} AS e
                    WHERE NOT EXISTS (
                        SELECT 1 FROM {tabla_hist} AS h WHERE h.{col_fk} = e.id
                    )
                    """
                )
            )
