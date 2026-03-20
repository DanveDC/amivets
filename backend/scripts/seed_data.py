import sys
import os
from datetime import datetime, date, timedelta
import random

# Añadir el directorio raíz al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    Usuario, Propietario, Mascota, Consulta, Inventario, Cita, CitaEstado,
    Vacunacion, Desparasitacion, PruebaComplementaria,
    ServicioConsulta, Hospitalizacion, Cirugia, Receta, DetalleReceta
)

def seed_data():
    db = SessionLocal()
    try:
        # Check if data already exists to avoid duplication
        exists = db.query(Consulta).first()
        if exists:
            print("ℹ️ La base de datos ya contiene información clínica. Omitiendo seeding automático.")
            return
        
        print("🚀 Iniciando carga masiva de datos profesionales...")
        # 1. Médicos (10 usuarios)
        medicos = []
        nombres_medicos = ["Pérez", "García", "Rodríguez", "Martínez", "López", "Sánchez", "González", "Díaz", "Fernández", "Moreno"]
        for i, apellido in enumerate(nombres_medicos):
            username = f"dr_{apellido.lower()}"
            user = db.query(Usuario).filter(Usuario.username == username).first()
            if not user:
                user = Usuario(
                    username=username,
                    email=f"{username}@amivets.com",
                    hashed_password=get_password_hash("doctor123"),
                    role="user",
                    is_active=True
                )
                db.add(user)
            medicos.append(user)
        db.commit()
        
        # 2. Inventario Extendido (40+ items)
        print("📦 Poblando inventario...")
        categorias = {
            "Antibiótico": [("Amoxicilina 500mg", 15.0), ("Enrofloxacina 100mg", 18.5), ("Cefalexina 250mg", 14.0), ("Doxiciclina 100mg", 22.0)],
            "Antiinflamatorio": [("Meloxicam 2.5mg", 12.5), ("Carprofeno 75mg", 25.0), ("Prednisolona 10mg", 10.0), ("Firocoxib 57mg", 45.0)],
            "Vacuna": [("Vacuna Antirrábica", 25.0), ("Vacuna Séxtuple Canina", 40.0), ("Triple Felina", 35.0), ("Leucemia Felina", 45.0), ("Tos de Perreras", 30.0)],
            "Desparasitante": [("Bravecto Perros", 35.0), ("NexGard Spectra", 32.0), ("Frontline Plus", 28.0), ("Drontal Plus", 15.0), ("Profender Gatos", 20.0)],
            "Insumo": [("Gasa estéril pkg", 2.5), ("Suero Fisiológico 500ml", 5.0), ("Sutura 3-0", 8.0), ("Jeringa 3ml", 0.5), ("Catéter 22G", 3.0)],
            "Alimento": [("Royal Canin GI 2kg", 55.0), ("Hills A/D Lata", 8.0), ("Pro Plan Puppy 3kg", 48.0)],
            "Laboratorio": [("Hemograma Completo", 45.0), ("Perfil Bioquímico", 65.0), ("Test 4DX", 55.0), ("Uroanálisis", 30.0)],
            "Imagen": [("Rayos X (1 Vista)", 50.0), ("Ecografía Abdominal", 90.0), ("Ecocardiograma", 120.0)]
        }
        
        prefixes = {
            "Antibiótico": "AB",
            "Antiinflamatorio": "AI",
            "Vacuna": "VC",
            "Desparasitante": "DP",
            "Insumo": "IN",
            "Alimento": "AL",
            "Laboratorio": "LB",
            "Imagen": "IM"
        }
        
        inventario_docs = []
        for cat_name, items in categorias.items():
            prefix = prefixes.get(cat_name, cat_name[:2].upper())
            for i, (nombre, precio) in enumerate(items):
                codigo = f"{prefix}-{i+100}"
                item = db.query(Inventario).filter(Inventario.codigo == codigo).first()
                if not item:
                    item = Inventario(
                        codigo=codigo,
                        nombre=nombre,
                        categoria=cat_name,
                        precio_unitario=precio,
                        stock_actual=random.randint(20, 100),
                        stock_minimo=5,
                        activo=True
                    )
                    db.add(item)
                inventario_docs.append(item)
        db.commit()

        # 3. Propietarios (40)
        print("👥 Creando propietarios...")
        nombres = ["Juan", "María", "Carlos", "Ana", "Luis", "Elena", "Pedro", "Laura", "Jorge", "Sofía", "Miguel", "Isabel", "Diego", "Carmen", "Andrés", "Lucía", "Roberto", "Mónica", "Fernando", "Patricia"]
        apellidos = ["Pérez", "González", "Rodríguez", "Martínez", "Sánchez", "López", "Gómez", "Díaz", "Hernández", "Castro", "Ruiz", "Álvarez", "Jiménez", "Moreno", "Muñoz", "Romero", "Alonso", "Gutiérrez", "Navarro", "Torres"]
        
        propietarios_docs = []
        for i in range(40):
            ced = str(random.randint(10000000, 30000000))
            prop = db.query(Propietario).filter(Propietario.cedula == ced).first()
            if not prop:
                prop = Propietario(
                    nombre=random.choice(nombres),
                    apellido=random.choice(apellidos),
                    cedula=ced,
                    telefono=f"04{random.randint(12, 24)}-{random.randint(1000000, 9999999)}",
                    email=f"user{i}_{ced}@gmail.com",
                    direccion="Urbanización Central, Av. Principal",
                    activo=True
                )
                db.add(prop)
            propietarios_docs.append(prop)
        db.flush()

        # 4. Mascotas (60)
        print("🐾 Creando pacientes (mascotas)...")
        razas_perro = ["Golden Retriever", "Pastor Alemán", "Poodle", "Beagle", "Labrador", "Chihuahua", "Boxer", "Rottweiler", "Husky", "Cocker Spaniel", "Pug", "Dachshund"]
        razas_gato = ["Siamés", "Persa", "Mestizo", "Bengala", "Ragdoll", "Maine Coon"]
        nombres_mascotas = ["Firulais", "Luna", "Rocky", "Bella", "Simba", "Toby", "Mia", "Max", "Coco", "Daisy", "Bruno", "Nala", "Cooper", "Molly", "Baco", "Zeus", "Thor", "Kiwi", "Lola", "Rex", "Maya", "Pipo", "Tito", "Nina"]
        
        mascotas_docs = []
        for i in range(60):
            p = random.choice(propietarios_docs)
            especie = random.choice(["Perro", "Gato"])
            raza = random.choice(razas_perro) if especie == "Perro" else random.choice(razas_gato)
            nombre = random.choice(nombres_mascotas) + f" {i}"
            codigo = f"{p.cedula}-{i}"
            
            mascota = db.query(Mascota).filter(Mascota.codigo_historia == codigo).first()
            if not mascota:
                nac = datetime.now() - timedelta(days=random.randint(365, 3650))
                mascota = Mascota(
                    nombre=nombre,
                    especie=especie,
                    raza=raza,
                    sexo=random.choice(["Macho", "Hembra"]),
                    fecha_nacimiento=nac.date(),
                    color=random.choice(["Blanco", "Negro", "Marrón", "Gris", "Dorado", "Manchado"]),
                    peso=round(random.uniform(2.0, 40.0), 1),
                    propietario_id=p.id,
                    estado_reproductivo=random.choice(["Esterilizado", "No Esterilizado"]),
                    codigo_historia=codigo,
                    activo=True
                )
                db.add(mascota)
            mascotas_docs.append(mascota)
        db.commit()

        # 5. Carga Histórica de Consultas (250 consultas en el último año)
        print("🩺 Generando historial clínico denso (último año)...")
        motivos = ["Chequeo General", "Vacunación", "Vómitos y diarrea", "Control post-op", "Problemas de piel", "Cojera", "Fiebre", "Limpieza dental", "Accidente doméstico", "Pérdida de apetito"]
        diagnosticos = ["Paciente Sano", "Dermatitis alérgica", "Gastroenteritis bacteriana", "Fractura por trauma", "Alergia alimentaria", "Otitis externa", "Parásitos intestinales", "Gingivitis leve", "Deshidratación", "Insuficiencia renal leve"]
        
        vacunas = [i for i in inventario_docs if i.categoria == "Vacuna"]
        desparasitantes = [i for i in inventario_docs if i.categoria == "Desparasitante"]
        medicamentos = [i for i in inventario_docs if i.categoria in ["Antibiótico", "Antiinflamatorio"]]
        laboratorios = [i for i in inventario_docs if i.categoria == "Laboratorio"]
        imagenes = [i for i in inventario_docs if i.categoria == "Imagen"]
        insumos = [i for i in inventario_docs if i.categoria == "Insumo"]

        for c_idx in range(250):
            m = random.choice(mascotas_docs)
            dr = random.choice(medicos)
            dias_atras = random.randint(0, 365)
            fecha = datetime.now() - timedelta(days=dias_atras, hours=random.randint(0, 8))
            
            consulta = Consulta(
                mascota_id=m.id,
                motivo=random.choice(motivos),
                sintomas="Descripción semiológica de los signos clínicos observados...",
                diagnostico=random.choice(diagnosticos),
                tratamiento="Plan terapéutico indicado según hallazgos...",
                peso=round(m.weight + random.uniform(-0.5, 0.5) if hasattr(m, 'weight') else m.peso + random.uniform(-0.5, 0.5), 2),
                temperatura=round(random.uniform(37.8, 40.1), 1),
                frecuencia_cardiaca=random.randint(70, 140),
                veterinario=f"Dr. {dr.username.split('_')[1].capitalize()}",
                fecha_consulta=fecha
            )
            # Fix: weight might be .peso in model
            consulta.peso = round(m.peso + random.uniform(-0.5, 0.5), 2)
            
            db.add(consulta)
            db.flush()

            # --- 1. Fórmulas (50% prob) ---
            if random.random() < 0.5:
                receta = Receta(consulta_id=consulta.id, fecha_emision=fecha, indicaciones_generales="Administrar según dosis indicada.")
                db.add(receta)
                db.flush()
                for _ in range(random.randint(1, 3)):
                    med = random.choice(medicamentos)
                    db.add(DetalleReceta(receta_id=receta.id, medicamento_id=med.id, dosis="X ml", frecuencia="12h", duracion="5d"))

            # --- 2. Hospitalizaciones (15% prob) ---
            if random.random() < 0.15:
                hosp = Hospitalizacion(mascota_id=m.id, consulta_id=consulta.id, fecha_ingreso=fecha, motivo="Observación", estado_paciente="Estable", jaula_nro="UCI-01", dias_cama=random.randint(1, 4), precio_aplicado=150.0, activo=False )
                db.add(hosp)
                db.flush()
                db.add(ServicioConsulta(consulta_id=consulta.id, tipo_servicio="HOSPITALIZACION", referencia_id=hosp.id, nombre_servicio="Hospitalización", cantidad=float(hosp.dias_cama), precio_unitario=50.0, estado="Aplicado"))

            # --- 3. Cirugías (7% prob) ---
            if random.random() < 0.07:
                ciru = Cirugia(mascota_id=m.id, consulta_id=consulta.id, fecha_cirugia=fecha, tipo_procedimiento="Cirugía General", cirujano_id=dr.id, informe_quirurgico="Sin incidentes.", riesgo_asa="ASA II", precio_aplicado=300.0)
                db.add(ciru)
                db.flush()
                db.add(ServicioConsulta(consulta_id=consulta.id, tipo_servicio="CIRUGIA", referencia_id=ciru.id, nombre_servicio="Cirugía Programada", cantidad=1.0, precio_unitario=300.0, estado="Aplicado"))

            if c_idx % 50 == 0:
                db.commit()
                print(f"   ... {c_idx} consultas generadas")

        db.commit()
        print("\n✅ SEEDING COMPLETADO CON ÉXITO")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error durante el seeding: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    seed_data()
