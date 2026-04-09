"""Add clinical tabs logic

Revision ID: 8ae206b11dda
Revises: 
Create Date: 2026-03-18 03:08:49.512806

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8ae206b11dda'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Obtener el inspector para verificar existencia de columnas
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Verificar columnas en 'cirugias'
    existing_cols_cirugias = [c['name'] for c in inspector.get_columns('cirugias')]
    if 'precio_aplicado' not in existing_cols_cirugias:
        op.add_column('cirugias', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
    if 'facturado' not in existing_cols_cirugias:
        op.add_column('cirugias', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))
    
    # Verificar columnas en 'hospitalizaciones'
    existing_cols_hosp = [c['name'] for c in inspector.get_columns('hospitalizaciones')]
    if 'precio_aplicado' not in existing_cols_hosp:
        op.add_column('hospitalizaciones', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
    if 'facturado' not in existing_cols_hosp:
        op.add_column('hospitalizaciones', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))
    if 'consulta_id' not in existing_cols_hosp:
        op.add_column('hospitalizaciones', sa.Column('consulta_id', sa.Integer(), nullable=True))
        try:
            op.create_foreign_key('fk_hospitalizaciones_consulta', 'hospitalizaciones', 'consultas', ['consulta_id'], ['id'])
        except:
            pass
            
    # Verificar columnas en 'pruebas_complementarias'
    existing_cols_pruebas = [c['name'] for c in inspector.get_columns('pruebas_complementarias')]
    if 'precio_aplicado' not in existing_cols_pruebas:
        op.add_column('pruebas_complementarias', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
    if 'facturado' not in existing_cols_pruebas:
        op.add_column('pruebas_complementarias', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))

    # Maneño de indices/constraints
    try:
        op.drop_constraint('mascotas_codigo_historia_key', 'mascotas', type_='unique')
    except:
        pass
    try:
        op.create_index(op.f('ix_mascotas_codigo_historia'), 'mascotas', ['codigo_historia'], unique=True)
    except:
        pass
    try:
        op.create_unique_constraint('uq_mascotas_microchip', 'mascotas', ['microchip'])
    except:
        pass

    op.alter_column('citas', 'veterinario_id',
               existing_type=sa.INTEGER(),
               nullable=False)

def downgrade() -> None:
    pass
