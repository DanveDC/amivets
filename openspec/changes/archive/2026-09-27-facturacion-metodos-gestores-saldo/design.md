# Design

## Context

**FacturacionService** (`backend/app/services/facturacion_service.py`): 
- Ya tiene `listar_facturas()`, `obtener_factura()`, `obtener_items_pendientes_orden()`, `facturar_orden()`
- `Factura` model tiene `fecha_emision`, `estado`, `saldo_pendiente`, `total_pagado`, `total`
- `FacturaOrden` vincula factura ↔ orden (1:1)
- `Abono` model (líneas 817-832) tiene `factura_id` FK, NO tiene `orden_id`

**Comisiones** (`comision_service.py`, models `LiquidacionComision`, `LiquidacionComisionDetalle`):
- `LiquidacionComisionDetalle` ya tiene `tipo_comision`, `monto_fijo`, `porcentaje`, `monto_encargado`, `monto_amivets` congelados (comision-tipo-mixto-encargado)
- `liquidacion.fecha_calculo` para filtrar por rango
- `liquidacion.encargado_id` → `Usuario` (role veterinario/gestor)

**OrdenServicio**: estados `CERRADA`, `FACTURADA`; relación `servicios[]`, `factura` via `FacturaOrden`

## Goals / Non-Goals

**Goals:**
1. `obtener_hoy()` - facturas de hoy para dashboard
2. `obtener_pagos_gestores()` - totales por encargado desde liquidaciones congeladas
3. `obtener_saldo_pendiente_orden()` - saldo por orden (factura vinculada o items pendientes)
4. `Abono.orden_id` FK opcional
5. 3 endpoints GET + update POST abonar

**Non-Goals:**
- Recalcular comisiones (usar valores congelados en LiquidacionComisionDetalle)
- Cambiar lógica de facturación existente
- Dashboard UI (solo endpoints)

## Decisions

### 1. FacturacionService - obtener_hoy()

```python
@staticmethod
def obtener_hoy(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    estado: Optional[str] = None,
    propietario_id: Optional[int] = None,
) -> List[Factura]:
    """Facturas emitidas hoy (fecha_emision::date = today)."""
    from datetime import datetime, timezone
    hoy_inicio = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    hoy_fin = hoy_inicio + timedelta(days=1)
    
    query = db.query(Factura).filter(
        Factura.fecha_emision >= hoy_inicio,
        Factura.fecha_emision < hoy_fin,
    )
    
    if estado:
        query = query.filter(Factura.estado == estado)
    if propietario_id:
        query = query.filter(Factura.propietario_id == propietario_id)
    
    return query.order_by(Factura.fecha_emision.desc()).offset(skip).limit(limit).all()
```

- Usa `datetime.now(timezone.utc)` para "hoy" en UTC (consistente con `listar_facturas`)
- Mismos filtros opcionales que `listar_facturas` para reusar en UI

### 2. FacturacionService - obtener_pagos_gestores()

```python
@staticmethod
def obtener_pagos_gestores(
    db: Session,
    desde: date,
    hasta: date,
) -> List[dict]:
    """Totales a pagar por encargado en rango, desde liquidaciones congeladas."""
    from datetime import datetime, time, timezone
    from sqlalchemy import func
    
    dt_desde = datetime.combine(desde, time.min, tzinfo=timezone.utc)
    dt_hasta = datetime.combine(hasta, time.max, tzinfo=timezone.utc)
    
    # Query base: liquidaciones en rango
    q = db.query(
        LiquidacionComision.encargado_id,
        Usuario.username,
        Usuario.role,
        func.sum(LiquidacionComisionDetalle.monto_encargado).label("total_encargado"),
        func.sum(LiquidacionComisionDetalle.monto_amivets).label("total_amivets"),
        func.count(LiquidacionComisionDetalle.id).filter(
            LiquidacionComisionDetalle.es_ajuste == False
        ).label("cantidad_lineas"),
        func.sum(LiquidacionComisionDetalle.monto_encargado).filter(
            LiquidacionComisionDetalle.es_ajuste == True
        ).label("total_ajustes"),
    ).join(
        LiquidacionComision, LiquidacionComision.id == LiquidacionComisionDetalle.liquidacion_id
    ).join(
        Usuario, Usuario.id == LiquidacionComision.encargado_id
    ).filter(
        LiquidacionComision.fecha_calculo >= dt_desde,
        LiquidacionComision.fecha_calculo <= dt_hasta,
    ).group_by(
        LiquidacionComision.encargado_id, Usuario.username, Usuario.role
    ).order_by(Usuario.username)
    
    resultados = []
    for row in q.all():
        resultados.append({
            "encargado_id": row.encargado_id,
            "username": row.username,
            "role": row.role,
            "total_encargado": float(row.total_encargado or 0),
            "total_amivets": float(row.total_amivets or 0),
            "cantidad_lineas": int(row.cantidad_lineas or 0),
            "total_ajustes": float(row.total_ajustes or 0),
        })
    return resultados
```

