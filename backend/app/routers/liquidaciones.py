from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Consulta, Factura, Liquidacion, LiquidacionDetalle, Usuario
from app.routers.reportes import _rango_utc
from app.routers.usuarios import get_current_admin
from app.schemas.schemas import (
    LiquidacionCalculoRequest,
    LiquidacionPreviewResponse,
    LiquidacionResponse,
    TarifaConsultaResponse,
    TarifaConsultaUpdate,
)

router = APIRouter(prefix="/api/liquidaciones", tags=["Liquidaciones a Veterinarios"])


def _consultas_elegibles(db: Session, veterinario_id: int, dt_inicio, dt_fin):
    """Consultas de un veterinario en el rango dado que todavia no fueron
    pagadas a ese profesional.

    Dos condiciones, ambas obligatorias por la regla de Daniel (Unidad E,
    docs/tareas/04-kpis-recetas-y-veterinarios.md):
    - Factura.estado == "PAGADA": pendientes y parciales no cuentan todavia.
    - NOT IN LiquidacionDetalle.consulta_id: una consulta que ya fue
      incluida en una liquidacion (de este calculo o de uno anterior, sea
      cual sea el rango) nunca vuelve a ser elegible. Sin este filtro,
      recalcular sobre un rango que se superpone con uno ya liquidado
      pagaria dos veces la misma consulta.
    """
    ya_liquidadas = db.query(LiquidacionDetalle.consulta_id)
    return (
        db.query(Consulta)
        .join(Factura, Factura.consulta_id == Consulta.id)
        .filter(
            Consulta.veterinario_id == veterinario_id,
            Factura.estado == "PAGADA",
            Consulta.fecha_consulta >= dt_inicio,
            Consulta.fecha_consulta <= dt_fin,
            ~Consulta.id.in_(ya_liquidadas),
        )
        # Defensa en profundidad: si alguna vez una Consulta tuviera mas de
        # una Factura PAGADA, el join la devolveria duplicada dentro del
        # mismo batch y tumbaria el calculo entero contra el unique de
        # LiquidacionDetalle.consulta_id.
        .distinct()
        .order_by(Consulta.fecha_consulta.asc())
        .all()
    )


def _factura_pagada_id(db: Session, consulta_id: int) -> int:
    """Id de la Factura PAGADA de esta consulta -- la misma condicion que ya
    filtra _consultas_elegibles. No usar Consulta.factura (relationship
    lazy sin filtro de estado): si una consulta llegara a tener mas de una
    Factura, esa relacion no garantiza devolver la PAGADA, y el factura_id
    persistido en LiquidacionDetalle debe ser exactamente el que hizo a la
    consulta elegible.
    """
    factura = (
        db.query(Factura)
        .filter(Factura.consulta_id == consulta_id, Factura.estado == "PAGADA")
        .first()
    )
    return factura.id


@router.get("/tarifas", response_model=List[TarifaConsultaResponse])
def listar_tarifas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """Lista veterinarios con su tarifa por consulta configurada (Solo Admin)"""
    return db.query(Usuario).filter(Usuario.role == "veterinario").all()


