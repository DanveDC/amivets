"""
sync_worker.py — Amivets Supabase Sync Worker
==============================================
Corre en segundo plano dentro del contenedor de Amivets (Render).
Cada 5 minutos consulta la tabla `citas_agendadas` en Supabase buscando
registros con estado='pendiente' y los inserta en la base de datos local
de Amivets (PostgreSQL). Si la inserción es exitosa, actualiza el estado
en Supabase a 'sincronizada'.

Variables de entorno requeridas (configura en Render > Environment):
  SUPABASE_URL          — URL del proyecto Supabase
  SUPABASE_SECRET_KEY   — service_role key del proyecto Supabase
  DATABASE_URL          — postgresql://user:pass@host/dbname   (ya existe en tu .env)

Dependencias:
  supabase>=2.3.0   (añadida a requirements.txt)
"""

import os
import time
import logging
from datetime import datetime, date, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client, Client
from sqlalchemy import create_engine, text, func
from sqlalchemy.orm import sessionmaker

# ── Importar modelos de Amivets ──────────────────────────────────────────────
# El worker corre dentro del contenedor donde /app/ ya tiene el backend.
import sys
sys.path.insert(0, "/app")

from app.models.models import Propietario, Mascota, Cita, CitaEstado, Usuario
from app.core.database import Base

# ── Configuración de logging ─────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SYNC_WORKER] %(levelname)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_worker")

# ── Variables de entorno ─────────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL        = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")
DATABASE_URL        = os.getenv("DATABASE_URL")          # PostgreSQL local de Amivets
SYNC_INTERVAL_SEC   = int(os.getenv("SYNC_INTERVAL_SEC", "300"))  # 5 minutos

# ── Inicializar clientes ─────────────────────────────────────────────────────
def init_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

def init_local_db():
    if not DATABASE_URL:
        raise EnvironmentError("DATABASE_URL no está configurada.")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    return Session

# ── Lógica de sincronización ─────────────────────────────────────────────────

def obtener_o_crear_propietario(session, nombre_cliente: str, telefono: str) -> Propietario:
    """
    Busca un propietario por teléfono. Si no existe, crea uno provisional.
    La recepción puede completar el resto de los datos (cedula, email, etc.)
    desde la interfaz interna de Amivets.
    """
    propietario = session.query(Propietario).filter(
        Propietario.telefono == telefono
    ).first()

    if propietario:
        log.info(f"  → Propietario existente encontrado: ID {propietario.id}")
        return propietario

    # Separar nombre en nombre + apellido (heurística simple)
    partes = nombre_cliente.strip().split(maxsplit=1)
    nombre  = partes[0]
    apellido = partes[1] if len(partes) > 1 else "—"

    # Cedula provisional única (para no violar la constraint UNIQUE)
    cedula_provisional = f"TEMP-{telefono}"

    # Verificar si ya hay un propietario con esa cédula provisional
    existe = session.query(Propietario).filter(
        Propietario.cedula == cedula_provisional
    ).first()
    if existe:
        return existe

    propietario = Propietario(
        nombre=nombre,
        apellido=apellido,
        cedula=cedula_provisional,
        telefono=telefono,
    )
    session.add(propietario)
    session.flush()  # obtener ID sin commit aún
    log.info(f"  → Propietario nuevo creado: ID {propietario.id} ({nombre_cliente})")
    return propietario


def obtener_o_crear_mascota(session, nombre_mascota: str, tipo_mascota: str,
                             propietario: Propietario) -> Mascota:
    """
    Busca la mascota por nombre + propietario. Si no existe, la crea.
    """
    mascota = session.query(Mascota).filter(
        Mascota.nombre == nombre_mascota,
        Mascota.propietario_id == propietario.id,
    ).first()

    if mascota:
        log.info(f"  → Mascota existente encontrada: ID {mascota.id}")
        return mascota

    # Código de historia provisional
    codigo = f"{propietario.cedula}-{nombre_mascota[:4].upper()}"

    mascota = Mascota(
        nombre=nombre_mascota,
        especie=tipo_mascota,
        propietario_id=propietario.id,
        codigo_historia=codigo,
    )
    session.add(mascota)
    session.flush()
    log.info(f"  → Mascota nueva creada: ID {mascota.id} ({nombre_mascota})")
    return mascota


