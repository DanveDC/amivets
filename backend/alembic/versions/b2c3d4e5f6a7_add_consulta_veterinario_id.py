"""Add veterinario_id FK to consultas

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_consultas = [c['name'] for c in inspector.get_columns('consultas')]

    if 'veterinario_id' not in existing_consultas:
        op.add_column(
            'consultas',
            sa.Column('veterinario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True)
        )

    # Note: Consulta.veterinario (free-text String(100)) is kept for audit/legacy
    # purposes. No data backfill is needed here: the consultas table is empty
    # (see docs/tareas/04-kpis-recetas-y-veterinarios.md, Obstaculo 1).


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_consultas = [c['name'] for c in inspector.get_columns('consultas')]

    if 'veterinario_id' in existing_consultas:
        op.drop_column('consultas', 'veterinario_id')
