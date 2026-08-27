"""Make consultas.veterinario_id NOT NULL

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Se confirmo (Round 1 review, Unidad E) que la tabla consultas esta
    # vacia en produccion todavia -- no hace falta backfill antes de exigir
    # NOT NULL. Una consulta sin veterinario_id queda impagable en
    # Liquidaciones (join exacto contra Usuario.id), asi que a partir de
    # ahora se rechaza tanto a nivel API (schema) como de base de datos.
    op.alter_column(
        'consultas',
        'veterinario_id',
        existing_type=sa.Integer(),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'consultas',
        'veterinario_id',
        existing_type=sa.Integer(),
        nullable=True,
    )
