from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Inventario
from app.schemas.schemas import InventarioCreate, InventarioUpdate, InventarioResponse

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
    db: Session = Depends(get_db)
):
    """Actualiza un producto"""
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
        
    for key, value in producto_update.model_dump(exclude_unset=True).items():
        setattr(producto, key, value)
    
    db.commit()
    db.refresh(producto)
    return producto

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
    cantidad: int, # Positivo para entrada, Negativo para salida
    tipo: str = Query(..., description="ENTRADA o SALIDA"), 
    db: Session = Depends(get_db)
):
    """Registra entrada o salida de stock (Simplificado)"""
    producto = db.query(Inventario).filter(Inventario.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
        
    if tipo.upper() == "SALIDA":
        if producto.stock_actual < abs(cantidad):
            raise HTTPException(status_code=400, detail="Stock insuficiente")
        producto.stock_actual -= abs(cantidad)
    elif tipo.upper() == "ENTRADA":
        producto.stock_actual += abs(cantidad)
    else:
        raise HTTPException(status_code=400, detail="Tipo de movimiento invalido")
    
    db.commit()
    db.refresh(producto)
    return producto
