# AmiVets Models - Force Sync v2
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, Boolean, Enum, JSON, Numeric, UniqueConstraint, Index, CheckConstraint, Sequence, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from typing import List, Optional
from datetime import datetime
import enum
from app.core.database import Base


class TipoMovimiento:
    """Conjunto cerrado para MovimientoInventario.tipo_movimiento (Tarea 07, slice B).

    La columna sigue siendo String en la DB (sin CHECK en este slice); esta
    clase es la fuente de verdad a nivel aplicacion para TODAS las escrituras
    nuevas. Las filas historicas no se reescriben.
    """
    ENTRADA = "ENTRADA"
    SALIDA = "SALIDA"
    MERMA = "MERMA"
    AJUSTE = "AJUSTE"
    REVERSA = "REVERSA"

    TODOS = frozenset({ENTRADA, SALIDA, MERMA, AJUSTE, REVERSA})


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
    veterinario = Column(String(100)) # Profesional responsable (texto libre, legado/auditoria)
    proxima_cita = Column(DateTime(timezone=True))

    # Claves foráneas
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    veterinario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)

    estado_pago = Column(String(50), default="POR_COBRAR") # POR_COBRAR, COBRADO
    precio_consulta = Column(Float, default=0.0)

    # Ciclo de vida clinico de la consulta (Tarea 09, decision 6), separado del
    # eje de cobro (estado_pago). ABIERTA = en curso; CERRADA = facturada o
    # cerrada por el veterinario; ANULADA = error. La migracion d0e1f2a3b4c5
    # deja las filas historicas en 'CERRADA' y el server_default en 'ABIERTA'.
    estado = Column(String(20), server_default="ABIERTA", default="ABIERTA", index=True)

    # Relaciones
    mascota = relationship("Mascota", back_populates="consultas")
    veterinario_usuario = relationship("Usuario", foreign_keys=[veterinario_id])
    pruebas = relationship("PruebaComplementaria", back_populates="consulta", cascade="all, delete-orphan")
    recetas = relationship("Receta", back_populates="consulta", cascade="all, delete-orphan")
    vacunaciones = relationship("Vacunacion", back_populates="consulta", cascade="all, delete-orphan")
    desparasitaciones = relationship("Desparasitacion", back_populates="consulta", cascade="all, delete-orphan")
    cirugias = relationship("Cirugia", back_populates="consulta")
    hospitalizaciones = relationship("Hospitalizacion", back_populates="consulta")
    servicios = relationship("ServicioConsulta", back_populates="consulta", cascade="all, delete-orphan")
    # uselist=True: una consulta puede tener mas de una Factura si la
    # activa fue anulada y se reemitio (flujo sancionado en
    # crear_factura). Con uselist=False, SQLAlchemy levanta
    # MultipleResultsFound apenas eso pasa una vez, tumbando GET
    # /api/consultas y /api/consultas/{id} enteros.
    facturas = relationship("Factura", back_populates="consulta", uselist=True)

    @property
    def factura(self) -> Optional["Factura"]:
        """La Factura relevante de esta consulta: la activa (no ANULADA) si
        existe -- nunca debe quedar tapada por una anulada vieja -- si no,
        la ANULADA mas reciente."""
        if not self.facturas:
            return None
        activas = [f for f in self.facturas if f.estado != "ANULADA"]
        if activas:
            return max(activas, key=lambda f: f.id)
        return max(self.facturas, key=lambda f: f.id)

    @property
    def factura_id(self) -> Optional[int]:
        factura = self.factura
        return factura.id if factura else None

    def __repr__(self):
        return f"<Consulta {self.id} - {self.fecha_consulta}>"

