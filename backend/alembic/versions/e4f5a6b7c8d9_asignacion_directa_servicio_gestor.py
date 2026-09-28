"""Asignación directa de un servicio a un gestor (asignacion-directa-servicio-gestor)

Agrega `servicios_consulta.asignado_directo_a_id` (FK usuarios, nullable,
indexada): a quién se DESPACHÓ el servicio al confirmar la orden, cuando quien
confirma elige un gestor puntual en vez de dejarlo "al área". Distinta de
`asignado_a_id`, que sigue significando quién lo TOMÓ (routers/servicios.py::
tomar_servicio) -- ver design.md, decisión 1.

Nullable sin backfill: todo lo existente queda "al área", que es el
comportamiento actual (Migration Plan, paso 1).

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "asignado_directo_a_id" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column("asignado_directo_a_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        )
    if "ix_servicios_consulta_asignado_directo_a_id" not in sc_indexes:
        op.create_index(
            "ix_servicios_consulta_asignado_directo_a_id",
            "servicios_consulta",
            ["asignado_directo_a_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    if "ix_servicios_consulta_asignado_directo_a_id" in sc_indexes:
        op.drop_index("ix_servicios_consulta_asignado_directo_a_id", table_name="servicios_consulta")
    if "asignado_directo_a_id" in sc_cols:
        op.drop_column("servicios_consulta", "asignado_directo_a_id")
