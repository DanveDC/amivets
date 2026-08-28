from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Consulta, Mascota, NotaClinica, Usuario
from app.routers.usuarios import get_current_user
from app.schemas.schemas import NotaClinicaCreate, NotaClinicaResponse, NotaClinicaUpdate

router = APIRouter(prefix="/api/notas", tags=["Notas Clinicas"])


def _autor_o_admin(nota: NotaClinica, current_user: Usuario):
    # Permisos (no existe docs/tecnico/matriz-permisos.md todavia, criterio
    # propio documentado aca): cualquier usuario logueado -- admin,
    # veterinario o user -- puede escribir una nota, porque el caso de uso
    # ("la dueña llamo") lo puede originar cualquiera del staff, no solo el
    # veterinario. Pero editar o borrar queda limitado al autor original o
    # a un admin: una bitacora clinica donde cualquiera puede tocar la nota
    # de otro no es confiable.
    if current_user.role != "admin" and nota.usuario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el autor de la nota o un administrador pueden modificarla",
        )


@router.post("/", response_model=NotaClinicaResponse, status_code=status.HTTP_201_CREATED)
def crear_nota(
    nota: NotaClinicaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Crea una nota clinica para un paciente. A diferencia de otros
    endpoints clinicos de este proyecto (mascotas, consultas, etc., que hoy
    no exigen login), esta bitacora necesita saber siempre quien escribio
    -- por eso requiere sesion activa."""
    mascota = db.query(Mascota).filter(Mascota.id == nota.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")

    if nota.consulta_id is not None:
        consulta = db.query(Consulta).filter(Consulta.id == nota.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")
        if consulta.mascota_id != nota.mascota_id:
            raise HTTPException(status_code=400, detail="La consulta indicada no pertenece a esta mascota")

    nueva_nota = NotaClinica(
        mascota_id=nota.mascota_id,
        consulta_id=nota.consulta_id,
        categoria=nota.categoria,
        texto=nota.texto,
        usuario_id=current_user.id,
    )
    db.add(nueva_nota)
    db.commit()
    db.refresh(nueva_nota)
    return nueva_nota


@router.get("/mascota/{mascota_id}", response_model=List[NotaClinicaResponse])
def listar_notas_mascota(
    mascota_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Notas de un paciente en orden cronologico (mas antigua primero, igual
    que /api/consultas). Las borradas logicamente no aparecen aca."""
    return (
        db.query(NotaClinica)
        .filter(NotaClinica.mascota_id == mascota_id, NotaClinica.is_deleted == False)
        .order_by(NotaClinica.fecha_creacion.asc())
        .all()
    )


@router.put("/{nota_id}", response_model=NotaClinicaResponse)
def actualizar_nota(
    nota_id: int,
    data: NotaClinicaUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Edita una nota y deja rastro de la edicion (fecha_edicion +
    editado_por_id en la misma fila) -- una nota clinica modificada sin
    marca es un problema en este contexto, aunque no justifica una tabla de
    historial aparte (ver models.py)."""
    nota = (
        db.query(NotaClinica)
        .filter(NotaClinica.id == nota_id, NotaClinica.is_deleted == False)
        .first()
    )
    if not nota:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    _autor_o_admin(nota, current_user)

    if data.categoria is not None:
        nota.categoria = data.categoria
    if data.texto is not None:
        nota.texto = data.texto
    nota.fecha_edicion = datetime.now(timezone.utc)
    nota.editado_por_id = current_user.id

    db.commit()
    db.refresh(nota)
    return nota


@router.delete("/{nota_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_nota(
    nota_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Borrado logico: la fila sigue en la base para auditoria, solo se
    oculta de la historia del paciente (mismo patron que
    ServicioConsulta.is_deleted). Tambien registra quien y cuando borro,
    reutilizando fecha_edicion/editado_por_id en vez de sumar columnas
    nuevas solo para este caso."""
    nota = (
        db.query(NotaClinica)
        .filter(NotaClinica.id == nota_id, NotaClinica.is_deleted == False)
        .first()
    )
    if not nota:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    _autor_o_admin(nota, current_user)

    nota.is_deleted = True
    nota.fecha_edicion = datetime.now(timezone.utc)
    nota.editado_por_id = current_user.id
    db.commit()
    return None