class AreaServicio(Base):
    """Puesto de trabajo que ejecuta un servicio (Tarea 06, decision 5).

    LABORATORIO, IMAGEN, ESTETICA, QUIROFANO... Es un eje de EJECUCION, no
    comercial: CatalogoServicio.categoria agrupa para el catalogo y los
    reportes, esta tabla dice quien hace el trabajo. Se separa de
    tipo_servicio porque ese campo es texto libre sin dominio controlado, y
    rutear trabajo real por texto libre es construir sobre arena.

    Es una tabla de CONFIGURACION que el admin edita: de ahi que
    requiere_adjunto viva como dato y no como una lista hardcodeada
    (decision 7, "sin tocar codigo").
    """
    __tablename__ = "areas_servicio"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String(50), nullable=False, unique=True, index=True)  # 'LABORATORIO'
    nombre = Column(String(100), nullable=False)  # 'Laboratorio'
    # Default del area para exigir adjunto al ejecutar. CatalogoServicio.
    # requiere_adjunto (nullable) puede sobrescribirlo item por item.
    requiere_adjunto = Column(Boolean, nullable=False, server_default=text("false"), default=False)
    activo = Column(Boolean, nullable=False, server_default=text("true"), default=True)

    gestores = relationship("GestorArea", back_populates="area", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<AreaServicio {self.codigo}>"


class GestorArea(Base):
    """Que usuario atiende que area (Tarea 06, decision 5). N:M usuario<->area.

    Modelo propio y no tabla de asociacion suelta, por consistencia con el
    unico N:M que ya existe en el repo (RecetaServicio): PK propia,
    UniqueConstraint sobre el par y created_at para auditar desde cuando.

    Es tambien la respuesta al multi-rol (decision 9.2): Usuario.role sigue
    siendo un solo String y "ser gestor de imagen" se expresa TENIENDO una fila
    aca. Un role='veterinario' con fila en GestorArea(IMAGEN) ve la ecografia
    en su bandeja, sin tocar ninguna de las ~14 comparaciones `role ==`.
    """
    __tablename__ = "gestor_area"

    # PK id sin index=True explicito (ver RecetaServicio): redundante en Postgres.
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    area_id = Column(Integer, ForeignKey("areas_servicio.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("usuario_id", "area_id", name="uq_gestor_area_usuario_area"),
    )

    usuario = relationship("Usuario")
    area = relationship("AreaServicio", back_populates="gestores")

    def __repr__(self):
        return f"<GestorArea usuario={self.usuario_id} area={self.area_id}>"


# SEQUENCE que numera las ordenes (Tarea 06, decision 1). Asociada al MetaData
# para que create_all la cree ANTES de la tabla: el server_default de
# OrdenServicio.numero la referencia y Postgres resuelve nextval() en tiempo de
# CREATE TABLE.
orden_servicio_numero_seq = Sequence("ordenes_servicio_numero_seq", metadata=Base.metadata)


class OrdenServicio(Base):
    """Contenedor de una visita: todo lo que se le hace y se le cobra al tutor
    en un mismo paso por la clinica (Tarea 06, decision 1).

    propietario_id es OBLIGATORIO y mascota_id OPCIONAL, no al reves: una venta
    de mostrador ("vino a comprar un antipulgas") tiene pagador y puede no
    tener paciente, y Factura.propietario_id ya es NOT NULL, asi que una orden
    sin tutor no se podria facturar nunca.

    veterinario_id es nullable: una orden de bano o estetica no tiene medico, y
    forzarlo obligaria a inventar un veterinario ficticio -- el error que la
    Tarea 09 ya descarto para las consultas sinteticas.

    NO hay columna `total`: sale de los servicios vivos de la orden. Guardarlo
    abriria la puerta a que la orden y la factura digan cosas distintas, y la
    factura ya es el registro de dinero.
    """
    __tablename__ = "ordenes_servicio"

    __table_args__ = (
        # Sin Enum a proposito (decision 1): Consulta.estado, Factura.estado,
        # ServicioConsulta.estado y MovimientoInventario.tipo_movimiento son
        # todos String; ademas un ENUM de Postgres exige ALTER TYPE para sumar
        # un valor. Misma garantia en la base, sin el costo de esquema.
        CheckConstraint(
            "estado IN ('ABIERTA', 'EN_ATENCION', 'CERRADA', 'FACTURADA', 'ANULADA')",
            name="ck_orden_servicio_estado",
        ),
        # Bandeja del dia (Main.html lista las abiertas): es la consulta caliente.
        Index("ix_ordenes_servicio_estado_fecha", "estado", "fecha_apertura"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # 'OS-002418'. Lo genera la SEQUENCE en la base, no la aplicacion:
    # generar_numero_factura lee la ultima fila y suma uno, y bajo concurrencia
    # dos recepcionistas obtienen el mismo numero. En el mostrador -- el momento
    # de mayor concurrencia -- eso no es tolerable.
    numero = Column(
        String(20),
        nullable=False,
        unique=True,
        index=True,
        server_default=text("'OS-' || lpad(nextval('ordenes_servicio_numero_seq')::text, 6, '0')"),
    )
    propietario_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False, index=True)
    # NULL = venta de mostrador sin paciente.
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=True, index=True)
    # Asignado por recepcion. NULL mientras no se asigne, o para siempre en una
    # orden solo de estetica.
    veterinario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    estado = Column(String(20), nullable=False, server_default="ABIERTA", default="ABIERTA", index=True)
    abierta_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    fecha_apertura = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    fecha_cierre = Column(DateTime(timezone=True), nullable=True)  # se sella al pasar a CERRADA
    cerrada_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    motivo_visita = Column(String(255), nullable=True)  # texto de mostrador
    observaciones = Column(Text, nullable=True)
    anulada_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    motivo_anulacion = Column(String(255), nullable=True)  # obligatorio en el endpoint al anular
    # Marcador de reversibilidad del backfill (decision 2), mismo patron que
    # ServicioConsulta.origen: 'MIGRACION_06' = fila creada por la migracion de
    # historicos; NULL = alta normal por API.
    origen = Column(String(20), nullable=True)

    propietario = relationship("Propietario")
    mascota = relationship("Mascota")
    veterinario = relationship("Usuario", foreign_keys=[veterinario_id])
    abierta_por = relationship("Usuario", foreign_keys=[abierta_por_id])
    cerrada_por = relationship("Usuario", foreign_keys=[cerrada_por_id])
    anulada_por = relationship("Usuario", foreign_keys=[anulada_por_id])
    servicios = relationship("ServicioConsulta", back_populates="orden")

    def __repr__(self):
        return f"<OrdenServicio {self.numero} - {self.estado}>"


class ServicioConsulta(Base):
    """Pivot node for any action taken logically inside a consultation"""
    __tablename__ = "servicios_consulta"
    # Declarados en el modelo (además de en las migraciones d0e1f2a3b4c5 /
    # e1f2a3b4c5d6) para que create_all los reproduzca en una base nueva, ahora
    # que el arranque sella/upgradea con Alembic en vez de replicar el DDL.
    __table_args__ = (
        # Ampliado en f2a3b4c5d6e1 (Tarea 06, decision 3): orden_id es el tercer
        # ancla valido. Una orden de mostrador sin paciente (mascota_id NULL) y
        # sin consulta violaria la version anterior del CHECK.
        # Desde c5d6e1f2a3b4 (etapa 4) orden_id es NOT NULL, asi que esta
        # condicion queda siempre verdadera para filas nuevas -- se conserva
        # tal cual (no se dropea) porque sigue documentando la regla y porque
        # dropear/recrear un CHECK en Postgres no gana nada sobre dejarlo.
        CheckConstraint(
            "orden_id IS NOT NULL OR consulta_id IS NOT NULL OR mascota_id IS NOT NULL",
            name="ck_servicio_consulta_scope",
        ),
        Index("ix_servicios_consulta_mascota_created", "mascota_id", "created_at"),
        # Maximo una linea CONSULTA viva por orden (Tarea 06, decision 3).
        # Factura.consulta_id es una sola FK y _consultas_elegibles liquida por
        # JOIN Factura.consulta_id: con dos consultas en una orden, la segunda
        # nunca se le liquidaria a su veterinario, en silencio.
        Index(
            "uq_orden_una_consulta",
            "orden_id",
            unique=True,
            postgresql_where=text("tipo_servicio = 'CONSULTA' AND is_deleted = false"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Contenedor de la visita (Tarea 06, decision 3). NOT NULL desde la
    # revision c5d6e1f2a3b4 (etapa 4): el backfill (b4c5d6e1f2a3, etapa 3)
    # engancho toda fila historica, y los endpoints de la etapa 4 (servicios.py,
    # clinico.py, cirugias.py, hospitalizaciones.py, pruebas.py,
    # POST /api/ordenes/{id}/servicios) garantizan que TODA fila nueva nace con
    # orden. La tabla NO se renombra a servicios_orden: el nombre fisico aparece
    # en dos migraciones aplicadas, tres FK que lo apuntan, el CHECK, dos indices
    # y las queries de _consumo_en_ledger; renombrar es churn sin ganancia de
    # comportamiento. El nombre queda historico; el modelo, correcto.
    orden_id = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=False, index=True)
    # nullable desde Tarea 09 (decision 1): un "servicio directo" (corte de unas,
    # venta de mostrador) no cuelga de ninguna consulta. El CHECK
    # ck_servicio_consulta_scope (migracion d0e1f2a3b4c5) exige que haya al menos
    # un ancla: consulta_id IS NOT NULL OR mascota_id IS NOT NULL.
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True)
    # Ancla a la historia del paciente. Se llena SIEMPRE de aca en adelante
    # (tambien en servicios con consulta) para simplificar las queries de
    # historia; backfill desde consulta.mascota_id en la migracion.
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=True, index=True)
    # Marcador de reversibilidad del backfill de espejos (Tarea 09, decision 2).
    # 'MIGRACION_09' = fila creada por la migracion d0e1f2a3b4c5; NULL = alta
    # normal por API. El downgrade borra solo las 'MIGRACION_09'.
    origen = Column(String(20), nullable=True)
    tipo_servicio = Column(String(50), nullable=False) # VACUNACION, CIRUGIA, HOSPITALIZACION, LABORATORIO, INSUMO, ESTETICA
    referencia_id = Column(Integer, nullable=True) # ID to specific clinical table or Inventory (Insumos)
    # Ancla (por fin) el servicio de la consulta a su definicion de catalogo.
    # Nullable y sin backfill: se llena de aca en adelante (Tarea 07, decision 8).
    catalogo_servicio_id = Column(Integer, ForeignKey("catalogo_servicios.id"), nullable=True, index=True)
    nombre_servicio = Column(String(255))
    cantidad = Column(Float, nullable=False, default=1.0)
    precio_unitario = Column(Float, nullable=False, default=0.0)
    # Decision 4 (docs/diseno/ordenes-de-servicio.md): SOLICITADO, EJECUTADO,
    # FACTURADO, CANCELADO. ASIGNADO / EN_PROCESO llegan con el despacho.
    # EJECUTADO y FACTURADO son los dos estados "consumidos" (ver
    # consumo_service.ESTADOS_CONSUMIDOS).
    estado = Column(String(50), default="SOLICITADO")
    detalles_clinicos = Column(Text, nullable=True) # Datos de aplicacion (lote, dosis, hallazgos, etc)
    facturado = Column(Boolean, default=False)
    # NOT NULL + server_default (Tarea 06, decision 3): uq_orden_una_consulta es
    # un indice parcial WHERE is_deleted = false. Con NULL permitido, esa
    # comparacion da UNKNOWN y la fila se escapa de la restriccion de "maximo
    # una consulta por orden" (hallazgo de revision, ver migracion f2a3b4c5d6e1).
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"), default=False) # Soft delete for auditing
    # Fecha del servicio para la historia unificada del paciente (Tarea 09,
    # pestana "Servicios"). Un servicio anexado hereda la fecha de la consulta
    # via backfill; uno directo usa el momento del alta. Indexada junto a
    # mascota_id para el feed ordenado por fecha.
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # --- Despacho al area (Tarea 06, decision 5) ---
    # Snapshot del area al anexar el servicio: si manana el catalogo cambia de
    # area, el trabajo ya despachado no se muda de cola. NULL = el atajo sin
    # despacho de la decision 4 (CONSULTA, INSUMO, venta de mostrador).
    area_id = Column(Integer, ForeignKey("areas_servicio.id"), nullable=True, index=True)
    # El gestor que TOMO el servicio. El despacho va al area, no a una persona:
    # el servicio queda ASIGNADO con asignado_a_id = NULL y lo toma el primero
    # que esta libre; un segundo que lo intente recibe 409.
    asignado_a_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    # Ambiguedad resuelta en etapa 5: asignado_at sella CUANDO ENTRO A
    # ASIGNADO (el despacho al area, en orden_service.confirmar_servicios),
    # no cuando un gestor lo toma -- ese momento ya lo identifica el propio
    # estado EN_PROCESO + asignado_a_id != NULL, sin necesitar timestamp
    # propio (ver routers/servicios.py::tomar_servicio).
    asignado_at = Column(DateTime(timezone=True), nullable=True)
    ejecutado_at = Column(DateTime(timezone=True), nullable=True)

    orden = relationship("OrdenServicio", back_populates="servicios")
    consulta = relationship("Consulta", back_populates="servicios")
    mascota = relationship("Mascota")
    area = relationship("AreaServicio")
    asignado_a = relationship("Usuario", foreign_keys=[asignado_a_id])
    adjuntos = relationship("Adjunto", back_populates="servicio")
    catalogo_servicio = relationship("CatalogoServicio", back_populates="servicios_consulta")
    # Movimientos de stock generados por aplicar este servicio (slice B lo escribe).
    movimientos = relationship("MovimientoInventario", back_populates="servicio_consulta")
    consumos_material = relationship("ConsumoMaterial", back_populates="servicio_consulta")

    def subtotal(self):
        return self.cantidad * self.precio_unitario


class Adjunto(Base):
    """Documento cargado contra un servicio (Tarea 06, decision 7).

    Cuelga del servicio, no de la tabla clinica: un estudio puede tener tres
    placas, y las columnas `archivo_url` sueltas (PruebaComplementaria,
    ConsentimientoInformado) no soportan mas de un archivo, no registran quien
    ni cuando, y no tienen control de acceso.

    Los bytes NO viven en la base ni bajo static/ (decision 8): van a
    /app/data/adjuntos en un volumen propio, y `ruta_relativa` es la ruta
    dentro de esa raiz, siempre generada (YYYY/MM/<uuid4>.<ext>). Ningun string
    controlado por el usuario entra en la ruta, asi que el path traversal es
    estructuralmente imposible.
    """
    __tablename__ = "adjuntos"

    id = Column(Integer, primary_key=True, index=True)
    servicio_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=False, index=True)
    # Solo para mostrar y para el Content-Disposition. NUNCA se usa como ruta.
    nombre_original = Column(String(255), nullable=False)
    # El tipo DETECTADO por los bytes, no el declarado por el cliente: la
    # descarga sirve este valor, nunca el que el cliente afirmo.
    content_type = Column(String(100), nullable=False)
    tamano_bytes = Column(Integer, nullable=False)  # medido al escribir, no leido del header
    # Integridad (verificar el respaldo) y deduplicacion (el PDF que el
    # laboratorio reenvia).
    sha256 = Column(String(64), nullable=False, index=True)
    ruta_relativa = Column(String(255), nullable=False, unique=True)
    subido_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Soft delete, mismo criterio que ServicioConsulta y NotaClinica: un informe
    # de rayos X que desaparece sin rastro es un problema de auditoria. Un
    # adjunto is_deleted no cuenta para el gate de requiere_adjunto.
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"), default=False)

    servicio = relationship("ServicioConsulta", back_populates="adjuntos")
    subido_por = relationship("Usuario")

    def __repr__(self):
        return f"<Adjunto {self.id} - servicio {self.servicio_id}>"


class Notificacion(Base):
    """Aviso dirigido a un usuario (Tarea 06, decision 6).

    Fan-out EN ESCRITURA: si el servicio va a un area con tres gestores se
    crean tres filas. Guardar el area y resolver destinatarios al leer seria
    mas compacto pero mentiria sobre la historia -- un gestor agregado manana
    apareceria como destinatario de un aviso que nunca recibio. Una
    notificacion es un registro inmutable de a quien se le aviso que.

    OJO con la distincion: la notificacion es el empujon, la BANDEJA del gestor
    es una query sobre servicios_consulta. No son lo mismo: si lo fueran,
    marcar leida una notificacion esconderia trabajo real.
    """
    __tablename__ = "notificaciones"

    __table_args__ = (
        # Badge de no leidas: es la consulta de cada poll.
        Index(
            "ix_notificaciones_destinatario_leida_created",
            "destinatario_id",
            "leida_at",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    destinatario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    # SERVICIO_ASIGNADO | SERVICIO_EJECUTADO | ORDEN_ASIGNADA | SERVICIO_SIN_GESTOR
    tipo = Column(String(40), nullable=False)
    titulo = Column(String(160), nullable=False)
    cuerpo = Column(Text, nullable=True)
    orden_id = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=True)  # para navegar al hacer clic
    servicio_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Timestamp y no boolean: mismo precio de almacenamiento y ademas se obtiene
    # CUANDO la vio, que es lo que necesita cualquier metrica de tiempo de
    # respuesta del gestor. Precedente: NotaClinica.fecha_edicion. NULL = no leida.
    leida_at = Column(DateTime(timezone=True), nullable=True)
    # canal y enviado_at nacen con la tabla vacia (cuesta cero) para que sumar
    # correo o WhatsApp despues sea un worker y no otra migracion con backfill.
    # En esta tarea solo se implementa APP.
    canal = Column(String(20), nullable=False, server_default="APP", default="APP")
    enviado_at = Column(DateTime(timezone=True), nullable=True)  # NULL para APP

    destinatario = relationship("Usuario")
    orden = relationship("OrdenServicio")
    servicio = relationship("ServicioConsulta")

    def __repr__(self):
        return f"<Notificacion {self.id} - {self.tipo} -> {self.destinatario_id}>"


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
    # Numeric(12, 3): el stock se suma y resta cientos de veces; Float acumula
    # error de redondeo. DECIMAL es aritmetica exacta (Tarea 07, decision 2).
    stock_actual = Column(Numeric(12, 3), nullable=False, default=0)
    stock_minimo = Column(Numeric(12, 3), nullable=False, default=5)
    fecha_vencimiento = Column(Date)
    proveedor = Column(String(200))
    ubicacion = Column(String(100))  # Ubicación física en el almacén
    # --- Inventario fraccionado (Tarea 07, slice A) ---
    # Discriminador de uso de la fila. Conjunto cerrado: MATERIAL | PRODUCTO.
    # MATERIAL se consume via servicios; PRODUCTO se vende directo. Sin Enum en
    # este slice (la migracion fija el server_default 'PRODUCTO').
    tipo_item = Column(String(12), nullable=False, server_default="PRODUCTO")
    # Unidad base de stock: 'ml' | 'g' | 'unidad'. NULL en el padron existente;
    # NULL se interpreta como 'unidad' con envase 1 para la aritmetica.
    unidad_medida = Column(String(12), nullable=True)
    # Contenido en unidad base por envase de compra (botella 1 L -> 1000).
    contenido_por_envase = Column(Numeric(12, 3), nullable=True)
    # Si True, consumir cualquier fraccion descarta el resto del envase (MERMA).
    merma_al_abrir = Column(Boolean, nullable=False, server_default="false")
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    activo = Column(Boolean, default=True)

    # Relaciones
    detalles_factura = relationship("DetalleFactura", back_populates="producto")
    recetas = relationship("RecetaServicio", back_populates="inventario")
    consumos_material = relationship("ConsumoMaterial", back_populates="inventario")
    # Historial de precio de lista (Tarea 08). Del mas viejo al mas nuevo; el
    # cascade sigue el mismo criterio que CatalogoServicio.recetas: borrar el
    # material se lleva su historial (decision 2).
    historial_precios = relationship(
        "HistorialPrecioInventario",
        back_populates="inventario",
        order_by="HistorialPrecioInventario.fecha_cambio",
        cascade="all, delete-orphan",
    )

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

    # Monto fijo que cobra este veterinario por cada consulta liquidada
    # (Unidad E). NULL = tarifa no configurada todavia: el calculo de
    # liquidacion debe rechazar, no asumir 0.
    tarifa_consulta = Column(Numeric(10, 2), nullable=True)

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
    estado = Column(String(20), default="PENDIENTE")  # PENDIENTE, PAGADA, ANULADA, PARCIAL
    metodo_pago = Column(String(50))  # Efectivo, Tarjeta, Transferencia
    total_pagado = Column(Float, default=0.0) # Para Cuentas por Cobrar
    saldo_pendiente = Column(Float, default=0.0)
    observaciones = Column(Text)
    
    # Clave foránea
    propietario_id = Column(Integer, ForeignKey("propietarios.id"), nullable=False)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True)
    
    # Relaciones
    propietario = relationship("Propietario", back_populates="facturas")
    detalles = relationship("DetalleFactura", back_populates="factura", cascade="all, delete-orphan")
    consulta = relationship("Consulta", back_populates="facturas")
    abonos = relationship("Abono", back_populates="factura")

    def __repr__(self):
        return f"<Factura {self.numero_factura}>"


class Abono(Base):
    """Modelo para pagos parciales sobre una factura"""
    __tablename__ = "abonos"

    id = Column(Integer, primary_key=True, index=True)
    numero_abono = Column(String(50), unique=True)
    factura_id = Column(Integer, ForeignKey("facturas.id"), nullable=False)
    monto = Column(Numeric(10, 2), nullable=False)
    metodo_pago = Column(String(50), nullable=False)
    fecha = Column(DateTime, default=datetime.utcnow)
    notas = Column(Text, nullable=True)

    factura = relationship("Factura", back_populates="abonos")

    def __repr__(self):
        return f"<Abono {self.numero_abono} - {self.monto}>"


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
    servicio_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=True) # Para linkar a servicios clínicos
    
    # Relaciones
    factura = relationship("Factura", back_populates="detalles")
    producto = relationship("Inventario", back_populates="detalles_factura")
    servicio = relationship("ServicioConsulta")
    
    def __repr__(self):
        return f"<DetalleFactura {self.id} - Factura {self.factura_id}>"


