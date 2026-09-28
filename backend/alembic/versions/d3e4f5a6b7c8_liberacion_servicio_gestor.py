"""Auditoría de liberación de servicio tomado (toma-exclusiva-servicio-gestor)

Agrega `servicios_consulta.liberado_at` (DateTime, nullable) y
`liberado_por_id` (FK usuarios, nullable): quién y cuándo devolvió un
servicio EN_PROCESO a ASIGNADO/asignado_a_id=NULL vía POST
/api/servicios/{id}/liberar. Índice en `liberado_at` para las consultas de
auditoría (misma necesidad que `servicios_realizados`, que ya filtra por
`ejecutado_at`).

No se toca `estado`: la liberación vuelve a ASIGNADO, no agrega un valor
nuevo al CHECK -- ver design.md, decisión 4 (no se usa CANCELADA, ese estado
ya significa borrado lógico).

Revision ID: d3e4f5a6b7c8
Revises: c8d7e6f5a4b3
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c8d7e6f5a4b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "liberado_at" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column("liberado_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "liberado_por_id" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column("liberado_por_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        )
    if "ix_servicios_consulta_liberado_at" not in sc_indexes:
        op.create_index(
            "ix_servicios_consulta_liberado_at",
            "servicios_consulta",
            ["liberado_at"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "ix_servicios_consulta_liberado_at" in sc_indexes:
        op.drop_index("ix_servicios_consulta_liberado_at", table_name="servicios_consulta")
    if "liberado_por_id" in sc_cols:
        op.drop_column("servicios_consulta", "liberado_por_id")
    if "liberado_at" in sc_cols:
        op.drop_column("servicios_consulta", "liberado_at")
