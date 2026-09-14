from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.models import Cirugia, Mascota, Consulta, ServicioConsulta
from app.schemas.schemas import CirugiaCreate, CirugiaResponse
from app.routers.usuarios import require_roles

router = APIRouter(prefix="/api/cirugias", tags=["Quirófano"])

@router.post("/", response_model=CirugiaResponse, status_code=status.HTTP_201_CREATED)
def registrar_cirugia(
    cirugia: CirugiaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "veterinario")),
):
    """Registra un informe de cirugía"""
    db_cirugia = Cirugia(**cirugia.model_dump())
    db.add(db_cirugia)

    # Espejo ServicioConsulta: toda fila de detalle con consulta_id debe tener
    # su espejo, siempre (Tarea 09, decisión 2) — así facturación no pierde
    # datos. Mismo patrón que routers/clinico.py.
    if db_cirugia.consulta_id:
        consulta = db.query(Consulta).filter(Consulta.id == db_cirugia.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")
        db.flush()
        db.add(ServicioConsulta(
            consulta_id=db_cirugia.consulta_id,
            mascota_id=consulta.mascota_id,
            tipo_servicio="CIRUGIA",
            referencia_id=db_cirugia.id,
            nombre_servicio=f"CIRUGÍA: {db_cirugia.tipo_procedimiento}",
            cantidad=1.0,
            precio_unitario=db_cirugia.precio_aplicado,
            detalles_clinicos=f"Riesgo ASA: {db_cirugia.riesgo_asa or 'N/D'} | Cirujano ID: {db_cirugia.cirujano_id or 'N/D'}",
            estado="EJECUTADO",
        ))

    db.commit()
    db.refresh(db_cirugia)
    return db_cirugia

@router.get("/mascota/{mascota_id}", response_model=List[CirugiaResponse])
def historial_quirurgico(mascota_id: int, db: Session = Depends(get_db)):
    """Obtiene el historial de cirugías de una mascota"""
    return db.query(Cirugia).filter(Cirugia.mascota_id == mascota_id).all()