class Liquidacion(Base):
    """Cabecera de una corrida de pago a un veterinario (Unidad E).

    Registra el rango consultado y el total resultante. El detalle
    consulta-por-consulta vive en LiquidacionDetalle para que el monto
    siempre se pueda desglosar.
    """
    __tablename__ = "liquidaciones"

    id = Column(Integer, primary_key=True, index=True)
    veterinario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    fecha_inicio = Column(DateTime(timezone=True), nullable=False)
    fecha_fin = Column(DateTime(timezone=True), nullable=False)
    fecha_calculo = Column(DateTime(timezone=True), server_default=func.now())
    total = Column(Numeric(10, 2), nullable=False, default=0)

    veterinario = relationship("Usuario")
    detalles = relationship("LiquidacionDetalle", back_populates="liquidacion", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Liquidacion {self.id} - Veterinario {self.veterinario_id}>"


class LiquidacionDetalle(Base):
    """Una consulta incluida en una liquidacion, con la tarifa ya aplicada.

    tarifa_aplicada es una COPIA de Usuario.tarifa_consulta tomada en el
    momento del calculo, no una referencia viva: si la tarifa del
    veterinario cambia despues, lo ya liquidado no se mueve (regla de
    Daniel, Unidad E de docs/tareas/04-kpis-recetas-y-veterinarios.md).

    consulta_id es unique: una consulta no puede quedar incluida en mas de
    una liquidacion nunca, ni siquiera si se recalcula sobre un rango que
    se superpone con uno ya liquidado.
    """
    __tablename__ = "liquidacion_detalles"

    id = Column(Integer, primary_key=True, index=True)
    liquidacion_id = Column(Integer, ForeignKey("liquidaciones.id"), nullable=False)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=False, unique=True)
    factura_id = Column(Integer, ForeignKey("facturas.id"), nullable=False)
    tarifa_aplicada = Column(Numeric(10, 2), nullable=False)
    fecha_consulta = Column(DateTime(timezone=True), nullable=False)

    liquidacion = relationship("Liquidacion", back_populates="detalles")
    consulta = relationship("Consulta")
    factura = relationship("Factura")

    def __repr__(self):
        return f"<LiquidacionDetalle {self.id} - Consulta {self.consulta_id}>"


