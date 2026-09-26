from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator, field_serializer, computed_field, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime, date
from decimal import Decimal


# ========== PROPIETARIO SCHEMAS ==========
class PropietarioBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=100)
    apellido: str = Field(..., min_length=1, max_length=100)
    cedula: str = Field(..., min_length=5, max_length=20)
    telefono: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = None
    direccion: Optional[str] = None
    activo: bool = True


class PropietarioCreate(PropietarioBase):
    pass


class PropietarioUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=100)
    apellido: Optional[str] = Field(None, min_length=1, max_length=100)
    telefono: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = None
    direccion: Optional[str] = None
    activo: Optional[bool] = None


class PropietarioResponse(PropietarioBase):
    id: int
    fecha_registro: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ========== MASCOTA SCHEMAS ==========
class MascotaBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=100)
    especie: str = Field(..., min_length=1, max_length=50)
    raza: Optional[str] = Field(None, max_length=100)
    sexo: Optional[str] = Field(None, max_length=10)
    fecha_nacimiento: Optional[date] = None
    color: Optional[str] = Field(None, max_length=50)
    peso: Optional[float] = Field(None, gt=0)
    observaciones: Optional[str] = None
    foto_url: Optional[str] = None
    estado_reproductivo: Optional[str] = Field(None, max_length=50)
    microchip: Optional[str] = Field(None, max_length=50)
    activo: bool = True


class MascotaCreate(MascotaBase):
    propietario_id: int = Field(..., gt=0)


class MascotaUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=100)
    especie: Optional[str] = Field(None, min_length=1, max_length=50)
    raza: Optional[str] = Field(None, max_length=100)
    sexo: Optional[str] = Field(None, max_length=10)
    fecha_nacimiento: Optional[date] = None
    color: Optional[str] = Field(None, max_length=50)
    peso: Optional[float] = Field(None, gt=0)
    observaciones: Optional[str] = None
    foto_url: Optional[str] = None
    estado_reproductivo: Optional[str] = Field(None, max_length=50)
    microchip: Optional[str] = Field(None, max_length=50)
    activo: Optional[bool] = None


class MascotaResponse(MascotaBase):
    id: int
    propietario_id: int
    fecha_registro: datetime
    codigo_historia: Optional[str] = None

    @model_validator(mode='before')
    def append_apellido(cls, data):
        # Si es un objeto de base de datos (SQLAlchemy) con atributos
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                # Comprobar si tenemos el objeto propietario cargado
                propietario = getattr(data, 'propietario', None)
                if propietario and hasattr(propietario, 'apellido'):
                    base_name = data.nombre.split(' ')[0]
                    # Solo modificamos el nombre para el esquema de respuesta
                    # NOTA: Esto altera el objeto si está en sesión, pero es aceptable para este flujo SPA
                    data.nombre = f"{base_name} {propietario.apellido}"
            except Exception:
                pass
        return data
    
    model_config = ConfigDict(from_attributes=True)


class MascotaTransfer(BaseModel):
    nuevo_propietario_id: int
    motivo: str


# ========== CONSULTA SCHEMAS ==========
class ConsultaBase(BaseModel):
    motivo: Optional[str] = None
    sintomas: Optional[str] = None
    diagnostico: Optional[str] = None
    tratamiento: Optional[str] = None
    peso: Optional[float] = Field(None)
    temperatura: Optional[float] = Field(None)
    frecuencia_cardiaca: Optional[float] = Field(None)
    observaciones: Optional[str] = None
    veterinario: Optional[str] = Field(None, max_length=100)
    veterinario_id: Optional[int] = Field(None, gt=0)
    fecha_consulta: Optional[datetime] = None
    proxima_cita: Optional[datetime] = None
    estado_pago: Optional[str] = "POR_COBRAR"
    precio_consulta: Optional[float] = 0.0
    # Ciclo de vida clinico (Tarea 09, decision 6): ABIERTA / CERRADA / ANULADA.
    # La respuesta siempre lo trae; crear_consulta lo fuerza a 'ABIERTA'.
    estado: Optional[str] = Field(None, max_length=20)

    @field_validator('temperatura')
    @classmethod
    def validar_temperatura(cls, v):
        # Desactivando esta falla estricta para evitar bloqueos por historial de datos
        return v

    @field_validator('frecuencia_cardiaca')
    @classmethod
    def validar_frecuencia(cls, v):
        # Desactivando esta falla estricta para evitar bloqueos por historial de datos
        return v


class ConsultaCreate(ConsultaBase):
    mascota_id: int = Field(..., gt=0)
    # Requerido desde ahora: una consulta sin veterinario asignado queda
    # impagable en Liquidaciones (Unidad E), ver decision de Daniel.
    veterinario_id: int = Field(..., gt=0)
    # Obligatorio desde Tarea 06 (decision 3): toda consulta nace DENTRO de una
    # orden. El backend le anexa a esa orden la linea tipo_servicio='CONSULTA'
    # que representa el honorario, y pasa la orden a EN_ATENCION.
    orden_id: int = Field(..., gt=0)


class ConsultaUpdate(BaseModel):
    motivo: Optional[str] = Field(None, min_length=1, max_length=255)
    sintomas: Optional[str] = None
    diagnostico: Optional[str] = None
    tratamiento: Optional[str] = None
    peso: Optional[float] = Field(None, gt=0)
    temperatura: Optional[float] = Field(None, gt=0, lt=50)
    frecuencia_cardiaca: Optional[float] = Field(None, gt=0)
    observaciones: Optional[str] = None
    veterinario: Optional[str] = Field(None, max_length=100)
    veterinario_id: Optional[int] = Field(None, gt=0)
    proxima_cita: Optional[datetime] = None
    estado_pago: Optional[str] = None
    precio_consulta: Optional[float] = None
    # Tarea 09, decision 6: el veterinario puede cerrar/reabrir la consulta.
    estado: Optional[str] = Field(None, max_length=20)


class ConsumoMaterialOverride(BaseModel):
    """Ajuste real de consumo por linea al aplicar un servicio (Tarea 07, decision 6).

    Sobreescribe la cantidad de la receta para ese material. Las lineas de
    receta sin override usan la cantidad estandar de la receta.
    """
    inventario_id: int = Field(..., gt=0)
    cantidad: Decimal = Field(..., gt=0)


