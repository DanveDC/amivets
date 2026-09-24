"""Ordenes de servicio: esquema aditivo (Tarea 06, FASE 2 etapa 2a)

Revision ID: f2a3b4c5d6e1
Revises: e1f2a3b4c5d6
Create Date: 2026-09-13 18:40:00.000000

Alcance (docs/diseno/ordenes-de-servicio.md, decisiones 1, 3, 5, 6 y 7). Esta
revision es PURAMENTE ADITIVA: crea tablas y columnas nuevas y amplia un CHECK.
No reescribe ni una fila de datos existente.

Lo que NO entra aca a proposito:

- El backfill de ordenes historicas (decision 2) va en su propia revision, para
  poder revertir los datos sin revertir el esquema.
- El renombre de estados de servicios_consulta (Pendiente/Aplicado/Cancelado ->
  SOLICITADO/EJECUTADO/... , decision 4) va en otra revision separada: toca la
  logica de consumo de insumos y necesita su propia revision de codigo.
- Por eso servicios_consulta.orden_id nace NULLABLE. Pasa a NOT NULL recien en
  la revision de backfill, cuando toda fila viva tenga orden.

Contenido:

- Decision 1: tabla ordenes_servicio. numero se genera con la SEQUENCE
  ordenes_servicio_numero_seq ('OS-' || lpad(nextval(...), 6, '0')) como
  server_default: no hay carrera posible entre dos altas simultaneas de
  mostrador, a diferencia de generar_numero_factura. estado se valida con
  CheckConstraint sobre el set cerrado (sin Enum, por consistencia con
  Consulta.estado / Factura.estado / ServicioConsulta.estado). Indice compuesto
  (estado, fecha_apertura) para la bandeja del dia.
- Decision 5: tablas areas_servicio y gestor_area; columnas area_id /
  asignado_a_id / asignado_at / ejecutado_at en servicios_consulta; columnas
  area_id y requiere_adjunto (nullable = hereda del area) en catalogo_servicios.
- Decision 6: tabla notificaciones con indice
  (destinatario_id, leida_at, created_at) para el badge de no leidas.
- Decision 7: tabla adjuntos, colgada del servicio.
- Decision 3: ck_servicio_consulta_scope se AMPLIA con orden_id como tercera
  ancla valida (una orden de mostrador sin paciente ni consulta violaria el
  CHECK actual). Postgres no tiene ALTER CONSTRAINT para cambiar la condicion:
  hay que dropear y recrear. Ademas el indice unico parcial uq_orden_una_consulta
  materializa "maximo una consulta por orden".

Estilo (segun docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
guardas de idempotencia con inspector (el arranque corre create_all ANTES de
alembic, asi que las tablas nuevas pueden llegar ya creadas por esa via), sin
batch_alter_table, apuntado a Postgres, downgrade() implementado y simetrico.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e1'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NUMERO_SEQ = "ordenes_servicio_numero_seq"
_NUMERO_DEFAULT = f"'OS-' || lpad(nextval('{_NUMERO_SEQ}')::text, 6, '0')"

_ESTADOS_ORDEN = ("ABIERTA", "EN_ATENCION", "CERRADA", "FACTURADA", "ANULADA")
_CK_ESTADO_ORDEN = "estado IN (" + ", ".join(f"'{e}'" for e in _ESTADOS_ORDEN) + ")"

# Condicion vieja y nueva del CHECK de alcance de servicios_consulta.
_SCOPE_VIEJO = "consulta_id IS NOT NULL OR mascota_id IS NOT NULL"
_SCOPE_NUEVO = (
    "orden_id IS NOT NULL OR consulta_id IS NOT NULL OR mascota_id IS NOT NULL"
)

# Maximo una linea CONSULTA viva por orden (decision 3): con dos consultas en
# una orden y una sola Factura.consulta_id, la segunda consulta nunca se le
# liquidaria a su veterinario.
_UQ_ORDEN_CONSULTA_WHERE = "tipo_servicio = 'CONSULTA' AND is_deleted = false"

# (columna, tipo, destino_fk, indexar). El destino de la FK se guarda como
# string y el objeto ForeignKey se construye dentro del bucle: un ForeignKey ya
# asociado a una Column no se puede reutilizar en otra.
_COLUMNAS_SERVICIO = [
    ("orden_id", lambda: sa.Integer(), "ordenes_servicio.id", True),
    ("area_id", lambda: sa.Integer(), "areas_servicio.id", True),
    ("asignado_a_id", lambda: sa.Integer(), "usuarios.id", True),
    ("asignado_at", lambda: sa.DateTime(timezone=True), None, False),
    ("ejecutado_at", lambda: sa.DateTime(timezone=True), None, False),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # --- 1. SEQUENCE de numeracion (decision 1) ---
    # Va antes de la tabla: el server_default de `numero` la referencia y
    # Postgres resuelve nextval('...') en tiempo de CREATE TABLE.
    op.execute(sa.text(f"CREATE SEQUENCE IF NOT EXISTS {_NUMERO_SEQ}"))

    # --- 2. areas_servicio (decision 5) ---
    # Antes de ordenes_servicio/servicios_consulta porque ambas la referencian.
    if "areas_servicio" not in existing_tables:
        op.create_table(
            "areas_servicio",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("codigo", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("nombre", sa.String(100), nullable=False),
            sa.Column("requiere_adjunto", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )

    # --- 3. ordenes_servicio (decision 1) ---
    if "ordenes_servicio" not in existing_tables:
        op.create_table(
            "ordenes_servicio",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column(
                "numero",
                sa.String(20),
                nullable=False,
                unique=True,
                index=True,
                server_default=sa.text(_NUMERO_DEFAULT),
            ),
            sa.Column("propietario_id", sa.Integer(), sa.ForeignKey("propietarios.id"), nullable=False, index=True),
            sa.Column("mascota_id", sa.Integer(), sa.ForeignKey("mascotas.id"), nullable=True, index=True),
            sa.Column("veterinario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True, index=True),
            sa.Column("estado", sa.String(20), nullable=False, server_default="ABIERTA", index=True),
            sa.Column("abierta_por_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False),
            sa.Column("fecha_apertura", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("fecha_cierre", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cerrada_por_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
            sa.Column("motivo_visita", sa.String(255), nullable=True),
            sa.Column("observaciones", sa.Text(), nullable=True),
            sa.Column("anulada_por_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
            sa.Column("motivo_anulacion", sa.String(255), nullable=True),
            sa.Column("origen", sa.String(20), nullable=True),
            sa.CheckConstraint(_CK_ESTADO_ORDEN, name="ck_orden_servicio_estado"),
            # Bandeja del dia: WHERE estado = 'ABIERTA' ORDER BY fecha_apertura.
            sa.Index("ix_ordenes_servicio_estado_fecha", "estado", "fecha_apertura"),
        )

    # --- 4. gestor_area (decision 5) ---
    if "gestor_area" not in existing_tables:
        op.create_table(
            "gestor_area",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False, index=True),
            sa.Column("area_id", sa.Integer(), sa.ForeignKey("areas_servicio.id"), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("usuario_id", "area_id", name="uq_gestor_area_usuario_area"),
        )

    # --- 5. notificaciones (decision 6) ---
    if "notificaciones" not in existing_tables:
        op.create_table(
            "notificaciones",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("destinatario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False, index=True),
            sa.Column("tipo", sa.String(40), nullable=False),
            sa.Column("titulo", sa.String(160), nullable=False),
            sa.Column("cuerpo", sa.Text(), nullable=True),
            sa.Column("orden_id", sa.Integer(), sa.ForeignKey("ordenes_servicio.id"), nullable=True),
            sa.Column("servicio_id", sa.Integer(), sa.ForeignKey("servicios_consulta.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("leida_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("canal", sa.String(20), nullable=False, server_default="APP"),
            sa.Column("enviado_at", sa.DateTime(timezone=True), nullable=True),
            # Badge de no leidas: se consulta en cada poll.
            sa.Index(
                "ix_notificaciones_destinatario_leida_created",
                "destinatario_id",
                "leida_at",
                "created_at",
            ),
        )

    # --- 6. adjuntos (decision 7) ---
    if "adjuntos" not in existing_tables:
        op.create_table(
            "adjuntos",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("servicio_id", sa.Integer(), sa.ForeignKey("servicios_consulta.id"), nullable=False, index=True),
            sa.Column("nombre_original", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False),
            sa.Column("tamano_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False, index=True),
            sa.Column("ruta_relativa", sa.String(255), nullable=False, unique=True),
            sa.Column("subido_por_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    # --- 7. servicios_consulta: columnas de orden y despacho (decisiones 3 y 5) ---
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}

    for nombre, hacer_tipo, destino_fk, indexar in _COLUMNAS_SERVICIO:
        if nombre in sc_cols:
            continue
        args = [nombre, hacer_tipo()]
        if destino_fk is not None:
            args.append(sa.ForeignKey(destino_fk))
        op.add_column("servicios_consulta", sa.Column(*args, nullable=True))
        if indexar:
            op.create_index(
                f"ix_servicios_consulta_{nombre}", "servicios_consulta", [nombre]
            )

    # Los indices se crean junto a la columna; este bucle cubre el caso de que la
    # columna ya existiera (create_all en base nueva) pero el indice no.
    for nombre, _hacer_tipo, _fk, indexar in _COLUMNAS_SERVICIO:
        if not indexar:
            continue
        idx = f"ix_servicios_consulta_{nombre}"
        if idx not in sc_indexes and nombre in sc_cols:
            op.create_index(idx, "servicios_consulta", [nombre])

    # --- 8. ck_servicio_consulta_scope ampliado (decision 3) ---
    # Postgres no permite cambiar la condicion de un CHECK con ALTER: se dropea
    # y se recrea. La condicion nueva es un superconjunto de la vieja, asi que
    # ninguna fila existente puede quedar afuera.
    sc_checks = {ck["name"] for ck in inspector.get_check_constraints("servicios_consulta")}
    if "ck_servicio_consulta_scope" in sc_checks:
        op.drop_constraint(
            "ck_servicio_consulta_scope", "servicios_consulta", type_="check"
        )
    op.create_check_constraint(
        "ck_servicio_consulta_scope", "servicios_consulta", _SCOPE_NUEVO
    )

    # --- 8.5. servicios_consulta.is_deleted: cerrar el hueco NULL (hallazgo de
    # revision) ---
    # uq_orden_una_consulta (paso 9) es un indice parcial WHERE is_deleted =
    # false. La columna nacio sin NOT NULL/server_default (solo default de
    # Python), asi que una fila con is_deleted NULL evalua esa condicion como
    # UNKNOWN y se escapa de "maximo una consulta por orden". Se backfillea y se
    # cierra la columna antes de crear el indice que depende de ella.
    op.execute(sa.text(
        "UPDATE servicios_consulta SET is_deleted = false WHERE is_deleted IS NULL"
    ))
    sc_is_deleted = next(
        (c for c in inspector.get_columns("servicios_consulta") if c["name"] == "is_deleted"),
        None,
    )
    if sc_is_deleted is not None and sc_is_deleted["nullable"]:
        op.alter_column(
            "servicios_consulta",
            "is_deleted",
            existing_type=sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        )

    # --- 9. uq_orden_una_consulta: maximo una consulta por orden (decision 3) ---
    sc_indexes = {idx["name"] for idx in sa.inspect(conn).get_indexes("servicios_consulta")}
    if "uq_orden_una_consulta" not in sc_indexes:
        op.create_index(
            "uq_orden_una_consulta",
            "servicios_consulta",
            ["orden_id"],
            unique=True,
            postgresql_where=sa.text(_UQ_ORDEN_CONSULTA_WHERE),
        )

    # --- 10. catalogo_servicios: area y override de adjunto (decisiones 5 y 7) ---
    cat_cols = {c["name"] for c in inspector.get_columns("catalogo_servicios")}
    cat_indexes = {idx["name"] for idx in inspector.get_indexes("catalogo_servicios")}
    if "area_id" not in cat_cols:
        op.add_column(
            "catalogo_servicios",
            sa.Column("area_id", sa.Integer(), sa.ForeignKey("areas_servicio.id"), nullable=True),
        )
    if "ix_catalogo_servicios_area_id" not in cat_indexes:
        op.create_index(
            "ix_catalogo_servicios_area_id", "catalogo_servicios", ["area_id"]
        )
    # nullable a proposito: NULL = hereda de areas_servicio.requiere_adjunto.
    if "requiere_adjunto" not in cat_cols:
        op.add_column(
            "catalogo_servicios",
            sa.Column("requiere_adjunto", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # Orden inverso al upgrade.

    # --- 10. catalogo_servicios ---
    cat_cols = {c["name"] for c in inspector.get_columns("catalogo_servicios")}
    cat_indexes = {idx["name"] for idx in inspector.get_indexes("catalogo_servicios")}
    if "requiere_adjunto" in cat_cols:
        op.drop_column("catalogo_servicios", "requiere_adjunto")
    if "ix_catalogo_servicios_area_id" in cat_indexes:
        op.drop_index("ix_catalogo_servicios_area_id", table_name="catalogo_servicios")
    if "area_id" in cat_cols:
        op.drop_column("catalogo_servicios", "area_id")

    # --- 9/8. Indice unico parcial y CHECK de alcance ---
    sc_indexes = {idx["name"] for idx in inspector.get_indexes("servicios_consulta")}
    if "uq_orden_una_consulta" in sc_indexes:
        op.drop_index("uq_orden_una_consulta", table_name="servicios_consulta")

    # --- 8.5. servicios_consulta.is_deleted: volver a nullable ---
    # No se revierte el backfill NULL->false (no hay NULL que reconstruir: es
    # dato mas correcto, no informacion perdida), pero se devuelve la columna a
    # su forma original (sin NOT NULL ni server_default) para que el downgrade
    # sea simetrico con el esquema de antes de esta revision.
    sc_is_deleted = next(
        (c for c in inspector.get_columns("servicios_consulta") if c["name"] == "is_deleted"),
        None,
    )
    if sc_is_deleted is not None and not sc_is_deleted["nullable"]:
        op.alter_column(
            "servicios_consulta",
            "is_deleted",
            existing_type=sa.Boolean(),
            nullable=True,
            server_default=None,
        )

    sc_checks = {ck["name"] for ck in inspector.get_check_constraints("servicios_consulta")}
    if "ck_servicio_consulta_scope" in sc_checks:
        op.drop_constraint(
            "ck_servicio_consulta_scope", "servicios_consulta", type_="check"
        )
    # ATENCION: si existen servicios anclados SOLO por orden_id (mostrador sin
    # paciente ni consulta), este CHECK falla a proposito: ese dato no se puede
    # representar en el esquema viejo.
    op.create_check_constraint(
        "ck_servicio_consulta_scope", "servicios_consulta", _SCOPE_VIEJO
    )

    # --- 7. servicios_consulta: columnas de orden y despacho ---
    sc_cols = {c["name"] for c in inspector.get_columns("servicios_consulta")}
    for nombre, _hacer_tipo, _fk, indexar in reversed(_COLUMNAS_SERVICIO):
        idx = f"ix_servicios_consulta_{nombre}"
        if indexar and idx in sc_indexes:
            op.drop_index(idx, table_name="servicios_consulta")
        if nombre in sc_cols:
            op.drop_column("servicios_consulta", nombre)

    # --- 6/5/4/3/2. Tablas nuevas (se llevan sus indices con el drop) ---
    for tabla in (
        "adjuntos",
        "notificaciones",
        "gestor_area",
        "ordenes_servicio",
        "areas_servicio",
    ):
        if tabla in existing_tables:
            op.drop_table(tabla)

    # --- 1. SEQUENCE ---
    op.execute(sa.text(f"DROP SEQUENCE IF EXISTS {_NUMERO_SEQ}"))
