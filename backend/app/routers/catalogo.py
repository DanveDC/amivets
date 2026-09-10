from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from typing import List, Optional

from app.core.database import get_db
from app.models.models import CatalogoServicio, RecetaServicio, Inventario
from app.schemas.schemas import (
    CatalogoServicioCreate,
    CatalogoServicioUpdate,
    CatalogoServicioResponse,
    RecetaServicioCreate,
    RecetaServicioUpdate,
    RecetaServicioResponse,
)

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


# ========== ABM de receta de servicio (Tarea 07, slice A) ==========
# La receta declara que materiales de inventario consume un servicio del
# catalogo y en que cantidad estandar. Sin logica de consumo aca: descontar
# stock al aplicar el servicio es slice B.


@router.get("/{servicio_id}/recetas", response_model=List[RecetaServicioResponse])
def listar_recetas_servicio(servicio_id: int, db: Session = Depends(get_db)):
    """Lista los materiales declarados en la receta de un servicio del catalogo."""
    servicio = db.query(CatalogoServicio).filter(CatalogoServicio.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    return (
        db.query(RecetaServicio)
        .options(joinedload(RecetaServicio.inventario))
        .filter(RecetaServicio.catalogo_servicio_id == servicio_id)
        .order_by(RecetaServicio.id)
        .all()
    )


@router.post(
    "/{servicio_id}/recetas",
    response_model=RecetaServicioResponse,
    status_code=status.HTTP_201_CREATED,
)
def agregar_receta_servicio(
    servicio_id: int,
    data: RecetaServicioCreate,
    db: Session = Depends(get_db),
):
    """Agrega una linea de material a la receta de un servicio.

    404 si el servicio o el material no existen; 409 si ese material ya
    figura en la receta de ese servicio (candado de la UNIQUE en DB).
    """
    servicio = db.query(CatalogoServicio).filter(CatalogoServicio.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    material = db.query(Inventario).filter(Inventario.id == data.inventario_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material de inventario no encontrado")

    # La linea de receta debe descontarse en la MISMA unidad en que se stockea el
    # material: "5 g" contra un material en "ml" restaria 5 de un saldo en ml (M1).
    unidad_material = material.unidad_medida or "unidad"
    if data.unidad_medida != unidad_material:
        raise HTTPException(
            status_code=422,
            detail=f"La unidad de la receta ('{data.unidad_medida}') no coincide con la del material '{material.nombre}' ('{unidad_material}')",
        )

    ya_existe = (
        db.query(RecetaServicio)
        .filter(
            RecetaServicio.catalogo_servicio_id == servicio_id,
            RecetaServicio.inventario_id == data.inventario_id,
        )
        .first()
    )
    if ya_existe:
        raise HTTPException(
            status_code=409,
            detail="Ese material ya esta en la receta de este servicio",
        )

    receta = RecetaServicio(
        catalogo_servicio_id=servicio_id,
        inventario_id=data.inventario_id,
        cantidad=data.cantidad,
        unidad_medida=data.unidad_medida,
    )
    db.add(receta)
    db.commit()
    db.refresh(receta)
    return receta


@router.put("/recetas/{receta_id}", response_model=RecetaServicioResponse)
def actualizar_receta_servicio(
    receta_id: int,
    data: RecetaServicioUpdate,
    db: Session = Depends(get_db),
):
    """Cambia la cantidad estandar o la unidad de una linea de receta."""
    receta = db.query(RecetaServicio).filter(RecetaServicio.id == receta_id).first()
    if not receta:
        raise HTTPException(status_code=404, detail="Linea de receta no encontrada")

    cambios = data.model_dump(exclude_unset=True)

    # Misma regla que el POST (M1): si se cambia la unidad, tiene que seguir
    # coincidiendo con la unidad base del material.
    if cambios.get("unidad_medida") is not None:
        inv = db.query(Inventario).filter(Inventario.id == receta.inventario_id).first()
        unidad_material = (inv.unidad_medida or "unidad") if inv else "unidad"
        if cambios["unidad_medida"] != unidad_material:
            raise HTTPException(
                status_code=422,
                detail=f"La unidad de la receta ('{cambios['unidad_medida']}') no coincide con la del material ('{unidad_material}')",
            )

    for key, value in cambios.items():
        setattr(receta, key, value)

    db.commit()
    db.refresh(receta)
    return receta


@router.delete("/recetas/{receta_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_receta_servicio(receta_id: int, db: Session = Depends(get_db)):
    """Quita una linea de material de la receta."""
    receta = db.query(RecetaServicio).filter(RecetaServicio.id == receta_id).first()
    if not receta:
        raise HTTPException(status_code=404, detail="Linea de receta no encontrada")

    db.delete(receta)
    db.commit()
    return None
