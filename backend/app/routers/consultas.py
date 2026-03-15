from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import (
    ConsultaCreate, ConsultaUpdate, ConsultaResponse,
    RecetaCreate, RecetaResponse
)
from app.models.models import Consulta, Receta, DetalleReceta
from app.services.consulta_service import ConsultaService

router = APIRouter(prefix="/api/consultas", tags=["Consultas"])


@router.post("/", response_model=ConsultaResponse, status_code=status.HTTP_201_CREATED)
def crear_consulta(
    consulta: ConsultaCreate,
    db: Session = Depends(get_db)
):
    """Crea una nueva consulta"""
    return ConsultaService.crear_consulta(db, consulta)


@router.get("/{consulta_id}", response_model=ConsultaResponse)
def obtener_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una consulta por ID"""
    consulta = ConsultaService.obtener_consulta(db, consulta_id)
    if not consulta:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta


@router.get("/", response_model=List[ConsultaResponse])
def listar_consultas(
    skip: int = 0,
    limit: int = 100,
    mascota_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Lista todas las consultas con filtros opcionales"""
    return ConsultaService.listar_consultas(db, skip, limit, mascota_id)


@router.put("/{consulta_id}", response_model=ConsultaResponse)
def actualizar_consulta(
    consulta_id: int,
    consulta: ConsultaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza una consulta existente"""
    consulta_actualizada = ConsultaService.actualizar_consulta(db, consulta_id, consulta)
    if not consulta_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta_actualizada


@router.delete("/{consulta_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Elimina una consulta"""
    if not ConsultaService.eliminar_consulta(db, consulta_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return None

@router.post("/{consulta_id}/recetas", response_model=RecetaResponse, status_code=status.HTTP_201_CREATED)
def crear_receta(
    consulta_id: int,
    receta_data: RecetaCreate,
    db: Session = Depends(get_db)
):
    """Crea una receta médica para una consulta"""
    consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
        
    nueva_receta = Receta(
        consulta_id=consulta_id,
        indicaciones_generales=receta_data.indicaciones_generales
    )
    
    for det in receta_data.detalles:
        detalle = DetalleReceta(
            medicamento_id=det.medicamento_id,
            dosis=det.dosis,
            frecuencia=det.frecuencia,
            duracion=det.duracion
        )
        nueva_receta.detalles.append(detalle)
        
    db.add(nueva_receta)
    db.commit()
    db.refresh(nueva_receta)
    return nueva_receta

@router.get("/{consulta_id}/recetas", response_model=List[RecetaResponse])
def listar_recetas_por_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Trae las recetas y su detalle asociadas a una consulta"""
    recetas = db.query(Receta).filter(Receta.consulta_id == consulta_id).all()
    return recetas
