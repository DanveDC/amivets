"""Inventario fraccionado (Tarea 07, slice A): esquema de consumo + recetas

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-09 22:30:00.000000

Alcance: SOLO esquema. No hay logica de consumo (eso es slice B).

- Integer -> Numeric(12, 3) en las columnas de stock/movimiento (preserva
  valores: 10 -> 10.000; Postgres castea sin perdida).
- Columnas nuevas en inventario: tipo_item, unidad_medida,
  contenido_por_envase, merma_al_abrir.
- Anclajes: movimientos_inventario.servicio_consulta_id,
  servicios_consulta.catalogo_servicio_id.
- Tablas nuevas (nacen vacias): recetas_servicio, consumo_material.

Estilo (segun docs/tecnico/inventario-actual.md §5): manual, sin
autogenerate, guardas de idempotencia con inspector, sin
batch_alter_table, apuntado a Postgres, downgrade() implementado.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # --- 1. Integer -> Numeric(12, 3) en columnas de stock ---
    # Guarda de idempotencia: solo alteramos si todavia no es Numeric.
    # Postgres castea INTEGER -> NUMERIC implicitamente, sin perder valor.
    inv_cols = {c['name']: c for c in inspector.get_columns('inventario')}
    if not isinstance(inv_cols['stock_actual']['type'], sa.Numeric):
        op.alter_column(
            'inventario', 'stock_actual',
            type_=sa.Numeric(12, 3),
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
    if not isinstance(inv_cols['stock_minimo']['type'], sa.Numeric):
        op.alter_column(
            'inventario', 'stock_minimo',
            type_=sa.Numeric(12, 3),
            existing_type=sa.Integer(),
            existing_nullable=False,
        )

    mov_cols = {c['name']: c for c in inspector.get_columns('movimientos_inventario')}
    if not isinstance(mov_cols['cantidad']['type'], sa.Numeric):
        op.alter_column(
            'movimientos_inventario', 'cantidad',
            type_=sa.Numeric(12, 3),
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
    # detalles_factura.cantidad se deja Integer a proposito (fuera de alcance,
    # ver docs/diseno/inventario-fraccionado.md decision 8).

    # --- 2. Columnas nuevas en inventario ---
    inv_col_names = [c['name'] for c in inspector.get_columns('inventario')]
    if 'tipo_item' not in inv_col_names:
        # Conjunto cerrado: MATERIAL | PRODUCTO. server_default 'PRODUCTO'
        # deja todo lo existente como producto vendible (que es lo que es hoy).
        op.add_column(
            'inventario',
            sa.Column('tipo_item', sa.String(12), nullable=False, server_default='PRODUCTO'),
        )
    if 'unidad_medida' not in inv_col_names:
        # 'ml' | 'g' | 'unidad'. NULL en todo el padron existente: no se
        # inventa lo que nadie declaro (NULL se interpreta como 'unidad').
        op.add_column(
            'inventario',
            sa.Column('unidad_medida', sa.String(12), nullable=True),
        )
    if 'contenido_por_envase' not in inv_col_names:
        op.add_column(
            'inventario',
            sa.Column('contenido_por_envase', sa.Numeric(12, 3), nullable=True),
        )
    if 'merma_al_abrir' not in inv_col_names:
        op.add_column(
            'inventario',
            sa.Column('merma_al_abrir', sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # --- 3. Anclajes (FK nullable, sin backfill) ---
    mov_col_names = [c['name'] for c in inspector.get_columns('movimientos_inventario')]
    if 'servicio_consulta_id' not in mov_col_names:
        # Clave del guard anti-doble-descuento por ledger (slice B) y de la
        # trazabilidad movimiento -> consulta.
        op.add_column(
            'movimientos_inventario',
            sa.Column(
                'servicio_consulta_id',
                sa.Integer(),
                sa.ForeignKey('servicios_consulta.id'),
                nullable=True,
            ),
        )

    sc_col_names = [c['name'] for c in inspector.get_columns('servicios_consulta')]
    if 'catalogo_servicio_id' not in sc_col_names:
        # Ancla por fin el servicio de la consulta a su definicion de catalogo.
        op.add_column(
            'servicios_consulta',
            sa.Column(
                'catalogo_servicio_id',
                sa.Integer(),
                sa.ForeignKey('catalogo_servicios.id'),
                nullable=True,
            ),
        )

    # --- 4. Tablas nuevas (nacen vacias) ---
    if 'recetas_servicio' not in existing_tables:
        op.create_table(
            'recetas_servicio',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('catalogo_servicio_id', sa.Integer(), sa.ForeignKey('catalogo_servicios.id'), nullable=False),
            sa.Column('inventario_id', sa.Integer(), sa.ForeignKey('inventario.id'), nullable=False),
            sa.Column('cantidad', sa.Numeric(12, 3), nullable=False),
            sa.Column('unidad_medida', sa.String(12), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            # Un material no puede figurar dos veces en la receta del mismo servicio.
            sa.UniqueConstraint('catalogo_servicio_id', 'inventario_id', name='uq_receta_servicio_material'),
        )

    if 'consumo_material' not in existing_tables:
        op.create_table(
            'consumo_material',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('servicio_consulta_id', sa.Integer(), sa.ForeignKey('servicios_consulta.id'), nullable=False),
            sa.Column('inventario_id', sa.Integer(), sa.ForeignKey('inventario.id'), nullable=False),
            sa.Column('cantidad', sa.Numeric(12, 3), nullable=False),
            sa.Column('unidad_medida', sa.String(12), nullable=False),
            # Enlace al movimiento de ledger generado, para trazabilidad y reversa (slice B).
            sa.Column('movimiento_id', sa.Integer(), sa.ForeignKey('movimientos_inventario.id'), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Orden inverso al upgrade.

    # --- 4. Tablas nuevas ---
    if 'consumo_material' in existing_tables:
        op.drop_table('consumo_material')
    if 'recetas_servicio' in existing_tables:
        op.drop_table('recetas_servicio')

    # --- 3. Anclajes (drop_column tambien tira la FK en Postgres) ---
    sc_col_names = [c['name'] for c in inspector.get_columns('servicios_consulta')]
    if 'catalogo_servicio_id' in sc_col_names:
        op.drop_column('servicios_consulta', 'catalogo_servicio_id')

    mov_col_names = [c['name'] for c in inspector.get_columns('movimientos_inventario')]
    if 'servicio_consulta_id' in mov_col_names:
        op.drop_column('movimientos_inventario', 'servicio_consulta_id')

    # --- 2. Columnas nuevas en inventario ---
    inv_col_names = [c['name'] for c in inspector.get_columns('inventario')]
    for col in ('merma_al_abrir', 'contenido_por_envase', 'unidad_medida', 'tipo_item'):
        if col in inv_col_names:
            op.drop_column('inventario', col)

    # --- 1. Numeric(12, 3) -> Integer ---
    # ATENCION: 'round(x)::integer' es LOSSY para cualquier fraccion creada
    # despues de esta migracion (2.500 -> 3, 0.125 -> 0). Solo es seguro
    # sobre el padron original, que ya era entero. postgresql_using es
    # obligatorio: Postgres no castea NUMERIC -> INTEGER de forma implicita.
    inv_cols = {c['name']: c for c in inspector.get_columns('inventario')}
    if isinstance(inv_cols['stock_actual']['type'], sa.Numeric):
        op.alter_column(
            'inventario', 'stock_actual',
            type_=sa.Integer(),
            existing_type=sa.Numeric(12, 3),
            existing_nullable=False,
            postgresql_using='round(stock_actual)::integer',
        )
    if isinstance(inv_cols['stock_minimo']['type'], sa.Numeric):
        op.alter_column(
            'inventario', 'stock_minimo',
            type_=sa.Integer(),
            existing_type=sa.Numeric(12, 3),
            existing_nullable=False,
            postgresql_using='round(stock_minimo)::integer',
        )

    mov_cols = {c['name']: c for c in inspector.get_columns('movimientos_inventario')}
    if isinstance(mov_cols['cantidad']['type'], sa.Numeric):
        op.alter_column(
            'movimientos_inventario', 'cantidad',
            type_=sa.Integer(),
            existing_type=sa.Numeric(12, 3),
            existing_nullable=False,
            postgresql_using='round(cantidad)::integer',
        )
