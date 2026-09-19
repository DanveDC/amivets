from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional

from app.models.models import Consulta, OrdenServicio, Usuario
from app.schemas.schemas import ConsultaCreate, ConsultaUpdate
from app.services import orden_service


class ConsultaService:
    """Servicio para la lógica de negocio de consultas veterinarias"""

    @staticmethod
    def crear_consulta(
        db: Session,
        consulta_data: ConsultaCreate,
        orden: OrdenServicio,
    ) -> Consulta:
        """Crea una consulta DENTRO de una orden (Tarea 06, decisiones 1 y 3).

        Las tres cosas pasan en la misma transacción a propósito:
          1. la `Consulta`,
          2. su línea `tipo_servicio='CONSULTA'` en la orden (el honorario deja
             de ser un ítem sintético y pasa a ser una línea como cualquier otra),
          3. la transición automática ABIERTA -> EN_ATENCION de la orden.

        Si el índice único parcial `uq_orden_una_consulta` rechaza la línea
        (ya hay una consulta viva en esa orden), el rollback se lleva también
        la consulta: nunca queda una consulta huérfana sin orden.
        """
        # El schema ya exige veterinario_id, pero no valida que exista o que
        # sea realmente un veterinario -- sin esto, Liquidaciones (Unidad E)
        # nunca encontraria elegible una consulta con un id invalido/erroneo.
        vet = db.query(Usuario).filter(Usuario.id == consulta_data.veterinario_id).first()
        if not vet or vet.role != "veterinario":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El veterinario_id indicado no corresponde a un usuario con rol veterinario",
            )
        # Pre-chequeo legible del índice único parcial: sin esto el cliente
        # recibiría un 500 crudo de IntegrityError. El except de abajo sigue
        # estando para la carrera (dos altas simultáneas contra la misma orden),
        # que el pre-chequeo no puede cubrir.
        if orden_service.consulta_viva_en_orden(db, orden.id):
            raise orden_service.error_una_consulta_por_orden(orden)

        try:
            data = consulta_data.model_dump()
            # La consulta nace ABIERTA (Tarea 09, decisión 6). Se fuerza acá y no
            # se acepta del cliente: model_dump trae estado=None por el default
            # del schema, y pasarlo pisaría el server_default con NULL.
            data.pop("estado", None)
            # `consultas` NO tiene columna orden_id (decisión 3: la relación
            # vive en la línea de servicio CONSULTA, una sola fuente de verdad).
            data.pop("orden_id", None)
            nueva_consulta = Consulta(**data, estado="ABIERTA")
            db.add(nueva_consulta)
            db.flush()  # id necesario para la línea de servicio y su referencia_id

            orden_service.crear_linea_consulta(db, orden, nueva_consulta)
            # Decisión 1, regla 1: automática, no un botón aparte. La lógica
            # vive en orden_service para que POST /api/ordenes/{id}/tomar y este
            # camino no puedan divergir.
            orden_service.marcar_en_atencion(orden)

            db.commit()
            db.refresh(nueva_consulta)
            return nueva_consulta
        except IntegrityError as exc:
            db.rollback()
            if "uq_orden_una_consulta" in str(getattr(exc, "orig", exc)):
                raise orden_service.error_una_consulta_por_orden(orden)
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
        estado_pago: Optional[str] = None,
        estado: Optional[str] = None,
        veterinario_id: Optional[int] = None
    ) -> List[Consulta]:
        """Lista consultas con filtros opcionales"""
        query = db.query(Consulta)

        if mascota_id:
            query = query.filter(Consulta.mascota_id == mascota_id)
        if veterinario_id:
            query = query.filter(Consulta.veterinario_id == veterinario_id)
        if veterinario:
            query = query.filter(Consulta.veterinario.ilike(f"%{veterinario}%"))
        if fecha_inicio:
            query = query.filter(Consulta.fecha_consulta >= fecha_inicio)
        if fecha_fin:
            query = query.filter(Consulta.fecha_consulta <= fecha_fin)
        if estado_pago:
            query = query.filter(Consulta.estado_pago == estado_pago)
        if estado:
            query = query.filter(Consulta.estado == estado)

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

        # Ciclo de vida clínico (Tarea 09, decisión 6): conjunto cerrado.
        if "estado" in update_data and update_data["estado"] not in {"ABIERTA", "CERRADA", "ANULADA"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="estado debe ser ABIERTA, CERRADA o ANULADA",
            )

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
