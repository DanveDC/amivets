from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, Boolean, Enum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class Propietario(Base):
    """Modelo para los propietarios de mascotas"""
    __tablename__ = "propietarios"
    
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    cedula = Column(String(20), unique=True, nullable=False, index=True)
    telefono = Column(String(20))
    email = Column(String(100), unique=True, index=True)
    direccion = Column(Text)
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    activo = Column(Boolean, default=True)
    
    # Relaciones
    mascotas = relationship("Mascota", back_populates="propietario", cascade="all, delete-orphan")
    facturas = relationship("Factura", back_populates="propietario")
    
    def __repr__(self):
        return f"<Propietario {self.nombre} {self.apellido}>"


class Mascota(Base):
    """Modelo para las mascotas/pacientes"""
    __tablename__ = "mascotas"
    
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    especie = Column(String(50), nullable=False)  # Perro, Gato, Ave, etc.
    raza = Column(String(100))
    sexo = Column(String(10))  # Macho, Hembra
    fecha_nacimiento = Column(Date)
    color = Column(String(50))
    peso = Column(Float)  # en kg
    observaciones = Column(Text)
    foto_url = Column(String(255))
    estado_reproductivo = Column(String(50))  # Esterilizado, No Esterilizado
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    activo = Column(Boolean, default=True)
    codigo_historia = Column(String(50), unique=True, index=True) # Cedula + ID
    microchip = Column(String(50), unique=True, nullable=True) # Alta agilidad/Identificación
    
    # Clave foránea
    propietario_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False)
    
    # Relaciones
    propietario = relationship("Propietario", back_populates="mascotas")
    consultas = relationship("Consulta", back_populates="mascota")
    historial_propietarios = relationship("HistoriaPropiedad", back_populates="mascota", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Mascota {self.nombre} - {self.especie}>"


class HistoriaPropiedad(Base):
    """Modelo para el historial de cambios de propietario"""
    __tablename__ = "historia_propiedad"
    
    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    propietario_anterior_id = Column(Integer, ForeignKey("propietarios.id"), nullable=True)
    propietario_nuevo_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False)
    fecha_cambio = Column(DateTime(timezone=True), server_default=func.now())
    motivo = Column(String(255))
    
    # Relaciones
    mascota = relationship("Mascota", back_populates="historial_propietarios")
    propietario_anterior = relationship("Propietario", foreign_keys=[propietario_anterior_id])
    propietario_nuevo = relationship("Propietario", foreign_keys=[propietario_nuevo_id])


