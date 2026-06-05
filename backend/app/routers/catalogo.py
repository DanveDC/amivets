from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional

from app.core.database import get_db
from app.models.models import CatalogoServicio
from app.schemas.schemas import CatalogoServicioCreate, CatalogoServicioUpdate, CatalogoServicioResponse

router = APIRouter(prefix="/api/catalogo", tags=["Catalogo de Servicios"])


@router.get("/categorias", response_model=List[str])
def listar_categorias(db: Session = Depends(get_db)):
    """Returns the list of unique active category names"""
    rows = (
        db.query(CatalogoServicio.categoria)
        .filter(CatalogoServicio.activo == True)
        .distinct()
        .order_by(CatalogoServicio.categoria)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/", response_model=List[CatalogoServicioResponse])
def listar_servicios(
    categoria: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    solo_activos: bool = Query(True),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """List catalog services with optional category and text search filters"""
    query = db.query(CatalogoServicio)

    if solo_activos:
        query = query.filter(CatalogoServicio.activo == True)

    if categoria:
        query = query.filter(CatalogoServicio.categoria == categoria)

    if q:
        query = query.filter(CatalogoServicio.nombre.ilike(f"%{q}%"))

    return query.order_by(CatalogoServicio.nombre).offset(skip).limit(limit).all()


@router.post("/", response_model=CatalogoServicioResponse, status_code=status.HTTP_201_CREATED)
def crear_servicio(
    servicio: CatalogoServicioCreate,
    db: Session = Depends(get_db),
):
    """Create a new service in the catalog"""
    nuevo = CatalogoServicio(**servicio.model_dump())
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo


@router.get("/{servicio_id}", response_model=CatalogoServicioResponse)
def obtener_servicio(servicio_id: int, db: Session = Depends(get_db)):
    """Get a catalog service by ID"""
    servicio = db.query(CatalogoServicio).filter(CatalogoServicio.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return servicio


@router.put("/{servicio_id}", response_model=CatalogoServicioResponse)
def actualizar_servicio(
    servicio_id: int,
    data: CatalogoServicioUpdate,
    db: Session = Depends(get_db),
):
    """Update a catalog service"""
    servicio = db.query(CatalogoServicio).filter(CatalogoServicio.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(servicio, key, value)

    db.commit()
    db.refresh(servicio)
    return servicio


@router.delete("/{servicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_servicio(servicio_id: int, db: Session = Depends(get_db)):
    """Soft-delete a catalog service (sets activo=False)"""
    servicio = db.query(CatalogoServicio).filter(CatalogoServicio.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    servicio.activo = False
    db.commit()
    return None
