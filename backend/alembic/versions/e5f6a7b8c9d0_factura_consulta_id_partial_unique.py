"""Add partial unique index on facturas.consulta_id (non-ANULADA)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backstop a nivel DB del guard de crear_factura (Round 2, Unidad E):
    # el chequeo "no tiene factura activa" en la app es check-then-insert,
    # sin esto dos requests casi simultaneos podrian pasarlo ambos.
    op.create_index(
        'ix_facturas_consulta_id_activa_unica',
        'facturas',
        ['consulta_id'],
        unique=True,
        postgresql_where=sa.text("estado != 'ANULADA'"),
    )


def downgrade() -> None:
    op.drop_index('ix_facturas_consulta_id_activa_unica', table_name='facturas')
