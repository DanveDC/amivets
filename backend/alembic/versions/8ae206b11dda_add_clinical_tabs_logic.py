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
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # 1. Verificar y añadir columnas en 'cirugias'
    existing_all_tables = inspector.get_table_names()
    
    if 'cirugias' in existing_all_tables:
        existing_cols_cirugias = [c['name'] for c in inspector.get_columns('cirugias')]
        if 'precio_aplicado' not in existing_cols_cirugias:
            op.add_column('cirugias', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
        if 'facturado' not in existing_cols_cirugias:
            op.add_column('cirugias', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))
    
    # 2. Verificar y añadir columnas en 'hospitalizaciones'
    if 'hospitalizaciones' in existing_all_tables:
        existing_cols_hosp = [c['name'] for c in inspector.get_columns('hospitalizaciones')]
        if 'precio_aplicado' not in existing_cols_hosp:
            op.add_column('hospitalizaciones', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
        if 'facturado' not in existing_cols_hosp:
            op.add_column('hospitalizaciones', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))
        if 'consulta_id' not in existing_cols_hosp:
            op.add_column('hospitalizaciones', sa.Column('consulta_id', sa.Integer(), nullable=True))
            # Verificar FK antes de crearla
            existing_fks = [fk['name'] for fk in inspector.get_foreign_keys('hospitalizaciones')]
            fk_name = 'fk_hospitalizaciones_consulta'
            if not any(fk['name'] == fk_name for fk in inspector.get_foreign_keys('hospitalizaciones')):
                op.create_foreign_key(fk_name, 'hospitalizaciones', 'consultas', ['consulta_id'], ['id'])

    # 3. Manejo de Mascotas (índices y restricciones)
    if 'mascotas' in existing_all_tables:
        existing_indices = [idx['name'] for idx in inspector.get_indexes('mascotas')]
        if 'ix_mascotas_codigo_historia' not in existing_indices:
            op.create_index('ix_mascotas_codigo_historia', 'mascotas', ['codigo_historia'], unique=True)

        # Para las restricciones únicas, el inspector de SQLAlchemy puede ser variable según el driver
        existing_uqs = [uq['name'] for uq in inspector.get_unique_constraints('mascotas')]
        uq_name = 'uq_mascotas_microchip'
        if not any(uq['name'] == uq_name for uq in inspector.get_unique_constraints('mascotas')):
            # Solo creamos si la columna existe (necesario si se arrancó de cero)
            existing_cols_mascotas = [c['name'] for c in inspector.get_columns('mascotas')]
            if 'microchip' in existing_cols_mascotas:
                op.create_unique_constraint(uq_name, 'mascotas', ['microchip'])

    # 4. Ajuste en Citas (solo si no es ya NOT NULL)
    if 'citas' in existing_all_tables:
        cols_citas = inspector.get_columns('citas')
        col_citas = next((c for c in cols_citas if c['name'] == 'veterinario_id'), None)
        if col_citas and col_citas.get('nullable') is True:
            # Usamos un try block solo para este comando específico ya que es el más propenso a fallar
            # pero el inspector debería habernos salvado de la mayoría de errores de transacción
            try:
                op.alter_column('citas', 'veterinario_id', existing_type=sa.INTEGER(), nullable=False)
            except Exception:
                pass

    # 5. Pruebas complementarias
    if 'pruebas_complementarias' in existing_all_tables:
        existing_cols_pruebas = [c['name'] for c in inspector.get_columns('pruebas_complementarias')]
        if 'precio_aplicado' not in existing_cols_pruebas:
            op.add_column('pruebas_complementarias', sa.Column('precio_aplicado', sa.Float(), nullable=False, server_default='0.0'))
        if 'facturado' not in existing_cols_pruebas:
            op.add_column('pruebas_complementarias', sa.Column('facturado', sa.Boolean(), nullable=True, server_default='false'))

def downgrade() -> None:
    pass