# ========== COMISIONES POR SERVICIO (comisiones-por-servicio) ==========
# Tablas nuevas a proposito (decision 1): el dev corre create_all, que crea
# tablas pero no agrega columnas a las existentes.

class ConfiguracionComision(Base):
    """Fila unica con el porcentaje de comision por defecto (0-100) que aplica
    a todo encargado sin porcentaje propio."""
    __tablename__ = "configuracion_comision"

    id = Column(Integer, primary_key=True)
    porcentaje_defecto = Column(Numeric(5, 2), nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("porcentaje_defecto >= 0 AND porcentaje_defecto <= 100", name="ck_config_comision_rango"),
    )


class ComisionEncargado(Base):
    """Porcentaje propio de un encargado; reemplaza al de defecto. Sin fila,
    el encargado usa ConfiguracionComision.porcentaje_defecto."""
    __tablename__ = "comision_encargados"

    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, unique=True, index=True)
    porcentaje = Column(Numeric(5, 2), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    usuario = relationship("Usuario")

    __table_args__ = (
        CheckConstraint("porcentaje >= 0 AND porcentaje <= 100", name="ck_comision_encargado_rango"),
    )


class LiquidacionComision(Base):
    """Cabecera de una liquidacion de comisiones a un encargado. Los totales
    son la suma de sus detalles (ajustes negativos incluidos)."""
    __tablename__ = "liquidaciones_comision"

    id = Column(Integer, primary_key=True, index=True)
    encargado_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    desde = Column(Date, nullable=False)
    hasta = Column(Date, nullable=False)
    fecha_calculo = Column(DateTime(timezone=True), server_default=func.now())
    creada_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    total_encargado = Column(Numeric(12, 2), nullable=False, default=0)
    total_amivets = Column(Numeric(12, 2), nullable=False, default=0)

    encargado = relationship("Usuario", foreign_keys=[encargado_id])
    detalles = relationship(
        "LiquidacionComisionDetalle",
        back_populates="liquidacion",
        cascade="all, delete-orphan",
        order_by="LiquidacionComisionDetalle.fecha_cobro",
    )

    @property
    def numero(self) -> str:
        return f"LC-{self.id:06d}" if self.id else ""


class LiquidacionComisionDetalle(Base):
    """Una linea de servicio liquidada (o su ajuste por anulacion), con el
    porcentaje y los montos COPIADOS al liquidar: no cambian si despues
    cambia el porcentaje del encargado.

    Candado contra el doble pago (decision 2): un par (servicio, factura) se
    liquida una sola vez como linea normal y una sola vez como ajuste. Si la
    factura se anula y el servicio se vuelve a cobrar en otra factura, es otro
    par y se puede liquidar de nuevo.
    """
    __tablename__ = "liquidacion_comision_detalles"

    id = Column(Integer, primary_key=True, index=True)
    liquidacion_id = Column(Integer, ForeignKey("liquidaciones_comision.id"), nullable=False, index=True)
    servicio_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=False)
    factura_id = Column(Integer, ForeignKey("facturas.id"), nullable=False)
    orden_id = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=True)
    descripcion = Column(String(255), nullable=True)
    fecha_cobro = Column(DateTime(timezone=True), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=False)
    porcentaje = Column(Numeric(5, 2), nullable=False)
    monto_encargado = Column(Numeric(12, 2), nullable=False)
    monto_amivets = Column(Numeric(12, 2), nullable=False)
    es_ajuste = Column(Boolean, nullable=False, default=False, server_default="false")

    liquidacion = relationship("LiquidacionComision", back_populates="detalles")

    __table_args__ = (
        Index(
            "uq_liq_comision_linea",
            "servicio_id", "factura_id",
            unique=True,
            postgresql_where=text("es_ajuste = false"),
        ),
        Index(
            "uq_liq_comision_ajuste",
            "servicio_id", "factura_id",
            unique=True,
            postgresql_where=text("es_ajuste = true"),
        ),
    )


