"""Comisiones por servicio (comisiones-por-servicio).

Reparte lo cobrado por cada línea de servicio entre AmiVets y su encargado.
La parte del encargado sale del tipo de comisión efectivo de la línea
(comision-tipo-mixto-encargado), en este orden de prioridad:
  1. override del item del catálogo (FIJO o PORCENTAJE, si no es HEREDA);
  2. comisión propia del encargado (FIJO, PORCENTAJE o MIXTO);
  3. porcentaje de defecto de ConfiguracionComision.

Todo se calcula DESDE EL ESTADO (decisión 3), no con hooks en los caminos de
cobro: una factura puede pasar a PAGADA por crear_factura, por un abono o por
el PATCH de facturas, y un hook en cada uno sería frágil. Lo único que se
persiste es la liquidación, con el tipo, el porcentaje, el monto fijo y los
montos congelados.

- Línea elegible: ServicioConsulta vivo, facturado, con encargado, cuya
  factura está PAGADA y cuyo par (servicio, factura) todavía no se liquidó.
- Encargado: veterinario de la consulta para la línea CONSULTA (o
  asignado_a_id si es una CONSULTA directa, sin consulta clínica); si no, el
  gestor que tomó el servicio (asignado_a_id). Sin encargado no hay comisión.
- Ajuste: línea ya liquidada cuya factura ahora está ANULADA y todavía no
  tiene su ajuste; se liquida en negativo en la próxima liquidación.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.models import (
    ComisionEncargado,
    ConfiguracionComision,
    CatalogoServicio,
    Consulta,
    DetalleFactura,
    Factura,
    LiquidacionComision,
    LiquidacionComisionDetalle,
    LiquidacionDetalle,
    OrdenServicio,
    ServicioConsulta,
    Usuario,
)

ROLES_ENCARGADO = ("veterinario", "gestor")
CENTAVO = Decimal("0.01")
CIEN = Decimal("100")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


def _centavos(v: Decimal) -> Decimal:
    return v.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def rango_utc(desde: Optional[date], hasta: Optional[date]) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Fechas locales -> límites UTC inclusivos (mismo criterio que reportes)."""
    dt_desde = datetime.combine(desde, time.min, tzinfo=timezone.utc) if desde else None
    dt_hasta = datetime.combine(hasta, time.max, tzinfo=timezone.utc) if hasta else None
    return dt_desde, dt_hasta


# ---------------------------------------------------------------------------
# Configuración de porcentajes
# ---------------------------------------------------------------------------

def obtener_configuracion(db: Session) -> ConfiguracionComision:
    """Fila única; se crea con 0% la primera vez que se pide."""
    config = db.query(ConfiguracionComision).order_by(ConfiguracionComision.id).first()
    if not config:
        config = ConfiguracionComision(porcentaje_defecto=Decimal("0"))
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def actualizar_configuracion(db: Session, porcentaje: Decimal, usuario: Usuario) -> ConfiguracionComision:
    config = obtener_configuracion(db)
    config.porcentaje_defecto = porcentaje
    config.updated_by_id = usuario.id
    db.commit()
    db.refresh(config)
    return config


def _comision_propia(db: Session, usuario_id: int) -> Optional[ComisionEncargado]:
    return db.query(ComisionEncargado).filter(ComisionEncargado.usuario_id == usuario_id).first()


def porcentaje_efectivo(db: Session, usuario_id: int, defecto: Optional[Decimal] = None) -> Decimal:
    """Porcentaje que se aplica al encargado (compatibilidad): el propio si
    tiene uno (0 si su tipo es FIJO), si no el de defecto."""
    propio = _comision_propia(db, usuario_id)
    if propio:
        return _dec(propio.porcentaje)
    return defecto if defecto is not None else _dec(obtener_configuracion(db).porcentaje_defecto)


def obtener_encargado(db: Session, usuario_id: int) -> Usuario:
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario or usuario.role not in ROLES_ENCARGADO:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encargado no encontrado")
    return usuario


