"""Consumo previsto al agregar un servicio a una orden (fix de revisión: el
consumo real indicado al agregar se perdía y al ejecutar se descontaba la
receta estándar).

Revision ID: b7c6d5e4f3a2
Revises: a9b8c7d6e5f4
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b7c6d5e4f3a2'
down_revision: Union[str, None] = 'a9b8c7d6e5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guarda: en dev create_all puede haberla creado antes.
    if 'consumos_previstos' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'consumos_previstos',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('servicio_consulta_id', sa.Integer(), sa.ForeignKey('servicios_consulta.id'), nullable=False),
            sa.Column('inventario_id', sa.Integer(), sa.ForeignKey('inventario.id'), nullable=False),
            sa.Column('cantidad', sa.Numeric(12, 3), nullable=False),
            sa.UniqueConstraint('servicio_consulta_id', 'inventario_id', name='uq_consumo_previsto_servicio_inventario'),
        )
        op.create_index('ix_consumos_previstos_servicio_consulta_id', 'consumos_previstos', ['servicio_consulta_id'])


def downgrade() -> None:
    if 'consumos_previstos' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('consumos_previstos')
