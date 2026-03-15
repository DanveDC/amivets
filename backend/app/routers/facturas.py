from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import FacturaCreate, FacturaUpdate, FacturaResponse
from app.services.facturacion_service import FacturacionService

router = APIRouter(prefix="/api/facturas", tags=["Facturación"])


@router.post("/", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def crear_factura(
    factura: FacturaCreate,
    db: Session = Depends(get_db)
):
    """
    Crea una nueva factura y descuenta automáticamente el inventario.
    
    - Valida stock disponible
    - Descuenta productos del inventario
    - Calcula totales automáticamente
    - Genera número de factura único
    """
    return FacturacionService.crear_factura(db, factura)


@router.get("/{factura_id}", response_model=FacturaResponse)
def obtener_factura(
    factura_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una factura por ID con todos sus detalles"""
    factura = FacturacionService.obtener_factura(db, factura_id)
    if not factura:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura


@router.get("/", response_model=List[FacturaResponse])
def listar_facturas(
    skip: int = 0,
    limit: int = 100,
    propietario_id: Optional[int] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Lista todas las facturas con filtros opcionales"""
    return FacturacionService.listar_facturas(db, skip, limit, propietario_id, estado)


@router.put("/{factura_id}", response_model=FacturaResponse)
def actualizar_factura(
    factura_id: int,
    factura: FacturaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza el estado o información de una factura"""
    factura_actualizada = FacturacionService.actualizar_factura(db, factura_id, factura)
    if not factura_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura_actualizada


@router.post("/{factura_id}/anular", response_model=FacturaResponse)
def anular_factura(
    factura_id: int,
    db: Session = Depends(get_db)
):
    """
    Anula una factura y devuelve el stock al inventario.
    
    - Cambia el estado a ANULADA
    - Devuelve productos al inventario
    """
    factura_anulada = FacturacionService.anular_factura(db, factura_id)
    if not factura_anulada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura_anulada
