import sys
import os
from datetime import datetime, timedelta

# Añadir el directorio raíz al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.models import (
    Usuario, Propietario, Mascota, Consulta, Inventario,
    ServicioConsulta, Hospitalizacion, Cirugia, Vacunacion, 
    Desparasitacion, PruebaComplementaria
)

def populate_demo():
    db = SessionLocal()
    try:
        print("🚀 Iniciando carga de datos de demostración completa...")
        
        # 1. Asegurar que existe un Propietario y Mascota para la demo
        prop = db.query(Propietario).filter(Propietario.cedula == "DEMO-001").first()
        if not prop:
            prop = Propietario(
                nombre="Juan", apellido="Demostración", cedula="DEMO-001",
                telefono="0412-9999999", email="demo@amivets.com", direccion="Av. Principal Demo"
            )
            db.add(prop)
            db.flush()
        
        masc = db.query(Mascota).filter(Mascota.codigo_historia == "PAT-DEMO").first()
        if not masc:
            masc = Mascota(
                nombre="Rex (Demo)", especie="Perro", raza="Pastor Alemán",
                sexo="Macho", fecha_nacimiento=datetime.now().date() - timedelta(days=730),
                color="Fuego", peso=32.5, propietario_id=prop.id,
                codigo_historia="PAT-DEMO", activo=True
            )
            db.add(masc)
            db.flush()

        # 2. Crear una Consulta Principal
        consulta = Consulta(
            mascota_id=masc.id,
            motivo="Chequeo Completo de Demostración",
            sintomas="Paciente traído para validar todos los módulos del sistema.",
            diagnostico="Paciente Sano (Control Operativo)",
            tratamiento="Seguimiento de rutina y plan preventivo.",
            peso=32.5, temperatura=38.5, frecuencia_cardiaca=80,
            veterinario="Dr. Antigravity",
            fecha_consulta=datetime.now()
        )
        db.add(consulta)
        db.flush()

        print(f"✅ Consulta #{consulta.id} creada. Agregando módulos clínicos...")

        # 3. Hospitalización
        hosp = Hospitalizacion(
            mascota_id=masc.id, consulta_id=consulta.id, motivo="Observación Post-Vacunal",
            estado_paciente="Estable", jaula_nro="UCI-05", 
            fecha_ingreso=datetime.now() - timedelta(hours=2),
            fecha_egreso=datetime.now() + timedelta(days=1),
            precio_aplicado=150.0, activo=True
        )
        db.add(hosp)
        db.flush()
        
        db.add(ServicioConsulta(
            consulta_id=consulta.id, tipo_servicio="HOSPITALIZACION", referencia_id=hosp.id,
            nombre_servicio="HOSPITALIZACIÓN: OBSERVACIÓN", cantidad=1.0, precio_unitario=150.0,
            detalles_clinicos=f"Ingreso: {hosp.fecha_ingreso.strftime('%d/%m/%Y %H:%M')} | Egreso: {hosp.fecha_egreso.strftime('%d/%m/%Y %H:%M')} | Jaula: {hosp.jaula_nro} | Estado: {hosp.estado_paciente}",
            estado="Aplicado"
        ))

        # 4. Vacunación
        vac_prod = db.query(Inventario).filter(Inventario.categoria == "Vacuna").first()
        if vac_prod:
            vac = Vacunacion(
                consulta_id=consulta.id, vacuna_id=vac_prod.id, lote="LOT-2026-X",
                fecha_refuerzo=datetime.now() + timedelta(days=365), precio_aplicado=40.0
            )
            db.add(vac)
            db.flush()
            db.add(ServicioConsulta(
                consulta_id=consulta.id, tipo_servicio="VACUNACION", referencia_id=vac.id,
                nombre_servicio=f"VACUNA: {vac_prod.nombre}", cantidad=1.0, precio_unitario=40.0,
                detalles_clinicos=f"Lote: {vac.lote} | Refuerzo: {vac.fecha_refuerzo.strftime('%d/%m/%Y')}",
                estado="Aplicado"
            ))

        # 5. Cirugía
        cir = Cirugia(
            mascota_id=masc.id, consulta_id=consulta.id, tipo_procedimiento="Limpieza Dental Especializada",
            cirujano_id=1, riesgo_asa="ASA I", informe_quirurgico="Procedimiento exitoso.",
            precio_aplicado=250.0
        )
        db.add(cir)
        db.flush()
        db.add(ServicioConsulta(
            consulta_id=consulta.id, tipo_servicio="CIRUGIA", referencia_id=cir.id,
            nombre_servicio=f"CIRUGÍA: {cir.tipo_procedimiento}", cantidad=1.0, precio_unitario=250.0,
            detalles_clinicos=f"Riesgo ASA: {cir.riesgo_asa} | Cirujano ID: {cir.cirujano_id}",
            estado="Aplicado"
        ))

        # 6. Laboratorio
        lab = PruebaComplementaria(
            mascota_id=masc.id, consulta_id=consulta.id, tipo="Hemograma Completo",
            resultado="Valores normales en sangre periférica.", observaciones="Sin hallazgos patológicos.",
            precio_aplicado=45.0
        )
        db.add(lab)
        db.flush()
        db.add(ServicioConsulta(
            consulta_id=consulta.id, tipo_servicio="LABORATORIO", referencia_id=lab.id,
            nombre_servicio=f"ESTUDIO: {lab.tipo}", cantidad=1.0, precio_unitario=45.0,
            detalles_clinicos=f"Resultado: {lab.resultado} | Obs: {lab.observaciones}",
            estado="Aplicado"
        ))

        # 7. Desparasitación
        desp_prod = db.query(Inventario).filter(Inventario.categoria == "Desparasitante").first()
        if desp_prod:
            desp = Desparasitacion(
                consulta_id=consulta.id, producto_id=desp_prod.id, tipo="Interna",
                dosis="1 tableta", precio_aplicado=15.0
            )
            db.add(desp)
            db.flush()
            db.add(ServicioConsulta(
                consulta_id=consulta.id, tipo_servicio="DESPARASITACION", referencia_id=desp.id,
                nombre_servicio=f"DESPARASITACIÓN: {desp_prod.nombre}", cantidad=1.0, precio_unitario=15.0,
                detalles_clinicos=f"Tipo: {desp.tipo} | Dosis: {desp.dosis}",
                estado="Aplicado"
            ))

        db.commit()
        print("\n✨ CARGA DE DEMOSTRACIÓN FINALIZADA CON ÉXITO")
        print(f"🔍 Busca al paciente: '{masc.nombre}' o consulta ID: {consulta.id}")

    except Exception as e:
        db.rollback()
        print(f"❌ Error durante el demo seeding: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    populate_demo()
