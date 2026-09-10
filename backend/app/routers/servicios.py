"""Servicios directos y edicion de servicios de consulta (Tarea 09).

Un "servicio directo" es un ServicioConsulta sin consulta (consulta_id NULL) que
cuelga de la mascota (mascota_id). Sirve para lo que no amerita consulta: corte
de unas, venta de mostrador, etc.

PATCH/DELETE de un servicio individual viven aca; routers/consultas.py mantiene
los paths /api/consultas/servicios/{id} como alias que delegan a estas mismas
funciones (para no romper e2e/flujo-clinico.spec.js).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import (
    ServicioConsultaCreate,
    ServicioConsultaUpdate,
    ServicioConsultaResponse,
)
from app.models.models import ServicioConsulta, Mascota, Usuario
from app.services import consumo_service
from app.routers.usuarios import get_optional_current_user

router = APIRouter(prefix="/api/servicios", tags=["Servicios"])

# Servicios clinicos: una recepcionista NO los puede anexar (Tarea 09, decision
# 7). admin y veterinario, sin restriccion de tipo.
TIPOS_SERVICIO_CLINICOS = {
    "VACUNACION",
    "DESPARASITACION",
    "CIRUGIA",
    "HOSPITALIZACION",
    "LABORATORIO",
}


def validar_tipo_servicio_por_rol(current_user: Optional[Usuario], tipo_servicio: Optional[str]):
    """Bloquea a la recepcionista de anexar servicios clinicos.

    Solo aplica cuando hay usuario autenticado con rol 'recepcionista'. admin,
    veterinario y las llamadas sin sesion pasan sin restriccion de tipo (misma
    limitacion documentada en usuarios.require_roles)."""
    if current_user is None or current_user.role != "recepcionista":
        return
    if (tipo_servicio or "").strip().upper() in TIPOS_SERVICIO_CLINICOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Una recepcionista no puede anexar servicios clínicos "
                "(vacunación, desparasitación, cirugía, hospitalización o laboratorio)."
            ),
        )


# ---------------------------------------------------------------------------
# Logica compartida de PATCH / DELETE de un servicio individual.
# routers/consultas.py delega en estas funciones.
# ---------------------------------------------------------------------------
def actualizar_servicio_impl(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session,
    current_user: Optional[Usuario],
) -> ServicioConsultaResponse:
    """Actualiza estado, precio o cantidad de un servicio.

    Al pasar de "no Aplicado" -> "Aplicado" consume materiales; al pasar de
    "Aplicado" -> otro estado los revierte (lee consumo_material, no la receta).
    Unificado en consumo_service (Tarea 07, decisión 3).
    """
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    old_estado = servicio.estado

    update_dict = update_data.model_dump(exclude_unset=True)
    consumos_override = update_dict.pop("consumos", None)

    # M2: editar cantidad/consumos de un servicio que sigue en "Aplicado"
    # cambiaria solo la columna, sin tocar el ledger ni ConsumoMaterial -> la
    # reversa posterior devolveria un monto distinto al consumido (drift). Se
    # exige revertir el estado primero. Con estado Pendiente/Cancelado el edit
    # es libre.
    nuevo_estado = update_dict.get("estado", servicio.estado)
    toca_cantidad = "cantidad" in update_dict and update_dict["cantidad"] != servicio.cantidad
    toca_consumos = consumos_override is not None
    if servicio.estado == "Aplicado" and nuevo_estado == "Aplicado" and (toca_cantidad or toca_consumos):
        raise HTTPException(
            status_code=409,
            detail="No se puede cambiar la cantidad de un servicio ya aplicado; revertí el estado primero",
        )

    for k, v in update_dict.items():
        setattr(servicio, k, v)

    new_estado = servicio.estado
    uid = current_user.id if current_user else None

    advertencias = []
    if old_estado != "Aplicado" and new_estado == "Aplicado":
        advertencias = consumo_service.consumir_para_servicio(
            db,
            servicio,
            overrides=consumo_service.overrides_from_payload(consumos_override),
            usuario_id=uid,
        )
    elif old_estado == "Aplicado" and new_estado != "Aplicado":
        consumo_service.revertir_para_servicio(db, servicio, usuario_id=uid)

    db.commit()
    db.refresh(servicio)
    resp = ServicioConsultaResponse.model_validate(servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp


def eliminar_servicio_impl(
    servicio_id: int,
    db: Session,
    current_user: Optional[Usuario],
) -> None:
    """Elimina lógicamente un servicio (Soft Delete) y revierte el consumo de
    materiales si estaba aplicado (Tarea 07, decisión 3)."""
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    if servicio.estado == "Aplicado":
        consumo_service.revertir_para_servicio(
            db, servicio, usuario_id=current_user.id if current_user else None
        )

    servicio.is_deleted = True
    servicio.estado = "Cancelado"
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/", response_model=ServicioConsultaResponse, status_code=status.HTTP_201_CREATED)
def crear_servicio_directo(
    servicio_data: ServicioConsultaCreate,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
):
    """Crea un servicio directo (sin consulta). Exige mascota_id.

    Misma lógica de consumo que anexar un servicio a una consulta: si entra en
    estado "Aplicado", descuenta materiales vía consumo_service.
    """
    if not servicio_data.mascota_id:
        raise HTTPException(status_code=422, detail="mascota_id es obligatorio para un servicio directo")

    mascota = db.query(Mascota).filter(Mascota.id == servicio_data.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")

    validar_tipo_servicio_por_rol(current_user, servicio_data.tipo_servicio)

    nuevo_servicio = ServicioConsulta(
        consulta_id=None,
        mascota_id=servicio_data.mascota_id,
        tipo_servicio=servicio_data.tipo_servicio,
        referencia_id=servicio_data.referencia_id,
        catalogo_servicio_id=servicio_data.catalogo_servicio_id,
        nombre_servicio=servicio_data.nombre_servicio,
        cantidad=servicio_data.cantidad,
        precio_unitario=servicio_data.precio_unitario,
        detalles_clinicos=servicio_data.detalles_clinicos,
        estado=servicio_data.estado,
        origen=None,  # alta normal, no migración
        is_deleted=False,
    )
    db.add(nuevo_servicio)
    db.flush()  # id necesario para anclar movimientos/consumos

    advertencias = []
    if nuevo_servicio.estado == "Aplicado":
        advertencias = consumo_service.consumir_para_servicio(
            db,
            nuevo_servicio,
            overrides=consumo_service.overrides_from_payload(servicio_data.consumos),
            usuario_id=current_user.id if current_user else None,
        )

    db.commit()
    db.refresh(nuevo_servicio)
    resp = ServicioConsultaResponse.model_validate(nuevo_servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp


@router.get("/", response_model=List[ServicioConsultaResponse])
def listar_servicios_directos(
    mascota_id: int,
    db: Session = Depends(get_db),
):
    """Lista los servicios directos (consulta_id IS NULL) de una mascota, para la
    historia y la facturación de sueltos. Excluye los borrados lógicamente."""
    return (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.mascota_id == mascota_id,
            ServicioConsulta.consulta_id.is_(None),
            ServicioConsulta.is_deleted == False,  # noqa: E712
        )
        .order_by(ServicioConsulta.id.desc())
        .all()
    )


@router.patch("/{servicio_id}", response_model=ServicioConsultaResponse)
def actualizar_servicio(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
):
    return actualizar_servicio_impl(servicio_id, update_data, db, current_user)


@router.delete("/{servicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_servicio(
    servicio_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
):
    return eliminar_servicio_impl(servicio_id, db, current_user)