class ServicioConsultaBase(BaseModel):
    # Tarea 09, decision 1: opcional. Un servicio directo llega con mascota_id y
    # consulta_id = None; un servicio anexado a una consulta, al reves. El CHECK
    # de la DB exige que haya al menos uno.
    consulta_id: Optional[int] = None
    mascota_id: Optional[int] = None
    # Tarea 06 (decisión 1 y 3): la orden a la que cuelga el servicio. Opcional
    # en el schema porque este mismo modelo lo usa POST /api/consultas/{id}/
    # servicios, donde el backend lo DERIVA de la consulta (nunca lo acepta del
    # cliente); crear_servicio_directo (POST /api/servicios/, sin consulta) en
    # cambio lo exige a nivel de endpoint -- mismo criterio que ya usa acá
    # mascota_id, que tampoco es NOT NULL en el schema.
    orden_id: Optional[int] = Field(None, gt=0)
    tipo_servicio: Optional[str] = Field(None, max_length=50)
    referencia_id: Optional[int] = None
    catalogo_servicio_id: Optional[int] = Field(None, gt=0)
    nombre_servicio: Optional[str] = Field(None, max_length=255)
    cantidad: Optional[float] = Field(default=1.0)
    precio_unitario: Optional[float] = Field(default=0.0)
    estado: Optional[str] = Field(default="SOLICITADO", max_length=50)
    detalles_clinicos: Optional[str] = None
    is_deleted: Optional[bool] = False

class ServicioConsultaCreate(ServicioConsultaBase):
    # Overrides opcionales de consumo real por material (Decision 6). Solo se
    # aplican si el servicio entra en un estado consumido (EJECUTADO/FACTURADO).
    consumos: Optional[List[ConsumoMaterialOverride]] = None

class ServicioConsultaUpdate(BaseModel):
    cantidad: Optional[float] = Field(None, gt=0)
    precio_unitario: Optional[float] = Field(None, ge=0)
    estado: Optional[str] = Field(None, max_length=50)
    detalles_clinicos: Optional[str] = None
    is_deleted: Optional[bool] = None
    catalogo_servicio_id: Optional[int] = Field(None, gt=0)
    consumos: Optional[List[ConsumoMaterialOverride]] = None

class ServicioConsultaResponse(ServicioConsultaBase):
    id: int
    # orden_id ya está en ServicioConsultaBase (Tarea 06, decisión 3): acá solo
    # se documenta que en la RESPUESTA es de solo lectura -- el cliente no
    # elige la orden de un servicio anexado a una consulta, la fija el backend
    # desde la línea CONSULTA (orden_de_consulta). crear_servicio_directo es la
    # única excepción: ahí sí lo exige del cliente (ver ServicioConsultaBase).
    # Fecha del servicio para la historia unificada del paciente (Tarea 09).
    created_at: Optional[datetime] = None
    # Ya facturado sí/no — para el timeline de la ficha (el endpoint ya filtra
    # por ?facturado=, faltaba exponerlo por fila).
    facturado: Optional[bool] = None
    # Área que ejecuta el servicio (snapshot al anexar). La bandeja del
    # encargado lo usa para agrupar por rubro sin adivinarlo por el catálogo
    # (pantalla-encargado, decisión 3).
    area_id: Optional[int] = None
    # Advertencias de stock al aplicar (Decision 4): faltantes que se
    # permitieron y registraron igual. None salvo en la respuesta del POST/PATCH
    # que dispara el consumo.
    advertencias: Optional[List[dict]] = None
    model_config = ConfigDict(from_attributes=True)


class ConsultaResponse(ConsultaBase):
    id: int
    mascota_id: int
    servicios: List[ServicioConsultaResponse] = []
    factura_id: Optional[int] = None
    # Derivado de la línea tipo_servicio='CONSULTA' de `servicios` (Tarea 06,
    # decisión 3: `consultas` NO tiene columna orden_id a propósito, sería una
    # segunda fuente de verdad -- orden_service.orden_de_consulta es la fuente
    # real). orden-servicio-carrito, decisión 10: se expone acá para que
    # Historia clínica pueda armar "Ir a la orden" sin buscarlo a mano en
    # `servicios[]`. No agrega una query nueva: `servicios` ya se carga para
    # este mismo response.
    orden_id: Optional[int] = None

    @model_validator(mode='before')
    def _derivar_orden_id(cls, data):
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                linea = next(
                    (
                        s for s in (getattr(data, 'servicios', None) or [])
                        if getattr(s, 'tipo_servicio', None) == 'CONSULTA' and not getattr(s, 'is_deleted', False)
                    ),
                    None,
                )
                if linea is not None:
                    data.orden_id = linea.orden_id
            except Exception:
                pass
        return data

    model_config = ConfigDict(from_attributes=True)

# ========== RECETA SCHEMAS ==========
class DetalleRecetaBase(BaseModel):
    medicamento_id: int = Field(..., gt=0)
    dosis: str = Field(..., min_length=1, max_length=100)
    frecuencia: str = Field(..., min_length=1, max_length=100)
    duracion: str = Field(..., min_length=1, max_length=100)

class DetalleRecetaCreate(DetalleRecetaBase):
    pass

class DetalleRecetaResponse(DetalleRecetaBase):
    id: int
    receta_id: int
    # Podriamos querer retornar mas detalles del inventario (nombre_medicamento, etc.)
    # pero mantendremos simple para schema base.

    model_config = ConfigDict(from_attributes=True)

class RecetaBase(BaseModel):
    indicaciones_generales: Optional[str] = None

class RecetaCreate(RecetaBase):
    consulta_id: int = Field(..., gt=0)
    detalles: List[DetalleRecetaCreate] = Field(..., min_length=1)

class RecetaResponse(RecetaBase):
    id: int
    consulta_id: int
    fecha_emision: datetime
    detalles: List[DetalleRecetaResponse] = []

    model_config = ConfigDict(from_attributes=True)


# ========== CITA SCHEMAS ==========
class CitaBase(BaseModel):
    fecha_cita: datetime
    hora_llegada: Optional[datetime] = None
    hora_inicio_atencion: Optional[datetime] = None
    hora_fin_atencion: Optional[datetime] = None
    tipo: str = Field(..., min_length=1, max_length=50)
    observaciones: Optional[str] = None


