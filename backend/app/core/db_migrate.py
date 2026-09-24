"""Aplicar migraciones Alembic en el arranque.

Reemplaza a los replicantes de DDL hechos a mano (Tarea 08
`price_history_backfill`, Tarea 09 `servicios_consulta_schema`): ahora las
migraciones bajo `backend/alembic/versions/` son la única fuente de verdad del
esquema y se aplican solas en cada deploy.

Lógica:
- Base sin `alembic_version` (la armó `create_all`, o es legacy sin sellar): el
  esquema ya está al día con el modelo → `alembic stamp head` (solo marca).
- Base sellada: `alembic upgrade head` → corre lo que falte.

Se llama justo después de `Base.metadata.create_all` en `scripts/init_db.py`.
Si una migración falla, la excepción sube: es preferible que el contenedor no
arranque a que sirva sobre un esquema a medio migrar.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys

from sqlalchemy import text

logger = logging.getLogger(__name__)

# .../backend  (este archivo es .../backend/app/core/db_migrate.py)
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_migrations(engine) -> None:
    """Sella (base nueva) o aplica migraciones pendientes (base existente)."""
    with engine.connect() as conn:
        tabla_existe = conn.execute(
            text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
        ).scalar()
        sellada = bool(
            tabla_existe
            and conn.execute(text("SELECT count(*) FROM alembic_version")).scalar()
        )

    accion = "upgrade" if sellada else "stamp"
    logger.info(
        "Alembic: %s head (base %s)", accion, "sellada" if sellada else "sin sellar"
    )
    subprocess.run(
        [sys.executable, "-m", "alembic", accion, "head"],
        cwd=_BACKEND_DIR,
        check=True,
    )