def obtener_veterinario_local(session, amivets_usuario_id: int) -> Usuario | None:
    """
    Resuelve el veterinario local a partir del ID en Supabase.
    La tabla `veterinarios` en Supabase tiene la columna `amivets_usuario_id`.
    """
    return session.query(Usuario).filter(Usuario.id == amivets_usuario_id).first()


def asignar_veterinario_automatico(sb: Client, session, fecha_cita_dt: datetime) -> tuple[int | None, int | None]:
    """
    Para consultas generales: elige el vet activo con menos citas ese día.
    Retorna (supabase_vet_id, amivets_usuario_id) o (None, None) si no hay vets configurados.
    """
    resp = sb.table("veterinarios").select("id, amivets_usuario_id").eq("activo", True).execute()
    vets = [v for v in (resp.data or []) if v.get("amivets_usuario_id")]

    if not vets:
        return None, None

    dia_inicio = fecha_cita_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    dia_fin = dia_inicio + timedelta(days=1)

    best_sb_id, best_local_id, best_count = None, None, float("inf")
    for vet in vets:
        local_id = vet["amivets_usuario_id"]
        count = (
            session.query(func.count(Cita.id))
            .filter(
                Cita.veterinario_id == local_id,
                Cita.fecha_cita >= dia_inicio,
                Cita.fecha_cita < dia_fin,
                Cita.estado != CitaEstado.CANCELADA,
            )
            .scalar()
            or 0
        )
        if count < best_count:
            best_count = count
            best_sb_id = vet["id"]
            best_local_id = local_id

    return best_sb_id, best_local_id


