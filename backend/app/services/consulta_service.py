from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional

from app.models.models import Consulta
from app.schemas.schemas import ConsultaCreate, ConsultaUpdate


class ConsultaService:
    """Servicio para la lógica de negocio de consultas veterinarias"""
    
    @staticmethod
    def crear_consulta(db: Session, consulta_data: ConsultaCreate) -> Consulta:
        """Crea una nueva consulta"""
        try:
            nueva_consulta = Consulta(**consulta_data.model_dump())
            db.add(nueva_consulta)
            db.commit()
            db.refresh(nueva_consulta)
            return nueva_consulta
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al crear la consulta. Verifique que el ID de la mascota sea correcto."
            )
    
    @staticmethod
    def obtener_consulta(db: Session, consulta_id: int) -> Optional[Consulta]:
        """Obtiene una consulta por ID"""
        return db.query(Consulta).filter(Consulta.id == consulta_id).first()
    
    @staticmethod
    def listar_consultas(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        mascota_id: Optional[int] = None
    ) -> List[Consulta]:
        """Lista consultas con filtros opcionales"""
        query = db.query(Consulta)
        
        if mascota_id:
            query = query.filter(Consulta.mascota_id == mascota_id)
        
        return query.order_by(Consulta.fecha_consulta.desc()).offset(skip).limit(limit).all()
    
    @staticmethod
    def actualizar_consulta(
        db: Session,
        consulta_id: int,
        consulta_data: ConsultaUpdate
    ) -> Optional[Consulta]:
        """Actualiza una consulta existente"""
        consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
        
        if not consulta:
            return None
        
        update_data = consulta_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(consulta, field, value)
        
        db.commit()
        db.refresh(consulta)
        
        return consulta
    
    @staticmethod
    def eliminar_consulta(db: Session, consulta_id: int) -> bool:
        """Elimina físicamente una consulta"""
        consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
        
        if not consulta:
            return False
        
        db.delete(consulta)
        db.commit()
        
        return True