def _encargado_a_dict(u: Usuario, propia: Optional[ComisionEncargado], defecto: Decimal) -> dict:
    return {
        "usuario_id": u.id,
        "username": u.username,
        "role": u.role,
        "tipo_comision": propia.tipo_comision if propia else None,
        "monto_fijo": propia.monto_fijo if propia else None,
        "porcentaje_propio": propia.porcentaje if propia else None,
        "porcentaje_efectivo": _dec(propia.porcentaje) if propia else defecto,
    }


def listar_encargados(db: Session) -> List[dict]:
    defecto = _dec(obtener_configuracion(db).porcentaje_defecto)
    propias = {c.usuario_id: c for c in db.query(ComisionEncargado).all()}
    usuarios = (
        db.query(Usuario)
        .filter(Usuario.role.in_(ROLES_ENCARGADO), Usuario.is_active == True)  # noqa: E712
        .order_by(Usuario.username)
        .all()
    )
    return [_encargado_a_dict(u, propias.get(u.id), defecto) for u in usuarios]


def fijar_comision_encargado(db: Session, usuario_id: int, tipo_comision: Optional[str],
                             monto_fijo: Optional[Decimal], porcentaje: Optional[Decimal]) -> dict:
    """Fija la comisión propia; con tipo None la quita y vuelve al porcentaje
    de defecto. El schema ya dejó en None el campo que el tipo no usa."""
    encargado = obtener_encargado(db, usuario_id)
    fila = _comision_propia(db, usuario_id)
    if tipo_comision is None:
        if fila:
            db.delete(fila)
            fila = None
    else:
        if not fila:
            fila = ComisionEncargado(usuario_id=usuario_id)
            db.add(fila)
        fila.tipo_comision = tipo_comision
        fila.monto_fijo = monto_fijo
        fila.porcentaje = porcentaje
    db.commit()
    return _encargado_a_dict(encargado, fila, _dec(obtener_configuracion(db).porcentaje_defecto))


# ---------------------------------------------------------------------------
# Cálculo de líneas
# ---------------------------------------------------------------------------

@dataclass
class Linea:
    servicio_id: int
    factura_id: int
    orden_id: Optional[int]
    orden_numero: Optional[str]
    numero_factura: Optional[str]
    descripcion: Optional[str]
    fecha_cobro: Optional[datetime]
    subtotal: Decimal
    porcentaje: Decimal
    monto_encargado: Decimal
    monto_amivets: Decimal
    es_ajuste: bool = False
    liquidacion_id: Optional[int] = None
    tipo_comision_usado: str = "PORCENTAJE"
    monto_fijo_usado: Optional[Decimal] = None
    porcentaje_usado: Optional[Decimal] = None

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _repartir_con_tipo(subtotal: Decimal, tipo: str, monto_fijo: Decimal, porcentaje: Decimal) -> dict:
    """Parte del encargado según el tipo. Nunca supera lo cobrado: un monto
    fijo mayor al subtotal se recorta, así monto_amivets nunca es negativo.
    Simétrico en el signo: con subtotal negativo (ajuste) devuelve el mismo
    reparto en negativo."""
    subtotal = _centavos(subtotal)
    signo = Decimal("-1") if subtotal < 0 else Decimal("1")
    base = abs(subtotal)
    if tipo == "FIJO":
        enc = _centavos(monto_fijo)
    elif tipo == "PORCENTAJE":
        enc = _centavos(base * porcentaje / CIEN)
    elif tipo == "MIXTO":
        enc = _centavos(monto_fijo + base * porcentaje / CIEN)
    else:
        enc = Decimal("0")
    enc = min(enc, base) * signo
    return {
        "tipo_comision_usado": tipo,
        "monto_fijo_usado": monto_fijo if tipo in ("FIJO", "MIXTO") else None,
        "porcentaje_usado": porcentaje if tipo in ("PORCENTAJE", "MIXTO") else None,
        "monto_encargado": enc,
        "monto_amivets": subtotal - enc,
    }


