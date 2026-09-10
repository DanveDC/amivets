from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Inventario, MovimientoInventario, HistorialPrecioInventario, Usuario
from app.routers.usuarios import get_current_user
from app.schemas.schemas import (
    InventarioCreate,
    InventarioUpdate,
    InventarioResponse,
    MovimientoInventarioResponse,
    HistorialPrecioRead,
)
from app.services.precio_service import registrar_cambio_precio, cuantizar_precio

router = APIRouter(prefix="/api/inventario", tags=["Inventario y Farmacia"])

@router.post("/", response_model=InventarioResponse, status_code=status.HTTP_201_CREATED)
def crear_producto(
    producto: InventarioCreate,
    db: Session = Depends(get_db)
):
    """Registra un nuevo producto en el inventario"""
    # Verificar si el codigo ya existe
    existe = db.query(Inventario).filter(Inventario.codigo == producto.codigo).first()
    if existe:
        raise HTTPException(status_code=400, detail="El codigo del producto ya existe")
        
    nuevo_producto = Inventario(**producto.model_dump())
    db.add(nuevo_producto)
    db.commit()
    db.refresh(nuevo_producto)
    return nuevo_producto

@router.get("/", response_model=List[InventarioResponse])
def listar_inventario(
    skip: int = 0,
    limit: int = 100,
    categoria: Optional[str] = None,
    bajo_stock: bool = False,
    db: Session = Depends(get_db)
):
    """Lista productos del inventario con filtros.
    
    - **bajo_stock**: Si es True, devuelve solo productos con stock <= stock_minimo
    """
    query = db.query(Inventario).filter(Inventario.activo == True)
    
    if categoria:
        query = query.filter(Inventario.categoria == categoria)
        
    if bajo_stock:
        query = query.filter(Inventario.stock_actual <= Inventario.stock_minimo)
        
    return query.offset(skip).limit(limit).all()

@router.get("/alertas-stock", response_model=List[InventarioResponse])
def obtener_alertas_stock(db: Session = Depends(get_db)):
    """Endpoint para dashboard (Trae cosas bajo el mínimo)"""
    return db.query(Inventario).filter(
        Inventario.activo == True,
        Inventario.stock_actual <= Inventario.stock_minimo
    ).all()

