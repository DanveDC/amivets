from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
import os

from supabase import create_client, Client
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import Usuario
from .usuarios import get_current_admin

router = APIRouter(prefix="/api/admin/supabase", tags=["Admin QR / Supabase"])

DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise HTTPException(status_code=500, detail="Supabase no configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)")
    return create_client(url, key)


# ── Schemas ────────────────────────────────────────────────────────────────────

class VeterinarioSBCreate(BaseModel):
    nombre: str
    especialidad: Optional[str] = None
    amivets_usuario_id: Optional[int] = None
    activo: bool = True


class VeterinarioSBUpdate(BaseModel):
    nombre: Optional[str] = None
    especialidad: Optional[str] = None
    amivets_usuario_id: Optional[int] = None
    activo: Optional[bool] = None


class HorarioCreate(BaseModel):
    amivets_usuario_id: int             # ID del usuario en el DB principal
    dia_semana: int                    # 0 = Lunes … 6 = Domingo
    hora_inicio: str                   # "HH:MM"
    hora_fin: str                      # "HH:MM"
    duracion_consulta_minutos: int = 60
    activo: bool = True


class HorarioUpdate(BaseModel):
    hora_inicio: Optional[str] = None
    hora_fin: Optional[str] = None
    duracion_consulta_minutos: Optional[int] = None
    activo: Optional[bool] = None


class CitaQRCreate(BaseModel):
    amivets_usuario_id: Optional[int] = None
    fecha_cita: str       # "YYYY-MM-DD"
    hora_cita: str        # "HH:MM"
    nombre_cliente: str
    telefono: str
    nombre_mascota: str
    tipo_mascota: Optional[str] = None
    motivo: Optional[str] = None


# ── Helper: obtener o crear vet en Supabase a partir del usuario principal ──────