def sincronizar_cita(sb: Client, Session, cita_sb: dict) -> bool:
    """
    Toma un registro de citas_agendadas (Supabase) y lo inserta en Amivets local.
    Si veterinario_id es null (consulta general), asigna automáticamente el vet con menos citas.
    Retorna True si se sincronizó correctamente.
    """
    cita_id = cita_sb["id"]
    log.info(f"Procesando cita Supabase ID: {cita_id}")

    # Construir datetime de la cita (necesario antes de la asignación automática)
    fecha_str = str(cita_sb["fecha_cita"])    # "2025-07-15"
    hora_str  = str(cita_sb["hora_cita"])[:5]  # "09:00"
    fecha_cita_dt = datetime.strptime(f"{fecha_str} {hora_str}", "%Y-%m-%d %H:%M")

    session = Session()
    try:
        sb_vet_id = cita_sb.get("veterinario_id")
        amivets_usuario_id = None

        if sb_vet_id is None:
            # Consulta general: asignar vet con menos citas ese día
            log.info("  → Consulta general, asignando veterinario automáticamente…")
            sb_vet_id, amivets_usuario_id = asignar_veterinario_automatico(sb, session, fecha_cita_dt)
            if not sb_vet_id:
                msg = "No hay veterinarios activos configurados para asignación automática"
                log.warning(f"  ✗ {msg}")
                _marcar_rechazada(sb, cita_id, msg)
                return False
            # Actualizar la cita en Supabase con el vet asignado
            sb.table("citas_agendadas").update({"veterinario_id": sb_vet_id}).eq("id", cita_id).execute()
            log.info(f"  → Vet asignado: Supabase ID {sb_vet_id} / Local ID {amivets_usuario_id}")
        else:
            vet_sb_resp = (
                sb.table("veterinarios")
                .select("amivets_usuario_id")
                .eq("id", sb_vet_id)
                .single()
                .execute()
            )
            amivets_usuario_id = vet_sb_resp.data.get("amivets_usuario_id") if vet_sb_resp.data else None

        if not amivets_usuario_id:
            msg = f"veterinario_id={sb_vet_id} no tiene amivets_usuario_id configurado"
            log.warning(f"  ✗ {msg}")
            _marcar_rechazada(sb, cita_id, msg)
            return False

        # 1. Propietario
        propietario = obtener_o_crear_propietario(
            session,
            cita_sb["nombre_cliente"],
            cita_sb["telefono"],
        )

        # 2. Mascota
        mascota = obtener_o_crear_mascota(
            session,
            cita_sb["nombre_mascota"],
            cita_sb["tipo_mascota"],
            propietario,
        )

        # 3. Veterinario local
        veterinario = obtener_veterinario_local(session, amivets_usuario_id)
        if not veterinario:
            msg = f"Usuario local ID {amivets_usuario_id} no encontrado"
            log.warning(f"  ✗ {msg}")
            _marcar_rechazada(sb, cita_id, msg)
            session.rollback()
            return False

        # 4. Verificar duplicado (misma fecha+vet+mascota)
        duplicado = session.query(Cita).filter(
            Cita.fecha_cita == fecha_cita_dt,
            Cita.veterinario_id == veterinario.id,
            Cita.mascota_id == mascota.id,
        ).first()

        if duplicado:
            log.warning("  ⚠ Cita duplicada detectada, marcando como sincronizada sin reinsertar")
            _marcar_sincronizada(sb, cita_id, duplicado.id)
            session.commit()
            return True

        # 5. Crear la cita local
        nueva_cita = Cita(
            fecha_cita=fecha_cita_dt,
            tipo="Consulta",
            estado=CitaEstado.PENDIENTE,
            observaciones=f"Agendada vía QR/Web. Tel: {cita_sb['telefono']}",
            veterinario_id=veterinario.id,
            propietario_id=propietario.id,
            mascota_id=mascota.id,
        )
        session.add(nueva_cita)
        session.commit()
        session.refresh(nueva_cita)

        log.info(f"  ✓ Cita local creada: ID {nueva_cita.id}")

        # 6. Actualizar Supabase
        _marcar_sincronizada(sb, cita_id, nueva_cita.id)
        return True

    except Exception as exc:
        session.rollback()
        msg = str(exc)[:300]
        log.error(f"  ✗ Error al sincronizar cita {cita_id}: {msg}")
        _marcar_rechazada(sb, cita_id, msg)
        return False

    finally:
        session.close()


def _marcar_sincronizada(sb: Client, cita_id: str, amivets_cita_id: int):
    sb.table("citas_agendadas").update({
        "estado": "sincronizada",
        "amivets_cita_id": amivets_cita_id,
        "sincronizada_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", cita_id).execute()


def _marcar_rechazada(sb: Client, cita_id: str, error_msg: str):
    sb.table("citas_agendadas").update({
        "estado": "rechazada",
        "error_msg": error_msg,
    }).eq("id", cita_id).execute()


# ── Loop principal ────────────────────────────────────────────────────────────

def run():
    log.info("Sync Worker iniciado. Intervalo: %d segundos.", SYNC_INTERVAL_SEC)

    sb      = init_supabase()
    Session = init_local_db()

    while True:
        try:
            log.info("🔍 Buscando citas pendientes en Supabase…")
            resp = sb.table("citas_agendadas") \
                .select("*") \
                .eq("estado", "pendiente") \
                .order("created_at") \
                .execute()

            citas = resp.data or []
            log.info(f"  Encontradas: {len(citas)} cita(s) pendiente(s).")

            ok = err = 0
            for cita in citas:
                if sincronizar_cita(sb, Session, cita):
                    ok += 1
                else:
                    err += 1

            if citas:
                log.info(f"  Resumen ciclo: ✓ {ok} sincronizadas | ✗ {err} rechazadas")

        except Exception as exc:
            log.error(f"Error en el ciclo de sincronización: {exc}")

        log.info(f"💤 Esperando {SYNC_INTERVAL_SEC // 60} min…\n")
        time.sleep(SYNC_INTERVAL_SEC)


if __name__ == "__main__":
    run()
