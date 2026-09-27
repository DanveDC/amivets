# Design

## Context

**Modelo actual `ServicioConsulta`** (models.py líneas 418-546):
- Campos clave: `id`, `orden_id`, `tipo_servicio`, `nombre_servicio`, `cantidad`, `precio_unitario`, `estado`, `area_id`, `asignado_a_id`, `asignado_directo_a_id`, `liberado_at`, `liberado_por_id`, `ejecutado_at`, `is_deleted`, `created_at`
- Relaciones: `orden`, `consulta`, `mascota`, `area`, `asignado_a`, `liberado_por`, `asignado_directo_a`, `adjuntos`, `catalogo_servicio`, `movimientos`, `consumos_material`
- Propiedad `subtotal()` = `cantidad * precio_unitario`

**Schema actual** (schemas.py líneas 177-324):
- `ServicioConsultaBase/Create/Update/Response` con campos básicos
- `ServicioConsultaResponse` tiene computed fields: `estado_toma`, `veterinario_nombre`, `area_nombre`
- `OrdenServicioAnexarServicio` para POST /api/ordenes/{id}/servicios

**Servicio orden_service.py** (líneas 325-399):
- `crear_servicio_en_orden()` crea servicio en estado SOLICITADO (o EJECUTADO para CONSULTA)
- `confirmar_servicios()` despacha a áreas o ejecuta sin área

**Frontend orden-abierta.js** (líneas 144-204):
- `pintarServicios()` renderiza tabla plana de servicios
- Columnas: nombre, tipo, cantidad, precio unitario, subtotal, estado, acción (gestor)
- `pintarResumen()` usa `orden.total` (calculado en server)

**Frontend facturacion.js**:
- `abrirPreviewFactura()` muestra items en tabla plana
- PDF export usa mismos items

## Goals / Non-Goals

**Goals:**
1. Agregar `servicio_padre_id` (self-FK) y `es_base` a `ServicioConsulta`
2. Validaciones de integridad en service layer
3. Computed fields en response para UI jerárquica
4. Renderizado agrupado en orden-abierta.js y facturacion.js
5. Migración Alembic con constraints

**Non-Goals:**
- Cambiar cálculo de `OrdenServicioResponse.total` (ya suma todos)
- Cambiar `FacturacionService.crear_factura` / `obtener_items_pendientes_orden`
- Anidación multinivel (solo 1 nivel: base → items)
- Modificar `confirmar_servicios` / despacho a áreas

## Decisions

### 1. Modelo (models.py) - ServicioConsulta

```python
# Nuevas columnas (después de asignado_directo_a_id, línea ~530)
servicio_padre_id = Column(
    Integer, 
    ForeignKey("servicios_consulta.id", ondelete="SET NULL"), 
    nullable=True, 
    index=True
)
es_base = Column(
    Boolean, 
    nullable=False, 
    server_default=text("false"), 
    default=False
)

# Relaciones auto-referenciales
servicio_padre = relationship(
    "ServicioConsulta", 
    remote_side=[id],
    back_populates="items_adicionales",
    foreign_keys=[servicio_padre_id]
)
items_adicionales = relationship(
    "ServicioConsulta",
    back_populates="servicio_padre",
    foreign_keys=[servicio_padre_id]
)

# Constraints en __table_args__
__table_args__ = (
    # ... existentes ...
    CheckConstraint(
        "(es_base = true AND servicio_padre_id IS NULL) OR "
        "(es_base = false AND servicio_padre_id IS NULL) OR "
        "(es_base = false AND servicio_padre_id IS NOT NULL)",
        name="ck_servicio_jerarquia_base_padre"
    ),
    CheckConstraint(
        "servicio_padre_id IS NULL OR "
        "(SELECT es_base FROM servicios_consulta WHERE id = servicio_padre_id) = true",
        name="ck_servicio_padre_es_base"
    ),
    CheckConstraint(
        "servicio_padre_id IS NULL OR "
        "(SELECT orden_id FROM servicios_consulta WHERE id = servicio_padre_id) = orden_id",
        name="ck_servicio_padre_misma_orden"
    ),
)
```

**Notas:**
- `ondelete="SET NULL"`: si se borra el padre (soft delete via `is_deleted`), el hijo queda huérfano pero válido
- Los CHECK constraints usan subqueries; en PostgreSQL funcionan. Alternativa: validar en service layer (más portable)
- Índice en `servicio_padre_id` para queries de "hijos de este padre"