class CitaEstado(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    EN_ESPERA = "EN_ESPERA"
    EN_CONSULTA = "EN_CONSULTA"
    FINALIZADO = "FINALIZADO"
    CANCELADA = "CANCELADA"

class Cita(Base):
    """Modelo para el agendamiento de citas"""
    __tablename__ = "citas"

    id = Column(Integer, primary_key=True, index=True)
    fecha_cita = Column(DateTime(timezone=True), nullable=False)
    hora_llegada = Column(DateTime(timezone=True), nullable=True)
    hora_inicio_atencion = Column(DateTime(timezone=True), nullable=True)
    hora_fin_atencion = Column(DateTime(timezone=True), nullable=True)
    tipo = Column(String(50), nullable=False) # Consulta, Cirugia, Vacunacion, etc
    estado = Column(String(50), default=CitaEstado.PENDIENTE)
    observaciones = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Claves foraneas
    veterinario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    propietario_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    
    # Relaciones
    veterinario = relationship("Usuario")
    propietario = relationship("Propietario") # No back_populates needed yet unless added to Propietario
    mascota = relationship("Mascota")

    def __repr__(self):
        return f"<Cita {self.id} - {self.fecha_cita}>"


class Consulta(Base):
    """Modelo para las consultas veterinarias"""
    __tablename__ = "consultas"
    
    id = Column(Integer, primary_key=True, index=True)
    fecha_consulta = Column(DateTime(timezone=True), server_default=func.now())
    motivo = Column(String(255), nullable=False)
    sintomas = Column(Text)
    diagnostico = Column(Text)
    tratamiento = Column(Text)
    peso = Column(Float)  # Peso en el momento de la consulta
    temperatura = Column(Float)  # en °C
    frecuencia_cardiaca = Column(Float) # bpm
    observaciones = Column(Text)
    veterinario = Column(String(100)) # Profesional responsable
    proxima_cita = Column(DateTime(timezone=True))
    
    # Clave foránea
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    
    # Relaciones
    mascota = relationship("Mascota", back_populates="consultas")
    pruebas = relationship("PruebaComplementaria", back_populates="consulta", cascade="all, delete-orphan")
    recetas = relationship("Receta", back_populates="consulta", cascade="all, delete-orphan")
    vacunaciones = relationship("Vacunacion", back_populates="consulta", cascade="all, delete-orphan")
    desparasitaciones = relationship("Desparasitacion", back_populates="consulta", cascade="all, delete-orphan")
    cirugias = relationship("Cirugia", back_populates="consulta")
    hospitalizaciones = relationship("Hospitalizacion", back_populates="consulta")
    servicios = relationship("ServicioConsulta", back_populates="consulta", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Consulta {self.id} - {self.fecha_consulta}>"

class ServicioConsulta(Base):
    """Pivot node for any action taken logically inside a consultation"""
    __tablename__ = "servicios_consulta"

    id = Column(Integer, primary_key=True, index=True)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=False)
    tipo_servicio = Column(String(50), nullable=False) # VACUNACION, CIRUGIA, HOSPITALIZACION, LABORATORIO, INSUMO, ESTETICA
    referencia_id = Column(Integer, nullable=True) # ID to specific clinical table or Inventory (Insumos)
    nombre_servicio = Column(String(255))
    cantidad = Column(Float, nullable=False, default=1.0)
    precio_unitario = Column(Float, nullable=False, default=0.0)
    estado = Column(String(50), default="Pendiente") # Pendiente, Aplicado
    detalles_clinicos = Column(Text, nullable=True) # Datos de aplicacion (lote, dosis, hallazgos, etc)
    is_deleted = Column(Boolean, default=False) # Soft delete for auditing

    consulta = relationship("Consulta", back_populates="servicios")

    def subtotal(self):
        return self.cantidad * self.precio_unitario

class Receta(Base):
    """Modelo para recetas medicas"""
    __tablename__ = "recetas"
    
    id = Column(Integer, primary_key=True, index=True)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=False)
    fecha_emision = Column(DateTime(timezone=True), server_default=func.now())
    indicaciones_generales = Column(Text)
    
    # Relaciones
    consulta = relationship("Consulta", back_populates="recetas")
    detalles = relationship("DetalleReceta", back_populates="receta", cascade="all, delete-orphan")

class DetalleReceta(Base):
    """Modelo para items de recetas"""
    __tablename__ = "detalles_receta"
    
    id = Column(Integer, primary_key=True, index=True)
    receta_id = Column(Integer, ForeignKey("recetas.id"), nullable=False)
    medicamento_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    dosis = Column(String(100), nullable=False)
    frecuencia = Column(String(100), nullable=False)
    duracion = Column(String(100), nullable=False)
    
    receta = relationship("Receta", back_populates="detalles")
    medicamento = relationship("Inventario")


class PruebaComplementaria(Base):
    """Modelo para pruebas de laboratorio y diagnostico"""
    __tablename__ = "pruebas_complementarias"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), nullable=False) # Laboratorio, Rayos X, ECO
    fecha = Column(DateTime(timezone=True), server_default=func.now())
    archivo_url = Column(String(255))
    resultado = Column(Text)
    observaciones = Column(Text)
    precio_aplicado = Column(Float, nullable=False, default=0.0)
    facturado = Column(Boolean, default=False)
    estado_orden = Column(String(50), default="Pendiente") # Pendiente, Enviado, Resultado Recibido

    # Claves foraneas
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True) # Puede estar vinculada a una consulta o no
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)

    # Relaciones
    consulta = relationship("Consulta", back_populates="pruebas")
    mascota = relationship("Mascota")

    def __repr__(self):
        return f"<Prueba {self.tipo} - {self.id}>"


class Inventario(Base):
    """Modelo para el inventario de medicinas y productos"""
    __tablename__ = "inventario"
    
    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String(50), unique=True, nullable=False, index=True)
    nombre = Column(String(200), nullable=False)
    descripcion = Column(Text)
    categoria = Column(String(50))  # Medicina, Vacuna, Alimento, Accesorio, etc.
    precio_unitario = Column(Float, nullable=False)
    stock_actual = Column(Integer, nullable=False, default=0)
    stock_minimo = Column(Integer, nullable=False, default=5)
    fecha_vencimiento = Column(Date)
    proveedor = Column(String(200))
    ubicacion = Column(String(100))  # Ubicación física en el almacén
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    activo = Column(Boolean, default=True)
    
    # Relaciones
    detalles_factura = relationship("DetalleFactura", back_populates="producto")
    
    def __repr__(self):
        return f"<Inventario {self.codigo} - {self.nombre}>"


