from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import PropietarioCreate, PropietarioUpdate, PropietarioResponse
from app.services.propietario_service import PropietarioService

router = APIRouter(prefix="/api/propietarios", tags=["Propietarios"])


@router.post("/", response_model=PropietarioResponse, status_code=status.HTTP_201_CREATED)
def crear_propietario(
    propietario: PropietarioCreate,
    db: Session = Depends(get_db)
):
    """Crea un nuevo propietario"""
    return PropietarioService.crear_propietario(db, propietario)


@router.get("/{propietario_id}", response_model=PropietarioResponse)
def obtener_propietario(
    propietario_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene un propietario por ID"""
    propietario = PropietarioService.obtener_propietario(db, propietario_id)
    if not propietario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Propietario no encontrado"
        )
    return propietario


@router.get("/", response_model=List[PropietarioResponse])
def listar_propietarios(
    skip: int = 0,
    limit: int = 100,
    activo: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """Lista todos los propietarios con filtros opcionales"""
    return PropietarioService.listar_propietarios(db, skip, limit, activo)


@router.put("/{propietario_id}", response_model=PropietarioResponse)
def actualizar_propietario(
    propietario_id: int,
    propietario: PropietarioUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza un propietario existente"""
    propietario_actualizado = PropietarioService.actualizar_propietario(db, propietario_id, propietario)
    if not propietario_actualizado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Propietario no encontrado"
        )
    return propietario_actualizado


@router.delete("/{propietario_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_propietario(
    propietario_id: int,
    db: Session = Depends(get_db)
):
    """Elimina (desactiva) un propietario"""
    if not PropietarioService.eliminar_propietario(db, propietario_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Propietario no encontrado"
        )
    return None
