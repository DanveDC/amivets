
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))
os.environ['DATABASE_URL'] = 'postgresql://vetuser:vetpass123@localhost:5432/veterinaria_db'

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from app.models.models import Consulta, Cita

engine = create_engine(os.environ['DATABASE_URL'])
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

db = SessionLocal()
try:
    print(f"Total Consultas: {db.query(Consulta).count()}")
    print(f"Total Citas: {db.query(Cita).count()}")
finally:
    db.close()