class Usuario(Base):
    """Modelo para usuarios del sistema"""
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user") # admin, user

    def __repr__(self):
        return f"<Usuario {self.username}>"


class Factura(Base):
    """Modelo para la cabecera de factura"""
    __tablename__ = "facturas"
    
    id = Column(Integer, primary_key=True, index=True)
    numero_factura = Column(String(50), unique=True, nullable=False, index=True)
    fecha_emision = Column(DateTime(timezone=True), server_default=func.now())
    es_presupuesto = Column(Boolean, default=False)
    subtotal = Column(Float, nullable=False, default=0.0)
    descuento = Column(Float, default=0.0)
    impuesto = Column(Float, default=0.0)  # IVA u otros impuestos
    total = Column(Float, nullable=False, default=0.0)
    estado = Column(String(20), default="PENDIENTE")  # PENDIENTE, PAGADA, ANULADA
    metodo_pago = Column(String(50))  # Efectivo, Tarjeta, Transferencia
    total_pagado = Column(Float, default=0.0) # Para Cuentas por Cobrar
    saldo_pendiente = Column(Float, default=0.0)
    observaciones = Column(Text)
    
    # Clave foránea
    propietario_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False)
    
    # Relaciones
    propietario = relationship("Propietario", back_populates="facturas")
    detalles = relationship("DetalleFactura", back_populates="factura", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Factura {self.numero_factura}>"


class DetalleFactura(Base):
    """Modelo para el detalle de factura (líneas de artículos)"""
    __tablename__ = "detalles_factura"
    
    id = Column(Integer, primary_key=True, index=True)
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)
    descripcion = Column(String(255))
    
    # Claves foráneas
    factura_id = Column(Integer, ForeignKey("facturas.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("inventario.id"), nullable=True)  # Puede ser null para servicios
    
    # Relaciones
    factura = relationship("Factura", back_populates="detalles")
    producto = relationship("Inventario", back_populates="detalles_factura")
    
    def __repr__(self):
        return f"<DetalleFactura {self.id} - Factura {self.factura_id}>"

class MovimientoInventario(Base):
    """Trazabilidad obligatoria: Cada vez que entra o sale un producto"""
    __tablename__ = "movimientos_inventario"
    
    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    tipo_movimiento = Column(String(20), nullable=False) # ENTRADA, SALIDA, MERMA
    cantidad = Column(Integer, nullable=False)
    costo_unitario = Column(Float, nullable=False) # Para finanzas/Kardex
    lote = Column(String(50), nullable=True) # Para medicinas
    fecha_vencimiento = Column(Date, nullable=True)
    origen_destino = Column(String(255)) # ID de factura, Nombre proveedor, etc.
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    usuario_responsable_id = Column(Integer, ForeignKey("usuarios.id"))
    
    # Relaciones
    producto = relationship("Inventario")
    responsable = relationship("Usuario")


class Hospitalizacion(Base):
    """Subfamilia Hospitalización: Pacientes internos"""
    __tablename__ = "hospitalizaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    fecha_ingreso = Column(DateTime(timezone=True), server_default=func.now())
    fecha_egreso = Column(DateTime(timezone=True), nullable=True)
    motivo = Column(Text, nullable=False)
    estado_paciente = Column(String(50)) # Estable, Critico, Reservado
    jaula_nro = Column(String(20))
    dias_cama = Column(Integer, default=1)
    monitoreo_constantes = Column(JSON, nullable=True) # Constantes por turno
    observaciones_ingreso = Column(Text)
    precio_aplicado = Column(Float, nullable=False, default=0.0)
    facturado = Column(Boolean, default=False)
    activo = Column(Boolean, default=True)
    
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True)

    mascota = relationship("Mascota")
    consulta = relationship("Consulta", back_populates="hospitalizaciones")
    hojas_tratamiento = relationship("HojaTratamiento", back_populates="hospitalizacion")


class HojaTratamiento(Base):
    """Subfamilia Hospitalización: Seguimiento de medicación"""
    __tablename__ = "hojas_tratamiento"
    
    id = Column(Integer, primary_key=True, index=True)
    hospitalizacion_id = Column(Integer, ForeignKey("hospitalizaciones.id"), nullable=False)
    fecha_hora = Column(DateTime(timezone=True), server_default=func.now())
    medicamento_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    dosis_administrada = Column(String(100))
    via_administracion = Column(String(50))
    usuario_responsable_id = Column(Integer, ForeignKey("usuarios.id"))
    
    hospitalizacion = relationship("Hospitalizacion", back_populates="hojas_tratamiento")
    medicamento = relationship("Inventario")
    responsable = relationship("Usuario")


class Cirugia(Base):
    """Subfamilia Quirófano: Informes de cirugía"""
    __tablename__ = "cirugias"
    
    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True)
    fecha_cirugia = Column(DateTime(timezone=True), server_default=func.now())
    tipo_procedimiento = Column(String(200), nullable=False)
    cirujano_id = Column(Integer, ForeignKey("usuarios.id"))
    informe_quirurgico = Column(Text)
    complicaciones = Column(Text)
    riesgo_asa = Column(String(10)) # ASA I-V
    honorarios_medicos = Column(Float, default=0.0)
    costo_anestesia = Column(Float, default=0.0)
    costo_insumos = Column(Float, default=0.0)
    precio_aplicado = Column(Float, nullable=False, default=0.0)
    facturado = Column(Boolean, default=False)
    
    mascota = relationship("Mascota")
    consulta = relationship("Consulta", back_populates="cirugias")
    protocolo_anestesico = relationship("ProtocoloAnestesico", back_populates="cirugia", uselist=False)


