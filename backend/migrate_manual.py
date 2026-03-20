import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.core.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS detalles_clinicos TEXT"))
        conn.commit()
        print("Migración de 'detalles_clinicos' exitosa.")
    except Exception as e:
        print(f"Error en migración: {e}")
