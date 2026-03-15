from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.models import Cirugia, Mascota
from app.schemas.schemas import CirugiaCreate, CirugiaResponse

router = APIRouter(prefix="/api/cirugias", tags=["Quirófano"])

@router.post("/", response_model=CirugiaResponse, status_code=status.HTTP_201_CREATED)
def registrar_cirugia(cirugia: CirugiaCreate, db: Session = Depends(get_db)):
    """Registra un informe de cirugía"""
    db_cirugia = Cirugia(**cirugia.model_dump())
    db.add(db_cirugia)
    db.commit()
    db.refresh(db_cirugia)
    return db_cirugia

@router.get("/mascota/{mascota_id}", response_model=List[CirugiaResponse])
def historial_quirurgico(mascota_id: int, db: Session = Depends(get_db)):
    """Obtiene el historial de cirugías de una mascota"""
    return db.query(Cirugia).filter(Cirugia.mascota_id == mascota_id).all()