class CitaCreate(CitaBase):
    veterinario_id: int = Field(..., gt=0)
    propietario_id: int = Field(..., gt=0)
    mascota_id: int = Field(..., gt=0)


class CitaUpdate(BaseModel):
    fecha_cita: Optional[datetime] = None
    tipo: Optional[str] = Field(None, min_length=1, max_length=50)
    estado: Optional[str] = Field(None, max_length=50)
    observaciones: Optional[str] = None


class CitaStatusUpdate(BaseModel):
    estado: str = Field(..., max_length=50)


class CitaResponse(CitaBase):
    id: int
    veterinario_id: int
    propietario_id: int
    mascota_id: int
    estado: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ========== PRUEBA COMPLEMENTARIA SCHEMAS ==========
class PruebaComplementariaBase(BaseModel):
    tipo: str = Field(..., min_length=1, max_length=50)
    archivo_url: Optional[str] = None
    resultado: Optional[str] = None
    observaciones: Optional[str] = None
    precio_aplicado: float = Field(0.0, ge=0)
    facturado: bool = False
    estado_orden: Optional[str] = "Pendiente"


class PruebaComplementariaCreate(PruebaComplementariaBase):
    mascota_id: int = Field(..., gt=0)
    consulta_id: Optional[int] = None


class PruebaComplementariaUpdate(BaseModel):
    tipo: Optional[str] = Field(None, min_length=1, max_length=50)
    archivo_url: Optional[str] = None
    resultado: Optional[str] = None
    observaciones: Optional[str] = None


class PruebaComplementariaResponse(PruebaComplementariaBase):
    id: int
    mascota_id: int
    consulta_id: Optional[int]
    fecha: datetime

    model_config = ConfigDict(from_attributes=True)


# ========== INVENTARIO SCHEMAS ==========
# Conjuntos cerrados del inventario fraccionado (Tarea 07). Se validan aca en
# vez de dejar texto libre como el `categoria` heredado.
TIPOS_ITEM_VALIDOS = {"MATERIAL", "PRODUCTO"}
UNIDADES_MEDIDA_VALIDAS = {"ml", "g", "unidad"}


class InventarioBase(BaseModel):
    codigo: str = Field(..., min_length=1, max_length=50)
    nombre: str = Field(..., min_length=1, max_length=200)
    descripcion: Optional[str] = None
    categoria: Optional[str] = Field(None, max_length=50)
    precio_unitario: float = Field(..., ge=0)
    # Decimal (no int): el stock ya vive en unidad base y admite fracciones
    # (Tarea 07, decision 2). ge=0 se mantiene como en el esquema heredado.
    stock_actual: Decimal = Field(default=Decimal("0"), ge=0, description="El stock jamás puede ser negativo")
    stock_minimo: Decimal = Field(default=Decimal("5"), ge=0)
    fecha_vencimiento: Optional[date] = None
    proveedor: Optional[str] = Field(None, max_length=200)
    ubicacion: Optional[str] = Field(None, max_length=100)
    # --- Inventario fraccionado (Tarea 07, slice A) ---
    tipo_item: Optional[str] = Field(default="PRODUCTO", max_length=12, description="MATERIAL | PRODUCTO")
    unidad_medida: Optional[str] = Field(None, max_length=12, description="ml | g | unidad; NULL = unidad sin definir")
    contenido_por_envase: Optional[Decimal] = Field(None, ge=0)
    merma_al_abrir: Optional[bool] = False
    activo: bool = True

    @field_validator('precio_unitario')
    @classmethod
    def validar_precio_positivo(cls, v):
        if v < 0:
            raise ValueError('El precio no puede ser negativo')
        return v

    @field_validator('tipo_item')
    @classmethod
    def validar_tipo_item(cls, v):
        if v is not None and v not in TIPOS_ITEM_VALIDOS:
            raise ValueError(f"tipo_item invalido. Usar uno de: {', '.join(sorted(TIPOS_ITEM_VALIDOS))}")
        return v

    @field_validator('unidad_medida')
    @classmethod
    def validar_unidad_medida(cls, v):
        if v is not None and v not in UNIDADES_MEDIDA_VALIDAS:
            raise ValueError(f"unidad_medida invalida. Usar una de: {', '.join(sorted(UNIDADES_MEDIDA_VALIDAS))}")
        return v

    # El stock se guarda y opera como Decimal, pero en el JSON de respuesta se
    # emite como numero (no string) para no romper a los consumidores que
    # esperan `stock_actual` numerico (e2e inventario / gestion-inventario).
    # Solo afecta la serializacion JSON; model_dump() sigue devolviendo Decimal.
    @field_serializer('stock_actual', 'stock_minimo', 'contenido_por_envase', when_used='json')
    def _serializar_decimales(self, v):
        return float(v) if v is not None else None


class InventarioCreate(InventarioBase):
    pass


class InventarioUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=200)
    descripcion: Optional[str] = None
    categoria: Optional[str] = Field(None, max_length=50)
    precio_unitario: Optional[float] = Field(None, ge=0)
    stock_actual: Optional[Decimal] = Field(None, ge=0)
    stock_minimo: Optional[Decimal] = Field(None, ge=0)
    fecha_vencimiento: Optional[date] = None
    proveedor: Optional[str] = Field(None, max_length=200)
    ubicacion: Optional[str] = Field(None, max_length=100)
    tipo_item: Optional[str] = Field(None, max_length=12)
    unidad_medida: Optional[str] = Field(None, max_length=12)
    contenido_por_envase: Optional[Decimal] = Field(None, ge=0)
    merma_al_abrir: Optional[bool] = None
    activo: Optional[bool] = None
    # Motivo opcional del cambio de precio (Tarea 08). No es una columna de
    # inventario: el router lo saca del loop generico y lo pasa a
    # registrar_cambio_precio(). exclude=True lo mantiene fuera de model_dump().
    motivo: Optional[str] = Field(None, max_length=200, exclude=True)

    @field_validator('tipo_item')
    @classmethod
    def validar_tipo_item(cls, v):
        if v is not None and v not in TIPOS_ITEM_VALIDOS:
            raise ValueError(f"tipo_item invalido. Usar uno de: {', '.join(sorted(TIPOS_ITEM_VALIDOS))}")
        return v

    @field_validator('unidad_medida')
    @classmethod
    def validar_unidad_medida(cls, v):
        if v is not None and v not in UNIDADES_MEDIDA_VALIDAS:
            raise ValueError(f"unidad_medida invalida. Usar una de: {', '.join(sorted(UNIDADES_MEDIDA_VALIDAS))}")
        return v


