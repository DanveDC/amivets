"""Add abonos table for partial payments

Revision ID: a1b2c3d4e5f6
Revises: 9f8e7d6c5b4a
Create Date: 2026-06-22 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '9f8e7d6c5b4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'abonos' not in existing_tables:
        op.create_table(
            'abonos',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('numero_abono', sa.String(50), unique=True, nullable=True),
            sa.Column('factura_id', sa.Integer(), sa.ForeignKey('facturas.id'), nullable=False),
            sa.Column('monto', sa.Numeric(10, 2), nullable=False),
            sa.Column('metodo_pago', sa.String(50), nullable=False),
            sa.Column('fecha', sa.DateTime(), nullable=True),
            sa.Column('notas', sa.Text(), nullable=True),
        )

    # Note: factura.estado is a plain VARCHAR(20). PARCIAL is now a valid value.
    # No constraint change required — the column accepts any string <= 20 chars.


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'abonos' in existing_tables:
        op.drop_table('abonos')
