"""Add orden_id to abonos table (facturacion-metodos-gestores-saldo)

Agrega `abonos.orden_id` (FK ordenes_servicio, nullable, indexada): permite
registrar un abono directamente sobre una orden ademas de su factura
(factura_id sigue NOT NULL -- ver design.md decision 4). Util para pagos
"pre-factura" de ordenes CERRADA, ej. ventas de servicio directo.

Revision ID: a2b3c4d5e6f7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLA = 'abonos'
_COLUMNA = 'orden_id'
_FK = 'fk_abonos_orden'
_INDICE = 'ix_abonos_orden_id'


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns(_TABLA)}
    fks = {fk['name'] for fk in inspector.get_foreign_keys(_TABLA)}
    indices = {idx['name'] for idx in inspector.get_indexes(_TABLA)}

    if _COLUMNA not in cols:
        op.add_column(_TABLA, sa.Column(_COLUMNA, sa.Integer(), nullable=True))
    if _FK not in fks:
        op.create_foreign_key(_FK, _TABLA, 'ordenes_servicio', [_COLUMNA], ['id'])
    if _INDICE not in indices:
        op.create_index(_INDICE, _TABLA, [_COLUMNA])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns(_TABLA)}
    fks = {fk['name'] for fk in inspector.get_foreign_keys(_TABLA)}
    indices = {idx['name'] for idx in inspector.get_indexes(_TABLA)}

    if _INDICE in indices:
        op.drop_index(_INDICE, table_name=_TABLA)
    if _FK in fks:
        op.drop_constraint(_FK, _TABLA, type_='foreignkey')
    if _COLUMNA in cols:
        op.drop_column(_TABLA, _COLUMNA)