class MovimientoInventario(Base):
    """Trazabilidad obligatoria: Cada vez que entra o sale un producto"""
    __tablename__ = "movimientos_inventario"
    
    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    # Conjunto previsto: ENTRADA | SALIDA | MERMA | AJUSTE | REVERSA.
    # Se mantiene String (sin Enum) en este slice; el enum se decide en slice B.
    tipo_movimiento = Column(String(20), nullable=False)
    # Numeric(12, 3): el ledger no debe arrastrar colas de redondeo (decision 2).
    cantidad = Column(Numeric(12, 3), nullable=False)
    costo_unitario = Column(Float, nullable=False) # Para finanzas/Kardex
    lote = Column(String(50), nullable=True) # Para medicinas
    fecha_vencimiento = Column(Date, nullable=True)
    origen_destino = Column(String(255)) # ID de factura, Nombre proveedor, etc.
    fecha_registro = Column(DateTime(timezone=True), server_default=func.now())
    usuario_responsable_id = Column(Integer, ForeignKey("usuarios.id"))
    # Ancla opcional al servicio que genero el movimiento. Slice A solo crea la
    # columna; el guard anti-doble-descuento por ledger llega en slice B.
    servicio_consulta_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=True, index=True)

    # Relaciones
    producto = relationship("Inventario")
    responsable = relationship("Usuario")
    servicio_consulta = relationship("ServicioConsulta", back_populates="movimientos")


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


