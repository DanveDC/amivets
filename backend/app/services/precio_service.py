"""Historial de precios de lista (Tarea 08, decision 4).

Punto UNICO de escritura del precio de venta de materiales y servicios: quien
llama a `registrar_cambio_precio()` actualiza la columna viva
(`Inventario.precio_unitario` / `CatalogoServicio.precio_ref`) y encola la fila
de historial en la MISMA transaccion. Imposible mover una sin la otra.

Toda la aritmetica de dinero es Decimal cuantizado a 2 decimales con
ROUND_HALF_UP; el `str()` intermedio evita heredar la cola binaria del float
(decision 8). La MISMA cuantizacion se usa para el guard "mismo precio no
registra" y para el valor persistido, o un cambio de 100.001 a 100.004 se
registraria guardando dos veces 100.00 (riesgo "doble cuantizacion").
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Union

from sqlalchemy.orm import Session

from app.models.models import (
    CatalogoServicio,
    HistorialPrecioInventario,
    HistorialPrecioServicio,
    Inventario,
)

DOS_DEC = Decimal("0.01")

EntidadPrecio = Union[Inventario, CatalogoServicio]
FilaHistorial = Union[HistorialPrecioInventario, HistorialPrecioServicio]


def cuantizar_precio(valor) -> Decimal:
    """Redondea a 2 decimales pasando por str() para no arrastrar ruido de float."""
    if valor is None:
        valor = 0
    return Decimal(str(valor)).quantize(DOS_DEC, rounding=ROUND_HALF_UP)


def _config_entidad(entidad_row: EntidadPrecio):
    """(atributo_precio, modelo_historial, columna_fk) segun el tipo de entidad."""
    if isinstance(entidad_row, Inventario):
        return "precio_unitario", HistorialPrecioInventario, "inventario_id"
    if isinstance(entidad_row, CatalogoServicio):
        return "precio_ref", HistorialPrecioServicio, "catalogo_servicio_id"
    raise TypeError(
        f"Entidad sin historial de precios: {type(entidad_row).__name__}"
    )


def registrar_cambio_precio(
    db: Session,
    *,
    entidad_row: EntidadPrecio,
    precio_nuevo,
    usuario_id: Optional[int] = None,
    motivo: Optional[str] = None,
) -> Optional[FilaHistorial]:
    """Aplica un cambio de precio de lista y deja la fila de historial en la sesion.

    - Cuantiza precio viejo y nuevo a 2 decimales. Si el viejo no es NULL y
      ambos coinciden devuelve None (guardar el mismo precio no crea registro).
      Si el precio actual es NULL ("sin precio cargado") siempre es un cambio.
    - Si difieren: actualiza la columna viva de la entidad con el valor
      cuantizado y hace `db.add()` de la fila de historial con precio_anterior =
      viejo (NULL si la entidad no tenia precio), precio_nuevo = nuevo,
      usuario_id y motivo.
    - NO hace commit: el caller cierra la transaccion (misma unidad de trabajo).
    """
    attr_precio, modelo_hist, fk_col = _config_entidad(entidad_row)

    raw_anterior = getattr(entidad_row, attr_precio)
    # Un precio actual NULL ("sin precio cargado") se persiste como NULL, no como
    # 0.00: hay que conservar la distincion "sin dato" vs "gratis" (decision 7 +
    # riesgos conocidos del diseno). Solo se cuantiza cuando hay un valor real.
    precio_anterior_q = None if raw_anterior is None else cuantizar_precio(raw_anterior)
    precio_nuevo_q = cuantizar_precio(precio_nuevo)

    # Si el precio actual es NULL siempre es un cambio (nunca un no-op): solo se
    # compara contra el nuevo cuando habia un precio anterior real.
    if raw_anterior is not None and precio_nuevo_q == precio_anterior_q:
        return None

    setattr(entidad_row, attr_precio, precio_nuevo_q)

    hist = modelo_hist(
        precio_nuevo=precio_nuevo_q,
        precio_anterior=precio_anterior_q,
        usuario_id=usuario_id,
        motivo=motivo,
        **{fk_col: entidad_row.id},
    )
    db.add(hist)
    return hist
