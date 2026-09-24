"""servicios_consulta.orden_id pasa a NOT NULL (Tarea 06, FASE 2 etapa 4)

Revision ID: c5d6e1f2a3b4
Revises: f7a8b9c0d1e2
Create Date: 2026-09-19 00:00:00.000000

Cierra el diferido explícito que dejó b4c5d6e1f2a3 (backfill, etapa 3) y que
la decisión 3 de docs/diseno/ordenes-de-servicio.md pide desde el principio:
"nullable -> NOT NULL tras backfill".

--------------------------------------------------------------------------
Por qué recién ahora
--------------------------------------------------------------------------
El backfill de la etapa 3 garantizó que las 260 órdenes históricas y sus
servicios quedaran enganchados (0 filas con orden_id NULL al terminar), pero
los endpoints que crean `ServicioConsulta` seguían sin setear orden_id en las
altas NUEVAS. Poner el NOT NULL antes de la etapa 4 habría roto la primera
alta nueva de cualquiera de esos endpoints. La etapa 4 agrega el wiring que le
falta a los 6 routers que quedaban (servicios.py, clinico.py x5, cirugias.py,
hospitalizaciones.py, pruebas.py) y los dos endpoints nuevos que anexan
trabajo directo a una orden (POST /api/ordenes/{id}/servicios y
POST /api/ordenes/{id}/confirmar) — recién con eso toda fila nueva nace con
orden, y esta migración deja de ser prematura.

--------------------------------------------------------------------------
Guard de seguridad
--------------------------------------------------------------------------
Si en el momento de correr esta migración quedara alguna fila con orden_id
NULL (un endpoint sin actualizar, un dato colado por otra vía), el upgrade
ABORTA con un mensaje explícito en vez de dejar que Postgres tire un error de
constraint crudo, o -- peor -- que alguien corra esta migración contra una
base que todavía no tiene el código de la etapa 4 y pierda filas en silencio.

Idempotencia: se lee el estado real de la columna vía el inspector antes de
tocar nada (mismo patrón que f2a3b4c5d6e1); si ya es NOT NULL, upgrade() es
un no-op.

Reversible: downgrade() vuelve la columna a nullable, simétrico.

Estilo (docs/tecnico/inventario-actual.md §5): manual, sin autogenerate, sin
batch_alter_table (target Postgres), downgrade() implementado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c5d6e1f2a3b4'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLA = "servicios_consulta"
_COLUMNA = "orden_id"


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    columnas = {c["name"]: c for c in inspector.get_columns(_TABLA)}
    columna = columnas.get(_COLUMNA)
    if columna is None:
        raise RuntimeError(
            f"{_TABLA}.{_COLUMNA} no existe: corré primero f2a3b4c5d6e1 "
            "(esquema aditivo de órdenes de servicio)."
        )
    if columna["nullable"] is False:
        return  # ya está NOT NULL: no-op (idempotencia)

    huerfanas = conn.execute(
        sa.text(f"SELECT COUNT(*) FROM {_TABLA} WHERE {_COLUMNA} IS NULL")
    ).scalar()
    if huerfanas:
        raise RuntimeError(
            f"No se puede poner {_TABLA}.{_COLUMNA} en NOT NULL: quedan "
            f"{huerfanas} fila(s) sin orden. Corré el backfill (b4c5d6e1f2a3) "
            "si son históricas, o revisá qué endpoint las creó sin pasar por "
            "una orden (Tarea 06, etapa 4) antes de reintentar esta migración."
        )

    op.alter_column(
        _TABLA,
        _COLUMNA,
        existing_type=sa.Integer(),
        nullable=False,
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    columnas = {c["name"]: c for c in inspector.get_columns(_TABLA)}
    columna = columnas.get(_COLUMNA)
    if columna is not None and columna["nullable"] is False:
        op.alter_column(
            _TABLA,
            _COLUMNA,
            existing_type=sa.Integer(),
            nullable=True,
        )
