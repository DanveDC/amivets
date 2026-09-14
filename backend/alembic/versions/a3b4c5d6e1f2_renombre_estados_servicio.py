"""Renombre de estados de servicios_consulta (Tarea 06, FASE 2 etapa 2b)

Revision ID: a3b4c5d6e1f2
Revises: f2a3b4c5d6e1
Create Date: 2026-09-13 19:05:00.000000

Decision 4 de docs/diseno/ordenes-de-servicio.md: el vocabulario de
ServicioConsulta.estado pasa a la maquina de estados de la orden.

    Pendiente                      -> SOLICITADO
    Aplicado, facturado = false    -> EJECUTADO
    Aplicado, facturado = true     -> FACTURADO
    Cancelado                      -> CANCELADO

Notas:

- `Aplicado` se parte en dos por el booleano `facturado`, que se CONSERVA (es
  redundante con estado = 'FACTURADO', pero lo escriben en bloque
  facturacion_service.py y lo filtra servicios.py; sacarlo es otro refactor).
- Solo migra datos: la columna sigue siendo String(50) sin CHECK, igual que
  Consulta.estado y Factura.estado. No se agrega restriccion en esta revision
  porque el ciclo de vida completo (ASIGNADO / EN_PROCESO) recien llega con los
  endpoints de despacho.
- Idempotente por construccion: cada UPDATE filtra por el nombre viejo, asi que
  una segunda corrida no encuentra filas. No hacen falta guardas de inspector.
- El orden importa dentro del par `Aplicado`: la primera sentencia se queda con
  las no facturadas y la segunda con el resto, ambas filtrando todavia por
  'Aplicado'.

Estilo (docs/tecnico/inventario-actual.md §5): manual, sin autogenerate,
backfill en SQL crudo via op.execute, downgrade() implementado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e1f2'
down_revision: Union[str, None] = 'f2a3b4c5d6e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Pendiente -> SOLICITADO (sin importar `facturado`: hay filas historicas
    # con facturado = true y estado Pendiente, y la Decision 4 solo desdobla el
    # caso Aplicado).
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'SOLICITADO' "
        "WHERE estado = 'Pendiente'"
    ))

    # Aplicado + facturado = false -> EJECUTADO.
    # `facturado` puede ser NULL en filas viejas: NOT TRUE cubre false y NULL,
    # que es la direccion segura (un servicio sin marca de facturado no es una
    # linea ya cobrada).
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'EJECUTADO' "
        "WHERE estado = 'Aplicado' AND facturado IS NOT TRUE"
    ))

    # Aplicado + facturado = true -> FACTURADO.
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'FACTURADO' "
        "WHERE estado = 'Aplicado' AND facturado IS TRUE"
    ))

    # Cancelado -> CANCELADO.
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'CANCELADO' "
        "WHERE estado = 'Cancelado'"
    ))


def downgrade() -> None:
    # Mapeo inverso completo. EJECUTADO y FACTURADO colapsan los dos en
    # 'Aplicado', que es exactamente de donde salieron: el booleano `facturado`
    # no se toca en ninguna direccion, asi que la distincion no se pierde y un
    # upgrade posterior reconstruye el mismo reparto.
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'Pendiente' "
        "WHERE estado = 'SOLICITADO'"
    ))
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'Aplicado' "
        "WHERE estado IN ('EJECUTADO', 'FACTURADO')"
    ))
    op.execute(sa.text(
        "UPDATE servicios_consulta SET estado = 'Cancelado' "
        "WHERE estado = 'CANCELADO'"
    ))
