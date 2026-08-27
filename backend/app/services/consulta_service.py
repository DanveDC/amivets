from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional

from app.models.models import Consulta, Usuario
from app.schemas.schemas import ConsultaCreate, ConsultaUpdate


class ConsultaService:
    """Servicio para la lógica de negocio de consultas veterinarias"""

    @staticmethod
    def crear_consulta(db: Session, consulta_data: ConsultaCreate) -> Consulta:
        """Crea una nueva consulta"""
        # El schema ya exige veterinario_id, pero no valida que exista o que
        # sea realmente un veterinario -- sin esto, Liquidaciones (Unidad E)
        # nunca encontraria elegible una consulta con un id invalido/erroneo.
        vet = db.query(Usuario).filter(Usuario.id == consulta_data.veterinario_id).first()
        if not vet or vet.role != "veterinario":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El veterinario_id indicado no corresponde a un usuario con rol veterinario",
            )
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
        mascota_id: Optional[int] = None,
        veterinario: Optional[str] = None,
        fecha_inicio: Optional[str] = None,
        fecha_fin: Optional[str] = None,
        estado_pago: Optional[str] = None
    ) -> List[Consulta]:
        """Lista consultas con filtros opcionales"""
        query = db.query(Consulta)

        if mascota_id:
            query = query.filter(Consulta.mascota_id == mascota_id)
        if veterinario:
            query = query.filter(Consulta.veterinario.ilike(f"%{veterinario}%"))
        if fecha_inicio:
            query = query.filter(Consulta.fecha_consulta >= fecha_inicio)
        if fecha_fin:
            query = query.filter(Consulta.fecha_consulta <= fecha_fin)
        if estado_pago:
            query = query.filter(Consulta.estado_pago == estado_pago)

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

        # Mismo chequeo que crear_consulta: reasignar veterinario_id sin
        # validar permitiria colgar la consulta de un usuario que no es
        # veterinario, o de un id inexistente.
        if "veterinario_id" in update_data:
            vet = db.query(Usuario).filter(Usuario.id == update_data["veterinario_id"]).first()
            if not vet or vet.role != "veterinario":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El veterinario_id indicado no corresponde a un usuario con rol veterinario",
                )

        for field, value in update_data.items():
            setattr(consulta, field, value)

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al actualizar la consulta. Verifique que los datos sean correctos."
            )
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
