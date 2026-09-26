"""Comisiones por servicio (comisiones-por-servicio, decisión 8). La lógica
vive en services/comision_service.py."""
from datetime import date
from io import BytesIO
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Usuario
from app.routers.usuarios import get_current_admin, get_current_user, require_roles
from app.schemas.schemas import (
    ComisionControlResponse,
    ConfiguracionComisionResponse,
    ConfiguracionComisionUpdate,
    EncargadoComisionResponse,
    LiquidacionComisionCreate,
    LiquidacionComisionResponse,
    PorcentajeEncargadoUpdate,
)
from app.services import comision_service
from app.services.pdf_service import PDFService

router = APIRouter(prefix="/api/comisiones", tags=["Comisiones"])


@router.get("/configuracion", response_model=ConfiguracionComisionResponse)
def ver_configuracion(db: Session = Depends(get_db), _: Usuario = Depends(get_current_admin)):
    return comision_service.obtener_configuracion(db)


@router.put("/configuracion", response_model=ConfiguracionComisionResponse)
def actualizar_configuracion(
    data: ConfiguracionComisionUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    return comision_service.actualizar_configuracion(db, data.porcentaje_defecto, current_user)


@router.get("/encargados", response_model=List[EncargadoComisionResponse])
def listar_encargados(db: Session = Depends(get_db), _: Usuario = Depends(get_current_admin)):
    """Veterinarios y gestores activos, con su porcentaje propio (si tienen)
    y el efectivo que se les aplica."""
    return comision_service.listar_encargados(db)


@router.put("/encargados/{usuario_id}", response_model=EncargadoComisionResponse)
def fijar_porcentaje(
    usuario_id: int,
    data: PorcentajeEncargadoUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    """`porcentaje` null quita el propio: el encargado vuelve al de defecto."""
    return comision_service.fijar_porcentaje_encargado(db, usuario_id, data.porcentaje)


@router.get("/", response_model=ComisionControlResponse)
def control(
    encargado_id: int = Query(..., gt=0),
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    """Pendientes (con el porcentaje actual), liquidadas (congeladas) y totales."""
    return comision_service.control(db, encargado_id, desde, hasta)


@router.get("/mias", response_model=ComisionControlResponse)
def mis_comisiones(
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(*comision_service.ROLES_ENCARGADO)),
):
    return comision_service.control(db, current_user.id, desde, hasta)


@router.get("/mias/liquidaciones", response_model=List[LiquidacionComisionResponse])
def mis_liquidaciones(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(*comision_service.ROLES_ENCARGADO)),
):
    """Solo las liquidaciones propias, de la más reciente a la más vieja
    (pantalla-encargado, "Mis comisiones")."""
    return comision_service.listar_liquidaciones(db, current_user.id)


@router.post("/liquidaciones", response_model=LiquidacionComisionResponse, status_code=status.HTTP_201_CREATED)
def liquidar(
    data: LiquidacionComisionCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    liq = comision_service.liquidar(db, data.encargado_id, data.desde, data.hasta, current_user)
    return comision_service.liquidacion_a_dict(db, liq)


@router.get("/liquidaciones", response_model=List[LiquidacionComisionResponse])
def listar_liquidaciones(
    encargado_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    return comision_service.listar_liquidaciones(db, encargado_id)


@router.get("/liquidaciones/{liquidacion_id}/pdf")
def descargar_pdf(
    liquidacion_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Comprobante con logo. Lo descarga el admin o el encargado dueño."""
    liq = comision_service.obtener_liquidacion(db, liquidacion_id)
    if current_user.role != "admin" and current_user.id != liq.encargado_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No podés ver la liquidación de otra persona")

    pdf = PDFService.generar_liquidacion_comision_pdf(comision_service.liquidacion_a_dict(db, liq), liq.encargado)
    if not pdf:
        raise HTTPException(status_code=500, detail="Error al generar el PDF de la liquidación")
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Liquidacion_{liq.numero}.pdf"},
    )
