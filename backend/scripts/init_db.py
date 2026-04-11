import sys
import os

# Añadir el directorio raíz al path para poder importar la app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.reset_db import reset_database
from scripts.seed_data import seed_data

def init_production_db():
    print("=== INICIANDO CONFIGURACIÓN DE BASE DE DATOS EN RENDER ===")
    
    # 1. Borrar toda la base de datos y recrear la estructura limpia
    print("\n[Paso 1/2] Limpiando y reconstruyendo esquema (Drop & Create)...")
    try:
        reset_database()
    except Exception as e:
        print(f"Error en el borrado: {e}")
        
    # 2. Poblar con datos de prueba
    print("\n[Paso 2/2] Insertando datos de prueba...")
    try:
        seed_data()
    except Exception as e:
        print(f"Error en el sembrado: {e}")
        
    print("\n=== CONFIGURACIÓN DE BASE DE DATOS FINALIZADA ===")

if __name__ == "__main__":
    init_production_db()