def calcular_comision(
    db: Session,
    subtotal: Decimal,
    encargado_id: int,
    servicio: Optional[ServicioConsulta] = None,
    catalogo_servicio: Optional[CatalogoServicio] = None,
    propias: Optional[Dict[int, Optional[ComisionEncargado]]] = None,
    defecto: Optional[Decimal] = None,
) -> dict:
    """Reparto de una línea con el tipo efectivo: catálogo (si no hereda) >
    comisión propia del encargado > porcentaje de defecto. Tipo y parámetros
    salen siempre del mismo origen.

    `propias` y `defecto` son caches opcionales para no consultar por línea."""
    if catalogo_servicio is None and servicio is not None:
        catalogo_servicio = servicio.catalogo_servicio
    if catalogo_servicio is not None and catalogo_servicio.tipo_comision_servicio in ("FIJO", "PORCENTAJE"):
        tipo = catalogo_servicio.tipo_comision_servicio
        return _repartir_con_tipo(
            subtotal, tipo,
            _dec(catalogo_servicio.monto_fijo_servicio) if tipo == "FIJO" else Decimal("0"),
            _dec(catalogo_servicio.porcentaje_servicio) if tipo == "PORCENTAJE" else Decimal("0"),
        )

    if propias is not None and encargado_id in propias:
        propia = propias[encargado_id]
    else:
        propia = _comision_propia(db, encargado_id)
        if propias is not None:
            propias[encargado_id] = propia
    if propia is not None:
        tipo = propia.tipo_comision
        return _repartir_con_tipo(
            subtotal, tipo,
            _dec(propia.monto_fijo) if tipo in ("FIJO", "MIXTO") else Decimal("0"),
            _dec(propia.porcentaje) if tipo in ("PORCENTAJE", "MIXTO") else Decimal("0"),
        )

    if defecto is None:
        defecto = _dec(obtener_configuracion(db).porcentaje_defecto)
    return _repartir_con_tipo(subtotal, "PORCENTAJE", Decimal("0"), defecto)


def _linea(reparto: dict, **campos) -> Linea:
    """Linea con los montos y el tipo de un reparto. `porcentaje` (columna
    NOT NULL histórica) es 0 cuando el tipo no usa porcentaje."""
    return Linea(
        porcentaje=reparto["porcentaje_usado"] or Decimal("0"),
        monto_encargado=reparto["monto_encargado"],
        monto_amivets=reparto["monto_amivets"],
        tipo_comision_usado=reparto["tipo_comision_usado"],
        monto_fijo_usado=reparto["monto_fijo_usado"],
        porcentaje_usado=reparto["porcentaje_usado"],
        **campos,
    )


def _filtro_encargado(encargado_id: int):
    """Línea CONSULTA -> veterinario de la consulta; el resto -> asignado_a_id.

    Una CONSULTA anexada directo a la orden (consulta-directa-atajo-sin-
    despacho) no tiene `Consulta` detrás: su encargado es asignado_a_id, el
    veterinario que la ejecutó. Si la línea sí tiene consulta, manda
    Consulta.veterinario_id aunque asignado_a_id diga otra cosa (la consulta
    puede reasignarse después). Requiere el outerjoin a Consulta del llamador.
    """
    return or_(
        and_(ServicioConsulta.tipo_servicio == "CONSULTA", Consulta.veterinario_id == encargado_id),
        and_(
            ServicioConsulta.tipo_servicio == "CONSULTA",
            ServicioConsulta.consulta_id.is_(None),
            ServicioConsulta.asignado_a_id == encargado_id,
        ),
        and_(ServicioConsulta.tipo_servicio != "CONSULTA", ServicioConsulta.asignado_a_id == encargado_id),
    )


