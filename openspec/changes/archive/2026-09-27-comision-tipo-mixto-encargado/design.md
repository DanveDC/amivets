# Design

## Context

- `models.py` (líneas 925-939): `ComisionEncargado` tiene solo `porcentaje` (Numeric(5,2))
- `models.py` (líneas 969-1009): `LiquidacionComisionDetalle` tiene `porcentaje`, `monto_encargado`, `monto_amivets` congelados
- `models.py` (líneas 1227-1265): `CatalogoServicio` no tiene campos de comisión
- `comision_service.py`:
  - `porcentaje_efectivo()` (línea 91-95): resuelve % propio > default
  - `_repartir()` (línea 171-173): `encargado = subtotal * porcentaje / 100`
  - `lineas_pendientes()` (línea 283-332): usa `porcentaje_efectivo()` y `_repartir()`
  - `ajustes_pendientes()` (línea 335-375): usa `porcentaje` congelado del detalle
  - `liquidar()` (línea 440-485): crea `LiquidacionComisionDetalle` copiando `porcentaje`, `monto_encargado`, `monto_amivets`
- `schemas.py` (líneas 1143-1154): `PorcentajeEncargadoUpdate`, `EncargadoComisionResponse`
- `routers/comisiones.py`: endpoints config porcentaje, control, liquidar

## Goals / Non-Goals

**Goals:**
1. `ComisionEncargado`: agregar `tipo_comision` (FIJO|PORCENTAJE|MIXTO), `monto_fijo`, hacer `porcentaje` nullable
2. `CatalogoServicio`: agregar `tipo_comision_servicio` (FIJO|PORCENTAJE|HEREDA), `monto_fijo_servicio` (nullable)
3. `comision_service.py`: `calcular_comision()` unificada, `lineas_pendientes`/`ajustes` usan nueva lógica
4. `LiquidacionComisionDetalle`: agregar `tipo_comision`, `monto_fijo` congelados
5. Migración Alembic para todas las tablas

**Non-Goals:**
- Cambiar `ConfiguracionComision` (sigue siendo solo porcentaje default)
- Comisiones por tramos/escalas (solo FIJO, PORCENTAJE, MIXTO simple)
- Comisiones para gestores externos (otra feature)

## Decisions

### 1. Modelos (models.py)

**ComisionEncargado** (modificar existente):
```python
class ComisionEncargado(Base):
    __tablename__ = "comision_encargados"
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, unique=True, index=True)
    tipo_comision = Column(String(20), nullable=False, server_default="PORCENTAJE")  # FIJO, PORCENTAJE, MIXTO
    monto_fijo = Column(Numeric(10, 2), nullable=True)
    porcentaje = Column(Numeric(5, 2), nullable=True)  # AHORA nullable
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    usuario = relationship("Usuario")
    __table_args__ = (
        CheckConstraint("tipo_comision IN ('FIJO','PORCENTAJE','MIXTO')", name="ck_comision_encargado_tipo"),
        CheckConstraint(
            "(tipo_comision = 'FIJO' AND monto_fijo IS NOT NULL AND porcentaje IS NULL) OR "
            "(tipo_comision = 'PORCENTAJE' AND porcentaje IS NOT NULL AND monto_fijo IS NULL) OR "
            "(tipo_comision = 'MIXTO' AND monto_fijo IS NOT NULL AND porcentaje IS NOT NULL)",
            name="ck_comision_encargado_campos"
        ),
        CheckConstraint("porcentaje >= 0 AND porcentaje <= 100", name="ck_comision_encargado_rango"),
    )
```

**CatalogoServicio** (agregar campos):
```python
class CatalogoServicio(Base):
    # ... campos existentes ...
    tipo_comision_servicio = Column(String(20), nullable=False, server_default="HEREDA")  # FIJO, PORCENTAJE, HEREDA
    monto_fijo_servicio = Column(Numeric(10, 2), nullable=True)  # solo si tipo_comision_servicio='FIJO'
    porcentaje_servicio = Column(Numeric(5, 2), nullable=True)  # solo si tipo_comision_servicio='PORCENTAJE'
    # CheckConstraint similar para validar coherencia
```

**LiquidacionComisionDetalle** (agregar campos):
```python
class LiquidacionComisionDetalle(Base):
    # ... campos existentes ...
    tipo_comision = Column(String(20), nullable=False)  # congelado: FIJO|PORCENTAJE|MIXTO
    monto_fijo = Column(Numeric(10, 2), nullable=True)  # congelado
```

