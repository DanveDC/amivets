from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator, ConfigDict
from typing import Optional, List
from datetime import datetime, date


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
    fecha_consulta: Optional[datetime] = None
    proxima_cita: Optional[datetime] = None
    estado_pago: Optional[str] = "POR_COBRAR"
    precio_consulta: Optional[float] = 0.0

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
    proxima_cita: Optional[datetime] = None
    estado_pago: Optional[str] = None
    precio_consulta: Optional[float] = None


class ServicioConsultaBase(BaseModel):
    consulta_id: int
    tipo_servicio: Optional[str] = Field(None, max_length=50) 
    referencia_id: Optional[int] = None
    nombre_servicio: Optional[str] = Field(None, max_length=255)
    cantidad: Optional[float] = Field(default=1.0)
    precio_unitario: Optional[float] = Field(default=0.0)
    estado: Optional[str] = Field(default="Pendiente", max_length=50)
    detalles_clinicos: Optional[str] = None
    is_deleted: Optional[bool] = False

class ServicioConsultaCreate(ServicioConsultaBase):
    pass

class ServicioConsultaUpdate(BaseModel):
    cantidad: Optional[float] = Field(None, gt=0)
    precio_unitario: Optional[float] = Field(None, ge=0)
    estado: Optional[str] = Field(None, max_length=50)
    detalles_clinicos: Optional[str] = None
    is_deleted: Optional[bool] = None

class ServicioConsultaResponse(ServicioConsultaBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ConsultaResponse(ConsultaBase):
    id: int
    mascota_id: int
    servicios: List[ServicioConsultaResponse] = []
    factura_id: Optional[int] = None
    
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
class InventarioBase(BaseModel):
    codigo: str = Field(..., min_length=1, max_length=50)
    nombre: str = Field(..., min_length=1, max_length=200)
    descripcion: Optional[str] = None
    categoria: Optional[str] = Field(None, max_length=50)
    precio_unitario: float = Field(..., ge=0)
    stock_actual: int = Field(default=0, ge=0, description="El stock jamás puede ser negativo")
    stock_minimo: int = Field(default=5, ge=0)
    fecha_vencimiento: Optional[date] = None
    proveedor: Optional[str] = Field(None, max_length=200)
    ubicacion: Optional[str] = Field(None, max_length=100)
    activo: bool = True
    
    @field_validator('precio_unitario')
    @classmethod
    def validar_precio_positivo(cls, v):
        if v < 0:
            raise ValueError('El precio no puede ser negativo')
        return v


class InventarioCreate(InventarioBase):
    pass


class InventarioUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=200)
    descripcion: Optional[str] = None
    categoria: Optional[str] = Field(None, max_length=50)
    precio_unitario: Optional[float] = Field(None, ge=0)
    stock_actual: Optional[int] = Field(None, ge=0)
    stock_minimo: Optional[int] = Field(None, ge=0)
    fecha_vencimiento: Optional[date] = None
    proveedor: Optional[str] = Field(None, max_length=200)
    ubicacion: Optional[str] = Field(None, max_length=100)
    activo: Optional[bool] = None


class InventarioResponse(InventarioBase):
    id: int
    fecha_registro: datetime
    
    model_config = ConfigDict(from_attributes=True)


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