def _factor_descuento(f: Factura) -> Decimal:
    """Parte del subtotal de la factura que efectivamente se cobró, sin
    impuesto: (subtotal - descuento) / subtotal. 1 si no hay subtotal."""
    subtotal = _dec(f.subtotal)
    if subtotal <= 0:
        return Decimal("1")
    return max(Decimal("0"), (subtotal - _dec(f.descuento)) / subtotal)


def _pares_cobrados(db: Session, encargado_id: int, dt_desde, dt_hasta) -> List[Tuple[ServicioConsulta, Factura, Decimal]]:
    """(línea, factura PAGADA que la cobró, monto cobrado por esa línea) del
    encargado en el rango.

    El monto es lo COBRADO, no el precio de lista de la línea: el subtotal de
    su DetalleFactura prorrateado por el descuento de la factura. Así la
    comisión nunca se calcula sobre plata que no entró."""
    base_filtros = [
        ServicioConsulta.is_deleted == False,  # noqa: E712
        ServicioConsulta.facturado == True,  # noqa: E712
        Factura.estado == "PAGADA",
        _filtro_encargado(encargado_id),
    ]
    if dt_desde:
        base_filtros.append(Factura.fecha_emision >= dt_desde)
    if dt_hasta:
        base_filtros.append(Factura.fecha_emision <= dt_hasta)

    # 1) Factura por DetalleFactura.servicio_id (cobro por orden, servicio
    #    directo, caja rápida...).
    por_detalle = (
        db.query(ServicioConsulta, Factura, DetalleFactura)
        .options(joinedload(ServicioConsulta.catalogo_servicio))
        .join(DetalleFactura, DetalleFactura.servicio_id == ServicioConsulta.id)
        .join(Factura, Factura.id == DetalleFactura.factura_id)
        .outerjoin(Consulta, Consulta.id == ServicioConsulta.consulta_id)
        .filter(*base_filtros)
        .all()
    )
    pares: Dict[Tuple[int, int], Tuple[ServicioConsulta, Factura, Decimal]] = {}
    for s, f, d in por_detalle:
        cobrado = _centavos(_dec(d.subtotal) * _factor_descuento(f))
        previo = pares.get((s.id, f.id))
        # Una misma línea podría estar en dos detalles de la misma factura:
        # se suman (el par sigue siendo uno solo para el candado de pago).
        pares[(s.id, f.id)] = (s, f, cobrado + (previo[2] if previo else Decimal("0")))

    # 2) Honorario facturado por el endpoint de compatibilidad from-consulta:
    #    la línea no lleva servicio_id y la factura se enlaza por consulta_id.
    #    Solo aplica a líneas CONSULTA que NUNCA tuvieron un DetalleFactura
    #    propio, en ninguna factura y sin importar el rango: si no, una línea
    #    cobrada por detalle fuera del rango se emparejaba además con otra
    #    factura de la consulta y la comisión se pagaba dos veces.
    por_consulta = (
        db.query(ServicioConsulta, Factura)
        .options(joinedload(ServicioConsulta.catalogo_servicio))
        .join(Consulta, Consulta.id == ServicioConsulta.consulta_id)
        .join(Factura, Factura.consulta_id == ServicioConsulta.consulta_id)
        .filter(ServicioConsulta.tipo_servicio == "CONSULTA", *base_filtros)
        .order_by(Factura.fecha_emision.desc(), Factura.id.desc())
        .all()
    )
    candidatas = {s.id for s, _ in por_consulta}
    # Solo cuentan detalles de facturas NO anuladas: si la línea se cobró por
    # detalle y esa factura se anuló, el honorario re-cobrado por consulta_id
    # tiene que seguir generando comisión (fix de revisión).
    con_detalle_alguna_vez = {
        r[0] for r in db.query(DetalleFactura.servicio_id)
        .join(Factura, Factura.id == DetalleFactura.factura_id)
        .filter(DetalleFactura.servicio_id.in_(candidatas or {0}), Factura.estado != "ANULADA")
        .distinct()
        .all()
    }
    tomadas = set()
    for s, f in por_consulta:
        if s.id in con_detalle_alguna_vez or s.id in tomadas:
            continue
        tomadas.add(s.id)
        cobrado = _centavos(_dec(s.cantidad) * _dec(s.precio_unitario) * _factor_descuento(f))
        pares[(s.id, f.id)] = (s, f, cobrado)
    return list(pares.values())