### 2. Schemas (schemas.py)

```python
class ServicioConsultaBase(BaseModel):
    # ... existentes ...
    servicio_padre_id: Optional[int] = Field(None, gt=0)
    es_base: bool = False

class ServicioConsultaCreate(ServicioConsultaBase):
    # ... existentes ...

class ServicioConsultaUpdate(BaseModel):
    # ... existentes ...
    servicio_padre_id: Optional[int] = Field(None, gt=0)
    es_base: Optional[bool] = None

class ServicioConsultaResponse(ServicioConsultaBase):
    # ... existentes ...
    servicio_padre_id: Optional[int] = None
    es_base: bool = False
    
    # Computed fields para UI jerárquica
    @computed_field
    @property
    def es_item_adicional(self) -> bool:
        return not self.es_base
    
    @computed_field
    @property
    def items_adicionales_count(self) -> int:
        if not self.es_base:
            return 0
        # Requiere que items_adicionales venga cargado (selectinload)
        return len(getattr(self, 'items_adicionales', []) or [])
    
    @computed_field
    @property
    def subtotal_items_adicionales(self) -> float:
        if not self.es_base:
            return 0.0
        items = getattr(self, 'items_adicionales', []) or []
        return sum((i.cantidad or 0) * (i.precio_unitario or 0) for i in items if not i.is_deleted)
    
    @computed_field
    @property
    def subtotal_paquete(self) -> Optional[float]:
        if not self.es_base:
            return None
        base_subtotal = (self.cantidad or 0) * (self.precio_unitario or 0)
        return base_subtotal + self.subtotal_items_adicionales

    model_config = ConfigDict(from_attributes=True)
```

```python
class OrdenServicioAnexarServicio(BaseModel):
    # ... existentes ...
    servicio_padre_id: Optional[int] = Field(None, gt=0)
    es_base: bool = False
```

### 3. Service Layer (orden_service.py)

```python
def crear_servicio_en_orden(
    db: Session,
    orden: OrdenServicio,
    *,
    tipo_servicio: str,
    referencia_id: Optional[int],
    catalogo_servicio_id: Optional[int],
    nombre_servicio: Optional[str],
    cantidad: float,
    precio_unitario: float,
    detalles_clinicos: Optional[str],
    consumos_override,
    current_user: Usuario,
    veterinario_id: Optional[int] = None,
    servicio_padre_id: Optional[int] = None,      # NEW
    es_base: bool = False,                        # NEW
) -> tuple:
    # Validaciones de jerarquía
    if es_base and servicio_padre_id is not None:
        raise HTTPException(422, "Un servicio base (paquete) no puede tener padre")
    
    if servicio_padre_id is not None:
        padre = db.query(ServicioConsulta).filter(
            ServicioConsulta.id == servicio_padre_id,
            ServicioConsulta.is_deleted == False
        ).first()
        if not padre:
            raise HTTPException(404, "Servicio padre no encontrado")
        if not padre.es_base:
            raise HTTPException(422, "El servicio padre debe ser un paquete base (es_base=true)")
        if padre.orden_id != orden.id:
            raise HTTPException(422, "El servicio padre debe pertenecer a la misma orden")
        if padre.servicio_padre_id is not None:
            raise HTTPException(422, "No se permite anidación de más de un nivel (padre ya tiene padre)")
        
        # Heredar orden_id y mascota_id del padre si no se proveen
        # (el schema ya no los exige en OrdenServicioAnexarServicio)
    
    # ... resto de lógica existente ...
    
    servicio = ServicioConsulta(
        orden_id=orden.id,
        # ... otros campos ...
        servicio_padre_id=servicio_padre_id,
        es_base=es_base,
        estado="SOLICITADO" if not es_base or tipo_servicio != "CONSULTA" else "EJECUTADO",
        # Para CONSULTA base: aplicar atajo sin despacho
    )
    # ...
```

### 4. Router (routers/ordenes.py)