class ProtocoloAnestesico(Base):
    """Subfamilia Quirófano: Control anestésico"""
    __tablename__ = "protocolos_anestesicos"
    
    id = Column(Integer, primary_key=True, index=True)
    cirugia_id = Column(Integer, ForeignKey("cirugias.id"), nullable=False)
    premedicacion = Column(Text)
    induccion = Column(Text)
    mantenimiento = Column(Text)
    monitoreo_constantes = Column(JSON) # Trazabilidad profesional de signos durante cirugía
    observaciones = Column(Text)
    
    cirugia = relationship("Cirugia", back_populates="protocolo_anestesico")


class ConsentimientoInformado(Base):
    """Subfamilia Quirófano/Historia: Documentación legal"""
    __tablename__ = "consentimientos"
    
    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    tipo_documento = Column(String(100)) # Cirugia, Eutanasia, Hospitalizacion
    firmado = Column(Boolean, default=False)
    fecha_firma = Column(DateTime(timezone=True), server_default=func.now())
    archivo_adjunto_url = Column(String(255))
    
    mascota = relationship("Mascota")


class PlanSalud(Base):
    """Subfamilia Historia: Vacunación y Desparasitación"""
    __tablename__ = "planes_salud"
    
    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    tipo_preventivo = Column(String(50)) # VACUNA, DESPARASITACION
    nombre_producto = Column(String(100))
    fecha_aplicacion = Column(Date, nullable=False)
    fecha_proxima_refuerzo = Column(Date)
    lote = Column(String(50))
    observaciones = Column(Text)
    
    mascota = relationship("Mascota")

class Vacunacion(Base):
    """Subfamilia Clínica: Registro de Vacunaciones"""
    __tablename__ = "vacunaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=False)
    vacuna_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    lote = Column(String(50), nullable=True)
    fecha_aplicacion = Column(DateTime(timezone=True), server_default=func.now())
    fecha_refuerzo = Column(DateTime(timezone=True), nullable=True)
    precio_aplicado = Column(Float, nullable=False, default=0.0)
    facturado = Column(Boolean, default=False)
    
    consulta = relationship("Consulta", back_populates="vacunaciones")
    vacuna = relationship("Inventario")

class Desparasitacion(Base):
    """Subfamilia Clínica: Registro de Desparasitaciones"""
    __tablename__ = "desparasitaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=False)
    tipo = Column(String(50), nullable=False) # Interna, Externa
    producto_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    dosis = Column(String(100), nullable=False)
    fecha_aplicacion = Column(DateTime(timezone=True), server_default=func.now())
    precio_aplicado = Column(Float, nullable=False, default=0.0)
    facturado = Column(Boolean, default=False)
    
    consulta = relationship("Consulta", back_populates="desparasitaciones")
    producto = relationship("Inventario")