def _numeros_orden(db: Session, orden_ids) -> Dict[int, str]:
    ids = {i for i in orden_ids if i}
    if not ids:
        return {}
    return dict(db.query(OrdenServicio.id, OrdenServicio.numero).filter(OrdenServicio.id.in_(ids)).all())


def lineas_pendientes(db: Session, encargado_id: int, dt_desde=None, dt_hasta=None) -> List[Linea]:
    """Líneas cobradas y sin liquidar, con el tipo de comisión efectivo ACTUAL
    de cada una (catálogo > encargado > defecto)."""
    pares = _pares_cobrados(db, encargado_id, dt_desde, dt_hasta)
    if not pares:
        return []

    servicio_ids = {s.id for s, _, _ in pares}
    ya_liquidados = set(
        db.query(LiquidacionComisionDetalle.servicio_id, LiquidacionComisionDetalle.factura_id)
        .filter(
            LiquidacionComisionDetalle.servicio_id.in_(servicio_ids),
            LiquidacionComisionDetalle.es_ajuste == False,  # noqa: E712
        )
        .all()
    )
    # Consultas ya pagadas con la tarifa fija (Unidad E): nunca más comisión.
    consultas_tarifa_fija = {
        r[0] for r in db.query(LiquidacionDetalle.consulta_id)
        .filter(LiquidacionDetalle.consulta_id.in_({s.consulta_id for s, _, _ in pares if s.consulta_id}))
        .all()
    }
    numeros = _numeros_orden(db, (s.orden_id for s, _, _ in pares))
    propias = {encargado_id: _comision_propia(db, encargado_id)}
    defecto = _dec(obtener_configuracion(db).porcentaje_defecto)

    lineas = []
    for s, f, cobrado in pares:
        if (s.id, f.id) in ya_liquidados:
            continue
        if s.tipo_servicio == "CONSULTA" and s.consulta_id in consultas_tarifa_fija:
            continue
        reparto = calcular_comision(db, cobrado, encargado_id, servicio=s, propias=propias, defecto=defecto)
        lineas.append(_linea(
            reparto,
            servicio_id=s.id,
            factura_id=f.id,
            orden_id=s.orden_id,
            orden_numero=numeros.get(s.orden_id),
            numero_factura=f.numero_factura,
            descripcion=s.nombre_servicio or s.tipo_servicio,
            fecha_cobro=f.fecha_emision,
            subtotal=cobrado,
        ))
    lineas.sort(key=lambda l: (l.fecha_cobro or datetime.min.replace(tzinfo=timezone.utc), l.servicio_id))
    return lineas


