import sys
import os

# Añadir el directorio raíz al path para poder importar la app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.reset_db import reset_database, create_initial_admin
from scripts.seed_data import seed_data
from app.core.database import engine, Base
from sqlalchemy import inspect

# Frase de confirmación explícita para el reset destructivo. No es un booleano
# a propósito: un typo en FORCE_RESET_DB=true ya no alcanza para borrar nada.
RESET_CONFIRMATION_PHRASE = "ELIMINAR_TODOS_LOS_DATOS"


def _force_reset_requested():
    return os.getenv("FORCE_RESET_DB", "false").lower() == "true"


def _force_reset_authorized():
    """Doble gate para el reset destructivo: confirmación explícita + nunca en producción."""
    environment = os.getenv("ENVIRONMENT", "development").lower()
    if environment == "production":
        print("[init] FORCE_RESET_DB pedido pero ENVIRONMENT=production: rechazado sin excepción.")
        return False
    if os.getenv("FORCE_RESET_DB_CONFIRM") != RESET_CONFIRMATION_PHRASE:
        print(
            "[init] FORCE_RESET_DB=true pero falta FORCE_RESET_DB_CONFIRM="
            f"{RESET_CONFIRMATION_PHRASE!r}: rechazado."
        )
        return False
    return True


def init_production_db():
    print("=== INICIANDO CONFIGURACIÓN DE BASE DE DATOS ===")

    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as e:
        # 2026-08-18: un fallo transitorio acá se convirtió en "base vacía" y
        # el script avanzó hacia reset_database(). No se repite: si no se puede
        # determinar el estado de la base, la app no arranca.
        print(f"[init] No se pudo inspeccionar la base de datos: {e}")
        print("[init] Abortando arranque — no se puede determinar el estado de la base.")
        sys.exit(1)

    if _force_reset_requested():
        if not _force_reset_authorized():
            sys.exit(1)
        print("\nReset forzado autorizado. Ejecutando...")
        print("\n[Paso 1/3] Limpiando y reconstruyendo esquema (Drop & Create)...")
        reset_database()
        print("\n[Paso 2/3] Creando usuario admin...")
        create_initial_admin()
        print("\n[Paso 3/3] Insertando datos de prueba...")
        seed_data()
    elif "usuarios" not in tables:
        # Base genuinamente nueva (el inspector sí respondió). Solo se crea el
        # esquema — operación no destructiva, segura de repetir en cada arranque.
        # Nunca se llama reset_database() ni seed_data() por este camino.
        print("\nEsquema no encontrado. Creando tablas (create_all, no destructivo)...")
        Base.metadata.create_all(bind=engine)
        create_initial_admin()
    else:
        print("\nLa base de datos ya está inicializada. Conservando datos existentes.")
        create_initial_admin()

    print("\n=== CONFIGURACIÓN DE BASE DE DATOS FINALIZADA ===")

if __name__ == "__main__":
    init_production_db()
