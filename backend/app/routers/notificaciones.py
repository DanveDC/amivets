"""Bandeja de avisos del usuario logueado (Tarea 06, decisión 6; etapa 5).

OJO con la distinción que hace el diseño: esto NO es la bandeja del gestor
(esa es una query sobre `servicios_consulta`, ver `routers/servicios.py::
listar_bandeja`). Acá es el canal de avisos genérico: cualquier usuario
(admin, veterinario, gestor...) ve y marca leídas SUS PROPIAS notificaciones,
nunca las de otro -- por eso ningún endpoint acepta `destinatario_id`, siempre
se filtra por `current_user.id`.

Nunca se auto-marca leída al listar (decisión 6): vaciar el badge porque el
usuario abrió el menú de reojo sería perder la señal de qué no vio todavía.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Notificacion, Usuario
from app.routers.usuarios import get_current_user
from app.schemas.schemas import NotificacionResponse

router = APIRouter(prefix="/api/notificaciones", tags=["Notificaciones"])


@router.get("/", response_model=List[NotificacionResponse])
def listar_notificaciones(
    no_leidas: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Las notificaciones del usuario logueado, de la más nueva a la más
    vieja. `?no_leidas=true` es la query del badge (poll periódico, decisión
    6) -- usa el índice compuesto (destinatario_id, leida_at, created_at)."""
    q = db.query(Notificacion).filter(Notificacion.destinatario_id == current_user.id)
    if no_leidas:
        q = q.filter(Notificacion.leida_at.is_(None))
    return q.order_by(Notificacion.created_at.desc()).limit(limit).all()


@router.patch("/{notificacion_id}/leer", response_model=NotificacionResponse)
def marcar_leida(
    notificacion_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Marca una notificación propia como leída. Idempotente: si ya estaba
    leída, no pisa `leida_at` con un timestamp nuevo."""
    notificacion = (
        db.query(Notificacion)
        .filter(Notificacion.id == notificacion_id, Notificacion.destinatario_id == current_user.id)
        .first()
    )
    if not notificacion:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    if notificacion.leida_at is None:
        notificacion.leida_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notificacion)
    return notificacion


@router.patch("/leer-todas", response_model=List[NotificacionResponse])
def marcar_todas_leidas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Marca TODAS las notificaciones no leídas del usuario logueado."""
    ahora = datetime.now(timezone.utc)
    pendientes = (
        db.query(Notificacion)
        .filter(Notificacion.destinatario_id == current_user.id, Notificacion.leida_at.is_(None))
        .all()
    )
    for n in pendientes:
        n.leida_at = ahora
    db.commit()
    for n in pendientes:
        db.refresh(n)
    return pendientes