def ajustes_pendientes(db: Session, encargado_id: int) -> List[Linea]:
    """Líneas liquidadas cuya factura se anuló después y todavía no tienen su
    ajuste. Se incluyen siempre, sin importar el rango (decisión 6)."""
    liquidadas = (
        db.query(LiquidacionComisionDetalle, Factura)
        .join(LiquidacionComision, LiquidacionComision.id == LiquidacionComisionDetalle.liquidacion_id)
        .join(Factura, Factura.id == LiquidacionComisionDetalle.factura_id)
        .filter(
            LiquidacionComision.encargado_id == encargado_id,
            LiquidacionComisionDetalle.es_ajuste == False,  # noqa: E712
            Factura.estado == "ANULADA",
        )
        .all()
    )
    if not liquidadas:
        return []
    con_ajuste = set(
        db.query(LiquidacionComisionDetalle.servicio_id, LiquidacionComisionDetalle.factura_id)
        .filter(LiquidacionComisionDetalle.es_ajuste == True)  # noqa: E712
        .all()
    )
    numeros = _numeros_orden(db, (d.orden_id for d, _ in liquidadas))
    ajustes = []
    for d, f in liquidadas:
        if (d.servicio_id, d.factura_id) in con_ajuste:
            continue
        # El ajuste revierte EXACTAMENTE lo pagado: montos congelados en
        # negativo, con el tipo y los parámetros congelados de la línea. No se
        # recalcula, así un redondeo o un cambio de reglas nunca deja saldo.
        linea = _linea_de_detalle(d, f.numero_factura, numeros.get(d.orden_id))
        linea.subtotal = -linea.subtotal
        linea.monto_encargado = -linea.monto_encargado
        linea.monto_amivets = -linea.monto_amivets
        linea.es_ajuste = True
        linea.liquidacion_id = None
        ajustes.append(linea)
    return ajustes


def lineas_liquidadas(db: Session, encargado_id: int, dt_desde=None, dt_hasta=None) -> List[Linea]:
    q = (
        db.query(LiquidacionComisionDetalle, Factura.numero_factura)
        .join(LiquidacionComision, LiquidacionComision.id == LiquidacionComisionDetalle.liquidacion_id)
        .join(Factura, Factura.id == LiquidacionComisionDetalle.factura_id)
        .filter(LiquidacionComision.encargado_id == encargado_id)
    )
    if dt_desde:
        q = q.filter(LiquidacionComisionDetalle.fecha_cobro >= dt_desde)
    if dt_hasta:
        q = q.filter(LiquidacionComisionDetalle.fecha_cobro <= dt_hasta)
    filas = q.order_by(LiquidacionComisionDetalle.fecha_cobro, LiquidacionComisionDetalle.id).all()
    numeros = _numeros_orden(db, (d.orden_id for d, _ in filas))
    return [_linea_de_detalle(d, numero_factura, numeros.get(d.orden_id)) for d, numero_factura in filas]


def _linea_de_detalle(d: LiquidacionComisionDetalle, numero_factura: Optional[str], orden_numero: Optional[str]) -> Linea:
    tipo = d.tipo_comision or "PORCENTAJE"
    return Linea(
        servicio_id=d.servicio_id,
        factura_id=d.factura_id,
        orden_id=d.orden_id,
        orden_numero=orden_numero,
        numero_factura=numero_factura,
        descripcion=d.descripcion,
        fecha_cobro=d.fecha_cobro,
        subtotal=_dec(d.subtotal),
        porcentaje=_dec(d.porcentaje),
        monto_encargado=_dec(d.monto_encargado),
        monto_amivets=_dec(d.monto_amivets),
        es_ajuste=bool(d.es_ajuste),
        liquidacion_id=d.liquidacion_id,
        tipo_comision_usado=tipo,
        monto_fijo_usado=_dec(d.monto_fijo) if d.monto_fijo is not None else None,
        porcentaje_usado=_dec(d.porcentaje) if tipo in ("PORCENTAJE", "MIXTO") else None,
    )


def _totales(lineas: List[Linea]) -> dict:
    return {
        "encargado": sum((l.monto_encargado for l in lineas), Decimal("0")),
        "amivets": sum((l.monto_amivets for l in lineas), Decimal("0")),
    }


def control(db: Session, encargado_id: int, desde: Optional[date], hasta: Optional[date]) -> dict:
    encargado = obtener_encargado(db, encargado_id)
    dt_desde, dt_hasta = rango_utc(desde, hasta)
    propia = _comision_propia(db, encargado_id)
    pendientes = ajustes_pendientes(db, encargado_id) + lineas_pendientes(db, encargado_id, dt_desde, dt_hasta)
    liquidadas = lineas_liquidadas(db, encargado_id, dt_desde, dt_hasta)
    return {
        "encargado_id": encargado.id,
        "username": encargado.username,
        "porcentaje_efectivo": porcentaje_efectivo(db, encargado_id),
        "tipo_comision": propia.tipo_comision if propia else None,
        "monto_fijo": propia.monto_fijo if propia else None,
        "pendientes": [l.as_dict() for l in pendientes],
        "liquidadas": [l.as_dict() for l in liquidadas],
        "totales_pendientes": _totales(pendientes),
        "totales_liquidadas": _totales(liquidadas),
    }


