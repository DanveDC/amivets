"""Historial de precios de lista de materiales y servicios (Tarea 08)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-10 00:15:00.000000

Alcance (docs/diseno/historial-precios.md, decisiones 2 y 7):

- Tablas nuevas: historial_precio_inventario, historial_precio_servicio. Cada
  una con su FK real (nada de esquema polimorfico), la self-FK corrige_id para
  las correcciones (decision 6) y un indice (entidad_id, fecha_cambio) para
  responder "precio vigente en la fecha X" en O(log n) (decision 3).
- precio_nuevo / precio_anterior nacen Numeric(10, 2), mismo precedente que
  Abono.monto / Usuario.tarifa_consulta (decision 8). Esta migracion NO toca
  los ~20 Float de facturacion/clinica (deuda tecnica documentada).
- Backfill en el mismo upgrade(): un registro inicial por material y por
  servicio con precio_nuevo = precio actual, precio_anterior = NULL,
  usuario_id = NULL, motivo = 'registro inicial (migracion)' y
  fecha_cambio = la fecha de nacimiento que la entidad ya declara
  (inventario.fecha_registro / catalogo_servicios.created_at), con COALESCE a
  now() por si alguna fila vieja la tuviera nula. El INSERT ... SELECT usa
  NOT EXISTS: re-correr la migracion no duplica anclas.

Estilo (segun docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
guardas de idempotencia con inspector, sin batch_alter_table, apuntado a
Postgres, downgrade() implementado (los datos se van con el drop_table).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (tabla_historial, tabla_entidad, columna_fk, columna_precio, columna_fecha)
_BACKFILL = [
    (
        'historial_precio_inventario',
        'inventario',
        'inventario_id',
        'precio_unitario',
        'fecha_registro',
    ),
    (
        'historial_precio_servicio',
        'catalogo_servicios',
        'catalogo_servicio_id',
        'precio_ref',
        'created_at',
    ),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # --- 1. historial_precio_inventario ---
    if 'historial_precio_inventario' not in existing_tables:
        op.create_table(
            'historial_precio_inventario',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('inventario_id', sa.Integer(), sa.ForeignKey('inventario.id'), nullable=False, index=True),
            sa.Column('precio_nuevo', sa.Numeric(10, 2), nullable=False),
            sa.Column('precio_anterior', sa.Numeric(10, 2), nullable=True),
            sa.Column('motivo', sa.String(200), nullable=True),
            sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
            sa.Column('corrige_id', sa.Integer(), sa.ForeignKey('historial_precio_inventario.id'), nullable=True),
            sa.Column('fecha_cambio', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Index('ix_hist_precio_inv_inventario_fecha', 'inventario_id', 'fecha_cambio'),
        )

    # --- 2. historial_precio_servicio ---
    if 'historial_precio_servicio' not in existing_tables:
        op.create_table(
            'historial_precio_servicio',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('catalogo_servicio_id', sa.Integer(), sa.ForeignKey('catalogo_servicios.id'), nullable=False, index=True),
            sa.Column('precio_nuevo', sa.Numeric(10, 2), nullable=False),
            sa.Column('precio_anterior', sa.Numeric(10, 2), nullable=True),
            sa.Column('motivo', sa.String(200), nullable=True),
            sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
            sa.Column('corrige_id', sa.Integer(), sa.ForeignKey('historial_precio_servicio.id'), nullable=True),
            sa.Column('fecha_cambio', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Index('ix_hist_precio_svc_servicio_fecha', 'catalogo_servicio_id', 'fecha_cambio'),
        )

    # --- 3. Backfill: un ancla por entidad, idempotente via NOT EXISTS ---
    # COALESCE del precio a 0: catalogo_servicios.precio_ref es nullable; un
    # servicio sin precio cargado nace con ancla precio_nuevo = 0 (la UI
    # distingue "gratis" de "sin dato", ver riesgos del diseno).
    # COALESCE de la fecha a now(): defensivo, el server_default hace que en la
    # practica nunca sea NULL.
    for tabla_hist, tabla_ent, col_fk, col_precio, col_fecha in _BACKFILL:
        op.execute(
            sa.text(
                f"""
                INSERT INTO {tabla_hist}
                    ({col_fk}, precio_nuevo, precio_anterior, motivo, usuario_id, fecha_cambio)
                SELECT
                    e.id,
                    COALESCE(e.{col_precio}, 0),
                    NULL,
                    'registro inicial (migracion)',
                    NULL,
                    COALESCE(e.{col_fecha}, now())
                FROM {tabla_ent} AS e
                WHERE NOT EXISTS (
                    SELECT 1 FROM {tabla_hist} AS h WHERE h.{col_fk} = e.id
                )
                """
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # Orden inverso al upgrade. drop_index explicito antes del drop_table
    # (en Postgres el drop_table ya se llevaria el indice, pero se deja
    # explicito por consistencia con el resto de las migraciones del repo).
    for tabla, indice in (
        ('historial_precio_servicio', 'ix_hist_precio_svc_servicio_fecha'),
        ('historial_precio_inventario', 'ix_hist_precio_inv_inventario_fecha'),
    ):
        if tabla not in existing_tables:
            continue
        indices = {idx['name'] for idx in inspector.get_indexes(tabla)}
        if indice in indices:
            op.drop_index(indice, table_name=tabla)

    if 'historial_precio_servicio' in existing_tables:
        op.drop_table('historial_precio_servicio')
    if 'historial_precio_inventario' in existing_tables:
        op.drop_table('historial_precio_inventario')