```python
@router.post("/{orden_id}/servicios", response_model=ServicioConsultaResponse, status_code=201)
def anexar_servicio_orden(
    orden_id: int,
    data: OrdenServicioAnexarServicio,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    orden = orden_service.obtener_orden(db, orden_id)
    orden_service.asegurar_recibe_trabajo(orden)
    
    # Validar tipo CONSULTA (existente)
    # ...
    
    servicio, advertencias = orden_service.crear_servicio_en_orden(
        db,
        orden,
        tipo_servicio=data.tipo_servicio,
        referencia_id=data.referencia_id,
        catalogo_servicio_id=data.catalogo_servicio_id,
        nombre_servicio=data.nombre_servicio,
        cantidad=data.cantidad,
        precio_unitario=data.precio_unitario,
        detalles_clinicos=data.detalles_clinicos,
        consumos_override=data.consumos,
        current_user=current_user,
        veterinario_id=data.veterinario_id,
        servicio_padre_id=data.servicio_padre_id,    # NEW
        es_base=data.es_base,                       # NEW
    )
    # ...
```

### 5. Frontend - orden-abierta.js

**En `pintarServicios()` (reemplazar lógica plana por agrupada):**

```javascript
function pintarServicios(orden) {
    const servicios = (orden.servicios || []).filter(s => !s.is_deleted);
    
    // Agrupar: bases con sus items
    const bases = servicios.filter(s => s.es_base);
    const itemsPorPadre = new Map();
    servicios.filter(s => !s.es_base && s.servicio_padre_id).forEach(s => {
        const arr = itemsPorPadre.get(s.servicio_padre_id) || [];
        arr.push(s);
        itemsPorPadre.set(s.servicio_padre_id, arr);
    });
    // Items sin padre ni base (servicios sueltos)
    const sueltos = servicios.filter(s => !s.es_base && !s.servicio_padre_id);
    
    let html = '';
    
    // Renderizar cada base + sus items
    bases.forEach(base => {
        const items = itemsPorPadre.get(base.id) || [];
        const subtotalBase = (base.cantidad || 0) * (base.precio_unitario || 0);
        const subtotalItems = items.reduce((sum, i) => sum + (i.cantidad || 0) * (i.precio_unitario || 0), 0);
        const subtotalPaquete = subtotalBase + subtotalItems;
        
        // Fila base
        html += renderFilaBase(base, subtotalPaquete, items.length);
        
        // Filas items (inicialmente ocultas si se quiere colapsable)
        items.forEach(item => {
            html += renderFilaItem(item);
        });
        
        // Fila subtotal paquete
        html += `<tr class="oa-paquete-subtotal"><td colspan="7" style="text-align:right; font-weight:600; padding:0.5rem 1rem; background:var(--surface-hover);">Subtotal paquete: ${money(subtotalPaquete)}</td></tr>`;
    });
    
    // Servicios sueltos
    sueltos.forEach(s => html += renderFilaServicio(s));
    
    body.innerHTML = html || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Sin servicios.</td></tr>';
}

function renderFilaBase(s, subtotalPaquete, itemsCount) {
    const area = s.area_nombre ? ` <span class="av-pill av-pill--neutral">${s.area_nombre === 'NINGUNO' ? 'Sin área' : escapeHtml(s.area_nombre)}</span>` : '';
    const vet = s.tipo_servicio === 'CONSULTA' && s.veterinario_nombre
        ? `<div style="font-size:12px; color:var(--text-secondary);">Veterinario: ${escapeHtml(s.veterinario_nombre)}</div>`
        : '';
    return `
    <tr class="oa-paquete-base" data-paquete-id="${s.id}">
        <td>
            <span class="oa-service-name" style="font-weight:600;">${escapeHtml(s.nombre_servicio || '—')}</span>
            <span class="av-pill av-pill--info" style="margin-left:6px; font-size:11px;">PAQUETE</span>
            ${vet}
        </td>
        <td><span class="av-pill av-pill--info">${escapeHtml(s.tipo_servicio || '—')}</span>${area}</td>
        <td class="num">${s.cantidad}</td>
        <td class="num" style="font-weight:500;">${money(s.precio_unitario)}</td>
        <td class="num" style="font-weight:500;">${money((s.cantidad || 0) * (s.precio_unitario || 0))}</td>
        <td><span class="av-pill ${ESTADO_PILL_SRV[s.estado] || 'av-pill--neutral'}">${ESTADO_LABEL_SRV[s.estado] || s.estado}</span></td>
        <td><span class="av-pill av-pill--neutral">${itemsCount} item${itemsCount === 1 ? '' : 's'}</span></td>
    </tr>`;
}

function renderFilaItem(s) {
    const area = s.area_nombre ? ` <span class="av-pill av-pill--neutral">${s.area_nombre === 'NINGUNO' ? 'Sin área' : escapeHtml(s.area_nombre)}</span>` : '';
    return `
    <tr class="oa-paquete-item" data-padre-id="${s.servicio_padre_id}" style="background:var(--surface);">
        <td style="padding-left:2.5rem;">
            <span style="color:var(--text-secondary);">└─ </span>
            <span class="oa-service-name">${escapeHtml(s.nombre_servicio || '—')}</span>
        </td>
        <td><span class="av-pill av-pill--neutral">${escapeHtml(s.tipo_servicio || '—')}</span>${area}</td>
        <td class="num">${s.cantidad}</td>
        <td class="num">${money(s.precio_unitario)}</td>
        <td class="num" style="font-weight:500;">${money((s.cantidad || 0) * (s.precio_unitario || 0))}</td>
        <td><span class="av-pill ${ESTADO_PILL_SRV[s.estado] || 'av-pill--neutral'}">${ESTADO_LABEL_SRV[s.estado] || s.estado}</span></td>
        <td></td>
    </tr>`;
}
```

