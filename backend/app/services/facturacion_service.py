from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime

from app.models.models import (
    Factura, DetalleFactura, Inventario, MovimientoInventario,
    Consulta, PruebaComplementaria, Vacunacion, Desparasitacion,
    Cirugia, Hospitalizacion, ServicioConsulta, TipoMovimiento
)
from app.services import consumo_service


def _consumo_en_ledger(db: Session, servicio_id) -> bool:
    """True si el ServicioConsulta ya descontó materiales al aplicarse y esos
    movimientos no fueron revertidos. Fuente de verdad: el ledger, no el
    estado (Tarea 07, decisión 3).

    Cuenta SOLO SALIDA contra REVERSA (la MERMA queda fuera: siempre acompaña a
    una SALIDA del mismo material y la reversa combina ambas en una REVERSA
    única; sumarla envenena el guard tras un ciclo aplicar/revertir).
    """
    if not servicio_id:
        return False
    salidas = db.query(MovimientoInventario.id).filter(
        MovimientoInventario.servicio_consulta_id == servicio_id,
        MovimientoInventario.tipo_movimiento == TipoMovimiento.SALIDA,
    ).count()
    reversas = db.query(MovimientoInventario.id).filter(
        MovimientoInventario.servicio_consulta_id == servicio_id,
        MovimientoInventario.tipo_movimiento == TipoMovimiento.REVERSA,
    ).count()
    if salidas > reversas:
        return True
    # Fallback para filas pre-migración (Tarea 07): los servicios aplicados antes
    # de que existiera movimientos_inventario.servicio_consulta_id no tienen
    # SALIDA anclada, así que el conteo de arriba da 0. Si el servicio está en un
    # estado consumido asumimos que ya descontó y NO volvemos a descontar al
    # facturar (dirección segura: evita el doble decremento de vacunas/
    # desparasitaciones históricas). Las líneas de servicio que consumen material
    # ya no llevan producto_id, así que este fallback no afecta al flujo nuevo.
    #
    # FACTURADO tiene que estar en el conjunto igual que EJECUTADO (Tarea 06,
    # decisión 4): con `== "EJECUTADO"` a secas, re-facturar un servicio ya
    # facturado volvería a descontarle el stock.
    serv = db.query(ServicioConsulta.estado).filter(
        ServicioConsulta.id == servicio_id
    ).first()
    return bool(serv and serv[0] in consumo_service.ESTADOS_CONSUMIDOS)
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
            # Una consulta no puede tener dos facturas vivas a la vez: rompe
            # la unicidad que asume Liquidaciones (Unidad E) al identificar
            # "la" factura PAGADA de una consulta. Re-facturar requiere
            # anular la anterior primero.
            if factura_data.consulta_id:
                factura_activa = (
                    db.query(Factura)
                    .filter(
                        Factura.consulta_id == factura_data.consulta_id,
                        Factura.estado != "ANULADA",
                    )
                    .first()
                )
                if factura_activa:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"La consulta {factura_data.consulta_id} ya tiene una factura activa (#{factura_activa.numero_factura}). Anúlela antes de crear una nueva.",
                    )

            # Guard contra doble submit (revisión 11): un ServicioConsulta ya
            # facturado no puede entrar en una factura nueva. Sin esto, un
            # doble clic en "Emitir factura" (orden-abierta.js) manda dos POST
            # casi simultáneos con los mismos servicio_id y ambos pasan, porque
            # el `.update({facturado: True})` de más abajo es incondicional.
            # Se bloquean las filas con SELECT FOR UPDATE antes de tocar
            # inventario: la segunda request de la carrera espera al commit de
            # la primera y recién ahí lee facturado=True, así que rechaza con
            # 409 en vez de generar una segunda factura para los mismos
            # servicios.
            servicio_ids_detalle = {
                getattr(d, 'servicio_id', None) for d in factura_data.detalles
                if getattr(d, 'servicio_id', None)
            }
            if servicio_ids_detalle:
                servicios_bloqueados = (
                    db.query(ServicioConsulta)
                    .filter(ServicioConsulta.id.in_(servicio_ids_detalle))
                    .order_by(ServicioConsulta.id)
                    .with_for_update()
                    .all()
                )
                ya_facturados = [s for s in servicios_bloqueados if s.facturado]
                if ya_facturados:
                    nombres = ", ".join(s.nombre_servicio or f"#{s.id}" for s in ya_facturados)
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Los siguientes servicios ya fueron facturados: {nombres}.",
                    )

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
                    
                    # Evitar doble descuento: si esta línea proviene de un
                    # servicio que ya consumió sus materiales al aplicarse
                    # (evidencia en el ledger), no se vuelve a descontar.
                    ya_descontado = _consumo_en_ledger(db, getattr(detalle_data, 'servicio_id', None))

                    if not ya_descontado:
                        if producto.stock_actual < detalle_data.cantidad:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Stock insuficiente para {producto.nombre}. Disponible: {producto.stock_actual}"
                            )

                        # 1. Descontar del inventario
                        producto.stock_actual -= detalle_data.cantidad

                        # 2. Preparar Movimiento de Trazabilidad. Magnitud
                        #    positiva; la dirección la lleva tipo_movimiento
                        #    (Tarea 07, decisión 8). Las filas negativas
                        #    históricas no se reescriben (deuda anotada).
                        movimiento = MovimientoInventario(
                            producto_id=producto.id,
                            tipo_movimiento=TipoMovimiento.SALIDA,
                            cantidad=detalle_data.cantidad,
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
            subtotal = subtotal or 0.0
            descuento = (factura_data.descuento or 0.0)
            impuesto = (factura_data.impuesto or 0.0)

            total = subtotal - descuento + impuesto
            # Hallazgo de revisión (Tarea 11): total_pagado llegaba del
            # cliente sin tope contra `total` -- antes de esta tarea siempre
            # se mandaba 0.0 desde el único caller real (orden-abierta.js),
            # así que no se notaba, pero el nuevo checkout ("Facturar orden",
            # #modalFacturarOrden) ya arma total_pagado en el cliente. Se
            # acota server-side para que un pago manipulado no pueda quedar
            # registrado por encima del total real de la factura.
            pago = max(0.0, min(factura_data.total_pagado or 0.0, total))
            # Si el pago clampeado queda en 0, no hay cobro real: persistir un
            # metodo_pago igual dejaba una factura PENDIENTE marcada como
            # "Efectivo" (o lo que sea que mande el cliente) sin que se haya
            # cobrado un peso (hallazgo de revisión 11, orden-abierta.js
            # mandaba metodo_pago aunque "Cobrar el total ahora" estuviera
            # destildado). metodo_pago es nullable en el modelo.
            metodo_pago = factura_data.metodo_pago if pago > 0 else None
            saldo_pendiente = total - pago
            if saldo_pendiente <= 0:
                estado = "PAGADA"
            elif pago > 0:
                estado = "PARCIAL"
            else:
                estado = "PENDIENTE"
            
            nueva_factura = Factura(
                numero_factura=numero_factura,
                propietario_id=factura_data.propietario_id,
                consulta_id=factura_data.consulta_id,
                es_presupuesto=factura_data.es_presupuesto,
                subtotal=subtotal,
                descuento=descuento,
                impuesto=impuesto,
                total=total,
                total_pagado=pago,
                saldo_pendiente=max(0, saldo_pendiente),
                estado=estado,
                metodo_pago=metodo_pago,
                observaciones=factura_data.observaciones,
                detalles=detalles_factura
            )
            
            db.add(nueva_factura)
            for mov in movimientos:
                db.add(mov)

            # Marcar como facturado CUALQUIER ServicioConsulta referenciado por
            # una línea de esta factura, tenga o no consulta. Esto cubre la
            # facturación de servicios directos sueltos (Tarea 09, decisión 8),
            # además del caso consulta.
            servicio_ids = {
                getattr(d, 'servicio_id', None)
                for d in factura_data.detalles
                if getattr(d, 'servicio_id', None)
            }
            if servicio_ids:
                db.query(ServicioConsulta).filter(
                    ServicioConsulta.id.in_(servicio_ids)
                ).update({ServicioConsulta.facturado: True}, synchronize_session=False)

            # Si viene de una consulta, marcar todo como facturado
            if factura_data.consulta_id:
                consulta = db.query(Consulta).filter(Consulta.id == factura_data.consulta_id).first()
                if consulta:
                    consulta.estado_pago = "COBRADO"
                    # Facturar cierra la consulta por cualquier camino (Tarea 09,
                    # decisión 6): el flujo legacy POST /api/facturas/ y el nuevo
                    # from-consulta dejan la misma huella. Reabrir es manual.
                    consulta.estado = "CERRADA"

                    # Marcar servicios como facturados (sin borrar el estado médico)
                    for s in consulta.servicios:
                        s.facturado = True

                    # Marcar las filas de detalle clínico. Ya no son fuente de
                    # facturación (Tarea 09, decisión 2: la única línea es el
                    # espejo ServicioConsulta), pero se siguen marcando para que
                    # cualquier lectura directa de esos booleanos quede coherente.
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
        except IntegrityError:
            # Backstop del indice unico parcial (facturas.consulta_id,
            # WHERE estado != 'ANULADA'): si dos requests pasaron el
            # chequeo de arriba casi simultaneamente, la DB rechaza el
            # segundo INSERT en vez de dejar dos facturas activas.
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="La consulta ya tiene una factura activa. Anúlela antes de crear una nueva.",
            )
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
        
        # Devolver stock SOLO por las líneas que efectivamente se descontaron al
        # facturar: producto_id presente Y no cubiertas por un consumo al
        # aplicar el servicio. Evita la devolución de más (audit §2 fila 5).
        for detalle in factura.detalles:
            if not detalle.producto_id:
                continue
            if _consumo_en_ledger(db, detalle.servicio_id):
                continue
            producto = db.query(Inventario).filter(
                Inventario.id == detalle.producto_id
            ).with_for_update().first()
            if producto:
                producto.stock_actual += detalle.cantidad
                db.add(MovimientoInventario(
                    producto_id=producto.id,
                    tipo_movimiento=TipoMovimiento.ENTRADA,
                    cantidad=detalle.cantidad,
                    costo_unitario=producto.precio_unitario,
                    origen_destino=f"Anulación factura {factura.numero_factura}",
                    usuario_responsable_id=None,
                ))

        factura.estado = "ANULADA"

        # Anular deshace el cobro: la consulta y sus líneas vuelven a estar
        # pendientes, si no obtener_items_pendientes_consulta no devuelve nada y
        # la consulta no se puede volver a facturar nunca (Tarea 09). Se reabre
        # también el ciclo clínico para que vuelva a la bandeja de trabajo.
        servicio_ids = [d.servicio_id for d in factura.detalles if d.servicio_id]
        if servicio_ids:
            db.query(ServicioConsulta).filter(
                ServicioConsulta.id.in_(servicio_ids)
            ).update({ServicioConsulta.facturado: False}, synchronize_session=False)
        if factura.consulta_id:
            consulta = db.query(Consulta).filter(Consulta.id == factura.consulta_id).first()
            if consulta:
                consulta.estado_pago = "POR_COBRAR"
                consulta.estado = "ABIERTA"
                for s in consulta.servicios:
                    s.facturado = False
                for p in consulta.pruebas: p.facturado = False
                for v in consulta.vacunaciones: v.facturado = False
                for d in consulta.desparasitaciones: d.facturado = False
                for c in consulta.cirugias: c.facturado = False
                for h in consulta.hospitalizaciones: h.facturado = False

        db.commit()
        db.refresh(factura)

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
        if (consulta.estado_pago or "POR_COBRAR") == "POR_COBRAR" and (consulta.precio_consulta or 0) > 0:
            items.append({
                "descripcion": f"Consulta Veterinaria - {consulta.motivo}",
                "cantidad": 1,
                "precio_unitario": consulta.precio_consulta or 0.0,
                "subtotal": consulta.precio_consulta or 0.0,
                "tipo": "CONSULTA",
                "id_interno": consulta.id
            })
            
        # 2. Servicios
        for s in consulta.servicios:
            # Puente de la etapa 4 (Tarea 06, decisión 3): desde ahora cada
            # consulta lleva además una línea tipo_servicio='CONSULTA' con su
            # honorario dentro de la orden. Este preview sigue emitiendo el
            # honorario como ítem sintético (bloque 1 de arriba), así que contar
            # también la línea lo duplicaría. Cuando la facturación pase a
            # trabajar por orden (obtener_items_pendientes_orden) se invierte:
            # desaparece el ítem sintético y la línea CONSULTA se factura como
            # cualquier otra. Hasta entonces, la línea se salta acá y el
            # `facturado = True` se lo pone igual crear_factura al recorrer
            # consulta.servicios.
            if s.tipo_servicio == "CONSULTA":
                continue
            if not s.facturado and not s.is_deleted:
                prod_id = None
                if s.tipo_servicio == 'INSUMO':
                    # Los materiales se descuentan al aplicar el servicio y son
                    # parte del precio del servicio (Tarea 07, decisión 3): la
                    # línea se factura por su precio pero NO toca inventario.
                    prod_id = None
                elif s.tipo_servicio == 'VACUNACION':
                    vac = db.query(Vacunacion).filter(Vacunacion.id == s.referencia_id).first()
                    if vac:
                        prod_id = vac.vacuna_id
                    else:
                        prod_id = s.referencia_id
                elif s.tipo_servicio == 'DESPARASITACION':
                    desp = db.query(Desparasitacion).filter(Desparasitacion.id == s.referencia_id).first()
                    if desp:
                        prod_id = desp.producto_id
                    else:
                        prod_id = s.referencia_id
                        
                items.append({
                    "descripcion": s.nombre_servicio or s.tipo_servicio,
                    "cantidad": s.cantidad or 1.0,
                    "precio_unitario": s.precio_unitario or 0.0,
                    "subtotal": (s.cantidad or 1.0) * (s.precio_unitario or 0.0),
                    "tipo": "SERVICIO",
                    "id_interno": s.id,
                    "producto_id": prod_id
                })

        # NOTA (Tarea 09, decisión 2 y §1.3 del diseño): antes había 5 loops más
        # (consulta.pruebas / vacunaciones / desparasitaciones / cirugias /
        # hospitalizaciones). Se eliminaron: cada fila de detalle clínico con
        # consulta_id ya tiene su espejo ServicioConsulta (loop 2), así que
        # recorrerlas de nuevo hacía DOBLE CONTEO. Ahora la única fuente del
        # preview es consulta.servicios + el honorario de consulta.

        return {
            "propietario_id": consulta.mascota.propietario_id,
            "propietario_nombre": f"{consulta.mascota.propietario.nombre} {consulta.mascota.propietario.apellido}",
            "mascota_nombre": consulta.mascota.nombre,
            "items": items
        }
