"""Add notas_clinicas table (Unidad B, tarea 05)

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'notas_clinicas' not in existing_tables:
        op.create_table(
            'notas_clinicas',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('mascota_id', sa.Integer(), sa.ForeignKey('mascotas.id'), nullable=False),
            # Nullable a proposito: la mayoria de las notas ("la dueña
            # llamo") no nace dentro de una consulta formal. Ver
            # NotaClinica en models.py.
            sa.Column('consulta_id', sa.Integer(), sa.ForeignKey('consultas.id'), nullable=True),
            sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
            sa.Column('categoria', sa.String(20), nullable=False, server_default='general'),
            sa.Column('texto', sa.Text(), nullable=False),
            sa.Column('fecha_creacion', sa.DateTime(timezone=True), server_default=sa.func.now()),
            # Borrado logico -- mismo patron que servicios_consulta.is_deleted.
            sa.Column('is_deleted', sa.Boolean(), server_default=sa.false()),
            # Rastro de edicion/borrado en la misma fila, sin tabla de
            # historial aparte (el proyecto no tiene precedente de eso).
            sa.Column('fecha_edicion', sa.DateTime(timezone=True), nullable=True),
            sa.Column('editado_por_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
        )
        op.create_index('ix_notas_clinicas_mascota_id', 'notas_clinicas', ['mascota_id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'notas_clinicas' in existing_tables:
        op.drop_table('notas_clinicas')