- Solo admin (info sensible de pagos a encargados)
- Usa `fecha_calculo` de la liquidación (cuando se generó), no `fecha_cobro` del detalle
- Agrega ajustes negativos en `total_encargado` (suma algebraica)
- `total_ajustes` separado para visibilidad

### 3. FacturacionService - obtener_saldo_pendiente_orden()

```python
@staticmethod
def obtener_saldo_pendiente_orden(db: Session, orden_id: int) -> dict:
    """Saldo pendiente de una orden: de su factura vinculada o items pendientes."""
    orden = db.query(OrdenServicio).filter(OrdenServicio.id == orden_id).first()
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    
    # Buscar factura vinculada
    vinculo = db.query(FacturaOrden).filter(FacturaOrden.orden_id == orden_id).first()
    
    if vinculo:
        factura = db.query(Factura).filter(Factura.id == vinculo.factura_id).first()
        if factura:
            if factura.estado == "PAGADA":
                saldo = 0.0
            else:
                saldo = float(factura.saldo_pendiente or 0)
            return {
                "orden_id": orden.id,
                "orden_numero": orden.numero,
                "estado_orden": orden.estado,
                "factura_id": factura.id,
                "factura_numero": factura.numero_factura,
                "factura_estado": factura.estado,
                "saldo_pendiente": saldo,
                "total_factura": float(factura.total or 0),
                "total_pagado": float(factura.total_pagado or 0),
            }
    
    # Sin factura vinculada: solo si orden CERRADA
    if orden.estado != "CERRADA":
        raise HTTPException(
            409, 
            f"La orden {orden.numero} está {orden.estado}; no tiene factura vinculada ni está cerrada."
        )
    
    data = FacturacionService.obtener_items_pendientes_orden(db, orden_id)
    return {
        "orden_id": orden.id,
        "orden_numero": orden.numero,
        "estado_orden": orden.estado,
        "factura_id": None,
        "factura_numero": None,
        "factura_estado": None,
        "saldo_pendiente": data["total"],
        "total_factura": data["total"],
        "total_pagado": 0.0,
    }
```

### 4. Modelo Abono - agregar orden_id

```python
class Abono(Base):
    # ... existentes ...
    factura_id = Column(Integer, ForeignKey("facturas.id"), nullable=False)
    orden_id = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=True, index=True)  # NEW
    
    factura = relationship("Factura", back_populates="abonos")
    orden = relationship("OrdenServicio")  # NEW
```

- `nullable=True`: abono puede ser solo a factura, solo a orden, o a ambos
- Si `orden_id` presente y `factura_id` también: ambos vinculados (factura de la orden)
- Migración Alembic: ADD COLUMN + index

### 5. Schemas