class NotaClinica(Base):
    """Bitacora de notas fechadas atada al paciente (Unidad B, tarea 05).

    mascota_id es obligatorio: toda nota vive siempre en la historia del
    paciente, sea cual sea su origen. consulta_id es opcional -- permite
    anclar una nota a una consulta puntual ("seguimiento de la consulta del
    martes") sin exigir que exista una consulta formal, que es justo el
    vacio que esta tabla viene a llenar (ej: "la dueña llamo, el animal
    sigue sin comer" no ocurre dentro de ninguna consulta). Mismo criterio
    que PruebaComplementaria, que ya tiene consulta_id nullable + mascota_id
    obligatorio.
    """
    __tablename__ = "notas_clinicas"

    id = Column(Integer, primary_key=True, index=True)
    mascota_id = Column(Integer, ForeignKey("mascotas.id"), nullable=False)
    consulta_id = Column(Integer, ForeignKey("consultas.id"), nullable=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    # Set fijo y simple (general/seguimiento/llamada/incidencia): es mas
    # facil agregar una categoria despues que sacar texto libre ya cargado.
    categoria = Column(String(20), nullable=False, default="general")
    texto = Column(Text, nullable=False)
    fecha_creacion = Column(DateTime(timezone=True), server_default=func.now())
    # Borrado logico -- mismo patron que ServicioConsulta.is_deleted: en un
    # contexto clinico, una nota que desaparece sin dejar rastro es un
    # problema de auditoria.
    is_deleted = Column(Boolean, default=False)

    # Rastro de edicion/borrado en la misma fila. El proyecto no tiene
    # precedente de un audit-log separado (Liquidacion/LiquidacionDetalle
    # son snapshots, no historiales de cambios), asi que una tabla nueva
    # solo para esto seria sobre-diseño.
    fecha_edicion = Column(DateTime(timezone=True), nullable=True)
    editado_por_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)

    mascota = relationship("Mascota")
    consulta = relationship("Consulta")
    usuario = relationship("Usuario", foreign_keys=[usuario_id])
    editado_por = relationship("Usuario", foreign_keys=[editado_por_id])

    def __repr__(self):
        return f"<NotaClinica {self.id} - Mascota {self.mascota_id}>"