def _get_or_create_sb_vet(sb: Client, usuario: Usuario) -> int:
    """Devuelve el ID del vet en Supabase, creándolo si no existe."""
    try:
        resp = sb.table("veterinarios").select("id").eq("amivets_usuario_id", usuario.id).execute()
        if resp.data:
            return resp.data[0]["id"]
        nombre = getattr(usuario, "nombre", None) or getattr(usuario, "username", None) or usuario.email
        insert = sb.table("veterinarios").insert({
            "nombre": nombre,
            "amivets_usuario_id": usuario.id,
            "activo": usuario.is_active,
        }).execute()
        if not insert.data:
            raise HTTPException(status_code=500, detail="Supabase rechazó el insert del veterinario (sin datos devueltos)")
        return insert.data[0]["id"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Supabase al sincronizar veterinario: {str(e)}")


# ── Health check Supabase ─────────────────────────────────────────────────────

@router.get("/health")
def supabase_health(current_user: Usuario = Depends(get_current_admin)):
    """Verifica conectividad con Supabase. (Solo Admin)"""
    try:
        sb = get_supabase()
        sb.table("veterinarios").select("id").limit(1).execute()
        return {"status": "ok", "message": "Supabase conectado correctamente"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Veterinarios (fuente: DB principal) ───────────────────────────────────────

@router.get("/veterinarios")
def listar_veterinarios(db: Session = Depends(get_db)):
    """Devuelve los veterinarios del DB principal (única fuente de verdad)."""
    usuarios = db.query(Usuario).filter(
        Usuario.role == "veterinario",
        Usuario.is_active == True,
    ).order_by(Usuario.username).all()
    return [
        {
            "id": u.id,
            "nombre": getattr(u, "nombre", None) or u.username,
            "activo": u.is_active,
            "amivets_usuario_id": u.id,
        }
        for u in usuarios
    ]


# ── Horarios en Supabase ───────────────────────────────────────────────────────

@router.get("/horarios")
def listar_horarios(
    amivets_usuario_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    try:
        sb = get_supabase()
        q = sb.table("horarios_veterinarios").select("*, veterinarios(nombre, amivets_usuario_id)")
        if amivets_usuario_id:
            sb_vet = sb.table("veterinarios").select("id").eq("amivets_usuario_id", amivets_usuario_id).execute()
            if sb_vet.data:
                q = q.eq("veterinario_id", sb_vet.data[0]["id"])
            else:
                return []
        resp = q.order("veterinario_id").order("dia_semana").order("hora_inicio").execute()
        return resp.data or []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Supabase en horarios: {str(e)}")


@router.post("/horarios", status_code=201)
def crear_horario(
    data: HorarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    try:
        sb = get_supabase()
        if data.hora_inicio >= data.hora_fin:
            raise HTTPException(status_code=400, detail="hora_inicio debe ser menor que hora_fin")
        if data.dia_semana < 0 or data.dia_semana > 6:
            raise HTTPException(status_code=400, detail="dia_semana debe estar entre 0 (Lunes) y 6 (Domingo)")
        usuario = db.query(Usuario).filter(Usuario.id == data.amivets_usuario_id).first()
        if not usuario:
            raise HTTPException(status_code=404, detail="Usuario no encontrado en el sistema")
        sb_vet_id = _get_or_create_sb_vet(sb, usuario)
        payload = {
            "veterinario_id": sb_vet_id,
            "dia_semana": data.dia_semana,
            "hora_inicio": data.hora_inicio,
            "hora_fin": data.hora_fin,
            "duracion_consulta_minutos": data.duracion_consulta_minutos,
            "activo": data.activo,
        }
        resp = sb.table("horarios_veterinarios").insert(payload).execute()
        if not resp.data:
            raise HTTPException(status_code=400, detail="Supabase rechazó el insert del horario (sin datos devueltos)")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Supabase al crear horario: {str(e)}")


@router.put("/horarios/{horario_id}")
def actualizar_horario(
    horario_id: int,
    data: HorarioUpdate,
    current_user: Usuario = Depends(get_current_admin),
):
    sb = get_supabase()
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")
    resp = sb.table("horarios_veterinarios").update(payload).eq("id", horario_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Horario no encontrado")
    return resp.data[0]


@router.delete("/horarios/{horario_id}", status_code=204)
def eliminar_horario(
    horario_id: int,
    current_user: Usuario = Depends(get_current_admin),
):
    sb = get_supabase()
    sb.table("horarios_veterinarios").delete().eq("id", horario_id).execute()


# ── Citas QR (lectura + cancelación) ──────────────────────────────────────────

@router.get("/citas-qr")
def listar_citas_qr(
    estado: Optional[str] = None,
    limit: int = 100,
    current_user: Usuario = Depends(get_current_admin),
):
    sb = get_supabase()
    q = sb.table("citas_agendadas").select("*, veterinarios(nombre)")
    if estado:
        q = q.eq("estado", estado)
    else:
        q = q.in_("estado", ["pendiente", "sincronizada", "rechazada"])
    resp = q.order("created_at", desc=True).limit(limit).execute()
    return resp.data or []


@router.post("/citas-qr", status_code=201)
def crear_cita_qr(data: CitaQRCreate, db: Session = Depends(get_db)):
    """Registra una nueva cita desde el formulario público (QR). Sin autenticación requerida."""
    sb = get_supabase()
    sb_vet_id = None
    if data.amivets_usuario_id:
        usuario = db.query(Usuario).filter(Usuario.id == data.amivets_usuario_id).first()
        if not usuario:
            raise HTTPException(status_code=404, detail="Veterinario no encontrado")
        sb_vet_id = _get_or_create_sb_vet(sb, usuario)
    payload = {
        "veterinario_id": sb_vet_id,
        "fecha_cita": data.fecha_cita,
        "hora_cita": data.hora_cita,
        "nombre_cliente": data.nombre_cliente,
        "telefono": data.telefono,
        "nombre_mascota": data.nombre_mascota,
        "tipo_mascota": data.tipo_mascota,
        "motivo": data.motivo,
        "estado": "pendiente",
    }
    resp = sb.table("citas_agendadas").insert(payload).execute()
    if not resp.data:
        raise HTTPException(status_code=400, detail="No se pudo registrar la cita en Supabase")
    return resp.data[0]


@router.delete("/citas-qr/{cita_id}", status_code=204)
def cancelar_cita_qr(
    cita_id: str,
    current_user: Usuario = Depends(get_current_admin),
):
    """Cancela una cita pendiente antes de que sea sincronizada. (Solo Admin)"""
    sb = get_supabase()
    sb.table("citas_agendadas").update({"estado": "cancelada"}).eq("id", cita_id).execute()
