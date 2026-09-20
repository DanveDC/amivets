"""Subida, descarga y borrado de adjuntos (Tarea 06, decisiones 7-9, etapa 6).

Tres endpoints, matriz de permisos (decisión 9, filas 16-18):

  - POST   /api/servicios/{servicio_id}/adjuntos   → admin/veterinario siempre;
    gestor SOLO el que tomó el servicio (asignado_a_id == él).
  - GET    /api/adjuntos/{id}                       → admin/recepción/veterinario
    siempre; gestor SOLO si tomó ese servicio puntual (mismo criterio que la
    fila 11/16 -- ver nota de deviación en el reporte de apply: la lista del
    enunciado pide explícitamente que un gestor de la MISMA área pero que no
    tomó el servicio tampoco pueda descargar, así que "sus servicios" se
    resuelve por asignado_a_id, no solo por membresía de área).
  - DELETE /api/adjuntos/{id}                       → admin/veterinario siempre;
    gestor SOLO el que lo subió (subido_por_id == él).
  - GET    /api/servicios/{servicio_id}/adjuntos     → listado, mismo gate de
    lectura que la descarga individual pero a nivel de servicio.

Los bytes nunca se sirven por nginx ni por una ruta estática (decisión 8,
requisito 4): la única puerta es este router, autenticado.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Adjunto, ServicioConsulta, Usuario
from app.routers.usuarios import require_roles
from app.schemas.schemas import AdjuntoResponse
from app.services import adjunto_service

router = APIRouter(tags=["Adjuntos"])


def _obtener_servicio_o_404(db: Session, servicio_id: int) -> ServicioConsulta:
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return servicio


def _obtener_adjunto_vivo_o_404(db: Session, adjunto_id: int) -> Adjunto:
    adjunto = (
        db.query(Adjunto)
        .filter(Adjunto.id == adjunto_id, Adjunto.is_deleted == False)  # noqa: E712
        .first()
    )
    if not adjunto:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    return adjunto


def _validar_permiso_subir(servicio: ServicioConsulta, current_user: Usuario) -> None:
    """Fila 16: admin y veterinario siempre; gestor solo el que tomó el
    servicio. Ningún otro rol sube (recepción queda afuera a propósito)."""
    if current_user.role in ("admin", "veterinario"):
        return
    if current_user.role == "gestor" and servicio.asignado_a_id == current_user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tenés permiso para subir un adjunto a este servicio.",
    )


def _validar_permiso_leer(servicio: ServicioConsulta, current_user: Usuario) -> None:
    """Fila 17: admin/recepción/veterinario siempre; gestor solo si es el
    servicio que tomó (mismo criterio estricto que subir/ejecutar -- ver
    header del módulo)."""
    if current_user.role in ("admin", "recepcionista", "veterinario"):
        return
    if current_user.role == "gestor" and servicio.asignado_a_id == current_user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tenés permiso para ver los adjuntos de este servicio.",
    )


def _validar_permiso_borrar(adjunto: Adjunto, current_user: Usuario) -> None:
    """Fila 18: admin y veterinario siempre; gestor solo el que subió."""
    if current_user.role in ("admin", "veterinario"):
        return
    if current_user.role == "gestor" and adjunto.subido_por_id == current_user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tenés permiso para borrar este adjunto.",
    )


@router.post(
    "/api/servicios/{servicio_id}/adjuntos",
    response_model=AdjuntoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subir_adjunto(
    servicio_id: int,
    archivo: UploadFile,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "veterinario", "gestor")),
):
    servicio = _obtener_servicio_o_404(db, servicio_id)
    _validar_permiso_subir(servicio, current_user)

    guardado = await adjunto_service.guardar_bytes_adjunto(archivo)

    adjunto = Adjunto(
        servicio_id=servicio.id,
        nombre_original=archivo.filename or "adjunto",
        content_type=guardado.content_type,
        tamano_bytes=guardado.tamano_bytes,
        sha256=guardado.sha256,
        ruta_relativa=guardado.ruta_relativa,
        subido_por_id=current_user.id,
    )
    db.add(adjunto)
    db.commit()
    db.refresh(adjunto)
    return adjunto


@router.get("/api/servicios/{servicio_id}/adjuntos", response_model=List[AdjuntoResponse])
def listar_adjuntos_servicio(
    servicio_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario", "gestor")),
):
    servicio = _obtener_servicio_o_404(db, servicio_id)
    _validar_permiso_leer(servicio, current_user)
    return (
        db.query(Adjunto)
        .filter(Adjunto.servicio_id == servicio_id, Adjunto.is_deleted == False)  # noqa: E712
        .order_by(Adjunto.created_at)
        .all()
    )


@router.get("/api/adjuntos/{adjunto_id}")
def descargar_adjunto(
    adjunto_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario", "gestor")),
):
    """Decisión 8, requisito 4: nunca un redirect a static/, siempre este
    endpoint autenticado. Content-Type y filename salen de la fila guardada
    (el content_type DETECTADO al subir, nunca el que declaró el cliente ni
    la extensión del archivo en disco)."""
    adjunto = _obtener_adjunto_vivo_o_404(db, adjunto_id)
    servicio = _obtener_servicio_o_404(db, adjunto.servicio_id)
    _validar_permiso_leer(servicio, current_user)

    ruta = adjunto_service.ruta_absoluta(adjunto.ruta_relativa)
    if not ruta.is_file():
        raise HTTPException(status_code=404, detail="El archivo del adjunto no está disponible.")

    nombre_sanitizado = adjunto.nombre_original.replace('"', "").replace("\\", "").replace("\n", "").replace("\r", "")
    return FileResponse(
        path=ruta,
        media_type=adjunto.content_type,
        filename=nombre_sanitizado,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/api/adjuntos/{adjunto_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_adjunto(
    adjunto_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "veterinario", "gestor")),
):
    """Soft delete (fila 18). Un adjunto is_deleted no cuenta para el candado
    de requiere_adjunto (servicios.py:_tiene_adjunto_vivo) ni aparece en el
    listado ni en la descarga -- pero los bytes físicos NO se borran: es la
    misma razón de auditoría que motiva el soft delete de la fila (decisión
    7), no solo un espejo de is_deleted."""
    adjunto = _obtener_adjunto_vivo_o_404(db, adjunto_id)
    _validar_permiso_borrar(adjunto, current_user)
    adjunto.is_deleted = True
    db.commit()
    return None
