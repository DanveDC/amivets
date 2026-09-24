
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))
os.environ['DATABASE_URL'] = 'postgresql://vetuser:vetpass123@localhost:5432/veterinaria_db'

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.models import Base, Consulta, Cita

engine = create_engine(os.environ['DATABASE_URL'])
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

db = SessionLocal()
try:
    print("Checking Consultas...")
    consultas = db.query(Consulta).all()
    for c in consultas:
        issues = []
        if c.peso is not None and c.peso <= 0:
            issues.append(f"Peso={c.peso}")
        if c.temperatura is not None and (c.temperatura < 30 or c.temperatura > 45):
            issues.append(f"Temp={c.temperatura}")
        if c.frecuencia_cardiaca is not None and (c.frecuencia_cardiaca < 20 or c.frecuencia_cardiaca > 300):
            issues.append(f"FC={c.frecuencia_cardiaca}")
        
        if issues:
            print(f"Invalid Consulta ID {c.id}: {', '.join(issues)}")
    
    print("\nChecking Citas...")
    citas = db.query(Cita).all()
    for ci in citas:
        if ci.fecha_cita is None:
            print(f"Cita ID {ci.id} has NULL fecha_cita")
            
    print("\nCheck finished.")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
