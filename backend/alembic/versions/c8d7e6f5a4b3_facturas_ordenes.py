"""Vínculo explícito factura -> orden (fix de revisión): antes la orden de una
factura se deducía por sus líneas de servicio, y una venta de caja rápida solo
con productos no tiene ninguna.

Backfill: se vincula cada factura existente cuyas líneas de servicio sean
todas de UNA misma orden (el mismo criterio que usaba anular_factura para
deducirla). Las facturas sin líneas de servicio (ventas de caja solo de
productos anteriores a esta migración) no tienen de dónde sacar la orden y
quedan sin vínculo.

Revision ID: c8d7e6f5a4b3
Revises: b7c6d5e4f3a2
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c8d7e6f5a4b3'
down_revision: Union[str, None] = 'b7c6d5e4f3a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guarda: en dev create_all puede haberla creado antes.
    if 'facturas_ordenes' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'facturas_ordenes',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('factura_id', sa.Integer(), sa.ForeignKey('facturas.id'), nullable=False),
            sa.Column('orden_id', sa.Integer(), sa.ForeignKey('ordenes_servicio.id'), nullable=False),
        )
        op.create_index('ix_facturas_ordenes_factura_id', 'facturas_ordenes', ['factura_id'], unique=True)
        op.create_index('ix_facturas_ordenes_orden_id', 'facturas_ordenes', ['orden_id'])

    # Backfill idempotente: solo facturas todavía sin vínculo.
    op.execute(
        """
        INSERT INTO facturas_ordenes (factura_id, orden_id)
        SELECT d.factura_id, MIN(s.orden_id)
        FROM detalles_factura d
        JOIN servicios_consulta s ON s.id = d.servicio_id
        WHERE s.orden_id IS NOT NULL
          AND d.factura_id NOT IN (SELECT factura_id FROM facturas_ordenes)
        GROUP BY d.factura_id
        HAVING COUNT(DISTINCT s.orden_id) = 1
        """
    )


def downgrade() -> None:
    if 'facturas_ordenes' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('facturas_ordenes')
