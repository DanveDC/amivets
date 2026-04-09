from app.core.config import settings
from sqlalchemy import create_engine, text

# Use the application's database URL
DATABASE_URL = settings.DATABASE_URL
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Ensure it uses localhost if not in docker
if "@db:" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("@db:", "@localhost:")

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS detalles_clinicos TEXT"))
        conn.execute(text("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS consulta_id INTEGER REFERENCES consultas(id)"))
        conn.commit()
        print("Column 'detalles_clinicos' in 'servicios_consulta' and 'consulta_id' in 'facturas' verified/added.")
    except Exception as e:
        print(f"Error: {e}")
