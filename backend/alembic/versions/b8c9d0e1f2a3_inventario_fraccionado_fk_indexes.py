"""Inventario fraccionado (Tarea 07, review): indices en FKs del ledger de consumo

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-09 23:45:00.000000

Slice A creo las FKs de anclaje y las tablas nuevas pero sin indice sobre las
columnas por las que se filtra en caliente (guard anti-doble-descuento, reversa,
carga de receta). Postgres NO indexa las FKs automaticamente. Se agregan:

- movimientos_inventario.servicio_consulta_id
- consumo_material.servicio_consulta_id
- recetas_servicio.catalogo_servicio_id
- servicios_consulta.catalogo_servicio_id

Estilo (segun docs/tecnico/inventario-actual.md §5): manual, guardas de
idempotencia con inspector.get_indexes, sin batch_alter_table, downgrade()
implementado.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (nombre_indice, tabla, columna)
_INDICES = [
    ('ix_movimientos_inventario_servicio_consulta_id', 'movimientos_inventario', 'servicio_consulta_id'),
    ('ix_consumo_material_servicio_consulta_id', 'consumo_material', 'servicio_consulta_id'),
    ('ix_recetas_servicio_catalogo_servicio_id', 'recetas_servicio', 'catalogo_servicio_id'),
    ('ix_servicios_consulta_catalogo_servicio_id', 'servicios_consulta', 'catalogo_servicio_id'),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    for nombre, tabla, columna in _INDICES:
        if tabla not in existing_tables:
            continue
        indices = {idx['name'] for idx in inspector.get_indexes(tabla)}
        columnas = {c['name'] for c in inspector.get_columns(tabla)}
        if nombre not in indices and columna in columnas:
            op.create_index(nombre, tabla, [columna])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    for nombre, tabla, _columna in reversed(_INDICES):
        if tabla not in existing_tables:
            continue
        indices = {idx['name'] for idx in inspector.get_indexes(tabla)}
        if nombre in indices:
            op.drop_index(nombre, table_name=tabla)
