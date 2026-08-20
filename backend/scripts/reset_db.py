import sys
import os

# Añadir el directorio raíz al path para poder importar la app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.core.database import SessionLocal, engine
from app.models.models import Base

def reset_database():
    print("Iniciando limpieza de base de datos...")
    db = SessionLocal()
    try:
        # Borrar tabla de migraciones alembic para evitar conflictos continuos
        with engine.begin() as conn:
            if engine.dialect.name == "sqlite":
                conn.execute(text("DROP TABLE IF EXISTS alembic_version;"))
            else:
                conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE;"))

        print("Eliminando todas las tablas...")
        Base.metadata.drop_all(bind=engine)
        print("Recreando estructura de base de datos desde los modelos...")
        Base.metadata.create_all(bind=engine)
        print("Base de datos reseteada.")
    except Exception as e:
        db.rollback()
        print(f"Error al resetear la base de datos: {e}")
    finally:
        db.close()


def create_initial_admin():
    """Crea el usuario admin inicial si ADMIN_INITIAL_PASSWORD está seteada.

    Sin la variable, no se crea admin — no hay fallback a una contraseña por
    defecto (Unidad A1, docs/tareas/04-kpis-recetas-y-veterinarios.md). Idempotente:
    seguro de llamar en cada arranque.
    """
    admin_password = os.getenv("ADMIN_INITIAL_PASSWORD")
    if not admin_password:
        print("[admin] ADMIN_INITIAL_PASSWORD no está definida: no se crea usuario admin.")
        return

    from app.core.security import get_password_hash
    from app.models.models import Usuario

    db = SessionLocal()
    try:
        if db.query(Usuario).filter(Usuario.username == "admin").first():
            return
        db.add(Usuario(
            username="admin",
            email="admin@amivets.com",
            hashed_password=get_password_hash(admin_password),
            role="admin",
            is_active=True
        ))
        db.commit()
        print("[admin] Usuario admin creado desde ADMIN_INITIAL_PASSWORD.")
    except Exception as e:
        db.rollback()
        print(f"[admin] Error al crear el usuario admin: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    reset_database()
    create_initial_admin()
