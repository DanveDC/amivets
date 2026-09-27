# Design

## Context

- `models.py` ya tiene `AreaServicio` (líneas 200-226), `GestorArea` (líneas 229-257) para gestores internos (N:M usuario↔área).
- `routers/areas.py` expone CRUD de áreas y asignación de gestores internos (`GET/POST/DELETE /api/areas/{id}/gestores`).
- `notificacion_service.py` crea notificaciones `SERVICIO_ASIGNADO` fan-out a gestores del área (línea 287 en `orden_service.py::confirmar_servicios` llama `notificacion_service.notificar_asignacion`).
- `schemas.py` usa patrón: `Create`/`Update`/`Response` con `ConfigDict(from_attributes=True)` y `model_validator` para nombres denormalizados.
- Alembic configurado en `backend/alembic/`; migraciones en `backend/alembic/versions/`.
- Permisos: `require_roles("admin")` para gestión de áreas/gestores (filas 23-24 de matriz).

## Goals / Non-Goals

**Goals:**
1. Tabla `gestores_externos` con campos de identificación (incluye `nombre`), contacto, pago, vinculación opcional a usuario.
2. Tabla pivote `gestor_area_externo` para N:M con `areas_servicio`.
3. Modelos SQLAlchemy con relaciones bidireccionales.
4. Schemas Pydantic completos.
5. Router CRUD protegido admin.
6. Extender `notificar_asignacion` para incluir gestores externos activos.
7. Migración Alembic.

**Non-Goals:**
- Portal/login para gestores externos (solo notificación APP en BD).
- Liquidación/comisiones para gestores externos (fase futura).
- Notificar externos en asignación directa (`asignado_directo_a_id`).

## Decisions

### 1. Modelos (models.py)

```python
class GestorExterno(Base):
    __tablename__ = "gestores_externos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(120), nullable=False)
    rif = Column(String(20), unique=True, nullable=False, index=True)
    telefono = Column(String(20), nullable=False)
    metodo_pago = Column(String(50), nullable=False)  # TRANSFERENCIA, EFECTIVO, ZELLE, CHEQUE, OTRO
    numero_cuenta = Column(String(50), nullable=True)
    es_movil = Column(Boolean, nullable=False, server_default=text("false"), default=False)
    zelle = Column(String(100), nullable=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    activo = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    usuario = relationship("Usuario")
    areas = relationship("GestorAreaExterno", back_populates="gestor", cascade="all, delete-orphan")
    
    __table_args__ = (
        CheckConstraint("metodo_pago IN ('TRANSFERENCIA','EFECTIVO','ZELLE','CHEQUE','OTRO')", name="ck_gestor_externo_metodo_pago"),
    )

class GestorAreaExterno(Base):
    __tablename__ = "gestor_area_externo"
    id = Column(Integer, primary_key=True)
    gestor_externo_id = Column(Integer, ForeignKey("gestores_externos.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id = Column(Integer, ForeignKey("areas_servicio.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    __table_args__ = (
        UniqueConstraint("gestor_externo_id", "area_id", name="uq_gestor_area_externo"),
    )
    
    gestor = relationship("GestorExterno", back_populates="areas")
    area = relationship("AreaServicio")
```

- `ondelete="CASCADE"` en pivote: al borrar gestor externo, se borran sus asignaciones (o soft delete pone `activo=false` y mantiene historial).
- `metodo_pago` con CHECK constraint para valores válidos.
- `usuario_id` nullable: gestor puede ser puramente externo o vinculado a usuario interno (ej. vet que también es proveedor).

### 2. Schemas (schemas.py)

```python
class GestorExternoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=120)
    rif: str = Field(..., min_length=1, max_length=20)
    telefono: str = Field(..., min_length=1, max_length=20)
    metodo_pago: Literal["TRANSFERENCIA", "EFECTIVO", "ZELLE", "CHEQUE", "OTRO"]
    numero_cuenta: Optional[str] = Field(None, max_length=50)
    es_movil: bool = False
    zelle: Optional[str] = Field(None, max_length=100)
    usuario_id: Optional[int] = Field(None, gt=0)
    activo: bool = True

class GestorExternoCreate(GestorExternoBase):
    @field_validator("rif")
    @classmethod
    def rif_upper(cls, v): return v.strip().upper()

class GestorExternoUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=120)
    rif: Optional[str] = Field(None, min_length=1, max_length=20)  # normalizado upper; 422 en router si tiene áreas
    telefono: Optional[str] = Field(None, min_length=1, max_length=20)
    metodo_pago: Optional[Literal["TRANSFERENCIA", "EFECTIVO", "ZELLE", "CHEQUE", "OTRO"]] = None
    numero_cuenta: Optional[str] = Field(None, max_length=50)
    es_movil: Optional[bool] = None
    zelle: Optional[str] = Field(None, max_length=100)
    usuario_id: Optional[int] = Field(None, gt=0)
    activo: Optional[bool] = None

class GestorExternoResponse(GestorExternoBase):
    id: int
    created_at: datetime
    areas: List[AreaServicioResponse] = []
    usuario_nombre: Optional[str] = None  # si usuario_id seteado
    
    @model_validator(mode='before')
    def _adjuntar_nombres(cls, data):
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                if getattr(data, 'usuario', None):
                    data.usuario_nombre = data.usuario.username
                areas = getattr(data, 'areas', None)
                if areas:
                    data.areas = [a.area for a in areas if a.area]
            except Exception:
                pass
        return data
    model_config = ConfigDict(from_attributes=True)
```