@router.get("/{producto_id}", response_model=InventarioResponse)
def obtener_producto(
    producto_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene un producto por ID"""
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return producto

@router.put("/{producto_id}", response_model=InventarioResponse)
def actualizar_producto(
    producto_id: int,
    producto_update: InventarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Actualiza un producto.

    El precio de lista (`precio_unitario`) NO pasa por el loop generico: si el
    payload lo trae y (cuantizado) difiere del actual, lo escribe
    `registrar_cambio_precio` -- que ademas historiza el cambio -- y exige rol
    admin (Tarea 08, decision 7). El resto de los campos (nombre, stock_minimo,
    proveedor, etc.) siguen por setattr: un veterinario los puede seguir
    editando.
    """
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    payload = producto_update.model_dump(exclude_unset=True)
    payload.pop("motivo", None)  # no es columna; solo alimenta el historial
    precio_nuevo = payload.pop("precio_unitario", None)

    if precio_nuevo is not None and cuantizar_precio(precio_nuevo) != cuantizar_precio(producto.precio_unitario):
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Solo un administrador puede cambiar precios")
        registrar_cambio_precio(
            db,
            entidad_row=producto,
            precio_nuevo=precio_nuevo,
            usuario_id=current_user.id,
            motivo=producto_update.motivo,
        )

    for key, value in payload.items():
        setattr(producto, key, value)

    db.commit()
    db.refresh(producto)
    return producto


@router.get("/{producto_id}/historial-precios", response_model=List[HistorialPrecioRead])
def historial_precios_producto(
    producto_id: int,
    desde: Optional[date] = Query(None, description="Filtra fecha_cambio desde este dia inclusive (YYYY-MM-DD)"),
    hasta: Optional[date] = Query(None, description="Filtra fecha_cambio hasta este dia inclusive (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Historial de precios de lista del material/producto, del mas nuevo al mas
    viejo (Tarea 08). La vigencia en una fecha se deriva tomando la primera fila
    con fecha_cambio <= esa fecha."""
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    q = db.query(HistorialPrecioInventario).filter(
        HistorialPrecioInventario.inventario_id == producto_id
    )
    if desde is not None:
        q = q.filter(
            HistorialPrecioInventario.fecha_cambio
            >= datetime.combine(desde, time.min, tzinfo=timezone.utc)
        )
    if hasta is not None:
        q = q.filter(
            HistorialPrecioInventario.fecha_cambio
            < datetime.combine(hasta, time.min, tzinfo=timezone.utc) + timedelta(days=1)
        )

    return q.order_by(
        HistorialPrecioInventario.fecha_cambio.desc(),
        HistorialPrecioInventario.id.desc(),
    ).all()


@router.get("/{producto_id}/movimientos", response_model=List[MovimientoInventarioResponse])
def movimientos_producto(
    producto_id: int,
    tipo: Optional[str] = Query(None, description="ENTRADA | SALIDA | MERMA | AJUSTE | REVERSA"),
    desde: Optional[date] = Query(None, description="Filtra fecha_registro desde este dia inclusive (YYYY-MM-DD)"),
    hasta: Optional[date] = Query(None, description="Filtra fecha_registro hasta este dia inclusive (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Ledger de movimientos del producto, del mas nuevo al mas viejo (Tarea 08).

    Es el primer lector de `movimientos_inventario`: la UI dibuja la curva de
    costo con el `costo_unitario` de cada ENTRADA al lado de la curva de precio
    de venta.
    """
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    q = db.query(MovimientoInventario).filter(MovimientoInventario.producto_id == producto_id)
    if tipo:
        q = q.filter(MovimientoInventario.tipo_movimiento == tipo.upper())
    if desde is not None:
        q = q.filter(
            MovimientoInventario.fecha_registro
            >= datetime.combine(desde, time.min, tzinfo=timezone.utc)
        )
    if hasta is not None:
        q = q.filter(
            MovimientoInventario.fecha_registro
            < datetime.combine(hasta, time.min, tzinfo=timezone.utc) + timedelta(days=1)
        )

    return q.order_by(
        MovimientoInventario.fecha_registro.desc(),
        MovimientoInventario.id.desc(),
    ).all()

@router.delete("/{producto_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_producto(
    producto_id: int,
    db: Session = Depends(get_db)
):
    """Desactiva un producto del inventario"""
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
        
    producto.activo = False
    db.commit()
    return None

@router.post("/{producto_id}/movimiento", response_model=InventarioResponse)
def registrar_movimiento(
    producto_id: int,
    cantidad: float,  # Positivo para entrada, negativo para salida; admite fracciones (Tarea 07)
    tipo: str = Query(..., description="ENTRADA o SALIDA"),
    db: Session = Depends(get_db)
):
    """Registra entrada o salida de stock (Simplificado)"""
    # Row-lock antes de leer/mutar el stock: sin esto, dos movimientos manuales
    # concurrentes sobre el mismo material pisan el saldo del otro (M5).
    producto = db.query(Inventario).filter(
        Inventario.id == producto_id
    ).with_for_update().first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    # El stock vive como Decimal (unidad base, 3 decimales). Convertir desde el
    # query param via str() para no arrastrar ruido binario de float.
    monto = abs(Decimal(str(cantidad))).quantize(Decimal("0.001"))

    if tipo.upper() == "SALIDA":
        if producto.stock_actual < monto:
            raise HTTPException(status_code=400, detail="Stock insuficiente")
        producto.stock_actual -= monto
    elif tipo.upper() == "ENTRADA":
        producto.stock_actual += monto
    else:
        raise HTTPException(status_code=400, detail="Tipo de movimiento invalido")

    db.commit()
    db.refresh(producto)

    if producto.stock_actual <= producto.stock_minimo:
        import logging
        _logger = logging.getLogger(__name__)
        _logger.warning(
            f"LOW STOCK ALERT: '{producto.nombre}' (id={producto.id}) "
            f"stock={producto.stock_actual} <= minimo={producto.stock_minimo}"
        )

    return producto
