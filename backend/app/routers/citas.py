from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Cita, CitaEstado, Mascota, Propietario, Usuario
from app.schemas.schemas import CitaCreate, CitaUpdate, CitaResponse, CitaStatusUpdate
from app.routers.usuarios import require_roles

CLINIC_TZ = ZoneInfo(settings.CLINIC_TIMEZONE)

router = APIRouter(prefix="/api/citas", tags=["Agenda y Citas"])

# HALLAZGO DE SEGURIDAD (Tarea 10): este router nunca tuvo Depends(require_roles)
# en NINGUN endpoint -- los 6 estaban abiertos.
#
# CORRECCION a una suposicion previa (docs/tareas/10, docs/diseno/
# ordenes-de-servicio.md §9.4): se asumio que POST /api/citas/ (agendar_cita)
# era el endpoint del agendamiento publico por QR y por eso tenia que quedar
# anonimo. Verificado en vivo, NO es asi:
#   - static/agendar.html no llama a /api/citas/ en ningun lado. Llama a
#     /api/admin/supabase/citas-qr (supabase_admin.py:227-257), que ya es
#     publico a proposito -- documentado, con rate limit de slowapi
#     (@limiter.limit("5/minute")) y un payload de texto libre
#     (nombre_cliente, telefono, nombre_mascota) pensado para un visitante sin
#     cuenta. Esa cita queda en una tabla de staging en Supabase
#     (`citas_agendadas`, estado "pendiente") hasta que el staff la revisa.
#   - CitaCreate (el payload de POST /api/citas/) exige `mascota_id` y
#     `propietario_id` que YA EXISTEN en la base de Postgres -- un visitante
#     anonimo del QR no tiene forma de conocer esos IDs internos.
#   - El unico caller real es agenda.js:231 (`fetchAPI('/citas/', {method:
#     'POST', ...})`), dentro de la seccion "Agenda" del shell, ya restringida
#     a ADMISION_ROLES en el front (static/js/core/router.js:47,57).
# Es un endpoint interno de mostrador (recepcion agenda una cita para un
# paciente/tutor que ya existe), no el QR. Se gatea igual que el resto del
# router.
_ROLES_CITAS = ("admin", "recepcionista", "veterinario")


@router.post("/", response_model=CitaResponse, status_code=status.HTTP_201_CREATED)
def agendar_cita(
    cita: CitaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Agenda una nueva cita con verificación de disponibilidad"""
    # Solo impedir citas de días anteriores a hoy, usando la fecha civil de la
    # clínica. El front manda hora local sin zona; el server puede correr en UTC,
    # así que comparar contra now_utc.date() rechaza citas del mismo día por la
    # noche (UTC-3 ya está en el día siguiente en UTC).
    hoy_local = datetime.now(CLINIC_TZ).date()
    fecha_cita = cita.fecha_cita
    if fecha_cita.tzinfo is not None:
        fecha_cita = fecha_cita.astimezone(CLINIC_TZ)
    # Ignoramos la hora para comparar fechas puras (el mismo día es válido siempre)
    if fecha_cita.date() < hoy_local:
        raise HTTPException(status_code=400, detail="No se pueden agendar citas de días anteriores.")
        
    # El mismo día se permite a cualquier hora para facilitar el registro de llegadas en recepción
    # (Evitamos conflictos de zona horaria entre el navegador y el servidor)
        
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
    fecha: Optional[str] = None,
    estado: Optional[str] = None,
    veterinario_id: Optional[int] = None,
    mascota_id: Optional[int] = None,
    tipo: Optional[str] = None,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Lista las citas, opcionalmente filtrando por fecha (YYYY-MM-DD), estado, veterinario, mascota, tipo o rango de fechas"""
    query = db.query(Cita)
    if fecha:
        try:
            fecha_dt = datetime.fromisoformat(fecha)
            dia_inicio = fecha_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            dia_fin = dia_inicio + timedelta(hours=24)
            query = query.filter(Cita.fecha_cita >= dia_inicio, Cita.fecha_cita < dia_fin)
        except ValueError:
            pass
    if estado:
        query = query.filter(Cita.estado == estado)
    if veterinario_id is not None:
        query = query.filter(Cita.veterinario_id == veterinario_id)
    if mascota_id is not None:
        query = query.filter(Cita.mascota_id == mascota_id)
    if tipo:
        query = query.filter(Cita.tipo == tipo)
    if fecha_inicio:
        query = query.filter(Cita.fecha_cita >= fecha_inicio)
    if fecha_fin:
        query = query.filter(Cita.fecha_cita <= fecha_fin)
    return query.order_by(Cita.fecha_cita).offset(skip).limit(limit).all()

@router.get("/{cita_id}", response_model=CitaResponse)
def obtener_cita(
    cita_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Obtiene una cita por ID"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    return cita

@router.put("/{cita_id}/checkin", response_model=CitaResponse)
def checkin_paciente(
    cita_id: int,
    status_update: CitaStatusUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Sistema de Check-in: Actualiza el estado del flujo del paciente (En espera, En consulta, Finalizado)"""
    estado = status_update.estado
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    
    # Validar transiciones de estado si es necesario
    try:
        nuevo_estado = CitaEstado(estado)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Estado invalido. Permitidos: {[e.value for e in CitaEstado]}")
        
    # Registrar timestamps automáticos
    now = datetime.now(timezone.utc)
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
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Actualiza datos generales de la cita"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    for key, value in cita_update.model_dump(exclude_unset=True).items():
        setattr(cita, key, value)
    
    db.commit()
    db.refresh(cita)
    return cita

@router.delete("/{cita_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancelar_cita(
    cita_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_CITAS)),
):
    """Cancela (elimina logica o fisica) una cita"""
    cita = db.query(Cita).filter(Cita.id == cita_id).first()
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    
    # Opcional: Solo marcar como cancelada en vez de borrar
    cita.estado = CitaEstado.CANCELADA
    db.commit()
    return None
