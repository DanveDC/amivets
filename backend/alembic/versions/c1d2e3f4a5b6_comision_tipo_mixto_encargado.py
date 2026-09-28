"""add tipo_comision and monto_fijo to comision_encargados, catalogo_servicios,
liquidacion_comision_detalles (comision-tipo-mixto-encargado)

- comision_encargados: tipo_comision (FIJO|PORCENTAJE|MIXTO), monto_fijo;
  porcentaje pasa a nullable. Las filas existentes quedan PORCENTAJE.
- catalogo_servicios: override por servicio (FIJO|PORCENTAJE|HEREDA) con su
  monto fijo o porcentaje propio.
- liquidacion_comision_detalles: tipo y monto fijo congelados al liquidar;
  las filas existentes se liquidaron siempre por porcentaje.

Revision ID: c1d2e3f4a5b6
Revises: b4e04370dc32
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b4e04370dc32'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columnas(tabla: str) -> set:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(tabla)}


def upgrade() -> None:
    # --- comision_encargados ---
    cols = _columnas('comision_encargados')
    if 'tipo_comision' not in cols:
        op.add_column('comision_encargados', sa.Column(
            'tipo_comision', sa.String(20), nullable=False, server_default='PORCENTAJE'))
    if 'monto_fijo' not in cols:
        op.add_column('comision_encargados', sa.Column('monto_fijo', sa.Numeric(10, 2), nullable=True))
    op.alter_column('comision_encargados', 'porcentaje', existing_type=sa.Numeric(5, 2), nullable=True)
    op.create_check_constraint(
        'ck_comision_encargado_tipo', 'comision_encargados',
        "tipo_comision IN ('FIJO','PORCENTAJE','MIXTO')",
    )
    op.create_check_constraint(
        'ck_comision_encargado_campos', 'comision_encargados',
        "(tipo_comision = 'FIJO' AND monto_fijo IS NOT NULL AND porcentaje IS NULL) OR "
        "(tipo_comision = 'PORCENTAJE' AND porcentaje IS NOT NULL AND monto_fijo IS NULL) OR "
        "(tipo_comision = 'MIXTO' AND monto_fijo IS NOT NULL AND porcentaje IS NOT NULL)",
    )
    op.create_check_constraint(
        'ck_comision_encargado_monto_fijo', 'comision_encargados',
        'monto_fijo IS NULL OR monto_fijo >= 0',
    )

    # --- catalogo_servicios ---
    cols = _columnas('catalogo_servicios')
    if 'tipo_comision_servicio' not in cols:
        op.add_column('catalogo_servicios', sa.Column(
            'tipo_comision_servicio', sa.String(20), nullable=False, server_default='HEREDA'))
    if 'monto_fijo_servicio' not in cols:
        op.add_column('catalogo_servicios', sa.Column('monto_fijo_servicio', sa.Numeric(10, 2), nullable=True))
    if 'porcentaje_servicio' not in cols:
        op.add_column('catalogo_servicios', sa.Column('porcentaje_servicio', sa.Numeric(5, 2), nullable=True))
    op.create_check_constraint(
        'ck_catalogo_comision_campos', 'catalogo_servicios',
        "(tipo_comision_servicio = 'HEREDA' AND monto_fijo_servicio IS NULL AND porcentaje_servicio IS NULL) OR "
        "(tipo_comision_servicio = 'FIJO' AND monto_fijo_servicio IS NOT NULL AND monto_fijo_servicio >= 0 "
        "AND porcentaje_servicio IS NULL) OR "
        "(tipo_comision_servicio = 'PORCENTAJE' AND porcentaje_servicio IS NOT NULL "
        "AND porcentaje_servicio >= 0 AND porcentaje_servicio <= 100 AND monto_fijo_servicio IS NULL)",
    )

    # --- liquidacion_comision_detalles ---
    # El server_default hace el backfill: todo lo liquidado antes fue PORCENTAJE.
    cols = _columnas('liquidacion_comision_detalles')
    if 'tipo_comision' not in cols:
        op.add_column('liquidacion_comision_detalles', sa.Column(
            'tipo_comision', sa.String(20), nullable=False, server_default='PORCENTAJE'))
    if 'monto_fijo' not in cols:
        op.add_column('liquidacion_comision_detalles', sa.Column('monto_fijo', sa.Numeric(10, 2), nullable=True))
    op.execute("UPDATE liquidacion_comision_detalles SET tipo_comision = 'PORCENTAJE' WHERE tipo_comision IS NULL")


def downgrade() -> None:
    op.drop_column('liquidacion_comision_detalles', 'monto_fijo')
    op.drop_column('liquidacion_comision_detalles', 'tipo_comision')

    op.drop_constraint('ck_catalogo_comision_campos', 'catalogo_servicios', type_='check')
    op.drop_column('catalogo_servicios', 'porcentaje_servicio')
    op.drop_column('catalogo_servicios', 'monto_fijo_servicio')
    op.drop_column('catalogo_servicios', 'tipo_comision_servicio')

    op.drop_constraint('ck_comision_encargado_monto_fijo', 'comision_encargados', type_='check')
    op.drop_constraint('ck_comision_encargado_campos', 'comision_encargados', type_='check')
    op.drop_constraint('ck_comision_encargado_tipo', 'comision_encargados', type_='check')
    # Volver a NOT NULL exige que no haya encargados FIJO: se bajan al default.
    op.execute("DELETE FROM comision_encargados WHERE porcentaje IS NULL")
    op.drop_column('comision_encargados', 'monto_fijo')
    op.drop_column('comision_encargados', 'tipo_comision')
    op.alter_column('comision_encargados', 'porcentaje', existing_type=sa.Numeric(5, 2), nullable=False)
