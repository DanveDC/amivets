from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime

from app.models.models import Factura, DetalleFactura, Inventario, MovimientoInventario
from app.schemas.schemas import FacturaCreate, FacturaUpdate


class FacturacionService:
    """Servicio para la lógica de negocio de facturación"""
    
    @staticmethod
    def generar_numero_factura(db: Session) -> str:
        """Genera un número de factura único"""
        ultima_factura = db.query(Factura).order_by(Factura.id.desc()).first()
        if ultima_factura:
            ultimo_numero = int(ultima_factura.numero_factura.split('-')[1])
            nuevo_numero = ultimo_numero + 1
        else:
            nuevo_numero = 1
        
        return f"FAC-{nuevo_numero:06d}"
    
    @staticmethod
    def crear_factura(db: Session, factura_data: FacturaCreate, usuario_id: Optional[int] = None) -> Factura:
        """
        Crea una nueva factura con integridad atómica:
        1. Bloquea filas de inventario (SELECT FOR UPDATE)
        2. Descuenta stock
        3. Registra movimiento trazable
        4. Calcula saldos y totales
        """
        try:
            # Generar número de factura
            numero_factura = FacturacionService.generar_numero_factura(db)
            
            subtotal = 0.0
            detalles_factura = []
            movimientos = []
            
            for detalle_data in factura_data.detalles:
                precio = detalle_data.precio_unitario
                
                # Si hay producto_id, aplicar lógica de inventario estricta
                if detalle_data.producto_id:
                    # BLOQUEO DE FILA PARA CONCURRENCIA
                    producto = db.query(Inventario).filter(
                        Inventario.id == detalle_data.producto_id
                    ).with_for_update().first()
                    
                    if not producto:
                        raise HTTPException(status_code=404, detail=f"Producto {detalle_data.producto_id} no encontrado")
                    
                    if producto.stock_actual < detalle_data.cantidad:
                        raise HTTPException(
                            status_code=400, 
                            detail=f"Stock insuficiente para {producto.nombre}. Disponible: {producto.stock_actual}"
                        )
                    
                    # 1. Descontar del inventario
                    producto.stock_actual -= detalle_data.cantidad
                    
                    # 2. Preparar Movimiento de Trazabilidad
                    movimiento = MovimientoInventario(
                        producto_id=producto.id,
                        tipo_movimiento="SALIDA",
                        cantidad=-detalle_data.cantidad,
                        costo_unitario=producto.precio_unitario, # Kardex usa costo
                        origen_destino=f"VENTA_{numero_factura}",
                        usuario_responsable_id=usuario_id
                    )
                    movimientos.append(movimiento)
                    
                    # Si no se pasó precio, usar el del maestro
                    if precio is None or precio == 0:
                        precio = producto.precio_unitario
                
                detalle_subtotal = precio * detalle_data.cantidad
                subtotal += detalle_subtotal
                
                detalles_factura.append(DetalleFactura(
                    producto_id=detalle_data.producto_id,
                    cantidad=detalle_data.cantidad,
                    precio_unitario=precio,
                    subtotal=detalle_subtotal,
                    descripcion=detalle_data.descripcion
                ))
            
            # Cálculo financiero profesional
            total = subtotal - factura_data.descuento + factura_data.impuesto
            saldo_pendiente = total - factura_data.total_pagado
            estado = "PAGADA" if saldo_pendiente <= 0 else "PENDIENTE"
            
            nueva_factura = Factura(
                numero_factura=numero_factura,
                propietario_id=factura_data.propietario_id,
                es_presupuesto=factura_data.es_presupuesto,
                subtotal=subtotal,
                descuento=factura_data.descuento,
                impuesto=factura_data.impuesto,
                total=total,
                total_pagado=factura_data.total_pagado,
                saldo_pendiente=max(0, saldo_pendiente),
                estado=estado,
                metodo_pago=factura_data.metodo_pago,
                observaciones=factura_data.observaciones,
                detalles=detalles_factura
            )
            
            db.add(nueva_factura)
            for mov in movimientos:
                db.add(mov)
                
            db.commit()
            db.refresh(nueva_factura)
            return nueva_factura
            
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Error en transacción de facturación: {str(e)}")
            
        except IntegrityError as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Error al crear la factura. Verifique los datos."
            )
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error inesperado: {str(e)}"
            )
    
    @staticmethod
    def obtener_factura(db: Session, factura_id: int) -> Optional[Factura]:
        """Obtiene una factura por ID"""
        return db.query(Factura).filter(Factura.id == factura_id).first()
    
    @staticmethod
    def listar_facturas(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        propietario_id: Optional[int] = None,
        estado: Optional[str] = None
    ) -> List[Factura]:
        """Lista facturas con filtros opcionales"""
        query = db.query(Factura)
        
        if propietario_id:
            query = query.filter(Factura.propietario_id == propietario_id)
        
        if estado:
            query = query.filter(Factura.estado == estado)
        
        return query.offset(skip).limit(limit).all()
    
    @staticmethod
    def actualizar_factura(
        db: Session,
        factura_id: int,
        factura_data: FacturaUpdate
    ) -> Optional[Factura]:
        """Actualiza una factura existente"""
        factura = db.query(Factura).filter(Factura.id == factura_id).first()
        
        if not factura:
            return None
        
        # Actualizar solo los campos proporcionados
        update_data = factura_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(factura, field, value)
        
        db.commit()
        db.refresh(factura)
        
        return factura
    
    @staticmethod
    def anular_factura(db: Session, factura_id: int) -> Optional[Factura]:
        """
        Anula una factura y devuelve el stock al inventario
        """
        factura = db.query(Factura).filter(Factura.id == factura_id).first()
        
        if not factura:
            return None
        
        if factura.estado == "ANULADA":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La factura ya está anulada"
            )
        
        # Devolver stock al inventario
        for detalle in factura.detalles:
            if detalle.producto_id:
                producto = db.query(Inventario).filter(
                    Inventario.id == detalle.producto_id
                ).first()
                if producto:
                    producto.stock_actual += detalle.cantidad
        
        factura.estado = "ANULADA"
        db.commit()
        db.refresh(factura)
        
        return factura

    @staticmethod
    def facturar_y_descargar_stock(db: Session, factura_id: int, usuario_id: int):
        factura = db.query(Factura).filter(Factura.id == factura_id).first()
        
        if not factura or factura.estado == "PAGADA":
            raise HTTPException(status_code=400, detail="Factura inválida o ya pagada")

        factura.estado = "PAGADA"
        factura.es_presupuesto = False
        
        for detalle in factura.detalles:
            if detalle.producto_id:
                producto = db.query(Inventario).filter(Inventario.id == detalle.producto_id).with_for_update().first() # ROW-LOCKING PARA CONCURRENCIA
                
                if producto.stock_actual < detalle.cantidad:
                    db.rollback()
                    raise HTTPException(status_code=400, detail=f"Stock insuficiente para el producto {producto.nombre}")
                
                # 1. Reducir stock base
                producto.stock_actual -= detalle.cantidad
                
                # 2. Rastrear Movimiento
                nuevo_movimiento = MovimientoInventario(
                    producto_id=producto.id,
                    tipo_movimiento="SALIDA",
                    cantidad=-detalle.cantidad,
                    costo_unitario=producto.precio_unitario,
                    origen_destino=f"VENTA_FACTURA_{factura.numero_factura}",
                    usuario_responsable_id=usuario_id
                )
                db.add(nuevo_movimiento)
                
        db.commit()
        return factura
