from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

load_dotenv()

# Build DB URL
DATABASE_URL = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DATABASE')}"

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE servicios_consulta ADD COLUMN IF NOT EXISTS detalles_clinicos TEXT"))
        conn.commit()
        print("Column 'detalles_clinicos' added or already exists.")
    except Exception as e:
        print(f"Error: {e}")
