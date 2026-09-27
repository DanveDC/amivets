"""CRUD de gestores externos y sus asignaciones a áreas (gestor-externo-crud).

Un gestor externo es un proveedor/laboratorio/especialista que NO es un
`Usuario` del sistema pero recibe notificaciones de servicios despachados a
su área (ver `services/notificacion_service.py::crear_notificacion_externa`).
Todo el CRUD es admin-only, mismo criterio que `routers/areas.py`.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.models import AreaServicio, GestorAreaExterno, GestorExterno, Notificacion, Usuario
from app.routers.usuarios import require_roles
from app.schemas.schemas import (
    AreaServicioResponse,
    GestorExternoAreaCreate,
    GestorExternoCreate,
    GestorExternoResponse,
    GestorExternoUpdate,
)

router = APIRouter(prefix="/api/gestores-externos", tags=["Gestores Externos"])


def _query_base(db: Session):
    return db.query(GestorExterno).options(
        selectinload(GestorExterno.areas).selectinload(GestorAreaExterno.area),
        selectinload(GestorExterno.usuario),
    )


def _obtener_o_404(db: Session, gestor_id: int) -> GestorExterno:
    gestor = _query_base(db).filter(GestorExterno.id == gestor_id).first()
    if not gestor:
        raise HTTPException(status_code=404, detail="Gestor externo no encontrado")
    return gestor


def _validar_usuario_id(db: Session, usuario_id: Optional[int]):
    if usuario_id is None:
        return
    if not db.query(Usuario).filter(Usuario.id == usuario_id).first():
        raise HTTPException(status_code=404, detail="Usuario no encontrado")


# Nombres reales de las constraints (migración b4e04370dc32_gestor_externo_crud.py):
# uq_gestores_externos_rif es explícita; las FKs de usuario_id y
# notificaciones.gestor_externo_id no tienen nombre propio en la migración,
# así que Postgres les asignó el default "<tabla>_<columna>_fkey".
_RIF_UNIQUE_CONSTRAINT = "uq_gestores_externos_rif"
_USUARIO_FK_CONSTRAINT = "gestores_externos_usuario_id_fkey"
_NOTIFICACION_FK_CONSTRAINT = "notificaciones_gestor_externo_id_fkey"


def _manejar_integrity_error(exc: IntegrityError):
    """Traduce el IntegrityError de un INSERT/UPDATE de gestores_externos al
    status/detail correcto según qué constraint se violó -- antes cualquier
    IntegrityError (incluida la FK de usuario_id, ej. una carrera entre el
    SELECT de `_validar_usuario_id` y el commit) se respondía igual como 409
    "RIF ya registrado", que es incorrecto cuando el problema es otro."""
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    if constraint == _RIF_UNIQUE_CONSTRAINT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RIF ya registrado")
    if constraint == _USUARIO_FK_CONSTRAINT:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se pudo guardar el gestor externo")


@router.get("/", response_model=List[GestorExternoResponse])
def listar_gestores_externos(
    skip: int = 0,
    limit: int = 100,
    activo: Optional[bool] = None,
    area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    q = _query_base(db)
    if activo is not None:
        q = q.filter(GestorExterno.activo == activo)
    if area_id is not None:
        q = q.join(GestorAreaExterno, GestorAreaExterno.gestor_externo_id == GestorExterno.id).filter(
            GestorAreaExterno.area_id == area_id
        )
    return q.order_by(GestorExterno.nombre).offset(skip).limit(limit).all()


@router.get("/{gestor_id}", response_model=GestorExternoResponse)
def obtener_gestor_externo(
    gestor_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    return _obtener_o_404(db, gestor_id)


@router.post("/", response_model=GestorExternoResponse, status_code=status.HTTP_201_CREATED)
def crear_gestor_externo(
    data: GestorExternoCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    _validar_usuario_id(db, data.usuario_id)
    gestor = GestorExterno(**data.model_dump())
    db.add(gestor)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _manejar_integrity_error(exc)
    return _obtener_o_404(db, gestor.id)


@router.patch("/{gestor_id}", response_model=GestorExternoResponse)
def actualizar_gestor_externo(
    gestor_id: int,
    data: GestorExternoUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    gestor = _obtener_o_404(db, gestor_id)
    cambios = data.model_dump(exclude_unset=True)

    if "rif" in cambios and cambios["rif"] != gestor.rif and gestor.areas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El RIF no puede cambiarse con áreas asignadas",
        )
    if "usuario_id" in cambios:
        _validar_usuario_id(db, cambios["usuario_id"])

    for key, value in cambios.items():
        setattr(gestor, key, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _manejar_integrity_error(exc)
    return _obtener_o_404(db, gestor_id)


@router.delete("/{gestor_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_gestor_externo(
    gestor_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    """Hard delete solo si no tiene áreas asignadas NI historial de
    notificaciones; en cualquier otro caso, 409 (desactivar con PATCH
    activo=false es el soft delete -- ver spec, "Soft vs hard delete").

    El chequeo de notificaciones es EXISTS/limit-1 (no carga filas): solo
    interesa si hay al menos una. La FK `gestor_externo_id` es ON DELETE
    RESTRICT (red de seguridad); si igual llega a pisarse con una carrera
    entre este SELECT y el commit, el IntegrityError de abajo cubre ese caso.
    """
    gestor = _obtener_o_404(db, gestor_id)
    if gestor.areas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tiene áreas asignadas, desactive el gestor en su lugar",
        )
    tiene_notificaciones = (
        db.query(Notificacion.id).filter(Notificacion.gestor_externo_id == gestor_id).limit(1).first()
        is not None
    )
    if tiene_notificaciones:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El gestor tiene historial de notificaciones, desactívelo en su lugar",
        )
    db.delete(gestor)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == _NOTIFICACION_FK_CONSTRAINT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El gestor tiene historial de notificaciones, desactívelo en su lugar",
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se pudo eliminar el gestor externo")
    return None


# ── Asignaciones área <-> gestor externo ────────────────────────────────────

@router.get("/{gestor_id}/areas/", response_model=List[AreaServicioResponse])
def listar_areas_gestor_externo(
    gestor_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    gestor = _obtener_o_404(db, gestor_id)
    return [ga.area for ga in gestor.areas if ga.area]


@router.post(
    "/{gestor_id}/areas/",
    response_model=AreaServicioResponse,
    status_code=status.HTTP_201_CREATED,
)
def asignar_area_gestor_externo(
    gestor_id: int,
    data: GestorExternoAreaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    area_id = data.area_id
    gestor = _obtener_o_404(db, gestor_id)
    if not gestor.activo:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El gestor externo está inactivo")

    area = db.query(AreaServicio).filter(AreaServicio.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")

    fila = GestorAreaExterno(gestor_externo_id=gestor_id, area_id=area_id)
    db.add(fila)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El gestor ya está asignado a esa área",
        )
    return area


@router.delete("/{gestor_id}/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def quitar_area_gestor_externo(
    gestor_id: int,
    area_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    fila = (
        db.query(GestorAreaExterno)
        .filter(GestorAreaExterno.gestor_externo_id == gestor_id, GestorAreaExterno.area_id == area_id)
        .first()
    )
    if not fila:
        raise HTTPException(status_code=404, detail="Ese gestor externo no está asignado a esa área")
    db.delete(fila)
    db.commit()
    return None
