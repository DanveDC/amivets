from sqlalchemy.orm import Session, contains_eager, joinedload
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional

from app.models.models import Mascota
from app.schemas.schemas import MascotaCreate, MascotaUpdate


from app.models.models import Mascota, Propietario, HistoriaPropiedad, Consulta


class MascotaService:
    """Servicio para la lógica de negocio de mascotas"""
    
    @staticmethod
    def crear_mascota(db: Session, mascota_data: MascotaCreate) -> Mascota:
        """Crea una nueva mascota y genera su código de historia"""
        try:
            # Obtener el propietario para su cédula
            propietario = db.query(Propietario).filter(Propietario.id == mascota_data.propietario_id).first()
            if not propietario:
                raise HTTPException(status_code=404, detail="Propietario no encontrado")
            
            nueva_mascota = Mascota(**mascota_data.model_dump())
            db.add(nueva_mascota)
            db.flush() # Para obtener el ID
            
            # Generar código: Cedula + ID correlativo de la mascota
            nueva_mascota.codigo_historia = f"{propietario.cedula}-{nueva_mascota.id}"
            
            # Registrar el primer dueño en el historial
            historia = HistoriaPropiedad(
                mascota_id=nueva_mascota.id,
                propietario_nuevo_id=propietario.id,
                motivo="Registro inicial"
            )
            db.add(historia)
            
            db.commit()
            db.commit()
            
            # Recargar con relaciones para el validador del esquema de respuesta
            return db.query(Mascota).options(joinedload(Mascota.propietario)).filter(Mascota.id == nueva_mascota.id).first()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al crear la mascota. Verifique los datos."
            )
    
    @staticmethod
    def obtener_mascota(db: Session, mascota_id: int) -> Optional[Mascota]:
        """Obtiene una mascota por ID con su propietario cargado"""
        return db.query(Mascota).options(joinedload(Mascota.propietario)).filter(Mascota.id == mascota_id).first()
    
    @staticmethod
    def listar_mascotas(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        propietario_id: Optional[int] = None,
        activo: Optional[bool] = None,
        search: Optional[str] = None
    ) -> List[Mascota]:
        """Lista mascotas con filtros opcionales y búsqueda por nombre o apellido del dueño"""
        query = db.query(Mascota).join(Mascota.propietario).options(contains_eager(Mascota.propietario))
        
        if search:
            search_filter = f"%{search}%"
            query = query.filter(
                (Mascota.nombre.ilike(search_filter)) | 
                (Propietario.nombre.ilike(search_filter)) |
                (Propietario.apellido.ilike(search_filter)) |
                (Mascota.codigo_historia.ilike(search_filter))
            )

        if propietario_id:
            query = query.filter(Mascota.propietario_id == propietario_id)
        
        if activo is not None:
            query = query.filter(Mascota.activo == activo)
        
        return query.offset(skip).limit(limit).all()
    
    @staticmethod
    def cambiar_propietario(db: Session, mascota_id: int, nuevo_propietario_id: int, motivo: str) -> Mascota:
        """Transfiere la mascota a un nuevo propietario y guarda el historial"""
        mascota = db.query(Mascota).filter(Mascota.id == mascota_id).first()
        if not mascota:
            raise HTTPException(status_code=404, detail="Mascota no encontrada")
            
        propietario_anterior_id = mascota.propietario_id
        mascota.propietario_id = nuevo_propietario_id
        
        # Actualizar código de historia con la nueva cédula?
        # El usuario pidió: "que el identificador unico sea la cedula del propietario + id"
        # Si cambia de dueño, el ID único cambia.
        nuevo_propietario = db.query(Propietario).filter(Propietario.id == nuevo_propietario_id).first()
        if not nuevo_propietario:
            raise HTTPException(status_code=404, detail="Nuevo propietario no encontrado")
            
        mascota.codigo_historia = f"{nuevo_propietario.cedula}-{mascota.id}"
        
        historia = HistoriaPropiedad(
            mascota_id=mascota.id,
            propietario_anterior_id=propietario_anterior_id,
            propietario_nuevo_id=nuevo_propietario_id,
            motivo=motivo
        )
        db.add(historia)
        db.commit()
        db.refresh(mascota)
        return mascota

    @staticmethod
    def obtener_historial_peso(db: Session, mascota_id: int):
        """Obtiene el historial de peso de las consultas"""
        consultas = db.query(Consulta).filter(
            Consulta.mascota_id == mascota_id,
            Consulta.peso != None
        ).order_by(Consulta.fecha_consulta.asc()).all()
        
        return [{"fecha": c.fecha_consulta, "peso": c.peso} for c in consultas]

    @staticmethod
    def actualizar_mascota(
        db: Session,
        mascota_id: int,
        mascota_data: MascotaUpdate
    ) -> Optional[Mascota]:
        """Actualiza una mascota existente"""
        mascota = db.query(Mascota).filter(Mascota.id == mascota_id).first()
        
        if not mascota:
            return None
        
        update_data = mascota_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(mascota, field, value)
        
        db.commit()
        db.refresh(mascota)
        
        return mascota
    
    @staticmethod
    def eliminar_mascota(db: Session, mascota_id: int) -> bool:
        """Elimina (desactiva) una mascota"""
        mascota = db.query(Mascota).filter(Mascota.id == mascota_id).first()
        
        if not mascota:
            return False
        
        mascota.activo = False
        db.commit()
        
        return True
