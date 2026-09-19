from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import PruebaComplementaria, Mascota, Consulta, ServicioConsulta
from app.schemas.schemas import PruebaComplementariaCreate, PruebaComplementariaUpdate, PruebaComplementariaResponse
from app.routers.usuarios import require_roles
from app.services import orden_service

router = APIRouter(prefix="/api/pruebas", tags=["Laboratorio y Diagnostico"])

@router.post("/", response_model=PruebaComplementariaResponse, status_code=status.HTTP_201_CREATED)
def registrar_prueba(
    prueba: PruebaComplementariaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "veterinario")),
):
    """Registra una nueva prueba de laboratorio o diagnostico"""
    # Validar mascota
    mascota = db.query(Mascota).filter(Mascota.id == prueba.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")

    # Validar consulta si se proporciona
    consulta = None
    orden = None
    if prueba.consulta_id:
        consulta = db.query(Consulta).filter(Consulta.id == prueba.consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")
        orden = orden_service.orden_de_consulta(db, prueba.consulta_id)
        if orden is not None:
            orden_service.asegurar_recibe_trabajo(orden)

    nueva_prueba = PruebaComplementaria(**prueba.dict())
    db.add(nueva_prueba)

    # Espejo ServicioConsulta si la prueba cuelga de una consulta (Tarea 09,
    # decisión 2). Mismo patrón que routers/clinico.py.
    if consulta is not None:
        db.flush()
        db.add(ServicioConsulta(
            orden_id=orden.id if orden is not None else None,
            consulta_id=nueva_prueba.consulta_id,
            mascota_id=consulta.mascota_id,
            tipo_servicio="LABORATORIO" if "Lab" in (nueva_prueba.tipo or "") else "DIAGNOSTICO",
            referencia_id=nueva_prueba.id,
            nombre_servicio=f"ESTUDIO: {nueva_prueba.tipo}",
            cantidad=1.0,
            precio_unitario=nueva_prueba.precio_aplicado,
            detalles_clinicos=f"Resultado: {(nueva_prueba.resultado or 'Pendiente')[:100]}",
            estado="EJECUTADO",
        ))

    db.commit()
    db.refresh(nueva_prueba)
    return nueva_prueba

@router.get("/", response_model=List[PruebaComplementariaResponse])
def listar_pruebas(
    mascota_id: Optional[int] = None,
    consulta_id: Optional[int] = None,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Lista pruebas complementarias con filtros"""
    query = db.query(PruebaComplementaria)
    
    if mascota_id:
        query = query.filter(PruebaComplementaria.mascota_id == mascota_id)
    if consulta_id:
        query = query.filter(PruebaComplementaria.consulta_id == consulta_id)
    if tipo:
        query = query.filter(PruebaComplementaria.tipo == tipo)
        
    return query.all()

@router.get("/{prueba_id}", response_model=PruebaComplementariaResponse)
def obtener_prueba(
    prueba_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una prueba especifica por ID"""
    prueba = db.query(PruebaComplementaria).filter(PruebaComplementaria.id == prueba_id).first()
    if not prueba:
        raise HTTPException(status_code=404, detail="Prueba no encontrada")
    return prueba

@router.put("/{prueba_id}", response_model=PruebaComplementariaResponse)
def actualizar_prueba(
    prueba_id: int,
    prueba_update: PruebaComplementariaUpdate,
    db: Session = Depends(get_db),
    # Sin guard hasta la Tarea 06 (decisión 9): mismo criterio que
    # POST /api/pruebas/ (registro clínico, admin/veterinario).
    _=Depends(require_roles("admin", "veterinario")),
):
    """Actualiza la informacion de una prueba"""
    prueba = db.query(PruebaComplementaria).filter(PruebaComplementaria.id == prueba_id).first()
    if not prueba:
        raise HTTPException(status_code=404, detail="Prueba no encontrada")
        
    for key, value in prueba_update.dict(exclude_unset=True).items():
        setattr(prueba, key, value)
    
    db.commit()
    db.refresh(prueba)
    return prueba

@router.delete("/{prueba_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_prueba(
    prueba_id: int,
    db: Session = Depends(get_db),
    # Sin guard hasta la Tarea 06 (decisión 9): elimina un registro clínico,
    # mismo criterio que el resto de este router (admin/veterinario).
    _=Depends(require_roles("admin", "veterinario")),
):
    """Elimina una prueba"""
    prueba = db.query(PruebaComplementaria).filter(PruebaComplementaria.id == prueba_id).first()
    if not prueba:
        raise HTTPException(status_code=404, detail="Prueba no encontrada")
        
    db.delete(prueba)
    db.commit()
    return None
