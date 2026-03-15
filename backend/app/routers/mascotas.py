from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import MascotaCreate, MascotaUpdate, MascotaResponse, MascotaTransfer
from app.services.mascota_service import MascotaService

router = APIRouter(prefix="/api/mascotas", tags=["Mascotas"])


@router.post("/", response_model=MascotaResponse, status_code=status.HTTP_201_CREATED)
def crear_mascota(
    mascota: MascotaCreate,
    db: Session = Depends(get_db)
):
    """Crea una nueva mascota"""
    return MascotaService.crear_mascota(db, mascota)


@router.get("/{mascota_id}", response_model=MascotaResponse)
def obtener_mascota(
    mascota_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una mascota por ID"""
    mascota = MascotaService.obtener_mascota(db, mascota_id)
    if not mascota:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mascota no encontrada"
        )
    return mascota


@router.get("/", response_model=List[MascotaResponse])
def listar_mascotas(
    skip: int = 0,
    limit: int = 100,
    propietario_id: Optional[int] = None,
    activo: Optional[bool] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Lista todas las mascotas con filtros opcionales y búsqueda"""
    return MascotaService.listar_mascotas(db, skip, limit, propietario_id, activo, search)


@router.post("/{mascota_id}/transferir", response_model=MascotaResponse)
def transferir_mascota(
    mascota_id: int,
    transfer_data: MascotaTransfer,
    db: Session = Depends(get_db)
):
    """Transfiere una mascota a otro propietario"""
    return MascotaService.cambiar_propietario(
        db, mascota_id, transfer_data.nuevo_propietario_id, transfer_data.motivo
    )


@router.get("/{mascota_id}/peso-history")
def obtener_historial_peso(
    mascota_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene el historial de peso de una mascota"""
    return MascotaService.obtener_historial_peso(db, mascota_id)


@router.put("/{mascota_id}", response_model=MascotaResponse)
def actualizar_mascota(
    mascota_id: int,
    mascota: MascotaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza una mascota existente"""
    mascota_actualizada = MascotaService.actualizar_mascota(db, mascota_id, mascota)
    if not mascota_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mascota no encontrada"
        )
    return mascota_actualizada


@router.delete("/{mascota_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_mascota(
    mascota_id: int,
    db: Session = Depends(get_db)
):
    """Elimina (desactiva) una mascota"""
    if not MascotaService.eliminar_mascota(db, mascota_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mascota no encontrada"
        )
    return None