### 3. Router (nuevo archivo `routers/gestores_externos.py` o dentro de `areas.py`)

Nuevo router `/api/gestores-externos/` con `require_roles("admin")` en todos los endpoints.

Endpoints:
- `GET /` — `skip, limit, activo, area_id` → lista con eager load `areas.area`
- `GET /{id}` — detalle con áreas
- `POST /` — crear, validar RIF único, usuario_id existe
- `PATCH /{id}` — actualizar; `rif` solo si no tiene áreas (422 si tiene, 409 si colisiona); `activo=false` es el soft delete
- `DELETE /{id}` — si no tiene áreas ni notificaciones → hard delete; con áreas → 409 "Tiene áreas asignadas, desactive en su lugar"; con notificaciones → 409 "El gestor tiene historial de notificaciones, desactívelo en su lugar" (chequeo explícito en el router; la FK RESTRICT es la red de seguridad)

Sub-router asignaciones:
- `GET /{id}/areas/` — lista áreas asignadas
- `POST /{id}/areas/` — `{area_id}` → crear pivote (validar area existe, gestor activo)
- `DELETE /{id}/areas/{area_id}` — borrar pivote

### 4. Integración notificaciones (orden_service.py + notificacion_service.py)

Dentro de `notificar_asignacion` (rama sin asignación directa), tras notificar gestores internos, agregar:

```python
# Notificar gestores externos activos del área
gestores_externos = db.query(GestorExterno).join(GestorAreaExterno).filter(
    GestorAreaExterno.area_id == servicio.area_id,
    GestorExterno.activo == True,
).all()
for ge in gestores_externos:
    notificacion_service.crear_notificacion_externa(db, ge, servicio)
```

Nueva función en `notificacion_service.py`:
```python
def crear_notificacion_externa(db, gestor_externo, servicio):
    # Crea notificación con destinatario_id=NULL, tipo="SERVICIO_ASIGNADO_EXTERNO"
    # Guarda gestor_externo_id en campo nuevo o en cuerpo JSON
    # Canal APP por ahora; futuro email/WhatsApp
```

Decisión: reusar `notificaciones` → `destinatario_id` pasa a nullable, se agrega `gestor_externo_id` (FK nullable a `gestores_externos.id`, ON DELETE RESTRICT, indexado) y `CHECK ((destinatario_id IS NOT NULL) <> (gestor_externo_id IS NOT NULL))`. `tipo="SERVICIO_ASIGNADO_EXTERNO"`, `canal="APP"`.

Reglas:
- Asignación directa (`servicio.asignado_directo_a_id`): NO se notifica a externos.
- Área sin gestores internos activos: se mantiene `SERVICIO_SIN_GESTOR` a admins aunque haya externos (no tienen portal).
- Queries existentes por `destinatario_id` (badge, bandeja de notificaciones) no ven las externas: correcto.

### 5. Migración Alembic

```bash
cd backend && alembic revision -m "add gestor_externo and gestor_area_externo tables"
```

Upgrade:
- CREATE TABLE gestores_externos (con `nombre`, CHECK metodo_pago)
- CREATE TABLE gestor_area_externo (FKs CASCADE, UniqueConstraint)
- Índices en rif, usuario_id, gestor_externo_id, area_id

- ALTER notificaciones: `destinatario_id` nullable, ADD `gestor_externo_id` + índice + CHECK XOR

Downgrade: borrar notificaciones externas, revertir columnas/constraint de notificaciones, DROP TABLE en orden inverso.

## Risks / Trade-offs

- **Notificaciones a externos**: Modelo actual `Notificacion.destinatario_id` es FK NOT NULL a `usuarios`. Opción A: hacerlo nullable + agregar `gestor_externo_id` nullable + check constraint (uno de los dos). Opción B: tabla separada `notificaciones_externas`. Elegir A por simplicidad y query unificada de "todas las notificaciones".
- **RIF inmutable tras asignación**: Regla de negocio para auditoría fiscal. Validar en PATCH: si `gestor.areas` no vacío y `rif` cambia → 422.
- **Soft vs hard delete**: Soft delete = `PATCH activo=false`, preserva historial de asignaciones y pagos. `DELETE` solo hace hard delete con cero áreas; con áreas → 409 (un DELETE que no borra confunde).
- **Historial de notificaciones**: FK `notificaciones.gestor_externo_id` con ON DELETE RESTRICT, no CASCADE. CASCADE borraba el historial al desasignar áreas y borrar; SET NULL no es viable porque violaría el CHECK XOR. Costo aceptado: un gestor que alguna vez recibió trabajo solo puede desactivarse.
- **Canal de notificación**: Por ahora solo `APP` (guarda en BD). Futuro: worker que lea notificaciones `canal="EMAIL"/"WHATSAPP"` y envíe.