"""Áreas de despacho y sus gestores (Tarea 06, decisiones 5 y 9; etapa 5).

Prerrequisito real que faltaba desde la etapa 2a: los modelos `AreaServicio` /
`GestorArea` existen en la base desde entonces, pero no había ningún endpoint
para crear un área ni para sumarle gestores (ver apply-progress de la etapa 4,
hallazgo #3). Sin esto, la rama SOLICITADO -> ASIGNADO de
`orden_service.confirmar_servicios` es código correcto por lectura pero
inalcanzable en la práctica -- nadie puede setear `CatalogoServicio.area_id`.
Este router cierra ese hueco.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import AreaServicio, GestorArea, Usuario
from app.routers.usuarios import get_current_user, require_roles
from app.schemas.schemas import (
    AreaServicioCreate,
    AreaServicioResponse,
    AreaServicioUpdate,
    GestorAreaCreate,
    GestorAreaResponse,
)

router = APIRouter(prefix="/api/areas", tags=["Áreas de servicio"])


@router.post("/", response_model=AreaServicioResponse, status_code=status.HTTP_201_CREATED)
def crear_area(
    data: AreaServicioCreate,
    db: Session = Depends(get_db),
    # Fila 23 de la matriz: editar catálogo/áreas/requiere_adjunto es admin-only.
    _: Usuario = Depends(require_roles("admin")),
):
    """Alta de un área de despacho (LABORATORIO, IMAGEN, ESTETICA, QUIROFANO...)."""
    area = AreaServicio(**data.model_dump())
    db.add(area)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un área con el código '{data.codigo}'",
        )
    db.refresh(area)
    return area


@router.get("/", response_model=List[AreaServicioResponse])
def listar_areas(
    db: Session = Depends(get_db),
    # Para poblar selects al anexar/editar catálogo: los tres roles que
    # anexan servicios (decisión 9, filas 7-8). `gestor` no necesita esta
    # lista para nada de lo que puede hacer en esta etapa.
    _: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Todas las áreas (activas e inactivas): el admin también necesita ver
    las inactivas para poder reactivarlas."""
    return db.query(AreaServicio).order_by(AreaServicio.nombre).all()


@router.get("/mias", response_model=List[AreaServicioResponse])
def mis_areas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Las áreas activas que atiende el usuario logueado (pantalla-encargado,
    decisión 2). Abierto a cualquier usuario autenticado porque solo devuelve
    lo propio: el gestor no puede leer GET / (todas las áreas)."""
    return (
        db.query(AreaServicio)
        .join(GestorArea, GestorArea.area_id == AreaServicio.id)
        .filter(GestorArea.usuario_id == current_user.id, AreaServicio.activo == True)  # noqa: E712
        .order_by(AreaServicio.nombre)
        .all()
    )


@router.put("/{area_id}", response_model=AreaServicioResponse)
def actualizar_area(
    area_id: int,
    data: AreaServicioUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    area = db.query(AreaServicio).filter(AreaServicio.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(area, key, value)
    db.commit()
    db.refresh(area)
    return area


@router.post(
    "/{area_id}/gestores",
    response_model=GestorAreaResponse,
    status_code=status.HTTP_201_CREATED,
)
def agregar_gestor(
    area_id: int,
    data: GestorAreaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    """Suma un usuario a `gestor_area` (fila 24 de la matriz).

    No exige `role='gestor'` en el usuario (ver `GestorAreaCreate`): un
    veterinario puede sumarse como gestor de un área sin dejar de ser
    veterinario (decisión 5, "una persona con varios roles").

    409 si la fila ya existe (`uq_gestor_area_usuario_area`): sumarlo dos
    veces no es un error de datos, es una operación repetida.
    """
    area = db.query(AreaServicio).filter(AreaServicio.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")

    usuario = db.query(Usuario).filter(Usuario.id == data.usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    fila = GestorArea(usuario_id=data.usuario_id, area_id=area_id)
    db.add(fila)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese usuario ya es gestor de esta área",
        )
    db.refresh(fila)
    return fila


@router.delete("/{area_id}/gestores/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
def quitar_gestor(
    area_id: int,
    usuario_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    """Hard delete de la fila `gestor_area` (decisión deliberada, etapa 5).

    A diferencia de `ServicioConsulta` / `NotaClinica` / `Adjunto`,
    `GestorArea` no tiene `is_deleted`: agregarlo sería una columna nueva sin
    ganancia real acá. La fila es configuración ("quién atiende qué área"),
    no dato clínico ni de dinero -- borrarla no pierde ningún historial: cada
    `Notificacion` ya emitida y cada `ServicioConsulta.asignado_a_id` ya
    escrito quedan con su propio snapshot inmutable, independiente de que la
    relación gestor-área se borre después.
    """
    fila = (
        db.query(GestorArea)
        .filter(GestorArea.area_id == area_id, GestorArea.usuario_id == usuario_id)
        .first()
    )
    if not fila:
        raise HTTPException(status_code=404, detail="Ese usuario no es gestor de esta área")
    db.delete(fila)
    db.commit()
    return None