class InventarioResponse(InventarioBase):
    id: int
    fecha_registro: datetime
    # Consumir un material al aplicar un servicio puede dejar el stock en
    # negativo (Tarea 07, decision 4: se permite, se avisa y se registra). El
    # ge=0 de InventarioBase sigue validando el INPUT de alta/edicion, pero la
    # LECTURA no debe fallar cuando el stock quedo negativo.
    stock_actual: Decimal

    model_config = ConfigDict(from_attributes=True)


class MovimientoInventarioResponse(BaseModel):
    """Lectura del ledger de inventario. Hoy nada lo consume; slice B lo usa
    para el guard anti-doble-descuento y la trazabilidad movimiento -> consulta."""
    id: int
    producto_id: int
    tipo_movimiento: str
    cantidad: Decimal
    costo_unitario: float
    lote: Optional[str] = None
    origen_destino: Optional[str] = None
    fecha_registro: datetime
    usuario_responsable_id: Optional[int] = None
    servicio_consulta_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class HistorialPrecioRead(BaseModel):
    """Una fila del historial de precios de lista (Tarea 08), para materiales y
    servicios (misma forma para los dos, decision 2).

    variacion_abs / variacion_pct se derivan de precio_anterior y quedan en None
    cuando no hay con que compararlas: registro inicial de migracion
    (precio_anterior IS NULL) o precio_anterior = 0 para el porcentaje.
    """
    id: int
    precio_nuevo: Decimal
    precio_anterior: Optional[Decimal] = None
    motivo: Optional[str] = None
    usuario_id: Optional[int] = None
    corrige_id: Optional[int] = None
    fecha_cambio: datetime

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def variacion_abs(self) -> Optional[float]:
        if self.precio_anterior is None:
            return None
        return float((self.precio_nuevo - self.precio_anterior).quantize(Decimal("0.01")))

    @computed_field
    @property
    def variacion_pct(self) -> Optional[float]:
        if self.precio_anterior is None or self.precio_anterior == 0:
            return None
        pct = (self.precio_nuevo - self.precio_anterior) / self.precio_anterior * Decimal("100")
        return float(pct.quantize(Decimal("0.01")))

    # Coherente con InventarioBase: los Decimal se emiten como numero (no string)
    # en el JSON de respuesta. model_dump() sigue devolviendo Decimal.
    @field_serializer('precio_nuevo', 'precio_anterior', when_used='json')
    def _serializar_decimales(self, v):
        return float(v) if v is not None else None


# ========== FACTURA SCHEMAS ==========
class DetalleFacturaBase(BaseModel):
    producto_id: Optional[int] = None
    cantidad: Optional[int] = Field(default=0)
    precio_unitario: Optional[float] = Field(default=0.0)
    descripcion: Optional[str] = Field(None, max_length=255)
    
    @field_validator('precio_unitario', mode='before')
    @classmethod
    def validar_precio_positivo(cls, v):
        if v is None:
            return 0.0
        return v


class DetalleFacturaCreate(DetalleFacturaBase):
    servicio_id: Optional[int] = None


class DetalleFacturaResponse(DetalleFacturaBase):
    id: int
    factura_id: int
    subtotal: float
    servicio_id: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)


class FacturaBase(BaseModel):
    propietario_id: int = Field(..., gt=0)
    es_presupuesto: Optional[bool] = False
    descuento: Optional[float] = Field(default=0.0)
    impuesto: Optional[float] = Field(default=0.0)
    metodo_pago: Optional[str] = Field(None, max_length=50)
    total_pagado: Optional[float] = Field(default=0.0)
    saldo_pendiente: Optional[float] = Field(default=0.0)
    observaciones: Optional[str] = None
    consulta_id: Optional[int] = None

    @model_validator(mode='after')
    def validar_pagos(self) -> 'FacturaBase':
        # En una factura real, el total se calcula después, 
        # pero para presupuestos o pagos parciales validamos que no paguen de más aquí
        # aunque el saldo pendiente se calcula en el servidor.
        return self


class FacturaCreate(FacturaBase):
    detalles: List[DetalleFacturaCreate] = Field(..., min_length=1)


class FacturaDesdeConsulta(BaseModel):
    """Body opcional de POST /api/facturas/from-consulta/{id} (Tarea 09, decision 8).

    El servidor arma los detalles desde consulta.servicios + el honorario; el
    cliente solo pasa datos de cobro. Todo opcional: sin body se emite una
    factura PENDIENTE por el total.
    """
    metodo_pago: Optional[str] = Field(None, max_length=50)
    total_pagado: Optional[float] = Field(default=0.0)
    descuento: Optional[float] = Field(default=0.0)
    impuesto: Optional[float] = Field(default=0.0)


class OrdenFacturarBody(BaseModel):
    """Body opcional de POST /api/ordenes/{id}/facturar (orden-servicio-carrito,
    decisión 6). Misma forma que FacturaDesdeConsulta -- el servidor arma los
    detalles desde los servicios sin facturar de la orden; el cliente solo
    manda datos de cobro. Todo opcional: sin body se emite una factura
    PENDIENTE por el total.
    """
    metodo_pago: Optional[str] = Field(None, max_length=50)
    total_pagado: Optional[float] = Field(default=0.0)
    descuento: Optional[float] = Field(default=0.0)
    impuesto: Optional[float] = Field(default=0.0)


# ========== CAJA RÁPIDA SCHEMAS (caja-rapida) ==========
class VentaRapidaItem(BaseModel):
    """Una línea de la venta de mostrador. `id` es un Inventario.id (PRODUCTO)
    o un CatalogoServicio.id (SERVICIO). `precio_unitario` solo se usa en
    servicios de precio variable (decisión 5): el resto se cobra al precio del
    maestro, venga lo que venga del cliente."""
    tipo: Literal["PRODUCTO", "SERVICIO"]
    id: int = Field(..., gt=0)
    cantidad: int = Field(..., ge=1)
    precio_unitario: Optional[float] = None


