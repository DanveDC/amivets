# Design

## Context

**Backend actual:**
- `backend/app/routers/caja_rapida.py`: router con `prefix="/api/caja-rapida"`, `tags=["Caja rápida"]`, endpoints `/ventas` y `/items`
- `backend/app/services/caja_rapida_service.py`: lógica de negocio con `ORIGEN = "CAJA_RAPIDA"`, función `registrar_venta`, `buscar_items`
- `backend/app/schemas/schemas.py`: schemas `VentaRapidaItem`, `VentaRapidaCreate`, `ItemCajaResponse` (líneas 741-785)
- `backend/app/main.py`: import y `app.include_router(caja_rapida.router)` (líneas 16, 183)

**Frontend actual:**
- `static/js/sections/caja-rapida.js`: sección completa con endpoints `/caja-rapida/items` y `/caja-rapida/ventas`, IDs DOM con prefijo `caja`
- `static/js/core/router.js`: import `initCajaRapida`, section `sec-caja-rapida`, módulo 5 Facturación

**Tests actual:**
- `e2e/caja-rapida.spec.js`: tests de venta y búsqueda
- `e2e/helpers.js`: `cobrarCajaRapida`, `buscarItemsCajaRapida`

**Base de datos:**
- `OrdenServicio.origen` guarda `"CAJA_RAPIDA"` para estas ventas (columna `origen`, String(20), nullable)

## Goals / Non-Goals

**Goals:**
1. Renombrar archivos: `caja_rapida.py` → `servicio_directo.py`, `caja_rapida_service.py` → `servicio_directo_service.py`, `caja-rapida.js` → `servicio-directo.js`
2. Renombrar router: prefix `/api/servicio-directo`, tag `["Servicio directo"]`
3. Renombrar schemas: `VentaRapidaItem` → `VentaDirectaItem`, `VentaRapidaCreate` → `VentaDirectaCreate`, `ItemCajaResponse` → `ItemServicioDirectoResponse`
4. Mantener `ORIGEN = "CAJA_RAPIDA"`: solo cambian nombres y sección
5. Frontend: nueva sección, nuevos IDs DOM, nuevos endpoints
6. Tests E2E: renombrar archivo, helpers, URLs, selectores

**Non-Goals:**
- Cambiar lógica de negocio, validaciones, flujo de venta
- Cambiar estructura de BD (solo valor de `origen`)
- Cambiar roles permitidos (admin, recepcionista)
- Cambiar campo `tipo` en `VentaDirectaItem` (mantiene `PRODUCTO` | `SERVICIO`)

## Decisions

### 1. Archivos a renombrar (backend)

| Actual | Nuevo |
|--------|-------|
| `backend/app/routers/caja_rapida.py` | `backend/app/routers/servicio_directo.py` |
| `backend/app/services/caja_rapida_service.py` | `backend/app/services/servicio_directo_service.py` |

### 2. Router (`servicio_directo.py`)

```python
router = APIRouter(prefix="/api/servicio-directo", tags=["Servicio directo"])
_ROLES_SERVICIO_DIRECTO = ("admin", "recepcionista")

@router.post("/ventas", ...)
def registrar_venta_directa(...): ...

@router.get("/items", ...)
def buscar_items(...): ...
```

### 3. Servicio (`servicio_directo_service.py`)

```python
ORIGEN = "CAJA_RAPIDA"  # sin cambios

def registrar_venta_directa(db: Session, data: VentaDirectaCreate, usuario: Usuario) -> Factura:
    ...

def buscar_items(db: Session, q: Optional[str], limit: int = 30) -> List[dict]:
    ...
```

- Función principal renombrada a `registrar_venta_directa` para claridad
- Docstrings y comentarios: "servicio directo"
- Mensaje de error línea 150-152: "no en servicio directo"

### 3. Schemas (`schemas.py`)

```python
class VentaDirectaItem(BaseModel):
    tipo: Literal["PRODUCTO", "SERVICIO"]
    id: int = Field(..., gt=0)
    cantidad: int = Field(..., ge=1)
    precio_unitario: Optional[float] = None

class VentaDirectaCreate(BaseModel):
    propietario_id: Optional[int] = Field(None, gt=0)
    metodo_pago: Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MULTIPLE"]
    items: List[VentaDirectaItem] = Field(..., min_length=1)

class ItemServicioDirectoResponse(BaseModel):
    tipo: Literal["PRODUCTO", "SERVICIO"]
    id: int
    nombre: str
    codigo: Optional[str] = None
    precio: float
    precio_variable: bool = False
    stock: Optional[float] = None
```

### 4. Main (`main.py`)

```python
from app.routers import ..., servicio_directo
app.include_router(servicio_directo.router)
```

### 5. Frontend

**Archivo:** `static/js/sections/servicio-directo.js` (renombrado)

**Router (`static/js/core/router.js`):**
```javascript
import { initServicioDirecto } from '../sections/servicio-directo.js';

{ id: 'sec-servicio-directo', label: 'Servicio directo', tab: true, init: initServicioDirecto, roles: ['admin', 'recepcionista'] },

// Módulo 5 Facturación
{ num: 5, label: 'Facturación', sectionIds: ['sec-facturacion', 'sec-servicio-directo'] },
```

**IDs DOM en `servicio-directo.js`:**
- Todos los `getElementById('caja...')` → `getElementById('servicioDirecto...')`
- `data-caja-*` attributes → `data-servicio-directo-*` (o mantener `data-caja-*` para compatibilidad de selectores CSS; decisión: renombrar para consistencia)

**Endpoints en `servicio-directo.js`:**
- `fetchAPI('/servicio-directo/items?q=...')`
- `fetchAPI('/servicio-directo/ventas', ...)`

**Función export:** `initServicioDirecto`

### 6. Tests E2E

**Archivo:** `e2e/servicio-directo.spec.js`

**Helpers (`e2e/helpers.js`):**
```javascript
export async function cobrarServicioDirecto(page, items, metodoPago = 'EFECTIVO') {
  return request.post('/api/servicio-directo/ventas', { ... });
}

export async function buscarItemsServicioDirecto(page, q = '') {
  return request.get(`/api/servicio-directo/items?q=${encodeURIComponent(q)}&limit=100`);
}
```

### 7. Base de datos

- Valor `OrdenServicio.origen` se mantiene `"CAJA_RAPIDA"`. `facturacion_service` lo compara al anular una venta (devolver material, anular en vez de reabrir la orden); cambiarlo rompería esa lógica.

## Risks / Trade-offs

- **Breaking change API**: Clientes externos que usen `/api/caja-rapida/` recibirán 404. Documentar en changelog.
- **Frontend cache**: Usuarios con JS cacheado verán errores hasta refresh. Usar versioning o cache-busting.
- **Tests E2E**: Deben actualizarse antes de correr CI; renombrar archivo evita confusión.
- **Colisión de IDs DOM**: el modal de servicio directo (`hoy.js`) ya usa el prefijo `servicioDirecto`; el botón de cobro de la sección es `btnServicioDirectoEmitir` para no duplicar `btnServicioDirectoCobrar`.
- **Imports Python**: Cambiar `from app.routers import caja_rapida` → `from app.routers import servicio_directo` en `main.py` y cualquier test que importe el router.