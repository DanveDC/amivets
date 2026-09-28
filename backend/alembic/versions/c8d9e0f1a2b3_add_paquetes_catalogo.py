"""Add paquetes catalogo: es_paquete + catalogo_paquete_componentes (plantillas-paquete-catalogo)

Agrega la columna `es_paquete` a `catalogo_servicios` (default false, no
rompe catalogo existente) y la tabla `catalogo_paquete_componentes`, que
declara los componentes de una plantilla de paquete (design D1). Solo las
reglas de una fila (cantidad > 0, paquete <> componente) entran en un CHECK
-- PostgreSQL rechaza subqueries dentro de un CHECK, asi que "el componente
no puede ser un paquete", "un paquete no puede contener a otro paquete" y
"sin CONSULTA" se validan en routers/catalogo.py (ver design.md).

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLA_CATALOGO = 'catalogo_servicios'
_COL_ES_PAQUETE = 'es_paquete'

_TABLA_COMPONENTES = 'catalogo_paquete_componentes'
_FK_PAQUETE = 'fk_paquete_componente_paquete'
_FK_COMPONENTE = 'fk_paquete_componente_componente'
_UQ = 'uq_paquete_componente'
_CK_CANTIDAD = 'ck_paquete_componente_cantidad'
_CK_NO_SELF = 'ck_paquete_componente_no_self'
_IX_PAQUETE_ID = 'ix_catalogo_paquete_componentes_paquete_id'
_IX_COMPONENTE_ID = 'ix_catalogo_paquete_componentes_componente_id'


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    cols_catalogo = {c['name'] for c in inspector.get_columns(_TABLA_CATALOGO)}
    if _COL_ES_PAQUETE not in cols_catalogo:
        op.add_column(
            _TABLA_CATALOGO,
            sa.Column(_COL_ES_PAQUETE, sa.Boolean(), nullable=False, server_default=sa.text('false')),
        )

    # create_all (backend/app/main.py) puede haber creado ya la tabla en un
    # entorno de dev sin pasar por esta migracion -- mismo caso documentado en
    # b7c8d9e0f1a2 y c1d2e3f4a5b6.
    if _TABLA_COMPONENTES not in inspector.get_table_names():
        op.create_table(
            _TABLA_COMPONENTES,
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('paquete_id', sa.Integer(), nullable=False),
            sa.Column('componente_id', sa.Integer(), nullable=False),
            sa.Column('cantidad', sa.Numeric(12, 3), nullable=False),
            sa.Column('posicion', sa.Integer(), nullable=False, server_default=sa.text('0')),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(['paquete_id'], [f'{_TABLA_CATALOGO}.id'], name=_FK_PAQUETE, ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['componente_id'], [f'{_TABLA_CATALOGO}.id'], name=_FK_COMPONENTE),
            sa.UniqueConstraint('paquete_id', 'componente_id', name=_UQ),
            sa.CheckConstraint('cantidad > 0', name=_CK_CANTIDAD),
            sa.CheckConstraint('paquete_id <> componente_id', name=_CK_NO_SELF),
        )

    inspector = sa.inspect(conn)
    indices = {idx['name'] for idx in inspector.get_indexes(_TABLA_COMPONENTES)}
    if _IX_PAQUETE_ID not in indices:
        op.create_index(_IX_PAQUETE_ID, _TABLA_COMPONENTES, ['paquete_id'])
    if _IX_COMPONENTE_ID not in indices:
        op.create_index(_IX_COMPONENTE_ID, _TABLA_COMPONENTES, ['componente_id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if _TABLA_COMPONENTES in inspector.get_table_names():
        indices = {idx['name'] for idx in inspector.get_indexes(_TABLA_COMPONENTES)}
        if _IX_COMPONENTE_ID in indices:
            op.drop_index(_IX_COMPONENTE_ID, table_name=_TABLA_COMPONENTES)
        if _IX_PAQUETE_ID in indices:
            op.drop_index(_IX_PAQUETE_ID, table_name=_TABLA_COMPONENTES)
        op.drop_table(_TABLA_COMPONENTES)

    inspector = sa.inspect(conn)
    cols_catalogo = {c['name'] for c in inspector.get_columns(_TABLA_CATALOGO)}
    if _COL_ES_PAQUETE in cols_catalogo:
        op.drop_column(_TABLA_CATALOGO, _COL_ES_PAQUETE)