class CatalogoServicio(Base):
    """Catalogo maestro de servicios y procedimientos de la clinica"""
    __tablename__ = "catalogo_servicios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(255), nullable=False, index=True)
    categoria = Column(String(100), nullable=False, index=True)
    precio_ref = Column(Float, default=0.0)
    precio_variable = Column(Boolean, default=False)
    unidad = Column(String(100))
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- Despacho y adjuntos (Tarea 06, decisiones 5 y 7) ---
    # Area que EJECUTA este item. NULL = no se despacha: es el atajo sin
    # despacho de la decision 4 (va directo SOLICITADO -> EJECUTADO). No se
    # reutiliza `categoria` porque ese es un eje comercial (como se agrupa en el
    # catalogo y en los reportes), no una estacion de trabajo.
    area_id = Column(Integer, ForeignKey("areas_servicio.id"), nullable=True, index=True)
    # Override por item de la exigencia de adjunto. NULL = hereda de
    # AreaServicio.requiere_adjunto; sin area, no exige. La cascada se evalua en
    # la transicion EN_PROCESO -> EJECUTADO.
    requiere_adjunto = Column(Boolean, nullable=True)

    # Materiales que consume este servicio (receta / BOM). Tarea 07, slice A.
    recetas = relationship(
        "RecetaServicio",
        back_populates="catalogo_servicio",
        cascade="all, delete-orphan",
    )
    servicios_consulta = relationship("ServicioConsulta", back_populates="catalogo_servicio")
    area = relationship("AreaServicio")
    # Historial de precio de referencia (Tarea 08), mismo criterio que Inventario.
    historial_precios = relationship(
        "HistorialPrecioServicio",
        back_populates="catalogo_servicio",
        order_by="HistorialPrecioServicio.fecha_cambio",
        cascade="all, delete-orphan",
    )


