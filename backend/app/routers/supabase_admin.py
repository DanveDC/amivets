from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
import os

from supabase import create_client, Client

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
    veterinario_id: int
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


# ── Veterinarios en Supabase ───────────────────────────────────────────────────

@router.get("/veterinarios")
def listar_veterinarios():
    sb = get_supabase()
    resp = sb.table("veterinarios").select("*").order("nombre").execute()
    return resp.data or []


@router.post("/veterinarios", status_code=201)
def crear_veterinario(data: VeterinarioSBCreate):
    sb = get_supabase()
    resp = sb.table("veterinarios").insert(data.model_dump()).execute()
    if not resp.data:
        raise HTTPException(status_code=400, detail="No se pudo crear el veterinario")
    return resp.data[0]


@router.put("/veterinarios/{vet_id}")
def actualizar_veterinario(vet_id: int, data: VeterinarioSBUpdate):
    sb = get_supabase()
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    resp = sb.table("veterinarios").update(payload).eq("id", vet_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Veterinario no encontrado")
    return resp.data[0]


@router.delete("/veterinarios/{vet_id}", status_code=204)
def desactivar_veterinario(vet_id: int):
    """Soft-delete: marca el vet como inactivo para no romper citas existentes."""
    sb = get_supabase()
    sb.table("veterinarios").update({"activo": False}).eq("id", vet_id).execute()


# ── Horarios en Supabase ───────────────────────────────────────────────────────

@router.get("/horarios")
def listar_horarios(veterinario_id: Optional[int] = None):
    sb = get_supabase()
    q = sb.table("horarios_veterinarios").select("*, veterinarios(nombre)")
    if veterinario_id:
        q = q.eq("veterinario_id", veterinario_id)
    resp = q.order("veterinario_id").order("dia_semana").order("hora_inicio").execute()
    return resp.data or []


@router.post("/horarios", status_code=201)
def crear_horario(data: HorarioCreate):
    sb = get_supabase()
    # Validar rango básico
    if data.hora_inicio >= data.hora_fin:
        raise HTTPException(status_code=400, detail="hora_inicio debe ser menor que hora_fin")
    if data.dia_semana < 0 or data.dia_semana > 6:
        raise HTTPException(status_code=400, detail="dia_semana debe estar entre 0 (Lunes) y 6 (Domingo)")
    resp = sb.table("horarios_veterinarios").insert(data.model_dump()).execute()
    if not resp.data:
        raise HTTPException(status_code=400, detail="No se pudo crear el horario")
    return resp.data[0]


@router.put("/horarios/{horario_id}")
def actualizar_horario(horario_id: int, data: HorarioUpdate):
    sb = get_supabase()
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")
    resp = sb.table("horarios_veterinarios").update(payload).eq("id", horario_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Horario no encontrado")
    return resp.data[0]


@router.delete("/horarios/{horario_id}", status_code=204)
def eliminar_horario(horario_id: int):
    sb = get_supabase()
    sb.table("horarios_veterinarios").delete().eq("id", horario_id).execute()


# ── Citas QR (lectura + cancelación) ──────────────────────────────────────────

@router.get("/citas-qr")
def listar_citas_qr(
    estado: Optional[str] = None,
    limit: int = 100,
):
    sb = get_supabase()
    q = sb.table("citas_agendadas").select("*, veterinarios(nombre)")
    if estado:
        q = q.eq("estado", estado)
    else:
        q = q.in_("estado", ["pendiente", "sincronizada", "rechazada"])
    resp = q.order("created_at", desc=True).limit(limit).execute()
    return resp.data or []


@router.delete("/citas-qr/{cita_id}", status_code=204)
def cancelar_cita_qr(cita_id: str):
    """Cancela una cita pendiente antes de que sea sincronizada."""
    sb = get_supabase()
    sb.table("citas_agendadas").update({"estado": "cancelada"}).eq("id", cita_id).execute()
