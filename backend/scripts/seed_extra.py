import os
from sqlalchemy.orm import Session
import random
from datetime import datetime, timedelta
from app.core.database import SessionLocal
from app.models.models import Usuario, Propietario, Mascota, Consulta, Inventario, Vacunacion, Desparasitacion, PruebaComplementaria, Hospitalizacion, Cirugia

def seed_extra():
    db = SessionLocal()
    try:
        medicos = db.query(Usuario).filter(Usuario.username != "admin").all()
        if not medicos:
            medicos = db.query(Usuario).all()
        mascotas_docs = db.query(Mascota).all()
        
        if not medicos or not mascotas_docs:
            print("Faltan usuarios o mascotas para enlazar los extra records.")
            return

        motivos = ["Observación post-tóxico", "Fractura", "Decaimiento general", "Dificulta respiratoria", "Control quirúrgico", "Remoción de tumores", "Esterilización de emergencia", "Limpieza dental profunda"]
        diagnosticos = ["Intoxicación aguda", "Traumatismo severo", "Piometra", "Anemia hemolítica", "Sarro grado III", "Obstrucción intestinal"]

        print("Generando 30 consultas extra para hospitalizaciones y procedimientos...")
        for i in range(30):
            med = random.choice(medicos)
            m = random.choice(mascotas_docs)
            fecha_retroactiva = datetime.now() - timedelta(days=random.randint(2, 60), hours=random.randint(0, 12))
            
            consulta = Consulta(
                mascota_id=m.id,
                motivo=random.choice(motivos),
                sintomas=f"El paciente ingresa con signos de letargia. {random.choice(motivos)}",
                diagnostico=random.choice(diagnosticos),
                peso=m.peso + random.uniform(-2, 2) if m.peso else random.uniform(2, 30),
                temperatura=random.uniform(36.0, 40.5),
                frecuencia_cardiaca=random.uniform(50, 140),
                veterinario=f"Dr. {med.username}",
                fecha_consulta=fecha_retroactiva
            )
            db.add(consulta)
            db.flush()

            # Añadir Hospitalización
            if random.random() < 0.4:
                hosp = Hospitalizacion(
                    mascota_id=m.id,
                    consulta_id=consulta.id,
                    motivo=consulta.diagnostico,
                    estado_paciente=random.choice(["Estable", "Crítico", "Reservado"]),
                    jaula_nro=f"J-{random.randint(1,10)}",
                    observaciones_ingreso="Paciente se queda para monitoreo IV fluidoterapia y control de signos vitales cada 4 horas.",
                    precio_aplicado=random.uniform(80.0, 250.0),
                    facturado=False,
                    activo=random.choice([True, False])
                )
                db.add(hosp)

            # Añadir Cirugía / PROCEDIMIENTO
            if random.random() < 0.3:
                cir = Cirugia(
                    mascota_id=m.id,
                    consulta_id=consulta.id,
                    tipo_procedimiento=random.choice(["Ovariohisterectomía", "Profilaxis Dental", "Osteosíntesis de fémur", "Castración", "Biopsia de masa"]),
                    cirujano_id=med.id,
                    informe_quirurgico="El paciente fue pre-medicado. Inducción con Propofol. Mantenimiento Isoflurano. Se logró el procedimiento sin mayores complicaciones. Recuperación anestésica favorable.",
                    complicaciones="Ninguna evidente.",
                    riesgo_asa=random.choice(["I", "II", "III"]),
                    precio_aplicado=random.uniform(150.0, 800.0),
                    facturado=False
                )
                db.add(cir)
            
            # También algunas pruebas 
            if random.random() < 0.3:
                lab = PruebaComplementaria(
                    mascota_id=m.id,
                    consulta_id=consulta.id,
                    tipo=random.choice(["Laboratorio", "Rayos X", "Ecografía"]),
                    archivo_url="https://res.cloudinary.com/demo/image/upload/v1580211327/sample.jpg" if random.random() > 0.5 else None,
                    resultado=random.choice(["Positivo a Parvovirus", "Osteoartritis moderada", "Sin alteraciones graves", "Se evidencia cuerpo extraño en intestino"]),
                    precio_aplicado=random.choice([45.0, 60.0, 90.0]),
                    facturado=False
                )
                db.add(lab)

        db.commit()
        print("Datos avanzados extra (Hospitalizaciones, Cirugias) inyectados exitosamente.")

    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    seed_extra()
