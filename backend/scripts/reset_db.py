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
            conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE;"))
            
        print("Eliminando todas las tablas...")
        Base.metadata.drop_all(bind=engine)
        print("Recreando estructura de base de datos desde los modelos...")
        Base.metadata.create_all(bind=engine)
        # Como TRUNCATE CASCADE borró todo, necesitamos recrear al menos el admin inicial
        from app.core.security import get_password_hash
        from app.models.models import Usuario
        
        admin = Usuario(
            username="admin",
            email="admin@amivets.com",
            hashed_password=get_password_hash("admin123"),
            role="admin",
            is_active=True
        )
        
        # También el usuario de prueba de la verificación anterior si se desea, 
        # pero el usuario pidió dejar "solo admin"
        db.add(admin)
        
        db.commit()
        print("Base de datos limpiada. Solo el usuario 'admin' (pass: admin123) permanece.")
    except Exception as e:
        db.rollback()
        print(f"Error al resetear la base de datos: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    reset_database()