# ---------------------------------------------------------------------------
# Liquidación
# ---------------------------------------------------------------------------

def liquidar(db: Session, encargado_id: int, desde: date, hasta: date, usuario: Usuario) -> LiquidacionComision:
    """Congela en una liquidación las líneas pendientes del rango y los ajustes
    pendientes. El índice único (servicio, factura, es_ajuste) es el candado
    contra una liquidación concurrente (decisión 2)."""
    obtener_encargado(db, encargado_id)
    dt_desde, dt_hasta = rango_utc(desde, hasta)
    lineas = ajustes_pendientes(db, encargado_id) + lineas_pendientes(db, encargado_id, dt_desde, dt_hasta)
    if not lineas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No hay comisiones pendientes de liquidar para ese encargado en el rango.",
        )

    totales = _totales(lineas)
    liquidacion = LiquidacionComision(
        encargado_id=encargado_id,
        desde=desde,
        hasta=hasta,
        creada_por_id=usuario.id,
        total_encargado=totales["encargado"],
        total_amivets=totales["amivets"],
    )
    for l in lineas:
        liquidacion.detalles.append(LiquidacionComisionDetalle(
            servicio_id=l.servicio_id,
            factura_id=l.factura_id,
            orden_id=l.orden_id,
            descripcion=(l.descripcion or "")[:255] or None,
            fecha_cobro=l.fecha_cobro,
            subtotal=l.subtotal,
            porcentaje=l.porcentaje,
            monto_encargado=l.monto_encargado,
            monto_amivets=l.monto_amivets,
            es_ajuste=l.es_ajuste,
            tipo_comision=l.tipo_comision_usado,
            monto_fijo=l.monto_fijo_usado,
        ))
    db.add(liquidacion)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Otra liquidación tomó algunas de estas líneas. Recargá y volvé a intentar.",
        )
    db.refresh(liquidacion)
    return liquidacion


def obtener_liquidacion(db: Session, liquidacion_id: int) -> LiquidacionComision:
    liq = db.query(LiquidacionComision).filter(LiquidacionComision.id == liquidacion_id).first()
    if not liq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Liquidación no encontrada")
    return liq


def liquidacion_a_dict(db: Session, liq: LiquidacionComision) -> dict:
    facturas = dict(
        db.query(Factura.id, Factura.numero_factura)
        .filter(Factura.id.in_({d.factura_id for d in liq.detalles} or {0}))
        .all()
    )
    numeros = _numeros_orden(db, (d.orden_id for d in liq.detalles))
    return {
        "id": liq.id,
        "numero": liq.numero,
        "encargado_id": liq.encargado_id,
        "encargado_username": liq.encargado.username if liq.encargado else None,
        "desde": liq.desde,
        "hasta": liq.hasta,
        "fecha_calculo": liq.fecha_calculo,
        "total_encargado": _dec(liq.total_encargado),
        "total_amivets": _dec(liq.total_amivets),
        "detalles": [
            _linea_de_detalle(d, facturas.get(d.factura_id), numeros.get(d.orden_id)).as_dict()
            for d in liq.detalles
        ],
    }


def listar_liquidaciones(db: Session, encargado_id: Optional[int] = None) -> List[dict]:
    q = db.query(LiquidacionComision)
    if encargado_id:
        q = q.filter(LiquidacionComision.encargado_id == encargado_id)
    return [liquidacion_a_dict(db, l) for l in q.order_by(LiquidacionComision.id.desc()).all()]
