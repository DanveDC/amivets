from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Usuario
from app.schemas.schemas import PropietarioCreate, PropietarioUpdate, PropietarioResponse
from app.services.propietario_service import PropietarioService
from app.routers.usuarios import require_roles

router = APIRouter(prefix="/api/propietarios", tags=["Propietarios"])

# HALLAZGO DE SEGURIDAD (Tarea 10): mismo agujero que mascotas.py -- este
# router nunca tuvo Depends(require_roles) en NINGUN endpoint. Confirmado en
# vivo: GET /api/propietarios/ sin token devolvia 200 con el padron completo
# de tutores (cedula incluida).
#
# admin + recepcionista + veterinario: MASCOTAS_ROLES del front
# (static/js/core/router.js:49, 49-70, cubre tambien "sec-propietarios") y
# fila 22 de la matriz de permisos (docs/diseno/ordenes-de-servicio.md,
# decision 9, seccion 9.3).
_ROLES_PROPIETARIOS = ("admin", "recepcionista", "veterinario")


@router.post("/", response_model=PropietarioResponse, status_code=status.HTTP_201_CREATED)
def crear_propietario(
    propietario: PropietarioCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_PROPIETARIOS)),
):
    """Crea un nuevo propietario"""
    return PropietarioService.crear_propietario(db, propietario)


@router.get("/{propietario_id}", response_model=PropietarioResponse)
def obtener_propietario(
    propietario_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_PROPIETARIOS)),
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
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_PROPIETARIOS)),
):
    """Lista propietarios con filtros opcionales.

    `search` busca por nombre, apellido o cédula (revisión final Tarea 09): sin
    esto, la ventana fija de `limit` (100 por default) más de 200 propietarios
    reales podían quedar fuera de cualquier búsqueda posible.
    """
    return PropietarioService.listar_propietarios(db, skip, limit, activo, search)


@router.put("/{propietario_id}", response_model=PropietarioResponse)
def actualizar_propietario(
    propietario_id: int,
    propietario: PropietarioUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_PROPIETARIOS)),
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
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_PROPIETARIOS)),
):
    """Elimina (desactiva) un propietario"""
    if not PropietarioService.eliminar_propietario(db, propietario_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Propietario no encontrado"
        )
    return None
