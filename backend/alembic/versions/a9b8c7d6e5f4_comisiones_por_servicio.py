"""Comisiones por servicio: configuracion, porcentaje por encargado y
liquidaciones de comisiones (comisiones-por-servicio, decision 1)

Revision ID: a9b8c7d6e5f4
Revises: c5d6e1f2a3b4
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, None] = 'c5d6e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    existing_tables = sa.inspect(conn).get_table_names()

    # Guardas por tabla: en dev create_all puede haberlas creado antes.
    if 'configuracion_comision' not in existing_tables:
        op.create_table(
            'configuracion_comision',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('porcentaje_defecto', sa.Numeric(5, 2), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
            sa.CheckConstraint('porcentaje_defecto >= 0 AND porcentaje_defecto <= 100', name='ck_config_comision_rango'),
        )

    if 'comision_encargados' not in existing_tables:
        op.create_table(
            'comision_encargados',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
            sa.Column('porcentaje', sa.Numeric(5, 2), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.CheckConstraint('porcentaje >= 0 AND porcentaje <= 100', name='ck_comision_encargado_rango'),
        )
        op.create_index('ix_comision_encargados_usuario_id', 'comision_encargados', ['usuario_id'], unique=True)

    if 'liquidaciones_comision' not in existing_tables:
        op.create_table(
            'liquidaciones_comision',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('encargado_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
            sa.Column('desde', sa.Date(), nullable=False),
            sa.Column('hasta', sa.Date(), nullable=False),
            sa.Column('fecha_calculo', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('creada_por_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
            sa.Column('total_encargado', sa.Numeric(12, 2), nullable=False, server_default='0'),
            sa.Column('total_amivets', sa.Numeric(12, 2), nullable=False, server_default='0'),
        )
        op.create_index('ix_liquidaciones_comision_id', 'liquidaciones_comision', ['id'])
        op.create_index('ix_liquidaciones_comision_encargado_id', 'liquidaciones_comision', ['encargado_id'])

    if 'liquidacion_comision_detalles' not in existing_tables:
        op.create_table(
            'liquidacion_comision_detalles',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('liquidacion_id', sa.Integer(), sa.ForeignKey('liquidaciones_comision.id'), nullable=False),
            sa.Column('servicio_id', sa.Integer(), sa.ForeignKey('servicios_consulta.id'), nullable=False),
            sa.Column('factura_id', sa.Integer(), sa.ForeignKey('facturas.id'), nullable=False),
            sa.Column('orden_id', sa.Integer(), sa.ForeignKey('ordenes_servicio.id'), nullable=True),
            sa.Column('descripcion', sa.String(255), nullable=True),
            sa.Column('fecha_cobro', sa.DateTime(timezone=True), nullable=True),
            sa.Column('subtotal', sa.Numeric(12, 2), nullable=False),
            sa.Column('porcentaje', sa.Numeric(5, 2), nullable=False),
            sa.Column('monto_encargado', sa.Numeric(12, 2), nullable=False),
            sa.Column('monto_amivets', sa.Numeric(12, 2), nullable=False),
            sa.Column('es_ajuste', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_liquidacion_comision_detalles_id', 'liquidacion_comision_detalles', ['id'])
        op.create_index('ix_liquidacion_comision_detalles_liquidacion_id', 'liquidacion_comision_detalles', ['liquidacion_id'])
        # Candado contra el doble pago (decision 2).
        op.create_index(
            'uq_liq_comision_linea', 'liquidacion_comision_detalles', ['servicio_id', 'factura_id'],
            unique=True, postgresql_where=sa.text('es_ajuste = false'),
        )
        op.create_index(
            'uq_liq_comision_ajuste', 'liquidacion_comision_detalles', ['servicio_id', 'factura_id'],
            unique=True, postgresql_where=sa.text('es_ajuste = true'),
        )


def downgrade() -> None:
    existing_tables = sa.inspect(op.get_bind()).get_table_names()
    for tabla in ('liquidacion_comision_detalles', 'liquidaciones_comision', 'comision_encargados', 'configuracion_comision'):
        if tabla in existing_tables:
            op.drop_table(tabla)