class VentaRapidaCreate(BaseModel):
    """Body de POST /api/caja-rapida/ventas. Sin `propietario_id` se factura a
    "Consumidor final" (decisión 1). Cobro completo obligatorio (decisión 6)."""
    propietario_id: Optional[int] = Field(None, gt=0)
    metodo_pago: Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MULTIPLE"]
    items: List[VentaRapidaItem] = Field(..., min_length=1)


class ServicioRealizadoResponse(BaseModel):
    """Un servicio que el usuario tomó y ejecutó (pantalla-encargado,
    decisión 4), con los nombres ya resueltos para la vista "Realizados"."""
    id: int
    nombre_servicio: Optional[str] = None
    area_id: Optional[int] = None
    area_nombre: Optional[str] = None
    mascota_nombre: Optional[str] = None
    orden_id: Optional[int] = None
    orden_numero: Optional[str] = None
    ejecutado_at: Optional[datetime] = None
    detalles_clinicos: Optional[str] = None
    adjuntos: int = 0


class ItemCajaResponse(BaseModel):
    """Resultado de GET /api/caja-rapida/items: productos y servicios
    vendibles en un solo listado."""
    tipo: Literal["PRODUCTO", "SERVICIO"]
    id: int
    nombre: str
    codigo: Optional[str] = None
    precio: float
    precio_variable: bool = False
    stock: Optional[float] = None


class FacturaUpdate(BaseModel):
    estado: Optional[str] = Field(None, max_length=20)
    metodo_pago: Optional[str] = Field(None, max_length=50)
    observaciones: Optional[str] = None


class FacturaResponse(FacturaBase):
    id: int
    numero_factura: Optional[str] = None
    fecha_emision: Optional[datetime] = None
    es_presupuesto: Optional[bool] = False
    subtotal: Optional[float] = 0.0
    total: Optional[float] = 0.0
    estado: Optional[str] = "PENDIENTE"
    detalles: List[DetalleFacturaResponse] = []
    consulta_id: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)


# ========== AUTH SCHEMAS ==========
class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: Optional[str] = None


class UsuarioBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    role: Optional[str] = "user"


class UsuarioCreate(UsuarioBase):
    password: str = Field(..., min_length=4)


class UsuarioResponse(UsuarioBase):
    id: int
    is_active: bool
    
    model_config = ConfigDict(from_attributes=True)


class UsuarioUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordUpdate(BaseModel):
    current_password: str = Field(..., min_length=4)
    new_password: str = Field(..., min_length=4)


# ========== NUEVOS MÓDULOS PROFESIONALES ==========

class HospitalizacionBase(BaseModel):
    mascota_id: int
    consulta_id: Optional[int] = None
    motivo: str
    estado_paciente: Optional[str] = None
    jaula_nro: Optional[str] = None
    dias_cama: int = Field(default=1, ge=1)
    fecha_ingreso: Optional[datetime] = None
    fecha_egreso: Optional[datetime] = None
    monitoreo_constantes: Optional[dict] = None
    observaciones_ingreso: Optional[str] = None
    precio_aplicado: float = Field(0.0, ge=0)
    facturado: bool = False

class HospitalizacionCreate(HospitalizacionBase):
    pass

class HospitalizacionResponse(HospitalizacionBase):
    id: int
    activo: bool
    model_config = ConfigDict(from_attributes=True)

class CirugiaBase(BaseModel):
    mascota_id: int
    consulta_id: Optional[int] = None
    tipo_procedimiento: str
    cirujano_id: Optional[int] = None
    informe_quirurgico: Optional[str] = None
    complicaciones: Optional[str] = None
    riesgo_asa: Optional[str] = None
    honorarios_medicos: float = Field(0.0, ge=0)
    costo_anestesia: float = Field(0.0, ge=0)
    costo_insumos: float = Field(0.0, ge=0)
    precio_aplicado: float = Field(0.0, ge=0)
    facturado: bool = False

class CirugiaCreate(CirugiaBase):
    pass

class CirugiaResponse(CirugiaBase):
    id: int
    fecha_cirugia: datetime
    model_config = ConfigDict(from_attributes=True)

class VacunacionBase(BaseModel):
    consulta_id: int = Field(..., gt=0)
    vacuna_id: int = Field(..., gt=0)
    lote: Optional[str] = None
    fecha_refuerzo: Optional[datetime] = None
    precio_aplicado: float = Field(0.0, ge=0)
    facturado: bool = False

class VacunacionCreate(VacunacionBase):
    pass

class VacunacionResponse(VacunacionBase):
    id: int
    fecha_aplicacion: datetime
    model_config = ConfigDict(from_attributes=True)

class DesparasitacionBase(BaseModel):
    consulta_id: int = Field(..., gt=0)
    tipo: str = Field(..., min_length=1, max_length=50)
    producto_id: int = Field(..., gt=0)
    dosis: str = Field(..., min_length=1, max_length=100)
    precio_aplicado: float = Field(0.0, ge=0)
    facturado: bool = False

class DesparasitacionCreate(DesparasitacionBase):
    pass

class DesparasitacionResponse(DesparasitacionBase):
    id: int
    fecha_aplicacion: datetime
    model_config = ConfigDict(from_attributes=True)

class PlanSaludBase(BaseModel):
    mascota_id: int
    tipo_preventivo: str # VACUNA, DESPARASITACION
    nombre_producto: str
    fecha_aplicacion: date
    fecha_proxima_refuerzo: Optional[date] = None
    lote: Optional[str] = None
    observaciones: Optional[str] = None

class PlanSaludCreate(PlanSaludBase):
    pass

