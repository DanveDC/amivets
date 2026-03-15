from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional

from app.models.models import Propietario
from app.schemas.schemas import PropietarioCreate, PropietarioUpdate


class PropietarioService:
    """Servicio para la lógica de negocio de propietarios"""
    
    @staticmethod
    def crear_propietario(db: Session, propietario_data: PropietarioCreate) -> Propietario:
        """Crea un nuevo propietario"""
        try:
            nuevo_propietario = Propietario(**propietario_data.model_dump())
            db.add(nuevo_propietario)
            db.commit()
            db.refresh(nuevo_propietario)
            return nuevo_propietario
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al crear el propietario. Es posible que la cédula o el email ya existan."
            )
    
    @staticmethod
    def obtener_propietario(db: Session, propietario_id: int) -> Optional[Propietario]:
        """Obtiene un propietario por ID"""
        return db.query(Propietario).filter(Propietario.id == propietario_id).first()
    
    @staticmethod
    def obtener_propietario_por_cedula(db: Session, cedula: str) -> Optional[Propietario]:
        """Obtiene un propietario por cédula"""
        return db.query(Propietario).filter(Propietario.cedula == cedula).first()
    
    @staticmethod
    def listar_propietarios(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        activo: Optional[bool] = None
    ) -> List[Propietario]:
        """Lista propietarios con filtros opcionales"""
        query = db.query(Propietario)
        
        if activo is not None:
            query = query.filter(Propietario.activo == activo)
        
        return query.offset(skip).limit(limit).all()
    
    @staticmethod
    def actualizar_propietario(
        db: Session,
        propietario_id: int,
        propietario_data: PropietarioUpdate
    ) -> Optional[Propietario]:
        """Actualiza un propietario existente"""
        propietario = db.query(Propietario).filter(Propietario.id == propietario_id).first()
        
        if not propietario:
            return None
        
        update_data = propietario_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(propietario, field, value)
        
        try:
            db.commit()
            db.refresh(propietario)
            return propietario
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al actualizar propietario. Verifique que cédula/email no estén duplicados."
            )
    
    @staticmethod
    def eliminar_propietario(db: Session, propietario_id: int) -> bool:
        """Elimina (desactiva) un propietario si no tiene mascotas activas"""
        propietario = db.query(Propietario).filter(Propietario.id == propietario_id).first()
        
        if not propietario:
            return False
            
        # Verificar si tiene mascotas activas
        from app.models.models import Mascota
        mascotas_activas = db.query(Mascota).filter(Mascota.propietario_id == propietario_id, Mascota.activo == True).count()
        if mascotas_activas > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No se puede eliminar el propietario porque tiene {mascotas_activas} mascota(s) activa(s) asociada(s)."
            )
        
        propietario.activo = False
        db.commit()
        
        return True
