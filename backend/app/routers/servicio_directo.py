"""Servicio directo: venta de mostrador sin registrar cliente (decisión 7).
La lógica vive en services/servicio_directo_service.py."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Usuario
from app.routers.usuarios import require_roles
from app.schemas.schemas import FacturaResponse, ItemServicioDirectoResponse, VentaDirectaCreate
from app.services import servicio_directo_service

router = APIRouter(prefix="/api/servicio-directo", tags=["Servicio directo"])

# Mismos roles que POST /api/facturas/.
_ROLES_SERVICIO_DIRECTO = ("admin", "recepcionista")


@router.post("/ventas", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def registrar_venta_directa(
    data: VentaDirectaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(*_ROLES_SERVICIO_DIRECTO)),
):
    """Vende productos y servicios sin área en un solo paso: factura PAGADA
    por el total, orden FACTURADA con origen CAJA_RAPIDA (valor histórico que
    se conserva). Sin propietario_id se factura a "Consumidor final"."""
    return servicio_directo_service.registrar_venta_directa(db, data, current_user)


@router.get("/items", response_model=List[ItemServicioDirectoResponse])
def buscar_items(
    q: Optional[str] = Query(None, max_length=100),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_SERVICIO_DIRECTO)),
):
    """Productos (Inventario PRODUCTO activo) y servicios del catálogo
    (activos, sin área) vendibles en servicio directo, filtrados por nombre o
    código."""
    return servicio_directo_service.buscar_items(db, q, limit)