class PlanSaludResponse(PlanSaludBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# ========== RECETA DE SERVICIO SCHEMAS (Tarea 07, slice A) ==========
class RecetaServicioBase(BaseModel):
    inventario_id: int = Field(..., gt=0)
    cantidad: Decimal = Field(..., gt=0)
    unidad_medida: str = Field(..., min_length=1, max_length=12, description="ml | g | unidad")

    @field_validator('unidad_medida')
    @classmethod
    def validar_unidad_medida(cls, v):
        if v not in UNIDADES_MEDIDA_VALIDAS:
            raise ValueError(f"unidad_medida invalida. Usar una de: {', '.join(sorted(UNIDADES_MEDIDA_VALIDAS))}")
        return v


class RecetaServicioCreate(RecetaServicioBase):
    pass


class RecetaServicioUpdate(BaseModel):
    cantidad: Optional[Decimal] = Field(None, gt=0)
    unidad_medida: Optional[str] = Field(None, min_length=1, max_length=12)

    @field_validator('unidad_medida')
    @classmethod
    def validar_unidad_medida(cls, v):
        if v is not None and v not in UNIDADES_MEDIDA_VALIDAS:
            raise ValueError(f"unidad_medida invalida. Usar una de: {', '.join(sorted(UNIDADES_MEDIDA_VALIDAS))}")
        return v


class RecetaServicioResponse(RecetaServicioBase):
    id: int
    catalogo_servicio_id: int
    inventario_nombre: Optional[str] = None
    created_at: datetime

    @model_validator(mode='before')
    def _adjuntar_nombre_inventario(cls, data):
        # Mismo criterio que NotaClinicaResponse._adjuntar_nombres: si es un
        # objeto ORM con la relacion cargada, resolvemos el nombre del material
        # aca para que el frontend no pida /inventario aparte solo para eso.
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                if getattr(data, 'inventario', None):
                    data.inventario_nombre = data.inventario.nombre
            except Exception:
                pass
        return data

    @field_serializer('cantidad', when_used='json')
    def _serializar_cantidad(self, v):
        return float(v) if v is not None else None

    model_config = ConfigDict(from_attributes=True)


# ========== CATALOGO SERVICIO SCHEMAS ==========
class CatalogoServicioBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    categoria: str = Field(..., min_length=1, max_length=100)
    precio_ref: float = Field(0.0, ge=0)
    precio_variable: bool = False
    unidad: Optional[str] = Field(None, max_length=100)
    activo: bool = True


class CatalogoServicioCreate(CatalogoServicioBase):
    # Despacho y adjuntos (Tarea 06, decisiones 5 y 7, etapa 5). area_id=None
    # es el atajo sin despacho (decisión 4); requiere_adjunto=None hereda del
    # área. Ambos campos son admin-only (fila 23 de la matriz) -- el router
    # valida el rol igual que ya hace con precio_ref.
    area_id: Optional[int] = Field(None, gt=0)
    requiere_adjunto: Optional[bool] = None


class CatalogoServicioUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=255)
    categoria: Optional[str] = Field(None, min_length=1, max_length=100)
    precio_ref: Optional[float] = Field(None, ge=0)
    precio_variable: Optional[bool] = None
    unidad: Optional[str] = Field(None, max_length=100)
    activo: Optional[bool] = None
    # Motivo opcional del cambio de precio (Tarea 08). No es una columna: el
    # router lo saca del loop generico y lo pasa a registrar_cambio_precio().
    motivo: Optional[str] = Field(None, max_length=200, exclude=True)
    # Despacho y adjuntos (etapa 5, ver CatalogoServicioCreate). gt=0 en vez de
    # nullable directo porque "sin área" se expresa mandando area_id=None
    # explícito o simplemente no mandando el campo (exclude_unset lo respeta).
    area_id: Optional[int] = Field(None, gt=0)
    requiere_adjunto: Optional[bool] = None


class CatalogoServicioResponse(CatalogoServicioBase):
    id: int
    created_at: datetime
    area_id: Optional[int] = None
    requiere_adjunto: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


# ========== ABONO SCHEMAS ==========
class AbonoCreate(BaseModel):
    monto: Decimal
    metodo_pago: str
    notas: Optional[str] = None


class AbonoResponse(BaseModel):
    id: int
    numero_abono: Optional[str] = None
    factura_id: int
    monto: Decimal
    metodo_pago: str
    fecha: datetime
    notas: Optional[str] = None


# ========== LIQUIDACIONES A VETERINARIOS (Unidad E) ==========
class TarifaConsultaUpdate(BaseModel):
    tarifa_consulta: Optional[Decimal] = Field(None, ge=0)


class TarifaConsultaResponse(BaseModel):
    id: int
    username: str
    tarifa_consulta: Optional[Decimal] = None

    model_config = ConfigDict(from_attributes=True)


class LiquidacionCalculoRequest(BaseModel):
    veterinario_id: int = Field(..., gt=0)
    fecha_inicio: str = Field(..., description="YYYY-MM-DD")
    fecha_fin: str = Field(..., description="YYYY-MM-DD")


class LiquidacionPreviewItem(BaseModel):
    consulta_id: int
    factura_id: int
    fecha_consulta: datetime
    tarifa_aplicada: Decimal


class LiquidacionPreviewResponse(BaseModel):
    veterinario_id: int
    veterinario: str
    fecha_inicio: str
    fecha_fin: str
    tarifa_consulta: Decimal
    total_consultas: int
    total: Decimal
    consultas: List[LiquidacionPreviewItem]


class LiquidacionDetalleResponse(BaseModel):
    id: int
    consulta_id: int
    factura_id: int
    tarifa_aplicada: Decimal
    fecha_consulta: datetime

    model_config = ConfigDict(from_attributes=True)


class LiquidacionResponse(BaseModel):
    id: int
    veterinario_id: int
    fecha_inicio: datetime
    fecha_fin: datetime
    fecha_calculo: datetime
    total: Decimal
    detalles: List[LiquidacionDetalleResponse] = []


# ========== COMISIONES POR SERVICIO (comisiones-por-servicio) ==========
class ConfiguracionComisionUpdate(BaseModel):
    porcentaje_defecto: Decimal = Field(..., ge=0, le=100)


class ConfiguracionComisionResponse(BaseModel):
    porcentaje_defecto: Decimal
    updated_at: Optional[datetime] = None


class PorcentajeEncargadoUpdate(BaseModel):
    """`porcentaje` null quita el porcentaje propio: el encargado vuelve al
    de defecto. Es obligatorio mandarlo (aunque sea null)."""
    porcentaje: Optional[Decimal] = Field(..., ge=0, le=100)


