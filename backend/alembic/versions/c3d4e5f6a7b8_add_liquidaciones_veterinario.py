"""Add tarifa_consulta and liquidaciones tables (Unidad E)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    existing_usuarios_cols = [c['name'] for c in inspector.get_columns('usuarios')]
    if 'tarifa_consulta' not in existing_usuarios_cols:
        op.add_column(
            'usuarios',
            sa.Column('tarifa_consulta', sa.Numeric(10, 2), nullable=True)
        )
    # Note: NULL significa "tarifa no configurada" -- el calculo de
    # liquidacion rechaza explicitamente a un veterinario en ese estado en
    # vez de asumir 0 (Unidad E, docs/tareas/04-kpis-recetas-y-veterinarios.md).

    if 'liquidaciones' not in existing_tables:
        op.create_table(
            'liquidaciones',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('veterinario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
            sa.Column('fecha_inicio', sa.DateTime(timezone=True), nullable=False),
            sa.Column('fecha_fin', sa.DateTime(timezone=True), nullable=False),
            sa.Column('fecha_calculo', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('total', sa.Numeric(10, 2), nullable=False, server_default='0'),
        )

    if 'liquidacion_detalles' not in existing_tables:
        op.create_table(
            'liquidacion_detalles',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('liquidacion_id', sa.Integer(), sa.ForeignKey('liquidaciones.id'), nullable=False),
            # unique=True: una consulta no puede aparecer en mas de un
            # detalle de liquidacion jamas -- candado de ultima linea contra
            # el doble pago si la logica de aplicacion fallara (Unidad E,
            # docs/tareas/04-kpis-recetas-y-veterinarios.md).
            sa.Column('consulta_id', sa.Integer(), sa.ForeignKey('consultas.id'), nullable=False, unique=True),
            sa.Column('factura_id', sa.Integer(), sa.ForeignKey('facturas.id'), nullable=False),
            # Copia (snapshot) de Usuario.tarifa_consulta al momento del
            # calculo, no una referencia viva. Cambiar la tarifa del
            # veterinario despues no puede alterar lo ya liquidado.
            sa.Column('tarifa_aplicada', sa.Numeric(10, 2), nullable=False),
            sa.Column('fecha_consulta', sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'liquidacion_detalles' in existing_tables:
        op.drop_table('liquidacion_detalles')
    if 'liquidaciones' in existing_tables:
        op.drop_table('liquidaciones')

    existing_usuarios_cols = [c['name'] for c in inspector.get_columns('usuarios')]
    if 'tarifa_consulta' in existing_usuarios_cols:
        op.drop_column('usuarios', 'tarifa_consulta')
