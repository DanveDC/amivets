from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.models import Hospitalizacion, Mascota, Consulta, ServicioConsulta
from app.schemas.schemas import HospitalizacionCreate, HospitalizacionResponse
from app.routers.usuarios import require_roles
from app.services import orden_service

router = APIRouter(prefix="/api/hospitalizaciones", tags=["Hospitalización"])

# Tarea 10 (fix de auth): admin + veterinario, sin recepcionista -- misma
# regla que clinico.py._ROLES_CLINICO_LECTURA. La fila 15 de la matriz de
# permisos le daria a recepcion una vista recortada (sin diagnostico ni
# tratamiento), pero eso exige un schema propio que hoy no existe; esta
# tarea es exclusivamente auth, sin tocar esquemas. Queda anotado como deuda.
_ROLES_HOSPITALIZACIONES = ("admin", "veterinario")

@router.post("/", response_model=HospitalizacionResponse, status_code=status.HTTP_201_CREATED)
def ingresar_paciente(
    hospitalizacion: HospitalizacionCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*_ROLES_HOSPITALIZACIONES)),
):
    """Ingresa un paciente a hospitalización"""
    # Verificar mascota
    mascota = db.query(Mascota).filter(Mascota.id == hospitalizacion.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")

    db_hosp = Hospitalizacion(**hospitalizacion.model_dump())
    db.add(db_hosp)

    # Espejo ServicioConsulta si la internación cuelga de una consulta (Tarea 09,
    # decisión 2). Mismo patrón que routers/clinico.py.
    if db_hosp.consulta_id:
        consulta = db.query(Consulta).filter(Consulta.id == db_hosp.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")
        orden = orden_service.orden_de_consulta(db, db_hosp.consulta_id)
        if orden is not None:
            orden_service.asegurar_recibe_trabajo(orden)
        db.flush()
        db.add(ServicioConsulta(
            orden_id=orden.id if orden is not None else None,
            consulta_id=db_hosp.consulta_id,
            mascota_id=consulta.mascota_id,
            tipo_servicio="HOSPITALIZACION",
            referencia_id=db_hosp.id,
            nombre_servicio=f"HOSPITALIZACIÓN: {(db_hosp.motivo or '')[:50]}",
            cantidad=float(db_hosp.dias_cama or 1),
            precio_unitario=db_hosp.precio_aplicado,
            detalles_clinicos=f"Jaula: {db_hosp.jaula_nro or 'N/A'} | Estado: {db_hosp.estado_paciente or 'Estable'}",
            estado="EJECUTADO",
        ))

    db.commit()
    db.refresh(db_hosp)
    return db_hosp

@router.get("/", response_model=List[HospitalizacionResponse])
def listar_hospitalizados(
    activos: bool = True,
    db: Session = Depends(get_db),
    # HALLAZGO DE SEGURIDAD (Tarea 10): unico endpoint del router sin guard --
    # POST y PUT ya usaban require_roles.
    _=Depends(require_roles(*_ROLES_HOSPITALIZACIONES)),
):
    """Lista pacientes en hospitalización"""
    query = db.query(Hospitalizacion)
    if activos:
        query = query.filter(Hospitalizacion.activo == True, Hospitalizacion.fecha_egreso == None)
    return query.all()

@router.put("/{hosp_id}/dar-alta", response_model=HospitalizacionResponse)
def dar_alta_paciente(
    hosp_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*_ROLES_HOSPITALIZACIONES)),
):
    """Registra el egreso de un paciente"""
    db_hosp = db.query(Hospitalizacion).filter(Hospitalizacion.id == hosp_id).first()
    if not db_hosp:
        raise HTTPException(status_code=404, detail="Registro de hospitalización no encontrado")
    
    import datetime
    db_hosp.fecha_egreso = datetime.datetime.now()
    db_hosp.activo = False
    db.commit()
    db.refresh(db_hosp)
    return db_hosp