class EncargadoComisionResponse(BaseModel):
    usuario_id: int
    username: str
    role: Optional[str] = None
    porcentaje_propio: Optional[Decimal] = None
    porcentaje_efectivo: Decimal


class ComisionLineaResponse(BaseModel):
    """Una línea del control de comisiones: pendiente (calculada con el
    porcentaje actual) o liquidada (con el porcentaje congelado)."""
    servicio_id: int
    factura_id: int
    orden_id: Optional[int] = None
    orden_numero: Optional[str] = None
    numero_factura: Optional[str] = None
    descripcion: Optional[str] = None
    fecha_cobro: Optional[datetime] = None
    subtotal: Decimal
    porcentaje: Decimal
    monto_encargado: Decimal
    monto_amivets: Decimal
    es_ajuste: bool = False
    liquidacion_id: Optional[int] = None


class ComisionTotales(BaseModel):
    encargado: Decimal
    amivets: Decimal


class ComisionControlResponse(BaseModel):
    encargado_id: int
    username: str
    porcentaje_efectivo: Decimal
    pendientes: List[ComisionLineaResponse] = []
    liquidadas: List[ComisionLineaResponse] = []
    totales_pendientes: ComisionTotales
    totales_liquidadas: ComisionTotales


class LiquidacionComisionCreate(BaseModel):
    encargado_id: int = Field(..., gt=0)
    desde: date
    hasta: date

    @model_validator(mode='after')
    def validar_rango(self):
        if self.hasta < self.desde:
            raise ValueError("'hasta' no puede ser anterior a 'desde'")
        return self


class LiquidacionComisionResponse(BaseModel):
    id: int
    numero: str
    encargado_id: int
    encargado_username: Optional[str] = None
    desde: date
    hasta: date
    fecha_calculo: Optional[datetime] = None
    total_encargado: Decimal
    total_amivets: Decimal
    detalles: List[ComisionLineaResponse] = []


# ========== ORDEN DE SERVICIO SCHEMAS (Tarea 06, decisiones 1 y 9) ==========
class OrdenServicioCreate(BaseModel):
    """Abrir una orden (fila 1 de la matriz: admin / recepción / veterinario).

    propietario_id es obligatorio y mascota_id opcional, no al revés: una venta
    de mostrador tiene pagador y puede no tener paciente (decisión 1).
    """
    propietario_id: int = Field(..., gt=0)
    mascota_id: Optional[int] = Field(None, gt=0)
    veterinario_id: Optional[int] = Field(None, gt=0)
    motivo_visita: Optional[str] = Field(None, max_length=255)
    observaciones: Optional[str] = None


class OrdenServicioAsignarVeterinario(BaseModel):
    veterinario_id: int = Field(..., gt=0)


class OrdenServicioAnexarServicio(BaseModel):
    """Anexa un servicio directo a la orden, sin pasar por una consulta
    (Tarea 06, decisión 1: venta de mostrador, orden solo de estética).

    Es la hermana de ServicioConsultaCreate para POST /api/ordenes/{id}/
    servicios: mismos campos de contenido, menos consulta_id/mascota_id/
    orden_id, que el backend fija desde la orden del path, y menos `estado`,
    que decide el propio endpoint por el área del ítem (decisión 4, atajo sin
    despacho) en vez de aceptarlo del cliente.

    `tipo_servicio='CONSULTA'` está reservado a POST /api/consultas/ (decisión
    3, índice único uq_orden_una_consulta): el endpoint lo rechaza con 400.
    """
    tipo_servicio: str = Field(..., max_length=50)
    referencia_id: Optional[int] = None
    catalogo_servicio_id: Optional[int] = Field(None, gt=0)
    nombre_servicio: Optional[str] = Field(None, max_length=255)
    cantidad: float = Field(default=1.0, gt=0)
    precio_unitario: float = Field(default=0.0, ge=0)
    detalles_clinicos: Optional[str] = None
    # Overrides opcionales de consumo real por material (decisión 6, Tarea 07).
    # Solo se usan si el atajo sin despacho deja el servicio en EJECUTADO.
    consumos: Optional[List[ConsumoMaterialOverride]] = None


class OrdenServicioAnular(BaseModel):
    # Obligatorio: anular una orden sin decir por qué deja un agujero en la
    # auditoría justo donde más importa (decisión 1, regla 5). Falta el campo
    # o viene vacío -> 422 de Pydantic.
    motivo_anulacion: str = Field(..., min_length=1, max_length=255)


class OrdenServicioResponse(BaseModel):
    """Cabecera de la orden. La usa el listado del panel del día."""
    id: int
    numero: str
    propietario_id: int
    mascota_id: Optional[int] = None
    veterinario_id: Optional[int] = None
    estado: str
    abierta_por_id: int
    fecha_apertura: datetime
    fecha_cierre: Optional[datetime] = None
    cerrada_por_id: Optional[int] = None
    motivo_visita: Optional[str] = None
    observaciones: Optional[str] = None
    anulada_por_id: Optional[int] = None
    motivo_anulacion: Optional[str] = None
    origen: Optional[str] = None
    # Denormalizados para que el tablero no tenga que pedir tutor/paciente/
    # veterinario aparte por cada fila (mismo criterio que NotaClinicaResponse).
    propietario_nombre: Optional[str] = None
    mascota_nombre: Optional[str] = None
    veterinario_nombre: Optional[str] = None
    # Presupuesto en tiempo real (orden-servicio-carrito, decisión 2): NO es
    # una columna de la orden -- se calcula acá, al leer, sobre los servicios
    # vivos (no CANCELADO, no is_deleted). Así no hay migración ni forma de
    # que se desincronice de las líneas reales.
    total: float = 0.0

    @model_validator(mode='before')
    def _adjuntar_nombres(cls, data):
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                prop = getattr(data, 'propietario', None)
                if prop:
                    data.propietario_nombre = f"{prop.nombre} {prop.apellido}"
                mascota = getattr(data, 'mascota', None)
                if mascota:
                    data.mascota_nombre = mascota.nombre
                vet = getattr(data, 'veterinario', None)
                if vet:
                    data.veterinario_nombre = vet.username
            except Exception:
                pass
            try:
                total = 0.0
                for servicio in getattr(data, 'servicios', None) or []:
                    if getattr(servicio, 'is_deleted', False):
                        continue
                    if getattr(servicio, 'estado', None) == 'CANCELADO':
                        continue
                    total += (servicio.cantidad or 0) * (servicio.precio_unitario or 0)
                data.total = total
            except Exception:
                pass
        return data

    model_config = ConfigDict(from_attributes=True)


