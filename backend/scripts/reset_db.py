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
        # Desactivar temporalmente las restricciones de claves foráneas para truncar tablas
        # Esto es específico para PostgreSQL
        db.execute(text("TRUNCATE TABLE usuarios, propietarios, mascotas, citas, consultas, recetas, detalles_receta, pruebas_complementarias, inventario, facturas, detalles_factura, historia_propiedad, movimientos_inventario RESTART IDENTITY CASCADE;"))
        
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
