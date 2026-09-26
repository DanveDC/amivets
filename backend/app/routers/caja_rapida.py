"""Caja rápida: venta de mostrador sin registrar cliente (caja-rapida,
decisión 7). La lógica vive en services/caja_rapida_service.py."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Usuario
from app.routers.usuarios import require_roles
from app.schemas.schemas import FacturaResponse, ItemCajaResponse, VentaRapidaCreate
from app.services import caja_rapida_service

router = APIRouter(prefix="/api/caja-rapida", tags=["Caja rápida"])

# Mismos roles que POST /api/facturas/.
_ROLES_CAJA = ("admin", "recepcionista")


@router.post("/ventas", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def registrar_venta(
    data: VentaRapidaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(*_ROLES_CAJA)),
):
    """Vende productos y servicios sin área en un solo paso: factura PAGADA
    por el total, orden FACTURADA con origen CAJA_RAPIDA. Sin propietario_id
    se factura a "Consumidor final"."""
    return caja_rapida_service.registrar_venta(db, data, current_user)


@router.get("/items", response_model=List[ItemCajaResponse])
def buscar_items(
    q: Optional[str] = Query(None, max_length=100),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CAJA)),
):
    """Productos (Inventario PRODUCTO activo) y servicios del catálogo
    (activos, sin área) vendibles en caja, filtrados por nombre o código."""
    return caja_rapida_service.buscar_items(db, q, limit)