### 2. Lógica de cálculo (comision_service.py)

**Nueva función central `calcular_comision()`:**
```python
def calcular_comision(
    db: Session,
    subtotal: Decimal,
    encargado_id: int,
    servicio: Optional[ServicioConsulta] = None,
    catalogo_servicio: Optional[CatalogoServicio] = None,
) -> dict:
    """
    Resuelve tipo y parámetros en orden de prioridad:
    1. catalogo_servicio (si tiene override != HEREDA)
    2. comision_encargado del encargado_id
    3. configuracion_comision default (PORCENTAJE 0%)
    """
    # 1. Intentar catálogo
    if catalogo_servicio and catalogo_servicio.tipo_comision_servicio != "HEREDA":
        tipo = catalogo_servicio.tipo_comision_servicio
        monto_fijo = _dec(catalogo_servicio.monto_fijo_servicio) if tipo in ("FIJO", "MIXTO") else Decimal("0")
        porcentaje = _dec(catalogo_servicio.porcentaje_servicio) if tipo in ("PORCENTAJE", "MIXTO") else Decimal("0")
        return _repartir_con_tipo(subtotal, tipo, monto_fijo, porcentaje)
    
    # 2. Encargado
    ce = db.query(ComisionEncargado).filter(ComisionEncargado.usuario_id == encargado_id).first()
    if ce:
        tipo = ce.tipo_comision
        monto_fijo = _dec(ce.monto_fijo) if tipo in ("FIJO", "MIXTO") else Decimal("0")
        porcentaje = _dec(ce.porcentaje) if tipo in ("PORCENTAJE", "MIXTO") else Decimal("0")
        return _repartir_con_tipo(subtotal, tipo, monto_fijo, porcentaje)
    
    # 3. Default
    config = obtener_configuracion(db)
    return _repartir_con_tipo(subtotal, "PORCENTAJE", Decimal("0"), _dec(config.porcentaje_defecto))

def _repartir_con_tipo(subtotal: Decimal, tipo: str, monto_fijo: Decimal, porcentaje: Decimal) -> dict:
    if tipo == "FIJO":
        enc = min(monto_fijo, subtotal)  # no pagar más que el subtotal
    elif tipo == "PORCENTAJE":
        enc = _centavos(subtotal * porcentaje / CIEN)
    elif tipo == "MIXTO":
        enc = _centavos(monto_fijo + subtotal * porcentaje / CIEN)
        if enc > subtotal:
            enc = subtotal
    else:
        enc = Decimal("0")
    return {
        "tipo_comision_usado": tipo,
        "monto_fijo_usado": monto_fijo if tipo in ("FIJO", "MIXTO") else None,
        "porcentaje_usado": porcentaje if tipo in ("PORCENTAJE", "MIXTO") else None,
        "monto_encargado": enc,
        "monto_amivets": _centavos(subtotal) - enc,
    }
```

**Modificar `lineas_pendientes()`:**
- Para cada par (servicio, factura), obtener `servicio.catalogo_servicio`
- Llamar `calcular_comision(db, cobrado, encargado_id, servicio, catalogo_servicio)`
- Usar valores retornados para crear `Linea`

**Modificar `ajustes_pendientes()`:**
- Leer `tipo_comision` y `monto_fijo` del `LiquidacionComisionDetalle` congelado
- Recalcular con `_repartir_con_tipo(-subtotal, tipo_congelado, monto_fijo_congelado, porcentaje_congelado)`

**Modificar `liquidar()`:**
- En cada `Linea` agregar `tipo_comision_usado`, `monto_fijo_usado`
- Al crear `LiquidacionComisionDetalle`, setear `tipo_comision=l.tipo_comision_usado`, `monto_fijo=l.monto_fijo_usado`

### 3. Schemas (schemas.py)

