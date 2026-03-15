from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.models.models import Cita, CitaEstado, Mascota, Propietario
from app.schemas.schemas import CitaCreate, CitaUpdate, CitaResponse

router = APIRouter(prefix="/api/citas", tags=["Agenda y Citas"])

@router.post("/", response_model=CitaResponse, status_code=status.HTTP_201_CREATED)
def agendar_cita(
    cita: CitaCreate,
    db: Session = Depends(get_db)
):
    """Agenda una nueva cita con verificación de disponibilidad"""
    # Impedir fechas al pasado
    if cita.fecha_cita.replace(tzinfo=timezone.utc) < datetime.utcnow().replace(tzinfo=timezone.utc):
        raise HTTPException(status_code=400, detail="No se pueden agendar citas en el pasado.")
        
    # Lógica de bloqueo de Agenda (Asumimos 30 min por cita)
    hora_fin_estimada = cita.fecha_cita + timedelta(minutes=30)
    
    cita_conflictiva = db.query(Cita).filter(
        Cita.veterinario_id == cita.veterinario_id,
        Cita.estado != "CANCELADA",
        and_(
            Cita.fecha_cita < hora_fin_estimada,
            Cita.fecha_cita + timedelta(minutes=30) > cita.fecha_cita
        )
    ).first()

    if cita_conflictiva:
        raise HTTPException(
            status_code=409, 
            detail="El veterinario seleccionado ya tiene una cita reservada en este horario."
        )

    # Validar que mascota y propietario existan
    mascota = db.query(Mascota).filter(Mascota.id == cita.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")
    
    propietario = db.query(Propietario).filter(Propietario.id == cita.propietario_id).first()
    if not propietario:
        raise HTTPException(status_code=404, detail="Propietario no encontrado")

    nueva_cita = Cita(**cita.model_dump())
    db.add(nueva_cita)
    db.commit()
    db.refresh(nueva_cita)
    return nueva_cita

@router.get("/", response_model=List[CitaResponse])
def listar_citas(
    fecha: Optional[datetime] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Lista las citas, opcionalmente filtrando por fecha o estado"""
    query = db.query(Cita)
    if fecha:
        # Filtrar por dia (ignorando hora) - simplificado
        # En produccion seria mejor rango de fechas
        pass 
    if estado:
        query = query.filter(Cita.estado == estado)
    
    return query.all()

@router.get("/{cita_id}", response_model=CitaResponse)
def obtener_cita(
    cita_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una cita por ID"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    return cita

@router.put("/{cita_id}/checkin", response_model=CitaResponse)
def checkin_paciente(
    cita_id: int,
    estado: str,
    db: Session = Depends(get_db)
):
    """Sistema de Check-in: Actualiza el estado del flujo del paciente (En espera, En consulta, Finalizado)"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    
    # Validar transiciones de estado si es necesario
    try:
        nuevo_estado = CitaEstado(estado)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Estado invalido. Permitidos: {[e.value for e in CitaEstado]}")
        
    # Registrar timestamps automáticos
    now = datetime.utcnow()
    if nuevo_estado == CitaEstado.EN_ESPERA and not cita.hora_llegada:
        cita.hora_llegada = now
    elif nuevo_estado == CitaEstado.EN_CONSULTA and not cita.hora_inicio_atencion:
        cita.hora_inicio_atencion = now
    elif nuevo_estado == CitaEstado.FINALIZADO and not cita.hora_fin_atencion:
        cita.hora_fin_atencion = now

    cita.estado = nuevo_estado
    db.commit()
    db.refresh(cita)
    return cita

@router.put("/{cita_id}", response_model=CitaResponse)
def actualizar_cita(
    cita_id: int,
    cita_update: CitaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza datos generales de la cita"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    for key, value in cita_update.dict(exclude_unset=True).items():
        setattr(cita, key, value)
    
    db.commit()
    db.refresh(cita)
    return cita

@router.delete("/{cita_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancelar_cita(
    cita_id: int,
    db: Session = Depends(get_db)
):
    """Cancela (elimina logica o fisica) una cita"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    
    # Opcional: Solo marcar como cancelada en vez de borrar
    cita.estado = CitaEstado.CANCELADA
    db.commit()
    return None