@router.put("/tarifa/{veterinario_id}", response_model=TarifaConsultaResponse)
def actualizar_tarifa(
    veterinario_id: int,
    data: TarifaConsultaUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """Configura el monto fijo que cobra un veterinario por consulta (Solo Admin)"""
    vet = db.query(Usuario).filter(Usuario.id == veterinario_id).first()
    if not vet:
        raise HTTPException(status_code=404, detail="Veterinario no encontrado")
    if vet.role != "veterinario":
        raise HTTPException(status_code=400, detail="El usuario indicado no tiene rol veterinario")
    vet.tarifa_consulta = data.tarifa_consulta
    db.commit()
    db.refresh(vet)
    return vet


@router.get("/preview", response_model=LiquidacionPreviewResponse)
def preview_liquidacion(
    veterinario_id: int,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """
    Muestra el desglose que resultaria de calcular la liquidacion para este
    veterinario y rango, SIN persistir nada. Pensado para revisar antes de
    confirmar con POST /calcular.
    """
    vet = db.query(Usuario).filter(Usuario.id == veterinario_id).first()
    if not vet:
        raise HTTPException(status_code=404, detail="Veterinario no encontrado")
    if vet.role != "veterinario":
        raise HTTPException(status_code=400, detail="El usuario indicado no tiene rol veterinario")
    if vet.tarifa_consulta is None:
        raise HTTPException(
            status_code=400,
            detail="El veterinario no tiene una tarifa por consulta configurada",
        )

    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)
    if not dt_inicio or not dt_fin:
        raise HTTPException(status_code=400, detail="fecha_inicio y fecha_fin son obligatorias")

    consultas = _consultas_elegibles(db, veterinario_id, dt_inicio, dt_fin)
    tarifa = vet.tarifa_consulta

    return {
        "veterinario_id": vet.id,
        "veterinario": vet.username,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "tarifa_consulta": tarifa,
        "total_consultas": len(consultas),
        "total": tarifa * len(consultas),
        "consultas": [
            {
                "consulta_id": c.id,
                "factura_id": _factura_pagada_id(db, c.id),
                "fecha_consulta": c.fecha_consulta,
                "tarifa_aplicada": tarifa,
            }
            for c in consultas
        ],
    }


@router.post("/calcular", response_model=LiquidacionResponse, status_code=status.HTTP_201_CREATED)
def calcular_liquidacion(
    payload: LiquidacionCalculoRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """
    Calcula y persiste una liquidacion: monto fijo por consulta atendida,
    solo sobre consultas con factura PAGADA que no hayan sido liquidadas
    antes. La tarifa vigente del veterinario se copia (snapshot) a cada
    fila de detalle en este momento -- ni un cambio posterior de tarifa, ni
    una anulacion posterior de la factura, puede alterar lo ya liquidado
    (regla de Daniel, Unidad E de docs/tareas/04-kpis-recetas-y-veterinarios.md).
    """
    vet = db.query(Usuario).filter(Usuario.id == payload.veterinario_id).first()
    if not vet:
        raise HTTPException(status_code=404, detail="Veterinario no encontrado")
    if vet.role != "veterinario":
        raise HTTPException(status_code=400, detail="El usuario indicado no tiene rol veterinario")
    if vet.tarifa_consulta is None:
        raise HTTPException(
            status_code=400,
            detail="El veterinario no tiene una tarifa por consulta configurada",
        )

    dt_inicio, dt_fin = _rango_utc(payload.fecha_inicio, payload.fecha_fin)
    if not dt_inicio or not dt_fin:
        raise HTTPException(status_code=400, detail="fecha_inicio y fecha_fin son obligatorias")

    consultas = _consultas_elegibles(db, payload.veterinario_id, dt_inicio, dt_fin)
    tarifa = vet.tarifa_consulta

    nueva_liquidacion = Liquidacion(
        veterinario_id=vet.id,
        fecha_inicio=dt_inicio,
        fecha_fin=dt_fin,
        total=tarifa * len(consultas),
    )
    db.add(nueva_liquidacion)
    db.flush()  # Necesitamos nueva_liquidacion.id para los detalles

    for c in consultas:
        db.add(
            LiquidacionDetalle(
                liquidacion_id=nueva_liquidacion.id,
                consulta_id=c.id,
                factura_id=_factura_pagada_id(db, c.id),
                tarifa_aplicada=tarifa,
                fecha_consulta=c.fecha_consulta,
            )
        )

    try:
        db.commit()
    except IntegrityError:
        # El unique en LiquidacionDetalle.consulta_id es el candado de
        # ultima linea (ver models.py): si dos calculos concurrentes
        # llegaron a incluir la misma consulta, esta se rechaza en vez de
        # duplicar el pago.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Alguna de las consultas ya fue incluida en otra liquidacion. Reintentá el calculo.",
        )

    db.refresh(nueva_liquidacion)
    return nueva_liquidacion


@router.get("/", response_model=List[LiquidacionResponse])
def listar_liquidaciones(
    veterinario_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """Historial de liquidaciones ya calculadas, con su detalle (Solo Admin)"""
    query = db.query(Liquidacion)
    if veterinario_id:
        query = query.filter(Liquidacion.veterinario_id == veterinario_id)
    return query.order_by(Liquidacion.fecha_calculo.desc()).all()
