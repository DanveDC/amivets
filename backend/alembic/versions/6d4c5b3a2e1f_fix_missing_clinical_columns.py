"""Fix missing clinical columns

Revision ID: 6d4c5b3a2e1f
Revises: 8ae206b11dda
Create Date: 2026-03-20 12:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '6d4c5b3a2e1f'
down_revision: Union[str, None] = '8ae206b11dda'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Obtener el inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Columnas para cirugias
    existing_cirugias = [c['name'] for c in inspector.get_columns('cirugias')]
    if 'honorarios_medicos' not in existing_cirugias:
        op.add_column('cirugias', sa.Column('honorarios_medicos', sa.Float(), nullable=True, server_default='0.0'))
    if 'costo_anestesia' not in existing_cirugias:
        op.add_column('cirugias', sa.Column('costo_anestesia', sa.Float(), nullable=True, server_default='0.0'))
    if 'costo_insumos' not in existing_cirugias:
        op.add_column('cirugias', sa.Column('costo_insumos', sa.Float(), nullable=True, server_default='0.0'))
    if 'complicaciones' not in existing_cirugias:
        op.add_column('cirugias', sa.Column('complicaciones', sa.Text(), nullable=True))
    
    # Columnas para hospitalizaciones
    existing_hosp = [c['name'] for c in inspector.get_columns('hospitalizaciones')]
    if 'monitoreo_constantes' not in existing_hosp:
        op.add_column('hospitalizaciones', sa.Column('monitoreo_constantes', sa.JSON(), nullable=True))
    if 'observaciones_ingreso' not in existing_hosp:
        op.add_column('hospitalizaciones', sa.Column('observaciones_ingreso', sa.Text(), nullable=True))
    
    # Columnas para consultas
    existing_consultas = [c['name'] for c in inspector.get_columns('consultas')]
    if 'proxima_cita' not in existing_consultas:
        op.add_column('consultas', sa.Column('proxima_cita', sa.DateTime(timezone=True), nullable=True))
    if 'observaciones' not in existing_consultas:
        op.add_column('consultas', sa.Column('observaciones', sa.Text(), nullable=True))

def downgrade() -> None:
    op.drop_column('consultas', 'observaciones')
    op.drop_column('consultas', 'proxima_cita')
    op.drop_column('hospitalizaciones', 'observaciones_ingreso')
    op.drop_column('hospitalizaciones', 'monitoreo_constantes')
    op.drop_column('cirugias', 'complicaciones')
    op.drop_column('cirugias', 'costo_insumos')
    op.drop_column('cirugias', 'costo_anestesia')
    op.drop_column('cirugias', 'honorarios_medicos')