```python
class ComisionEncargadoUpdate(BaseModel):
    tipo_comision: Literal["FIJO", "PORCENTAJE", "MIXTO"] = "PORCENTAJE"
    monto_fijo: Optional[Decimal] = Field(None, ge=0, max_digits=10, decimal_places=2)
    porcentaje: Optional[Decimal] = Field(None, ge=0, le=100, max_digits=5, decimal_places=2)
    
    @model_validator(mode="after")
    def validar_campos(self):
        if self.tipo_comision == "FIJO" and self.monto_fijo is None:
            raise ValueError("monto_fijo obligatorio para tipo FIJO")
        if self.tipo_comision == "PORCENTAJE" and self.porcentaje is None:
            raise ValueError("porcentaje obligatorio para tipo PORCENTAJE")
        if self.tipo_comision == "MIXTO" and (self.monto_fijo is None or self.porcentaje is None):
            raise ValueError("monto_fijo y porcentaje obligatorios para tipo MIXTO")
        return self

class EncargadoComisionResponse(BaseModel):
    usuario_id: int
    username: str
    role: Optional[str] = None
    tipo_comision: str
    monto_fijo: Optional[Decimal] = None
    porcentaje: Optional[Decimal] = None
    porcentaje_efectivo: Decimal  # compatible: si FIJO/MIXTO devuelve 0 o equivalente
    # Para backward compat: si tipo=PORCENTAJE, porcentaje_efectivo = porcentaje
    # Si tipo=FIJO, porcentaje_efectivo = 0 (o calcular % equivalente sobre subtotal típico?)

class CatalogoServicioBase(BaseModel):
    # ... campos existentes ...
    tipo_comision_servicio: Literal["FIJO", "PORCENTAJE", "HEREDA"] = "HEREDA"
    monto_fijo_servicio: Optional[Decimal] = Field(None, ge=0, max_digits=10, decimal_places=2)
    porcentaje_servicio: Optional[Decimal] = Field(None, ge=0, le=100, max_digits=5, decimal_places=2)

class ComisionLineaResponse(BaseModel):
    # ... campos existentes ...
    tipo_comision_usado: str
    monto_fijo_usado: Optional[Decimal] = None
    porcentaje_usado: Optional[Decimal] = None
```

### 4. Migración Alembic

```bash
cd backend && alembic revision -m "add tipo_comision and monto_fijo to comision_encargados, catalogo_servicios, liquidacion_comision_detalles"
```

Upgrade:
- ALTER TABLE comision_encargados ADD COLUMN tipo_comision VARCHAR(20) NOT NULL DEFAULT 'PORCENTAJE'
- ALTER TABLE comision_encargados ADD COLUMN monto_fijo NUMERIC(10,2) NULL
- ALTER TABLE comision_encargados ALTER COLUMN porcentaje DROP NOT NULL
- ADD CHECK constraints (tipo, campos coherentes)
- ALTER TABLE catalogo_servicios ADD COLUMN tipo_comision_servicio VARCHAR(20) NOT NULL DEFAULT 'HEREDA'
- ALTER TABLE catalogo_servicios ADD COLUMN monto_fijo_servicio NUMERIC(10,2) NULL
- ALTER TABLE catalogo_servicios ADD COLUMN porcentaje_servicio NUMERIC(5,2) NULL
- ADD CHECK constraint catalogo_servicios
- ALTER TABLE liquidacion_comision_detalles ADD COLUMN tipo_comision VARCHAR(20) NOT NULL DEFAULT 'PORCENTAJE'
- ALTER TABLE liquidacion_comision_detalles ADD COLUMN monto_fijo NUMERIC(10,2) NULL
- Backfill liquidacion_comision_detalles.tipo_comision = 'PORCENTAJE' (existentes)

Downgrade: DROP COLUMNS en orden inverso.

## Risks / Trade-offs

- **Backward compat `porcentaje_efectivo`**: Frontend actual espera `porcentaje_efectivo` en `EncargadoComisionResponse`. Para tipo FIJO/MIXTO no hay un "porcentaje efectivo" único. Opción A: devolver 0 y documentar. Opción B: calcular % equivalente asumiendo subtotal promedio. Elegir A: devolver `porcentaje_efectivo = porcentaje or 0` y frontend leer `tipo_comision` + `monto_fijo`.
- **Monto fijo > subtotal**: En `_repartir_con_tipo` cap a `subtotal` para que `monto_amivets >= 0`. Documentar.
- **Catálogo sin monto_fijo_servicio**: Si servicio override es FIJO pero `monto_fijo_servicio` es NULL, caer a config del encargado o error. Validar en schema: si tipo_comision_servicio=FIJO → monto_fijo_servicio required.
- **Ajustes negativos**: `ajustes_pendientes` usa subtotal negativo; `_repartir_con_tipo` debe manejar subtotal < 0 (devolver negativo simétrico).
- **Performance**: `calcular_comision` hace query a `ComisionEncargado` y `CatalogoServicio` por cada línea. Optimizar: cachear `ComisionEncargado` por `encargado_id` en dict (ya se hace en `porcentajes_propios`), y eager load `catalogo_servicio` en query de `_pares_cobrados`.