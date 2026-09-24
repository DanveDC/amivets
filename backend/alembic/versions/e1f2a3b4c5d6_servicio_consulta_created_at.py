"""servicios_consulta.created_at para la historia unificada de servicios (Tarea 09)

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-10 13:00:00.000000

La pestaña "Servicios" de la ficha del paciente (Tarea 09) reemplaza las 6
pestañas por tipo (vacunas, cirugías, laboratorio, etc.) por un timeline único
filtrable. Ese timeline necesita una fecha por servicio: `ServicioConsulta` no
tenía ninguna propia (la fecha vivía en la consulta, y un servicio directo no
tiene consulta).

- Agrega `servicios_consulta.created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Backfill: los servicios anexados a una consulta heredan `consulta.fecha_consulta`;
  el resto queda con el `now()` del ALTER (no hay directos históricos).
- Índice `(mascota_id, created_at)` para el feed ordenado por fecha del paciente.

Estilo: manual, guardas de idempotencia con inspector, sin batch, Postgres,
downgrade() implementado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "created_at" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
        # Los servicios anexados a una consulta toman la fecha de esa consulta.
        op.execute(
            sa.text(
                """
                UPDATE servicios_consulta sc
                SET created_at = c.fecha_consulta
                FROM consultas c
                WHERE sc.consulta_id = c.id
                  AND c.fecha_consulta IS NOT NULL
                """
            )
        )

    if "ix_servicios_consulta_mascota_created" not in sc_indexes:
        op.create_index(
            "ix_servicios_consulta_mascota_created",
            "servicios_consulta",
            ["mascota_id", "created_at"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "ix_servicios_consulta_mascota_created" in sc_indexes:
        op.drop_index("ix_servicios_consulta_mascota_created", table_name="servicios_consulta")
    if "created_at" in sc_cols:
        op.drop_column("servicios_consulta", "created_at")
