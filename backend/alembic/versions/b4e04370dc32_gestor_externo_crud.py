"""Gestores externos y su integración con notificaciones (gestor-externo-crud)

Crea `gestores_externos` (proveedor/laboratorio/especialista, no es un
`Usuario`) y la tabla pivote `gestor_area_externo` (N:M con `areas_servicio`,
mismo patrón que `gestor_area`).

También toca `notificaciones`: `destinatario_id` pasa a nullable y se suma
`gestor_externo_id` (FK RESTRICT, indexada) + CHECK XOR -- una notificación
tiene exactamente uno de los dos destinatarios (design.md, decisión 4 /
Risks). Sin esto, `notificar_asignacion` no puede avisarle a un gestor
externo sin inventar un `Usuario` fantasma. RESTRICT (no CASCADE) porque
borrar un gestor externo no debe llevarse su historial de notificaciones;
SET NULL no es viable porque violaría el CHECK XOR.

Revision ID: b4e04370dc32
Revises: e4f5a6b7c8d9
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b4e04370dc32'
down_revision: Union[str, None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if "gestores_externos" not in existing_tables:
        op.create_table(
            "gestores_externos",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("nombre", sa.String(length=120), nullable=False),
            sa.Column("rif", sa.String(length=20), nullable=False),
            sa.Column("telefono", sa.String(length=20), nullable=False),
            sa.Column("metodo_pago", sa.String(length=50), nullable=False),
            sa.Column("numero_cuenta", sa.String(length=50), nullable=True),
            sa.Column("es_movil", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("zelle", sa.String(length=100), nullable=True),
            sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
            sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint(
                "metodo_pago IN ('TRANSFERENCIA','EFECTIVO','ZELLE','CHEQUE','OTRO')",
                name="ck_gestor_externo_metodo_pago",
            ),
            sa.UniqueConstraint("rif", name="uq_gestores_externos_rif"),
        )
        op.create_index("ix_gestores_externos_rif", "gestores_externos", ["rif"])
        op.create_index("ix_gestores_externos_usuario_id", "gestores_externos", ["usuario_id"])

    if "gestor_area_externo" not in existing_tables:
        op.create_table(
            "gestor_area_externo",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "gestor_externo_id",
                sa.Integer(),
                sa.ForeignKey("gestores_externos.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "area_id",
                sa.Integer(),
                sa.ForeignKey("areas_servicio.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("gestor_externo_id", "area_id", name="uq_gestor_area_externo"),
        )
        op.create_index("ix_gestor_area_externo_gestor_externo_id", "gestor_area_externo", ["gestor_externo_id"])
        op.create_index("ix_gestor_area_externo_area_id", "gestor_area_externo", ["area_id"])

    # notificaciones: destinatario_id nullable + gestor_externo_id + CHECK XOR.
    notif_cols = {c["name"] for c in inspector.get_columns("notificaciones")}
    notif_checks = {c["name"] for c in inspector.get_check_constraints("notificaciones")}
    notif_indexes = {idx["name"] for idx in inspector.get_indexes("notificaciones")}

    if "gestor_externo_id" not in notif_cols:
        op.add_column(
            "notificaciones",
            sa.Column(
                "gestor_externo_id",
                sa.Integer(),
                sa.ForeignKey("gestores_externos.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
    if "ix_notificaciones_gestor_externo_id" not in notif_indexes:
        op.create_index("ix_notificaciones_gestor_externo_id", "notificaciones", ["gestor_externo_id"])

    op.alter_column("notificaciones", "destinatario_id", existing_type=sa.Integer(), nullable=True)

    if "ck_notificaciones_destinatario_xor_externo" not in notif_checks:
        op.create_check_constraint(
            "ck_notificaciones_destinatario_xor_externo",
            "notificaciones",
            "(destinatario_id IS NOT NULL) != (gestor_externo_id IS NOT NULL)",
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())
    notif_checks = {c["name"] for c in inspector.get_check_constraints("notificaciones")}
    notif_indexes = {idx["name"] for idx in inspector.get_indexes("notificaciones")}
    notif_cols = {c["name"] for c in inspector.get_columns("notificaciones")}

    if "ck_notificaciones_destinatario_xor_externo" in notif_checks:
        op.drop_constraint("ck_notificaciones_destinatario_xor_externo", "notificaciones", type_="check")

    # Sin esto, filas con destinatario_id NULL (externas) violarían el
    # NOT NULL al revertir -- se borran, son datos del feature que se revierte.
    conn.execute(sa.text("DELETE FROM notificaciones WHERE destinatario_id IS NULL"))

    op.alter_column("notificaciones", "destinatario_id", existing_type=sa.Integer(), nullable=False)

    if "ix_notificaciones_gestor_externo_id" in notif_indexes:
        op.drop_index("ix_notificaciones_gestor_externo_id", table_name="notificaciones")
    if "gestor_externo_id" in notif_cols:
        op.drop_column("notificaciones", "gestor_externo_id")

    if "gestor_area_externo" in existing_tables:
        op.drop_table("gestor_area_externo")
    if "gestores_externos" in existing_tables:
        op.drop_table("gestores_externos")
