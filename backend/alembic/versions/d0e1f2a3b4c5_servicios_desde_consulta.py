"""Servicios desde la consulta (Tarea 09, FASE 2): servicio directo + ciclo de vida

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-10 12:00:00.000000

Alcance (docs/diseno/flujo-consulta-servicios.md, decisiones 1, 2 y 6):

- Decision 1: servicios_consulta.consulta_id pasa a nullable; se agrega
  servicios_consulta.mascota_id (FK nullable, index) para colgar el servicio
  suelto de la historia del paciente. CHECK ck_servicio_consulta_scope garantiza
  que siempre haya al menos un ancla (consulta o mascota). Backfill de mascota_id
  desde consulta.mascota_id para las filas existentes.
- Decision 2: backfill de espejos ServicioConsulta. Por cada fila de detalle
  clinico (vacunaciones, desparasitaciones, cirugias, hospitalizaciones,
  pruebas_complementarias) con consulta_id y SIN espejo (match por
  tipo_servicio + referencia_id + consulta_id), se crea el ServicioConsulta
  correspondiente para que quede visible y facturable desde consulta.servicios.
- Decision 6: consultas.estado VARCHAR(20). Las filas historicas nacen 'CERRADA'
  (ya pasaron); el server_default se deja en 'ABIERTA' para las nuevas. Indice
  en consultas.estado.

Reversibilidad del backfill de espejos: se agrega servicios_consulta.origen
VARCHAR(20). Las filas creadas por esta migracion llevan origen = 'MIGRACION_09';
el downgrade() borra exactamente ese conjunto (DELETE WHERE origen = 'MIGRACION_09')
antes de dropear las columnas. Un alta normal (POST /api/servicios o
/api/consultas/{id}/servicios) deja origen = NULL, asi que nunca es tocada por el
downgrade.

Estilo (segun docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
guardas de idempotencia con inspector, sin batch_alter_table, apuntado a Postgres,
downgrade() implementado. Backfills en SQL crudo (op.execute).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (tabla_detalle, tipo_servicio, tipos_espejo_existentes, expr_nombre, expr_cantidad, join_inventario)
#  - tipos_espejo_existentes: valores de tipo_servicio que YA podria haber usado
#    un espejo de esa tabla (pruebas puede haber quedado como LABORATORIO o
#    DIAGNOSTICO segun routers/clinico.py).
_ESPEJOS = [
    {
        "tabla": "vacunaciones",
        "tipo": "VACUNACION",
        "tipos_existentes": ("VACUNACION",),
        "nombre": "'VACUNA: ' || COALESCE(i.nombre, 'N/D')",
        "cantidad": "1.0",
        "join_inv": "LEFT JOIN inventario i ON i.id = d.vacuna_id",
    },
    {
        "tabla": "desparasitaciones",
        "tipo": "DESPARASITACION",
        "tipos_existentes": ("DESPARASITACION",),
        "nombre": "'DESPARASITACION: ' || COALESCE(i.nombre, 'N/D')",
        "cantidad": "1.0",
        "join_inv": "LEFT JOIN inventario i ON i.id = d.producto_id",
    },
    {
        "tabla": "cirugias",
        "tipo": "CIRUGIA",
        "tipos_existentes": ("CIRUGIA",),
        "nombre": "'CIRUGIA: ' || COALESCE(d.tipo_procedimiento, 'N/D')",
        "cantidad": "1.0",
        "join_inv": "",
    },
    {
        "tabla": "hospitalizaciones",
        "tipo": "HOSPITALIZACION",
        "tipos_existentes": ("HOSPITALIZACION",),
        "nombre": "'HOSPITALIZACION: ' || COALESCE(substr(d.motivo, 1, 50), 'N/D')",
        "cantidad": "COALESCE(d.dias_cama, 1)",
        "join_inv": "",
    },
    {
        "tabla": "pruebas_complementarias",
        "tipo": "LABORATORIO",
        "tipos_existentes": ("LABORATORIO", "DIAGNOSTICO"),
        "nombre": "'ESTUDIO: ' || COALESCE(d.tipo, 'N/D')",
        "cantidad": "1.0",
        "join_inv": "",
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    consulta_cols = {c["name"] for c in inspector.get_columns("consultas")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}
    consulta_indexes = {idx["name"] for idx in inspector.get_indexes("consultas")}
    sc_checks = {ck["name"] for ck in inspector.get_check_constraints("servicios_consulta")}

    # --- 1. servicios_consulta.consulta_id -> nullable ---
    op.alter_column(
        "servicios_consulta",
        "consulta_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # --- 2. servicios_consulta.mascota_id (FK nullable, index) ---
    if "mascota_id" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column(
                "mascota_id",
                sa.Integer(),
                sa.ForeignKey("mascotas.id"),
                nullable=True,
            ),
        )
    if "ix_servicios_consulta_mascota_id" not in sc_indexes:
        op.create_index(
            "ix_servicios_consulta_mascota_id",
            "servicios_consulta",
            ["mascota_id"],
        )

    # --- 3. servicios_consulta.origen (marcador de reversibilidad del backfill) ---
    if "origen" not in sc_cols:
        op.add_column(
            "servicios_consulta",
            sa.Column("origen", sa.String(20), nullable=True),
        )

    # --- 4. Backfill de mascota_id desde la consulta (Decision 1) ---
    op.execute(
        sa.text(
            """
            UPDATE servicios_consulta
            SET mascota_id = (
                SELECT c.mascota_id FROM consultas c
                WHERE c.id = servicios_consulta.consulta_id
            )
            WHERE consulta_id IS NOT NULL AND mascota_id IS NULL
            """
        )
    )

    # --- 5. Backfill de espejos ServicioConsulta (Decision 2) ---
    # Por cada fila de detalle con consulta_id y sin espejo previo, se crea el
    # ServicioConsulta correspondiente. origen = 'MIGRACION_09' para que el
    # downgrade borre exactamente lo que se creo aca.
    for esp in _ESPEJOS:
        tipos_lista = ", ".join(f"'{t}'" for t in esp["tipos_existentes"])
        op.execute(
            sa.text(
                f"""
                INSERT INTO servicios_consulta
                    (consulta_id, mascota_id, tipo_servicio, referencia_id,
                     nombre_servicio, cantidad, precio_unitario, estado,
                     facturado, is_deleted, origen)
                SELECT
                    d.consulta_id,
                    c.mascota_id,
                    '{esp["tipo"]}',
                    d.id,
                    {esp["nombre"]},
                    {esp["cantidad"]},
                    COALESCE(d.precio_aplicado, 0),
                    'Aplicado',
                    COALESCE(d.facturado, false),
                    false,
                    'MIGRACION_09'
                FROM {esp["tabla"]} d
                JOIN consultas c ON c.id = d.consulta_id
                {esp["join_inv"]}
                WHERE d.consulta_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM servicios_consulta s
                    WHERE s.referencia_id = d.id
                      AND s.consulta_id = d.consulta_id
                      AND s.tipo_servicio IN ({tipos_lista})
                  )
                """
            )
        )

    # --- 6. CHECK ck_servicio_consulta_scope (tras los backfills) ---
    if "ck_servicio_consulta_scope" not in sc_checks:
        op.create_check_constraint(
            "ck_servicio_consulta_scope",
            "servicios_consulta",
            "consulta_id IS NOT NULL OR mascota_id IS NOT NULL",
        )

    # --- 7. consultas.estado (Decision 6) ---
    if "estado" not in consulta_cols:
        # Nace 'CERRADA' para todas las filas historicas (ya pasaron)...
        op.add_column(
            "consultas",
            sa.Column(
                "estado",
                sa.String(20),
                nullable=False,
                server_default="CERRADA",
            ),
        )
        # ...y a partir de ahora el default de servidor es 'ABIERTA'.
        op.alter_column(
            "consultas",
            "estado",
            existing_type=sa.String(20),
            server_default="ABIERTA",
        )
    if "ix_consultas_estado" not in consulta_indexes:
        op.create_index("ix_consultas_estado", "consultas", ["estado"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    consulta_cols = {c["name"] for c in inspector.get_columns("consultas")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}
    consulta_indexes = {idx["name"] for idx in inspector.get_indexes("consultas")}
    sc_checks = {ck["name"] for ck in inspector.get_check_constraints("servicios_consulta")}

    # Orden inverso al upgrade, cuidando FKs y el CHECK.

    # --- 5/3. Borrar EXACTAMENTE los espejos creados por el backfill ---
    op.execute(sa.text("DELETE FROM servicios_consulta WHERE origen = 'MIGRACION_09'"))

    # --- 6. CHECK (antes de dropear mascota_id, que referencia) ---
    if "ck_servicio_consulta_scope" in sc_checks:
        op.drop_constraint(
            "ck_servicio_consulta_scope", "servicios_consulta", type_="check"
        )

    # --- 7. consultas.estado ---
    if "ix_consultas_estado" in consulta_indexes:
        op.drop_index("ix_consultas_estado", table_name="consultas")
    if "estado" in consulta_cols:
        op.drop_column("consultas", "estado")

    # --- 3/2. origen + mascota_id ---
    if "origen" in sc_cols:
        op.drop_column("servicios_consulta", "origen")
    if "ix_servicios_consulta_mascota_id" in sc_indexes:
        op.drop_index(
            "ix_servicios_consulta_mascota_id", table_name="servicios_consulta"
        )
    if "mascota_id" in sc_cols:
        op.drop_column("servicios_consulta", "mascota_id")

    # --- 1. consulta_id -> NOT NULL ---
    # ATENCION: si existen servicios directos (consulta_id IS NULL) creados bajo
    # el modelo nuevo, este ALTER falla a proposito: ese dato no se puede
    # representar en el esquema viejo. Hay que borrarlos/reasignarlos primero.
    op.alter_column(
        "servicios_consulta",
        "consulta_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
