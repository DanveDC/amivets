"""Sync billing and clinical fields

Revision ID: 9f8e7d6c5b4a
Revises: 6d4c5b3a2e1f
Create Date: 2026-04-09 02:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '9f8e7d6c5b4a'
down_revision: Union[str, None] = '6d4c5b3a2e1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Facturas
    existing_facturas = [c['name'] for c in inspector.get_columns('facturas')]
    if 'total_pagado' not in existing_facturas:
        op.add_column('facturas', sa.Column('total_pagado', sa.Float(), server_default='0.0'))
    if 'saldo_pendiente' not in existing_facturas:
        op.add_column('facturas', sa.Column('saldo_pendiente', sa.Float(), server_default='0.0'))
    
    # Consultas
    existing_consultas = [c['name'] for c in inspector.get_columns('consultas')]
    if 'estado_pago' not in existing_consultas:
        op.add_column('consultas', sa.Column('estado_pago', sa.String(50), server_default='POR_COBRAR'))
    if 'precio_consulta' not in existing_consultas:
        op.add_column('consultas', sa.Column('precio_consulta', sa.Float(), server_default='0.0'))
    
    # Servicios Consulta
    existing_servicios = [c['name'] for c in inspector.get_columns('servicios_consulta')]
    if 'detalles_clinicos' not in existing_servicios:
        op.add_column('servicios_consulta', sa.Column('detalles_clinicos', sa.Text(), nullable=True))
    if 'facturado' not in existing_servicios:
        op.add_column('servicios_consulta', sa.Column('facturado', sa.Boolean(), server_default='false'))
    if 'is_deleted' not in existing_servicios:
        op.add_column('servicios_consulta', sa.Column('is_deleted', sa.Boolean(), server_default='false'))
    
    # Mascotas
    existing_mascotas = [c['name'] for c in inspector.get_columns('mascotas')]
    if 'microchip' not in existing_mascotas:
        op.add_column('mascotas', sa.Column('microchip', sa.String(50), nullable=True))

def downgrade() -> None:
    op.drop_column('mascotas', 'microchip')
    op.drop_column('servicios_consulta', 'is_deleted')
    op.drop_column('servicios_consulta', 'facturado')
    op.drop_column('servicios_consulta', 'detalles_clinicos')
    op.drop_column('consultas', 'precio_consulta')
    op.drop_column('consultas', 'estado_pago')
    op.drop_column('facturas', 'saldo_pendiente')
    op.drop_column('facturas', 'total_pagado')
