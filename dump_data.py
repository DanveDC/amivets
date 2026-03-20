
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))
os.environ['DATABASE_URL'] = 'postgresql://vetuser:vetpass123@localhost:5432/veterinaria_db'

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.models import Consulta, Cita

engine = create_engine(os.environ['DATABASE_URL'])
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

db = SessionLocal()
try:
    print("ALL CONSULTAS:")
    consultas = db.query(Consulta).all()
    for c in consultas:
        print(f"ID={c.id}, Fecha={c.fecha_consulta}, Motivo={c.motivo}, Peso={c.peso}, Temp={c.temperatura}, FC={c.frecuencia_cardiaca}")
    
    print("\nALL CITAS:")
    citas = db.query(Cita).all()
    for ci in citas:
        print(f"ID={ci.id}, Fecha={ci.fecha_cita}, Tipo={ci.tipo}, Estado={ci.estado}")
            
    print("\nDump finished.")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