class RecetaServicio(Base):
    """Receta (BOM) de un servicio del catalogo: que materiales consume y cuanto.

    Es una plantilla con la cantidad estandar. Al aplicar el servicio, el
    veterinario ajusta la cantidad real; contra el stock va la real
    (ver ConsumoMaterial). Nace vacia (Tarea 07, decision 6 y 8).
    """
    __tablename__ = "recetas_servicio"

    # PK id sin index=True explicito: en Postgres el PRIMARY KEY ya crea su
    # indice unico, agregar otro es redundante (M-NIT).
    id = Column(Integer, primary_key=True)
    catalogo_servicio_id = Column(Integer, ForeignKey("catalogo_servicios.id"), nullable=False, index=True)
    inventario_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    cantidad = Column(Numeric(12, 3), nullable=False)
    unidad_medida = Column(String(12), nullable=False)  # 'ml' | 'g' | 'unidad'
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("catalogo_servicio_id", "inventario_id", name="uq_receta_servicio_material"),
    )

    catalogo_servicio = relationship("CatalogoServicio", back_populates="recetas")
    inventario = relationship("Inventario", back_populates="recetas")

    def __repr__(self):
        return f"<RecetaServicio svc={self.catalogo_servicio_id} inv={self.inventario_id}>"


class ConsumoMaterial(Base):
    """Cantidad real de un material consumida en una aplicacion de servicio.

    Una fila por material por aplicacion del servicio. Dispara el
    MovimientoInventario (slice B) y es lo que se revierte al anular.
    movimiento_id enlaza la trazabilidad consumo -> ledger.
    """
    __tablename__ = "consumo_material"

    # PK id sin index=True explicito (ver RecetaServicio): redundante en Postgres.
    id = Column(Integer, primary_key=True)
    servicio_consulta_id = Column(Integer, ForeignKey("servicios_consulta.id"), nullable=False, index=True)
    inventario_id = Column(Integer, ForeignKey("inventario.id"), nullable=False)
    cantidad = Column(Numeric(12, 3), nullable=False)
    unidad_medida = Column(String(12), nullable=False)
    movimiento_id = Column(Integer, ForeignKey("movimientos_inventario.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    servicio_consulta = relationship("ServicioConsulta", back_populates="consumos_material")
    inventario = relationship("Inventario", back_populates="consumos_material")
    movimiento = relationship("MovimientoInventario")

    def __repr__(self):
        return f"<ConsumoMaterial svc_consulta={self.servicio_consulta_id} inv={self.inventario_id}>"


class HistorialPrecioInventario(Base):
    """Un cambio del precio de lista (venta) de un material/producto (Tarea 08).

    Append-only: nunca UPDATE ni DELETE (decision 6). Una correccion es una fila
    nueva con corrige_id (self-FK) apuntando a la anulada. precio_anterior es
    redundante a proposito: hace cada fila autoexplicativa para la tabla de la
    UI (fecha, precio, variacion, quien) sin joins (decision 3).

    Numeric(10, 2) como el resto de las columnas de dinero de features nuevas
    (decision 8). El registro de migracion se reconoce por
    precio_anterior IS NULL AND usuario_id IS NULL (decision 7).
    """
    __tablename__ = "historial_precio_inventario"

    id = Column(Integer, primary_key=True, index=True)
    inventario_id = Column(Integer, ForeignKey("inventario.id"), nullable=False, index=True)
    precio_nuevo = Column(Numeric(10, 2), nullable=False)
    precio_anterior = Column(Numeric(10, 2), nullable=True)
    motivo = Column(String(200), nullable=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    corrige_id = Column(Integer, ForeignKey("historial_precio_inventario.id"), nullable=True)
    fecha_cambio = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        # Responde "precio vigente en la fecha X" con ORDER BY fecha_cambio DESC
        # LIMIT 1 en O(log n) (decision 3).
        Index("ix_hist_precio_inv_inventario_fecha", "inventario_id", "fecha_cambio"),
    )

    inventario = relationship("Inventario", back_populates="historial_precios")
    usuario = relationship("Usuario")
    corrige = relationship("HistorialPrecioInventario", remote_side=[id])

    def __repr__(self):
        return f"<HistorialPrecioInventario inv={self.inventario_id} {self.precio_anterior}->{self.precio_nuevo}>"


class HistorialPrecioServicio(Base):
    """Un cambio del precio de referencia de un servicio del catalogo (Tarea 08).

    Misma forma y mismas reglas que HistorialPrecioInventario. Para servicios con
    precio_variable = True el precio_ref es orientativo; el historial lo registra
    igual (es lo que la clinica declara como referencia).
    """
    __tablename__ = "historial_precio_servicio"

    id = Column(Integer, primary_key=True, index=True)
    catalogo_servicio_id = Column(Integer, ForeignKey("catalogo_servicios.id"), nullable=False, index=True)
    precio_nuevo = Column(Numeric(10, 2), nullable=False)
    precio_anterior = Column(Numeric(10, 2), nullable=True)
    motivo = Column(String(200), nullable=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    corrige_id = Column(Integer, ForeignKey("historial_precio_servicio.id"), nullable=True)
    fecha_cambio = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("ix_hist_precio_svc_servicio_fecha", "catalogo_servicio_id", "fecha_cambio"),
    )

    catalogo_servicio = relationship("CatalogoServicio", back_populates="historial_precios")
    usuario = relationship("Usuario")
    corrige = relationship("HistorialPrecioServicio", remote_side=[id])

    def __repr__(self):
        return f"<HistorialPrecioServicio svc={self.catalogo_servicio_id} {self.precio_anterior}->{self.precio_nuevo}>"