**CSS adicional** (en static/css o inline style):
```css
.oa-paquete-base { background: var(--surface-hover); }
.oa-paquete-item:hover { background: var(--surface-hover); }
.oa-paquete-subtotal td { border-top: 2px solid var(--border); }
```

**Toggle colapso (opcional):**
```javascript
// En wire()
body.addEventListener('click', (e) => {
    const baseRow = e.target.closest('.oa-paquete-base');
    if (baseRow) {
        const paqueteId = baseRow.dataset.paqueteId;
        document.querySelectorAll(`.oa-paquete-item[data-padre-id="${paqueteId}"], .oa-paquete-subtotal[data-padre-id="${paqueteId}"]`).forEach(el => {
            el.style.display = el.style.display === 'none' ? '' : 'none';
        });
    }
});
```

### 6. Frontend - facturacion.js

En `abrirPreviewFactura()` y PDF: mismo patrón de agrupación. Reutilizar lógica de renderizado.

### 7. Migración Alembic

```bash
cd backend && alembic revision -m "add servicio_padre_id and es_base to servicios_consulta"
```

```python
def upgrade():
    op.add_column('servicios_consulta', sa.Column('servicio_padre_id', sa.Integer(), sa.ForeignKey('servicios_consulta.id', ondelete='SET NULL'), nullable=True, index=True))
    op.add_column('servicios_consulta', sa.Column('es_base', sa.Boolean(), nullable=False, server_default=sa.text('false'), default=False))
    
    # Constraints (opcional: validar en service layer para portabilidad)
    # op.create_check_constraint('ck_servicio_jerarquia', 'servicios_consulta', 
    #     "(es_base = true AND servicio_padre_id IS NULL) OR (es_base = false)")

def downgrade():
    op.drop_column('servicios_consulta', 'es_base')
    op.drop_column('servicios_consulta', 'servicio_padre_id')
```

### 8. Eager Loading en obtener_orden

En `orden_service.py::obtener_orden(con_asignados=True)`, agregar:
```python
.selectinload(OrdenServicio.servicios).selectinload(ServicioConsulta.items_adicionales)
```
Para que `items_adicionales_count` y `subtotal_items_adicionales` funcionen sin N+1.

## Risks / Trade-offs

- **CHECK constraints con subqueries**: Pueden ser lentos en inserts masivos. Alternativa: validar solo en service layer (más rápido, portable). Recomendación: service layer + constraints como safety net.
- **Eager loading items_adicionales**: Aumenta memoria en `obtener_orden(con_asignados=True)` (Panel del día). Mitigación: solo cargar cuando `con_asignados=True` (ya es así para asignados).
- **Total orden/factura**: No cambia — suma todos los servicios. El `subtotal_paquete` es solo para display.
- **Soft delete**: Si padre se borra (`is_deleted=true`), `servicio_padre_id` queda apuntando a fila borrada. FK `ondelete="SET NULL"` lo limpia automáticamente.
- **Precio base = 0**: Permitido. El paquete puede tener precio 0 y que el total sea solo suma de items. Validar en frontend que al menos base o items tengan precio > 0.