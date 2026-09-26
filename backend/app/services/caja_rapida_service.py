"""Caja rápida: venta de mostrador sin registrar cliente (caja-rapida).

Una venta es una OrdenServicio (origen CAJA_RAPIDA, sin mascota) que nace y
muere en la misma transacción: los servicios del catálogo se registran como
EJECUTADO (consumiendo su receta), los productos van como líneas producto_id
de la factura, y la orden queda FACTURADA. La factura la emite
FacturacionService.crear_factura, que hace el único commit (decisión 4): si
algo falla antes o adentro, se hace rollback de todo.

Mismo patrón que orden_service / consumo_service: funciones que reciben la
Session; acá la que cierra la transacción es crear_factura.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.models import (
    CatalogoServicio,
    Factura,
    Inventario,
    OrdenServicio,
    Propietario,
    ServicioConsulta,
    Usuario,
)
from app.schemas.schemas import DetalleFacturaCreate, FacturaCreate, VentaRapidaCreate
from app.services import consumo_service
from app.services.facturacion_service import FacturacionService

ORIGEN = "CAJA_RAPIDA"

# Propietario de sistema para las ventas sin cliente (decisión 1). La cédula
# es la clave: única en la tabla, así que el get-or-create no puede duplicarlo.
CEDULA_CONSUMIDOR_FINAL = "CONSUMIDOR-FINAL"

# Categoría del catálogo -> tipo_servicio de la línea. Espejo de CATEGORIA_TIPO
# en static/js/sections/orden-abierta.js; lo que no está mapeado va como OTRO.
CATEGORIA_TIPO = {
    "LABORATORIO": "LABORATORIO",
    "IMAGENOLOGIA": "LABORATORIO",
    "QUIROFANO": "CIRUGIA",
    "HOSPITALIZACION": "HOSPITALIZACION",
    "PELUQUERIA": "ESTETICA",
    "FARMACIA": "INSUMO",
    "SERVICIOS": "OTRO",
    "ADMINISTRACION VARIOS": "OTRO",
}


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def obtener_consumidor_final(db: Session) -> Propietario:
    """Get-or-create del propietario "Consumidor final". El INSERT ... ON
    CONFLICT DO NOTHING hace que dos ventas concurrentes que lo crean por
    primera vez no choquen: una inserta y la otra lo lee."""
    db.execute(
        pg_insert(Propietario)
        .values(
            nombre="Consumidor",
            apellido="final",
            cedula=CEDULA_CONSUMIDOR_FINAL,
            activo=True,
        )
        .on_conflict_do_nothing(index_elements=["cedula"])
    )
    return db.query(Propietario).filter(Propietario.cedula == CEDULA_CONSUMIDOR_FINAL).one()


def _conflicto(detalle: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


def registrar_venta(db: Session, data: VentaRapidaCreate, usuario: Usuario) -> Factura:
    """Valida, arma la orden y emite la factura cobrada al 100%. Todo o nada."""
    try:
        return _registrar_venta(db, data, usuario)
    except Exception:
        # crear_factura ya hace rollback de lo suyo; esto cubre los errores
        # previos (validación, consumo de receta) para no dejar la orden o los
        # servicios flusheados colgando en la sesión.
        db.rollback()
        raise


def _registrar_venta(db: Session, data: VentaRapidaCreate, usuario: Usuario) -> Factura:
    # --- Cliente ---------------------------------------------------------
    if data.propietario_id:
        propietario = db.query(Propietario).filter(Propietario.id == data.propietario_id).first()
        if not propietario:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propietario no encontrado")
    else:
        propietario = obtener_consumidor_final(db)

    items_producto = [it for it in data.items if it.tipo == "PRODUCTO"]
    items_servicio = [it for it in data.items if it.tipo == "SERVICIO"]

    # --- Validación de productos (decisión 5) ------------------------------
    # Se bloquean en orden de id, igual que crear_factura, para no abrir un
    # deadlock con otra venta que pida los mismos productos en otro orden. El
    # stock se valida sobre la cantidad total pedida (un producto repetido en
    # dos líneas suma).
    cantidad_por_producto = {}
    for it in items_producto:
        cantidad_por_producto[it.id] = cantidad_por_producto.get(it.id, 0) + it.cantidad

    productos = {}
    if cantidad_por_producto:
        productos = {
            p.id: p
            for p in db.query(Inventario)
            .filter(Inventario.id.in_(cantidad_por_producto.keys()))
            .order_by(Inventario.id)
            .with_for_update()
            .all()
        }
    for prod_id, cantidad in cantidad_por_producto.items():
        producto = productos.get(prod_id)
        if not producto:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Producto {prod_id} no encontrado")
        if not producto.activo:
            raise _conflicto(f"El producto {producto.nombre} está inactivo.")
        if producto.tipo_item != "PRODUCTO":
            raise _conflicto(f"{producto.nombre} es un material de uso interno; no se vende en caja.")
        if producto.stock_actual < cantidad:
            raise _conflicto(
                f"Stock insuficiente para {producto.nombre}. Disponible: {float(producto.stock_actual):g}"
            )

    # --- Validación de servicios (decisión 5) ------------------------------
    servicio_ids = {it.id for it in items_servicio}
    catalogo = {}
    if servicio_ids:
        catalogo = {
            c.id: c
            for c in db.query(CatalogoServicio).filter(CatalogoServicio.id.in_(servicio_ids)).all()
        }
    for it in items_servicio:
        item = catalogo.get(it.id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Servicio {it.id} no encontrado")
        if not item.activo:
            raise _conflicto(f"El servicio {item.nombre} está inactivo.")
        if item.area_id is not None:
            raise _conflicto(
                f"El servicio {item.nombre} tiene área de despacho: se vende con una orden, no en caja rápida."
            )
        if item.precio_variable and not (it.precio_unitario and it.precio_unitario > 0):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"El servicio {item.nombre} es de precio variable: indicá un precio mayor a 0.",
            )

    # --- Orden de la venta (decisión 2) ------------------------------------
    ahora = _ahora()
    orden = OrdenServicio(
        propietario_id=propietario.id,
        mascota_id=None,
        estado="CERRADA",
        abierta_por_id=usuario.id,
        fecha_cierre=ahora,
        cerrada_por_id=usuario.id,
        origen=ORIGEN,
    )
    db.add(orden)
    db.flush()

    detalles: List[DetalleFacturaCreate] = []
    for it in data.items:
        if it.tipo == "SERVICIO":
            item = catalogo[it.id]
            precio = it.precio_unitario if item.precio_variable else (item.precio_ref or 0.0)
            servicio = ServicioConsulta(
                orden_id=orden.id,
                consulta_id=None,
                mascota_id=None,
                origen=ORIGEN,
                tipo_servicio=CATEGORIA_TIPO.get((item.categoria or "").upper(), "OTRO"),
                catalogo_servicio_id=item.id,
                nombre_servicio=item.nombre,
                cantidad=it.cantidad,
                precio_unitario=precio,
                area_id=None,
                estado="EJECUTADO",
                ejecutado_at=ahora,
                is_deleted=False,
            )
            db.add(servicio)
            db.flush()
            consumo_service.consumir_para_servicio(db, servicio, usuario_id=usuario.id)
            detalles.append(DetalleFacturaCreate(
                servicio_id=servicio.id,
                cantidad=it.cantidad,
                precio_unitario=precio,
                descripcion=item.nombre,
            ))
        else:
            producto = productos[it.id]
            detalles.append(DetalleFacturaCreate(
                producto_id=producto.id,
                cantidad=it.cantidad,
                # Precio del maestro siempre, nunca el del cliente (decisión 5).
                precio_unitario=producto.precio_unitario,
                descripcion=producto.nombre,
            ))

    total = sum((d.precio_unitario or 0.0) * d.cantidad for d in detalles)

    # FACTURADA antes de crear_factura: su commit es el único de la venta, así
    # que orden, servicios, consumos y factura quedan confirmados juntos.
    orden.estado = "FACTURADA"

    return FacturacionService.crear_factura(
        db,
        FacturaCreate(
            propietario_id=propietario.id,
            metodo_pago=data.metodo_pago,
            total_pagado=total,
            descuento=0.0,
            impuesto=0.0,
            detalles=detalles,
        ),
        usuario_id=usuario.id,
        # Vínculo factura -> orden (FacturaOrden): anular la factura encuentra
        # la orden aunque la venta sea solo de productos.
        orden_id=orden.id,
    )


def buscar_items(db: Session, q: Optional[str], limit: int = 30) -> List[dict]:
    """Productos y servicios vendibles en caja (mismas reglas que la venta):
    Inventario PRODUCTO activo, y CatalogoServicio activo sin área."""
    productos_q = db.query(Inventario).filter(
        Inventario.activo == True,  # noqa: E712
        Inventario.tipo_item == "PRODUCTO",
    )
    servicios_q = db.query(CatalogoServicio).filter(
        CatalogoServicio.activo == True,  # noqa: E712
        CatalogoServicio.area_id.is_(None),
    )
    if q:
        patron = f"%{q.strip()}%"
        productos_q = productos_q.filter(or_(Inventario.nombre.ilike(patron), Inventario.codigo.ilike(patron)))
        servicios_q = servicios_q.filter(CatalogoServicio.nombre.ilike(patron))

    resultados = [
        {
            "tipo": "PRODUCTO",
            "id": p.id,
            "nombre": p.nombre,
            "codigo": p.codigo,
            "precio": p.precio_unitario or 0.0,
            "precio_variable": False,
            "stock": float(p.stock_actual or 0),
        }
        for p in productos_q.order_by(Inventario.nombre).limit(limit).all()
    ] + [
        {
            "tipo": "SERVICIO",
            "id": s.id,
            "nombre": s.nombre,
            "codigo": None,
            "precio": s.precio_ref or 0.0,
            "precio_variable": bool(s.precio_variable),
            "stock": None,
        }
        for s in servicios_q.order_by(CatalogoServicio.nombre).limit(limit).all()
    ]
    resultados.sort(key=lambda r: r["nombre"].lower())
    return resultados[:limit]
