"""Add servicio_padre_id and es_base to servicios_consulta (servicio-base-paquete-items)

Jerarquía padre/hijo para distinguir un "servicio base/paquete" (es_base=true)
de sus "items adicionales" (servicio_padre_id -> id de un base de la MISMA
orden). Solo la regla de una fila (base sin padre) entra en un CHECK --
PostgreSQL rechaza subqueries dentro de un CHECK, así que "padre es_base",
"misma orden" y "un solo nivel" se validan en
orden_service.crear_servicio_en_orden, no en la DB (ver design.md).

Revision ID: b7c8d9e0f1a2
Revises: a2b3c4d5e6f7
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLA = 'servicios_consulta'
_COL_PADRE = 'servicio_padre_id'
_COL_BASE = 'es_base'
_FK = 'fk_servicios_consulta_padre'
_INDICE = 'ix_servicios_consulta_servicio_padre_id'
_CHECK = 'ck_servicio_base_sin_padre'


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns(_TABLA)}
    fks = {fk['name'] for fk in inspector.get_foreign_keys(_TABLA)}
    indices = {idx['name'] for idx in inspector.get_indexes(_TABLA)}
    checks = {c['name'] for c in inspector.get_check_constraints(_TABLA)}

    if _COL_PADRE not in cols:
        op.add_column(_TABLA, sa.Column(_COL_PADRE, sa.Integer(), nullable=True))
    if _FK not in fks:
        op.create_foreign_key(_FK, _TABLA, _TABLA, [_COL_PADRE], ['id'], ondelete='SET NULL')
    if _INDICE not in indices:
        op.create_index(_INDICE, _TABLA, [_COL_PADRE])

    if _COL_BASE not in cols:
        op.add_column(
            _TABLA,
            sa.Column(_COL_BASE, sa.Boolean(), nullable=False, server_default=sa.text('false')),
        )

    if _CHECK not in checks:
        op.create_check_constraint(
            _CHECK,
            _TABLA,
            "NOT (es_base AND servicio_padre_id IS NOT NULL)",
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns(_TABLA)}
    fks = {fk['name'] for fk in inspector.get_foreign_keys(_TABLA)}
    indices = {idx['name'] for idx in inspector.get_indexes(_TABLA)}
    checks = {c['name'] for c in inspector.get_check_constraints(_TABLA)}

    if _CHECK in checks:
        op.drop_constraint(_CHECK, _TABLA, type_='check')
    if _COL_BASE in cols:
        op.drop_column(_TABLA, _COL_BASE)
    if _INDICE in indices:
        op.drop_index(_INDICE, table_name=_TABLA)
    if _FK in fks:
        op.drop_constraint(_FK, _TABLA, type_='foreignkey')
    if _COL_PADRE in cols:
        op.drop_column(_TABLA, _COL_PADRE)
