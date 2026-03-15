import sys
import os
from datetime import datetime, date, timedelta
import random

# Añadir el directorio raíz al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import Usuario, Propietario, Mascota, Consulta, Inventario, Cita, CitaEstado

def seed_data():
    print("Iniciando carga de datos de prueba...")
    db = SessionLocal()
    try:
        # 1. Crear Médicos (5 usuarios)
        medicos = []
        for i in range(1, 6):
            username = f"doctor{i}"
            user = db.query(Usuario).filter(Usuario.username == username).first()
            if not user:
                user = Usuario(
                    username=username,
                    email=f"doctor{i}@amivets.com",
                    hashed_password=get_password_hash("doctor123"),
                    role="user",
                    is_active=True
                )
                db.add(user)
            medicos.append(user)
        
        # 2. Crear Inventario Básico (Medicamenteos para recetas)
        productos = [
            {"codigo": "P-001", "nombre": "Amoxicilina 500mg", "categoria": "Antibiótico", "precio": 15.0, "stock": 50},
            {"codigo": "P-002", "nombre": "Meloxicam 2.5mg", "categoria": "Antiinflamatorio", "precio": 12.5, "stock": 30},
            {"codigo": "P-003", "nombre": "Doxiciclina 100mg", "categoria": "Antibiótico", "precio": 18.2, "stock": 40},
            {"codigo": "P-004", "nombre": "Prednisona 5mg", "categoria": "Corticoide", "precio": 10.0, "stock": 100},
            {"codigo": "P-005", "nombre": "Complejo B Inyectable", "categoria": "Vitamina", "precio": 8.5, "stock": 20},
        ]
        
        inventario_docs = []
        for p in productos:
            item = db.query(Inventario).filter(Inventario.codigo == p["codigo"]).first()
            if not item:
                item = Inventario(
                    codigo=p["codigo"],
                    nombre=p["nombre"],
                    categoria=p["categoria"],
                    precio_unitario=p["precio"],
                    stock_actual=p["stock"],
                    stock_minimo=5,
                    activo=True
                )
                db.add(item)
            inventario_docs.append(item)

        # 3. Crear Propietarios (10)
        propietarios_data = [
            ("Juan", "Pérez", "12345678", "0414-1234567", "juan.perez@email.com"),
            ("María", "González", "87654321", "0424-7654321", "maria.g@email.com"),
            ("Carlos", "Rodríguez", "11223344", "0412-1112233", "carlos.rod@email.com"),
            ("Ana", "Martínez", "44332211", "0416-4443322", "ana.m@email.com"),
            ("Luis", "Sánchez", "55667788", "0414-5556677", "luis.s@email.com"),
            ("Elena", "López", "88776655", "0424-8887766", "elena.l@email.com"),
            ("Pedro", "Gómez", "99001122", "0412-9990011", "pedro.g@email.com"),
            ("Laura", "Díaz", "22110099", "0416-2221100", "laura.d@email.com"),
            ("Jorge", "Hernández", "33445566", "0414-3334455", "jorge.h@email.com"),
            ("Sofía", "Castro", "66554433", "0424-6665544", "sofia.c@email.com"),
        ]
        
        propietarios_docs = []
        for nom, ape, ced, tel, email in propietarios_data:
            prop = db.query(Propietario).filter(Propietario.cedula == ced).first()
            if not prop:
                prop = Propietario(
                    nombre=nom,
                    apellido=ape,
                    cedula=ced,
                    telefono=tel,
                    email=email,
                    direccion="Calle Falsa 123",
                    activo=True
                )
                db.add(prop)
            propietarios_docs.append(prop)
        
        db.flush() # Para obtener IDs

        # 4. Crear Mascotas (15)
        mascotas_data = [
            ("Firulais", "Perro", "Golden Retriever", "Macho", "2020-01-15", "Dorado", 25.5, 0),
            ("Luna", "Gato", "Siamés", "Hembra", "2021-05-10", "Blanco/Gris", 4.2, 1),
            ("Rocky", "Perro", "Pastor Alemán", "Macho", "2019-11-20", "Negro/Fuego", 32.0, 2),
            ("Bella", "Perro", "Poodle", "Hembra", "2022-03-05", "Blanco", 6.5, 3),
            ("Simba", "Gato", "Persa", "Macho", "2021-08-12", "Naranja", 5.0, 4),
            ("Toby", "Perro", "Beagle", "Macho", "2020-12-01", "Tricolor", 12.8, 5),
            ("Mia", "Gato", "Mestizo", "Hembra", "2023-01-20", "Calicó", 3.5, 6),
            ("Max", "Perro", "Labrador", "Macho", "2018-06-15", "Chocolate", 28.3, 7),
            ("Coco", "Perro", "Chihuahua", "Hembra", "2021-02-14", "Arena", 2.1, 8),
            ("Daisy", "Perro", "Boxer", "Hembra", "2019-09-30", "Atigrado", 24.0, 9),
            ("Bruno", "Perro", "Rottweiler", "Macho", "2020-04-22", "Negro/Bronce", 38.5, 0),
            ("Nala", "Gato", "Mestizo", "Hembra", "2022-11-12", "Tabby", 3.8, 1),
            ("Cooper", "Perro", "Golden Retriever", "Macho", "2021-07-04", "Dorado", 27.0, 2),
            ("Molly", "Perro", "Cocker Spaniel", "Hembra", "2020-08-18", "Canela", 11.5, 3),
            ("Baco", "Perro", "Husky", "Macho", "2019-02-28", "Gris/Blanco", 22.4, 4),
        ]
        
        mascotas_docs = []
        for i, (nom, esp, raz, sex, nac, col, pes, p_idx) in enumerate(mascotas_data):
            p_id = propietarios_docs[p_idx].id
            cedula = propietarios_docs[p_idx].cedula
            codigo = f"{cedula}-{i+1}"
            mascota = db.query(Mascota).filter(Mascota.codigo_historia == codigo).first()
            if not mascota:
                mascota = Mascota(
                    nombre=nom,
                    especie=esp,
                    raza=raz,
                    sexo=sex,
                    fecha_nacimiento=date.fromisoformat(nac),
                    color=col,
                    peso=pes,
                    propietario_id=p_id,
                    estado_reproductivo="No Esterilizado" if i % 2 == 0 else "Esterilizado",
                    codigo_historia=codigo,
                    activo=True
                )
                db.add(mascota)
            mascotas_docs.append(mascota)
        
        db.commit() # Commit Owners and Pets
        print("Mascotas y propietarios creados.")

        # 5. Crear Consultas (unas pocas)
        for i in range(5):
            m = mascotas_docs[i]
            consulta = Consulta(
                mascota_id=m.id,
                motivo="Chequeo General",
                sintomas="Ninguno aparente, revisión de rutina.",
                diagnostico="Paciente sano.",
                peso=m.peso,
                temperatura=38.5,
                frecuencia_cardiaca=70.0,
                veterinario=f"Dr. {medicos[i].username}",
                observaciones="Se recomienda desparasitación el próximo mes."
            )
            db.add(consulta)
        db.commit()
        print("Consultas creadas.")

        # 6. Crear Citas/Órdenes (unas pocas)
        for i in range(5, 8):
            m = mascotas_docs[i]
            cita = Cita(
                fecha_cita=datetime.now() + timedelta(days=1, hours=i),
                tipo="Consulta Especializada",
                estado=CitaEstado.PENDIENTE,
                mascota_id=m.id,
                propietario_id=m.propietario_id,
                veterinario_id=medicos[i-5].id,
                observaciones="Requiere ayuno."
            )
            db.add(cita)

        db.commit()
        print("Datos de prueba cargados exitosamente.")
        print(f"Resumen: {len(medicos)} médicos, {len(propietarios_docs)} propietarios, {len(mascotas_docs)} mascotas.")
        
    except Exception as e:
        db.rollback()
        print(f"Error al cargar datos de prueba: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    seed_data()
