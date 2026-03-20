from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.schemas import (
    ConsultaCreate, ConsultaUpdate, ConsultaResponse,
    RecetaCreate, RecetaResponse,
    ServicioConsultaCreate, ServicioConsultaUpdate, ServicioConsultaResponse
)
from app.models.models import Consulta, Receta, DetalleReceta, ServicioConsulta, Inventario, MovimientoInventario
from app.services.consulta_service import ConsultaService

router = APIRouter(prefix="/api/consultas", tags=["Consultas"])


@router.post("/", response_model=ConsultaResponse, status_code=status.HTTP_201_CREATED)
def crear_consulta(
    consulta: ConsultaCreate,
    db: Session = Depends(get_db)
):
    """Crea una nueva consulta"""
    return ConsultaService.crear_consulta(db, consulta)


@router.get("/{consulta_id}", response_model=ConsultaResponse)
def obtener_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una consulta por ID"""
    consulta = ConsultaService.obtener_consulta(db, consulta_id)
    if not consulta:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta


@router.get("/", response_model=List[ConsultaResponse])
def listar_consultas(
    skip: int = 0,
    limit: int = 100,
    mascota_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Lista todas las consultas con filtros opcionales"""
    return ConsultaService.listar_consultas(db, skip, limit, mascota_id)


@router.put("/{consulta_id}", response_model=ConsultaResponse)
def actualizar_consulta(
    consulta_id: int,
    consulta: ConsultaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza una consulta existente"""
    consulta_actualizada = ConsultaService.actualizar_consulta(db, consulta_id, consulta)
    if not consulta_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta_actualizada


@router.delete("/{consulta_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Elimina una consulta"""
    if not ConsultaService.eliminar_consulta(db, consulta_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return None

@router.post("/{consulta_id}/recetas", response_model=RecetaResponse, status_code=status.HTTP_201_CREATED)
def crear_receta(
    consulta_id: int,
    receta_data: RecetaCreate,
    db: Session = Depends(get_db)
):
    """Crea una receta médica para una consulta"""
    consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
        
    nueva_receta = Receta(
        consulta_id=consulta_id,
        indicaciones_generales=receta_data.indicaciones_generales
    )
    
    for det in receta_data.detalles:
        detalle = DetalleReceta(
            medicamento_id=det.medicamento_id,
            dosis=det.dosis,
            frecuencia=det.frecuencia,
            duracion=det.duracion
        )
        nueva_receta.detalles.append(detalle)
        
    db.add(nueva_receta)
    db.commit()
    db.refresh(nueva_receta)
    return nueva_receta

@router.get("/{consulta_id}/recetas", response_model=List[RecetaResponse])
def listar_recetas_por_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Trae las recetas y su detalle asociadas a una consulta"""
    recetas = db.query(Receta).filter(Receta.consulta_id == consulta_id).all()
    return recetas

@router.post("/{consulta_id}/servicios", response_model=ServicioConsultaResponse, status_code=status.HTTP_201_CREATED)
def agregar_servicio_consulta(
    consulta_id: int,
    servicio_data: ServicioConsultaCreate,
    db: Session = Depends(get_db)
):
    """Agrega un ítem o servicio a la consulta clínica (Vacuna, Cirugía, Insumo, etc.)"""
    consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
    
    nuevo_servicio = ServicioConsulta(
        consulta_id=consulta_id,
        tipo_servicio=servicio_data.tipo_servicio,
        referencia_id=servicio_data.referencia_id,
        nombre_servicio=servicio_data.nombre_servicio,
        cantidad=servicio_data.cantidad,
        precio_unitario=servicio_data.precio_unitario,
        detalles_clinicos=servicio_data.detalles_clinicos,
        estado=servicio_data.estado,
        is_deleted=False
    )
    
    # Check simple deduct for 'Aplicado' straight away, mostly items start 'Pendiente'
    if nuevo_servicio.estado == "Aplicado" and nuevo_servicio.referencia_id:
        if nuevo_servicio.tipo_servicio in ["INSUMO", "VACUNACION"]:
            inv = db.query(Inventario).filter(Inventario.id == nuevo_servicio.referencia_id).first()
            if inv:
                if inv.stock_actual < nuevo_servicio.cantidad:
                    raise HTTPException(status_code=400, detail=f"Stock insuficiente para {inv.nombre}")
                inv.stock_actual -= nuevo_servicio.cantidad
                mov = MovimientoInventario(
                    producto_id=inv.id,
                    tipo_movimiento="SALIDA",
                    cantidad=nuevo_servicio.cantidad,
                    costo_unitario=inv.precio_unitario,
                    origen_destino=f"Consumo directo - Consulta #{consulta.id}"
                )
                db.add(mov)

    db.add(nuevo_servicio)
    db.commit()
    db.refresh(nuevo_servicio)
    return nuevo_servicio

@router.patch("/servicios/{servicio_id}", response_model=ServicioConsultaResponse)
def actualizar_servicio_consulta(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session = Depends(get_db)
):
    """Actualiza el estado, precio o cantidad de un servicio de consulta. Maneja stock si pasa de Pendiente a Aplicado o viceversa."""
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    old_estado = servicio.estado
    old_cantidad = servicio.cantidad

    update_dict = update_data.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(servicio, k, v)

    new_estado = servicio.estado
    
    # Manejo de Inventario Progresivo
    if servicio.tipo_servicio in ["INSUMO", "VACUNACION"] and servicio.referencia_id:
        inv = db.query(Inventario).filter(Inventario.id == servicio.referencia_id).first()
        if inv:
            # Si cambia de PENDIENTE a APLICADO
            if old_estado != "Aplicado" and new_estado == "Aplicado":
                if inv.stock_actual < servicio.cantidad:
                    raise HTTPException(status_code=400, detail=f"Stock insuficiente para {inv.nombre}")
                inv.stock_actual -= servicio.cantidad
                db.add(MovimientoInventario(
                    producto_id=inv.id,
                    tipo_movimiento="SALIDA",
                    cantidad=servicio.cantidad,
                    costo_unitario=inv.precio_unitario,
                    origen_destino=f"Consumo directo mod - Consulta #{servicio.consulta_id}"
                ))

            # Si cambia de APLICADO a PENDIENTE (Devolución)
            elif old_estado == "Aplicado" and new_estado != "Aplicado":
                inv.stock_actual += old_cantidad
                db.add(MovimientoInventario(
                    producto_id=inv.id,
                    tipo_movimiento="ENTRADA",
                    cantidad=old_cantidad,
                    costo_unitario=inv.precio_unitario,
                    origen_destino=f"Reversión de consumo - Consulta #{servicio.consulta_id}"
                ))

    db.commit()
    db.refresh(servicio)
    return servicio

@router.delete("/servicios/{servicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_servicio_consulta(
    servicio_id: int,
    db: Session = Depends(get_db)
):
    """Elimina lógicamente un servicio (Soft Delete) y devuelve stock si estaba aplicado"""
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    if servicio.estado == "Aplicado" and servicio.tipo_servicio in ["INSUMO", "VACUNACION"] and servicio.referencia_id:
        inv = db.query(Inventario).filter(Inventario.id == servicio.referencia_id).first()
        if inv:
            inv.stock_actual += servicio.cantidad
            db.add(MovimientoInventario(
                producto_id=inv.id,
                tipo_movimiento="ENTRADA",
                cantidad=servicio.cantidad,
                costo_unitario=inv.precio_unitario,
                origen_destino=f"Eliminación/Reversión - Consulta #{servicio.consulta_id}"
            ))

    servicio.is_deleted = True
    servicio.estado = "Cancelado"
    db.commit()
    return None