class OrdenServicioDetalleResponse(OrdenServicioResponse):
    """La orden completa: cabecera + sus servicios (fila 4 de la matriz).

    Incluye las líneas borradas lógicamente con su `is_deleted`, igual que
    ConsultaResponse.servicios — el filtro fino es del consumidor.
    """
    servicios: List[ServicioConsultaResponse] = []

    model_config = ConfigDict(from_attributes=True)


# ========== ÁREAS DE SERVICIO Y GESTORES (Tarea 06, decisiones 5 y 9, etapa 5) ==========
class AreaServicioCreate(BaseModel):
    """Alta de un área de despacho (fila 23 de la matriz: solo admin).

    `codigo` es el identificador estable que referencia CatalogoServicio.area_id
    (ej. 'LABORATORIO'); se normaliza a mayúsculas para no depender de que el
    cliente lo mande consistente.
    """
    codigo: str = Field(..., min_length=1, max_length=50)
    nombre: str = Field(..., min_length=1, max_length=100)
    requiere_adjunto: bool = False
    activo: bool = True

    @field_validator("codigo")
    @classmethod
    def _normalizar_codigo(cls, v: str) -> str:
        return v.strip().upper()


class AreaServicioUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=100)
    requiere_adjunto: Optional[bool] = None
    activo: Optional[bool] = None


class AreaServicioResponse(BaseModel):
    id: int
    codigo: str
    nombre: str
    requiere_adjunto: bool
    activo: bool

    model_config = ConfigDict(from_attributes=True)


class GestorAreaCreate(BaseModel):
    """Suma un usuario a `gestor_area` (fila 24 de la matriz: solo admin).

    No exige `role='gestor'`: la decisión 5 resuelve el multi-rol con datos
    (`gestor_area`), no con el string de rol -- un veterinario puede tener
    también una fila acá (ej. el veterinario que hace la ecografía).
    """
    usuario_id: int = Field(..., gt=0)


class GestorAreaResponse(BaseModel):
    id: int
    usuario_id: int
    area_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ========== NOTIFICACIONES (Tarea 06, decisión 6, etapa 5) ==========
class NotificacionResponse(BaseModel):
    id: int
    destinatario_id: int
    tipo: str
    titulo: str
    cuerpo: Optional[str] = None
    orden_id: Optional[int] = None
    servicio_id: Optional[int] = None
    created_at: datetime
    leida_at: Optional[datetime] = None
    canal: str
    enviado_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ========== NOTA CLINICA SCHEMAS (Unidad B, tarea 05) ==========
CATEGORIAS_NOTA_VALIDAS = {"general", "seguimiento", "llamada", "incidencia"}


class NotaClinicaBase(BaseModel):
    categoria: str = Field(default="general", max_length=20)
    texto: str = Field(..., min_length=1)
    # Ancla opcional a una consulta puntual -- ver justificacion en
    # NotaClinica (models.py): la mayoria de las notas nace fuera de una
    # consulta formal.
    consulta_id: Optional[int] = Field(None, gt=0)

    @field_validator('categoria')
    @classmethod
    def validar_categoria(cls, v):
        if v not in CATEGORIAS_NOTA_VALIDAS:
            raise ValueError(f"Categoria invalida. Usar una de: {', '.join(sorted(CATEGORIAS_NOTA_VALIDAS))}")
        return v


class NotaClinicaCreate(NotaClinicaBase):
    mascota_id: int = Field(..., gt=0)
    # usuario_id NO se acepta desde el cliente: lo fija el backend con el
    # usuario autenticado (mismo criterio que Consulta.veterinario_id, que
    # tampoco puede ser texto libre falsificable).


class NotaClinicaUpdate(BaseModel):
    categoria: Optional[str] = Field(None, max_length=20)
    texto: Optional[str] = Field(None, min_length=1)

    @field_validator('categoria')
    @classmethod
    def validar_categoria(cls, v):
        if v is not None and v not in CATEGORIAS_NOTA_VALIDAS:
            raise ValueError(f"Categoria invalida. Usar una de: {', '.join(sorted(CATEGORIAS_NOTA_VALIDAS))}")
        return v


class NotaClinicaResponse(NotaClinicaBase):
    id: int
    mascota_id: int
    usuario_id: int
    autor: Optional[str] = None
    fecha_creacion: datetime
    fecha_edicion: Optional[datetime] = None
    editado_por_username: Optional[str] = None
    is_deleted: bool

    @model_validator(mode='before')
    def _adjuntar_nombres(cls, data):
        # Igual criterio que MascotaResponse.append_apellido: si es un
        # objeto ORM con las relaciones cargadas, resolvemos el nombre de
        # autor/editor aca para que el frontend no tenga que pedir /usuarios
        # aparte solo para mostrar quien escribio la nota.
        # OJO: el campo de salida se llama "editado_por_username", NUNCA
        # "editado_por" -- ese nombre ya es la relationship SQLAlchemy en
        # NotaClinica, y pisarla con un string confunde a la instrumentacion
        # del ORM (el objeto deja de ser serializable). "autor" no choca
        # porque en el modelo esa relacion se llama "usuario".
        if not isinstance(data, dict) and hasattr(data, '__table__'):
            try:
                if getattr(data, 'usuario', None):
                    data.autor = data.usuario.username
                if getattr(data, 'editado_por', None):
                    data.editado_por_username = data.editado_por.username
            except Exception:
                pass
        return data

    model_config = ConfigDict(from_attributes=True)


# ========== ADJUNTOS (Tarea 06, decisiones 7 y 8, etapa 6) ==========
class AdjuntoResponse(BaseModel):
    id: int
    servicio_id: int
    nombre_original: str
    # El DETECTADO por los bytes al subir, no lo que declaró el cliente.
    content_type: str
    tamano_bytes: int
    sha256: str
    subido_por_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    model_config = ConfigDict(from_attributes=True)
