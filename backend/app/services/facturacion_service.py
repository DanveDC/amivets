from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime

from app.models.models import (
    Factura, DetalleFactura, Inventario, MovimientoInventario, 
    Consulta, PruebaComplementaria, Vacunacion, Desparasitacion, 
    Cirugia, Hospitalizacion, ServicioConsulta
)
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
                    servicio_id=getattr(detalle_data, 'servicio_id', None),
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
                consulta_id=factura_data.consulta_id,
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
            
            # Si viene de una consulta, marcar todo como facturado
            if factura_data.consulta_id:
                consulta = db.query(Consulta).filter(Consulta.id == factura_data.consulta_id).first()
                if consulta:
                    consulta.estado_pago = "COBRADO"
                    
                    # Marcar servicios como facturados (sin borrar el estado médico)
                    for s in consulta.servicios:
                        s.facturado = True
                    
                    # Marcar otros items
                    for p in consulta.pruebas: p.facturado = True
                    for v in consulta.vacunaciones: v.facturado = True
                    for d in consulta.desparasitaciones: d.facturado = True
                    for c in consulta.cirugias: c.facturado = True
                    for h in consulta.hospitalizaciones: h.facturado = True
            
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
        estado: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[Factura]:
        """Lista facturas con filtros opcionales de estado, propietario y búsqueda textual"""
        from app.models.models import Propietario
        query = db.query(Factura).join(Propietario, Factura.propietario_id == Propietario.id)
        
        if search:
            # Búsqueda por número de factura o nombre/apellido del propietario
            search_filter = f"%{search}%"
            query = query.filter(
                (Factura.numero_factura.ilike(search_filter)) |
                (Propietario.nombre.ilike(search_filter)) |
                (Propietario.apellido.ilike(search_filter))
            )
            
        if propietario_id:
            query = query.filter(Factura.propietario_id == propietario_id)
        
        if estado:
            query = query.filter(Factura.estado == estado)
        
        return query.order_by(Factura.fecha_emision.desc()).offset(skip).limit(limit).all()
    
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

    @staticmethod
    def obtener_items_pendientes_consulta(db: Session, consulta_id: int):
        """
        Colecta todos los items que no han sido facturados asociados a una consulta
        """
        consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")
        
        items = []
        
        # 1. El costo de la consulta misma
        if consulta.estado_pago == "POR_COBRAR" and consulta.precio_consulta > 0:
            items.append({
                "descripcion": f"Consulta Veterinaria - {consulta.motivo}",
                "cantidad": 1,
                "precio_unitario": consulta.precio_consulta,
                "subtotal": consulta.precio_consulta,
                "tipo": "CONSULTA",
                "id_interno": consulta.id
            })
            
        # 2. Servicios
        for s in consulta.servicios:
            if not s.facturado and not s.is_deleted:
                items.append({
                    "descripcion": s.nombre_servicio,
                    "cantidad": s.cantidad,
                    "precio_unitario": s.precio_unitario,
                    "subtotal": s.subtotal(),
                    "tipo": "SERVICIO",
                    "id_interno": s.id,
                    "producto_id": s.referencia_id if s.tipo_servicio in ['INSUMO', 'VACUNACION'] else None
                })
        
        # 3. Pruebas
        for p in consulta.pruebas:
            if not p.facturado:
                items.append({
                    "descripcion": f"Prueba: {p.tipo}",
                    "cantidad": 1,
                    "precio_unitario": p.precio_aplicado,
                    "subtotal": p.precio_aplicado,
                    "tipo": "PRUEBA",
                    "id_interno": p.id
                })
        
        # 4. Vacunas
        for v in consulta.vacunaciones:
            if not v.facturado:
                items.append({
                    "descripcion": f"Vacunación: {v.vacuna.nombre if v.vacuna else 'Vacuna'}",
                    "cantidad": 1,
                    "precio_unitario": v.precio_aplicado,
                    "subtotal": v.precio_aplicado,
                    "tipo": "VACUNA",
                    "id_interno": v.id
                })
                
        # 5. Desparasitaciones
        for d in consulta.desparasitaciones:
            if not d.facturado:
                items.append({
                    "descripcion": f"Desparasitación: {d.tipo}",
                    "cantidad": 1,
                    "precio_unitario": d.precio_aplicado,
                    "subtotal": d.precio_aplicado,
                    "tipo": "DESPARASITACION",
                    "id_interno": d.id
                })
        
        # 6. Cirugías
        for c in consulta.cirugias:
            if not c.facturado:
                items.append({
                    "descripcion": f"Cirugía: {c.tipo_procedimiento}",
                    "cantidad": 1,
                    "precio_unitario": c.precio_aplicado,
                    "subtotal": c.precio_aplicado,
                    "tipo": "CIRUGIA",
                    "id_interno": c.id
                })
                
        # 7. Hospitalizaciones
        for h in consulta.hospitalizaciones:
            if not h.facturado:
                items.append({
                    "descripcion": f"Hospitalización: {h.motivo}",
                    "cantidad": h.dias_cama,
                    "precio_unitario": h.precio_aplicado,
                    "subtotal": h.precio_aplicado * h.dias_cama,
                    "tipo": "HOSPITALIZACION",
                    "id_interno": h.id
                })
        
        return {
            "propietario_id": consulta.mascota.propietario_id,
            "propietario_nombre": f"{consulta.mascota.propietario.nombre} {consulta.mascota.propietario.apellido}",
            "mascota_nombre": consulta.mascota.nombre,
            "items": items
        }
