from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db
from ..core.config import settings
from ..models import models
from ..schemas import schemas

router = APIRouter(
    prefix="/api/clinico",
    tags=["Clinico"]
)

@router.get("/vacunaciones/{mascota_id}")
def obtener_vacunaciones(mascota_id: int, db: Session = Depends(get_db)):
    res = db.query(models.Vacunacion).join(models.Consulta).filter(models.Consulta.mascota_id == mascota_id).all()
    # attach vacuna details
    out = []
    for v in res:
        out.append({
            "id": v.id,
            "consulta_id": v.consulta_id,
            "lote": v.lote,
            "fecha_aplicacion": v.fecha_aplicacion,
            "fecha_refuerzo": v.fecha_refuerzo,
            "vacuna_nombre": v.vacuna.nombre if v.vacuna else "Desconocida"
        })
    return out

@router.post("/vacunacion", response_model=schemas.VacunacionResponse)
def crear_vacunacion(vacunacion: schemas.VacunacionCreate, db: Session = Depends(get_db)):
    # Verify consulta exists
    consulta = db.query(models.Consulta).filter(models.Consulta.id == vacunacion.consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    # Verify vaccine in inventory
    producto = db.query(models.Inventario).filter(models.Inventario.id == vacunacion.vacuna_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Vacuna no encontrada en inventario")
    
    # Check category
    if producto.categoria != "Vacuna" and settings.STRICT_INVENTORY: # Omit if strict
        pass 

    if producto.stock_actual < 1:
        raise HTTPException(status_code=400, detail="Stock insuficiente para esta vacuna")

    # Discount inventory
    producto.stock_actual -= 1
    
    # Register clinical procedure
    precio_aplicado = vacunacion.precio_aplicado if vacunacion.precio_aplicado and vacunacion.precio_aplicado > 0 else producto.precio_unitario

    db_vacunacion = models.Vacunacion(
        consulta_id=vacunacion.consulta_id,
        vacuna_id=vacunacion.vacuna_id,
        lote=vacunacion.lote,
        fecha_refuerzo=vacunacion.fecha_refuerzo,
        precio_aplicado=precio_aplicado,
        facturado=False
    )
    
    db.add(db_vacunacion)
    
    # Add to inventory history
    mov = models.MovimientoInventario(
        producto_id=producto.id,
        tipo_movimiento="SALIDA",
        cantidad=1,
        costo_unitario=producto.precio_unitario, # Using price since cost wasn't explicitly captured
        lote=vacunacion.lote,
        origen_destino=f"Aplicación clínica - Consulta #{consulta.id}"
    )
    db.add(mov)

    db.commit()
    db.refresh(db_vacunacion)
    return db_vacunacion

@router.get("/desparasitaciones/{mascota_id}")
def obtener_desparasitaciones(mascota_id: int, db: Session = Depends(get_db)):
    res = db.query(models.Desparasitacion).join(models.Consulta).filter(models.Consulta.mascota_id == mascota_id).all()
    out = []
    for d in res:
        out.append({
            "id": d.id,
            "consulta_id": d.consulta_id,
            "tipo": d.tipo,
            "dosis": d.dosis,
            "fecha_aplicacion": d.fecha_aplicacion,
            "producto_nombre": d.producto.nombre if d.producto else "Desconocido"
        })
    return out

@router.post("/desparasitacion", response_model=schemas.DesparasitacionResponse)
def crear_desparasitacion(desp: schemas.DesparasitacionCreate, db: Session = Depends(get_db)):
    consulta = db.query(models.Consulta).filter(models.Consulta.id == desp.consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    producto = db.query(models.Inventario).filter(models.Inventario.id == desp.producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    if producto.stock_actual < 1:
        raise HTTPException(status_code=400, detail="Stock insuficiente")

    producto.stock_actual -= 1
    precio_aplicado = desp.precio_aplicado if desp.precio_aplicado and desp.precio_aplicado > 0 else producto.precio_unitario

    db_desp = models.Desparasitacion(
        consulta_id=desp.consulta_id,
        tipo=desp.tipo,
        producto_id=desp.producto_id,
        dosis=desp.dosis,
        precio_aplicado=precio_aplicado,
        facturado=False
    )
    db.add(db_desp)

    mov = models.MovimientoInventario(
        producto_id=producto.id,
        tipo_movimiento="SALIDA",
        cantidad=1,
        costo_unitario=producto.precio_unitario,
        origen_destino=f"Aplicación clinica - Consulta #{consulta.id}"
    )
    db.add(mov)

    db.commit()
    db.refresh(db_desp)
    return db_desp

@router.get("/hospitalizaciones/{mascota_id}", response_model=List[schemas.HospitalizacionResponse])
def obtener_hospitalizaciones(mascota_id: int, db: Session = Depends(get_db)):
    return db.query(models.Hospitalizacion).filter(models.Hospitalizacion.mascota_id == mascota_id).all()

@router.post("/hospitalizacion", response_model=schemas.HospitalizacionResponse)
def crear_hospitalizacion(hosp: schemas.HospitalizacionCreate, db: Session = Depends(get_db)):
    if hosp.consulta_id:
        consulta = db.query(models.Consulta).filter(models.Consulta.id == hosp.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")

    db_hosp = models.Hospitalizacion(
        mascota_id=hosp.mascota_id,
        consulta_id=hosp.consulta_id,
        motivo=hosp.motivo,
        estado_paciente=hosp.estado_paciente,
        jaula_nro=hosp.jaula_nro,
        observaciones_ingreso=hosp.observaciones_ingreso,
        precio_aplicado=hosp.precio_aplicado,
        facturado=False,
        activo=True
    )
    db.add(db_hosp)
    db.commit()
    db.refresh(db_hosp)
    return db_hosp

@router.get("/cirugias/{mascota_id}", response_model=List[schemas.CirugiaResponse])
def obtener_cirugias(mascota_id: int, db: Session = Depends(get_db)):
    return db.query(models.Cirugia).filter(models.Cirugia.mascota_id == mascota_id).all()

@router.post("/cirugia", response_model=schemas.CirugiaResponse)
def crear_cirugia(cir: schemas.CirugiaCreate, db: Session = Depends(get_db)):
    if cir.consulta_id:
        consulta = db.query(models.Consulta).filter(models.Consulta.id == cir.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")

    db_cir = models.Cirugia(
        mascota_id=cir.mascota_id,
        consulta_id=cir.consulta_id,
        tipo_procedimiento=cir.tipo_procedimiento,
        cirujano_id=cir.cirujano_id,
        informe_quirurgico=cir.informe_quirurgico,
        complicaciones=cir.complicaciones,
        riesgo_asa=cir.riesgo_asa,
        precio_aplicado=cir.precio_aplicado,
        facturado=False
    )
    db.add(db_cir)
    db.commit()
    db.refresh(db_cir)
    return db_cir

@router.get("/pruebas_complementarias/{mascota_id}", response_model=List[schemas.PruebaComplementariaResponse])
def obtener_pruebas(mascota_id: int, db: Session = Depends(get_db)):
    return db.query(models.PruebaComplementaria).filter(models.PruebaComplementaria.mascota_id == mascota_id).all()

@router.post("/prueba_complementaria", response_model=schemas.PruebaComplementariaResponse)
def crear_prueba_complementaria(prueba: schemas.PruebaComplementariaCreate, db: Session = Depends(get_db)):
    if prueba.consulta_id:
        consulta = db.query(models.Consulta).filter(models.Consulta.id == prueba.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")

    db_prueba = models.PruebaComplementaria(
        tipo=prueba.tipo,
        archivo_url=prueba.archivo_url,
        resultado=prueba.resultado,
        observaciones=prueba.observaciones,
        precio_aplicado=prueba.precio_aplicado,
        consulta_id=prueba.consulta_id,
        mascota_id=prueba.mascota_id,
        facturado=False
    )
    db.add(db_prueba)
    db.commit()
    db.refresh(db_prueba)
    return db_prueba