```python
class AbonoCreate(BaseModel):
    monto: Decimal
    metodo_pago: str
    notas: Optional[str] = None
    orden_id: Optional[int] = Field(None, gt=0)  # NEW

class AbonoResponse(BaseModel):
    id: int
    numero_abono: Optional[str] = None
    factura_id: int
    orden_id: Optional[int] = None  # NEW
    orden_numero: Optional[str] = None  # NEW (resuelto via relationship)
    monto: Decimal
    metodo_pago: str
    fecha: datetime
    notas: Optional[str] = None
    
    @model_validator(mode='before')
    def _adjuntar_orden_numero(cls, data):
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                if getattr(data, 'orden', None):
                    data.orden_numero = data.orden.numero
            except Exception:
                pass
        return data

# Nuevos responses
class FacturaHoyResponse(FacturaResponse):
    """Igual que FacturaResponse, para documentación"""
    pass

class GestorPagoResponse(BaseModel):
    encargado_id: int
    username: str
    role: str
    total_encargado: float
    total_amivets: float
    cantidad_lineas: int
    total_ajustes: float

class SaldoPendienteOrdenResponse(BaseModel):
    orden_id: int
    orden_numero: str
    estado_orden: str
    factura_id: Optional[int] = None
    factura_numero: Optional[str] = None
    factura_estado: Optional[str] = None
    saldo_pendiente: float
    total_factura: float
    total_pagado: float
```

### 6. Router endpoints

```python
@router.get("/hoy", response_model=List[FacturaResponse])
def facturas_hoy(
    skip: int = 0,
    limit: int = 100,
    estado: Optional[str] = None,
    propietario_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    return FacturacionService.obtener_hoy(db, skip, limit, estado, propietario_id)


@router.get("/gestores-pagos", response_model=List[GestorPagoResponse])
def gestores_pagos(
    desde: str,  # YYYY-MM-DD
    hasta: str,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin")),
):
    from datetime import date
    try:
        d_desde = date.fromisoformat(desde)
        d_hasta = date.fromisoformat(hasta)
    except ValueError:
        raise HTTPException(422, "Formato de fecha inválido. Use YYYY-MM-DD")
    if d_hasta < d_desde:
        raise HTTPException(422, "'hasta' no puede ser anterior a 'desde'")
    return FacturacionService.obtener_pagos_gestores(db, d_desde, d_hasta)


@router.get("/orden/{orden_id}/saldo-pendiente", response_model=SaldoPendienteOrdenResponse)
def saldo_pendiente_orden(
    orden_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    return FacturacionService.obtener_saldo_pendiente_orden(db, orden_id)
```

### 7. POST /abonar actualizado

```python
@router.post("/{factura_id}/abonar", response_model=AbonoResponse, status_code=201)
def registrar_abono(
    factura_id: int,
    abono_data: AbonoCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    factura = db.query(Factura).filter(Factura.id == factura_id).first()
    if not factura:
        raise HTTPException(404, "Factura no encontrada")
    
    # Si viene orden_id, validar
    orden = None
    if abono_data.orden_id:
        orden = db.query(OrdenServicio).filter(OrdenServicio.id == abono_data.orden_id).first()
        if not orden:
            raise HTTPException(404, "Orden no encontrada")
        if orden.estado not in ("CERRADA", "FACTURADA"):
            raise HTTPException(409, f"Orden {orden.numero} está {orden.estado}")
        # Verificar que la factura pertenece a la orden (si tiene factura vinculada)
        vinculo = db.query(FacturaOrden).filter(FacturaOrden.orden_id == orden.id).first()
        if vinculo and vinculo.factura_id != factura_id:
            raise HTTPException(409, "La factura no corresponde a la orden indicada")
    
    # ... resto de lógica existente ...
    # Al crear Abono, setear orden_id si vino
    nuevo_abono = Abono(
        numero_abono=numero_abono,
        factura_id=factura_id,
        orden_id=abono_data.orden_id,  # NEW
        monto=abono_data.monto,
        metodo_pago=abono_data.metodo_pago,
        notas=abono_data.notas,
    )
    # ... actualizar factura.total_pagado, saldo_pendiente, estado ...
```

## Risks / Trade-offs

- **`obtener_pagos_gestores` solo admin**: expone info financiera sensible (cuánto se paga a cada encargado)
- **`fecha_calculo` vs `fecha_cobro`**: se usa `fecha_calculo` de la liquidación (cuando se generó el pago), no la fecha de cobro de cada línea. Consistente con `listar_liquidaciones`.
- **Abono con orden_id**: permite pagos "pre-factura" para órdenes CERRADA. Si luego se factura, el abono ya está vinculado a ambas.
- **Saldo pendiente sin factura**: para órdenes CERRADA sin factura, calcula items pendientes. Útil para "Órdenes por cobrar" en facturación.js
- **Migración Abono.orden_id**: nullable, no rompe datos existentes