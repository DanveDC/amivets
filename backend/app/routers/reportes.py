from datetime import datetime, time, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any, Optional

from app.core.database import get_db
from app.models.models import DetalleFactura, Inventario, Consulta, Usuario, ServicioConsulta, Mascota
from app.routers.usuarios import require_roles
from app.services import consumo_service

router = APIRouter(prefix="/api/reportes", tags=["Reportes y Analitica"])

# HALLAZGO DE SEGURIDAD (Tarea 10): este router nunca tuvo Depends(require_roles)
# en NINGUN endpoint. Confirmado en vivo: GET /api/reportes/finanzas/ingresos
# sin token devolvia 200 con el total de ingresos real de la clinica. Los seis
# endpoints exponen datos financieros (ingresos, cuentas por cobrar) y de
# desempeno por medico (kpi/rendimiento) -- ninguno anonimo.
#
# admin unicamente: la seccion "Informes" del front ya esta restringida a
# admin (static/js/core/router.js:75, roles: ['admin']), y ningun otro rol
# tiene una pantalla que llegue a estos endpoints -- no hay tension con un
# flujo real en uso, a diferencia de facturas/catalogo.
_ROLES_REPORTES = ("admin",)


def _rango_utc(fecha_inicio: Optional[str], fecha_fin: Optional[str]):
    """
    Convierte 'YYYY-MM-DD' en limites datetime UTC-aware.
    fecha_fin cubre hasta el ultimo instante del dia para no excluir
    registros por el desfase entre la fecha local y el almacenamiento en UTC.
    """
    dt_inicio = None
    dt_fin = None
    try:
        if fecha_inicio:
            dt_inicio = datetime.combine(
                datetime.strptime(fecha_inicio, "%Y-%m-%d").date(), time.min, tzinfo=timezone.utc
            )
        if fecha_fin:
            dt_fin = datetime.combine(
                datetime.strptime(fecha_fin, "%Y-%m-%d").date(), time.max, tzinfo=timezone.utc
            )
    except ValueError:
        raise HTTPException(status_code=400, detail="fecha_inicio/fecha_fin deben tener formato YYYY-MM-DD")
    return dt_inicio, dt_fin


@router.get("/kpi/servicios")
def servicios_mas_solicitados(
    limit: int = 5,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Retorna los servicios/productos mas solicitados basandose en el detalle de facturas.
    """
    from app.models.models import Factura

    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    # Consulta agrupada para contar ocurrencias de productos en facturas
    # Se asume que Inventario contiene tanto productos como servicios
    query = (
        db.query(
            Inventario.nombre,
            func.sum(DetalleFactura.cantidad).label("total_vendido")
        )
        .join(DetalleFactura, DetalleFactura.producto_id == Inventario.id)
        .filter(Inventario.activo.is_(True))
    )

    if dt_inicio or dt_fin:
        query = query.join(Factura, Factura.id == DetalleFactura.factura_id)
        if dt_inicio:
            query = query.filter(Factura.fecha_emision >= dt_inicio)
        if dt_fin:
            query = query.filter(Factura.fecha_emision <= dt_fin)

    resultados = (
        query
        .group_by(Inventario.id, Inventario.nombre)
        .order_by(desc("total_vendido"))
        .limit(limit)
        .all()
    )

    return [
        {"servicio": r[0], "total_solicitudes": r[1]}
        for r in resultados
    ]

@router.get("/kpi/rendimiento")
def rendimiento_veterinarios(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Retorna el rendimiento por veterinario (cantidad de consultas realizadas
    e ingresos atribuidos a sus consultas). Agrupa por veterinario_id (FK a
    Usuario), no por el texto libre legado.

    `ingresos` (Tarea 11, boceto Reportes.html — "Producción por médico"):
    suma precio_unitario*cantidad de los servicios EJECUTADO/FACTURADO
    (consumo_service.ESTADOS_CONSUMIDOS) anexados a las consultas del
    veterinario. Es una consulta separada de la de consultas_realizadas
    -y se combinan en Python, no con un JOIN único- porque un JOIN
    ServicioConsulta duplicaría cada Consulta por cada servicio que tiene,
    inflando total_consultas.
    """
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = (
        db.query(
            Usuario.id,
            Usuario.username,
            func.count(Consulta.id).label("total_consultas")
        )
        .join(Consulta, Consulta.veterinario_id == Usuario.id)
        .filter(Consulta.estado != "ANULADA")
    )
    if dt_inicio:
        query = query.filter(Consulta.fecha_consulta >= dt_inicio)
    if dt_fin:
        query = query.filter(Consulta.fecha_consulta <= dt_fin)

    resultados = (
        query
        .group_by(Usuario.id, Usuario.username)
        .order_by(desc("total_consultas"))
        .all()
    )

    ingresos_query = (
        db.query(
            Consulta.veterinario_id,
            func.sum(ServicioConsulta.precio_unitario * ServicioConsulta.cantidad).label("ingresos")
        )
        .join(ServicioConsulta, ServicioConsulta.consulta_id == Consulta.id)
        .filter(
            Consulta.estado != "ANULADA",
            ServicioConsulta.is_deleted.is_(False),
            ServicioConsulta.estado.in_(consumo_service.ESTADOS_CONSUMIDOS),
        )
    )
    if dt_inicio:
        ingresos_query = ingresos_query.filter(Consulta.fecha_consulta >= dt_inicio)
    if dt_fin:
        ingresos_query = ingresos_query.filter(Consulta.fecha_consulta <= dt_fin)

    ingresos_por_vet = {
        r[0]: float(r[1]) if r[1] is not None else 0.0
        for r in ingresos_query.group_by(Consulta.veterinario_id).all()
    }

    return [
        {
            "veterinario_id": r[0],
            "veterinario": r[1],
            "consultas_realizadas": r[2],
            "ingresos": ingresos_por_vet.get(r[0], 0.0),
        }
        for r in resultados
    ]

@router.get("/consultas-por-veterinario")
def consultas_por_veterinario(
    veterinario_id: int,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Detalle de las consultas atendidas por un veterinario puntual en un rango de fechas.
    veterinario_id es obligatorio: mezclar consultas de varios profesionales sin
    distinguir a quien pertenece cada una no sirve para esta vista.
    """
    vet = db.query(Usuario).filter(Usuario.id == veterinario_id).first()
    if not vet:
        raise HTTPException(status_code=404, detail="Veterinario no encontrado")

    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(Consulta).filter(
        Consulta.veterinario_id == veterinario_id,
        Consulta.estado != "ANULADA",
    )
    if dt_inicio:
        query = query.filter(Consulta.fecha_consulta >= dt_inicio)
    if dt_fin:
        query = query.filter(Consulta.fecha_consulta <= dt_fin)

    consultas = query.order_by(Consulta.fecha_consulta.desc()).all()

    detalle = []
    for c in consultas:
        propietario = c.mascota.propietario if c.mascota else None
        servicios_activos = [s for s in c.servicios if not s.is_deleted]
        detalle.append({
            "id": c.id,
            "fecha_consulta": c.fecha_consulta,
            "mascota_id": c.mascota_id,
            "mascota": c.mascota.nombre if c.mascota else None,
            "propietario": f"{propietario.nombre} {propietario.apellido}" if propietario else None,
            "motivo": c.motivo,
            "servicios": [
                {
                    "id": s.id,
                    "tipo_servicio": s.tipo_servicio,
                    "nombre_servicio": s.nombre_servicio,
                    "cantidad": s.cantidad,
                    "precio_unitario": s.precio_unitario,
                    "estado": s.estado
                }
                for s in servicios_activos
            ]
        })

    return {
        "veterinario_id": vet.id,
        "veterinario": vet.username,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "total_consultas": len(detalle),
        "consultas": detalle
    }

@router.get("/kpi/consultas")
def resumen_consultas(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """Consultas atendidas y pacientes unicos en el rango dado."""
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(Consulta).filter(Consulta.estado != "ANULADA")
    if dt_inicio:
        query = query.filter(Consulta.fecha_consulta >= dt_inicio)
    if dt_fin:
        query = query.filter(Consulta.fecha_consulta <= dt_fin)

    agregado = query.with_entities(
        func.count(Consulta.id).label("total"),
        func.count(func.distinct(Consulta.mascota_id)).label("pacientes")
    ).first()

    return {
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "consultas_atendidas": agregado.total or 0,
        "pacientes_unicos": agregado.pacientes or 0
    }

@router.get("/finanzas/ingresos")
def resumen_ingresos(
    periodo: str = "diario", # diario, mensual (ignorado si se pasan fecha_inicio/fecha_fin)
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """Resumen de ingresos para la Subfamilia Administración"""
    from app.models.models import Factura
    from sqlalchemy import extract

    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(Factura)

    if dt_inicio or dt_fin:
        if dt_inicio:
            query = query.filter(Factura.fecha_emision >= dt_inicio)
        if dt_fin:
            query = query.filter(Factura.fecha_emision <= dt_fin)
    elif periodo == "diario":
        query = query.filter(func.date(Factura.fecha_emision) == func.current_date())
    elif periodo == "mensual":
        query = query.filter(extract('month', Factura.fecha_emision) == extract('month', func.now()))
        query = query.filter(extract('year', Factura.fecha_emision) == extract('year', func.now()))

    agregado = query.with_entities(
        func.sum(Factura.total).label("total"),
        func.count(Factura.id).label("cantidad")
    ).first()

    cantidad_facturas = agregado.cantidad or 0
    total_ingresos = float(agregado.total) if agregado.total is not None else None
    ticket_promedio = (total_ingresos / cantidad_facturas) if (total_ingresos is not None and cantidad_facturas) else None

    return {
        "periodo": periodo,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "total_ingresos": total_ingresos,
        "cantidad_facturas": cantidad_facturas,
        "ticket_promedio": ticket_promedio
    }

@router.get("/finanzas/cuentas-por-cobrar")
def cuentas_por_cobrar(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """Gestión de cobros pendientes"""
    from app.models.models import Factura, Propietario

    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = (
        db.query(
            Factura.numero_factura,
            Factura.saldo_pendiente,
            Propietario.nombre,
            Propietario.apellido
        )
        .join(Propietario)
        .filter(Factura.saldo_pendiente > 0)
    )
    if dt_inicio:
        query = query.filter(Factura.fecha_emision >= dt_inicio)
    if dt_fin:
        query = query.filter(Factura.fecha_emision <= dt_fin)

    pendientes = query.all()

    detalle = [
        {
            "factura": p[0],
            "saldo_deudor": p[1],
            "cliente": f"{p[2]} {p[3]}"
        } for p in pendientes
    ]
    total_pendiente = sum(p[1] for p in pendientes) if pendientes else None

    return {
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "total_pendiente": total_pendiente,
        "cantidad_facturas": len(detalle),
        "detalle": detalle
    }


# ── Tarea 11 — nuevos KPI que pide Reportes.html y que el backend no
# exponía todavía. Ninguno toca el modelo de datos ni requiere migración:
# son agregaciones sobre columnas que ya existen (ServicioConsulta.tipo_
# servicio, Mascota.especie, Mascota.fecha_registro). "Patologías más
# frecuentes" del boceto se deja afuera a propósito: Consulta.diagnostico
# es texto libre (ver docs/diseno/pantallas/README.md), no hay catálogo de
# diagnósticos para agrupar, y el boceto mismo lo marca como "Requiere
# catálogo de diagnósticos" — no se mockea.

@router.get("/kpi/ingresos-por-tipo-servicio")
def ingresos_por_tipo_servicio(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Ingresos y cantidad de servicios por tipo_servicio (boceto: "Ingresos
    por servicio" — Consultas/Cirugías/Hospitalización/Laboratorio/
    Estética/Vacunas/Productos). Solo servicios EJECUTADO/FACTURADO
    (consumo_service.ESTADOS_CONSUMIDOS), no borrados.
    """
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(
        ServicioConsulta.tipo_servicio,
        func.sum(ServicioConsulta.precio_unitario * ServicioConsulta.cantidad).label("total_ingresos"),
        func.count(ServicioConsulta.id).label("cantidad"),
    ).filter(
        ServicioConsulta.is_deleted.is_(False),
        ServicioConsulta.estado.in_(consumo_service.ESTADOS_CONSUMIDOS),
    )
    if dt_inicio:
        query = query.filter(ServicioConsulta.created_at >= dt_inicio)
    if dt_fin:
        query = query.filter(ServicioConsulta.created_at <= dt_fin)

    resultados = query.group_by(ServicioConsulta.tipo_servicio).order_by(desc("total_ingresos")).all()

    return [
        {
            "tipo_servicio": r[0],
            "total_ingresos": float(r[1]) if r[1] is not None else 0.0,
            "cantidad": r[2],
        }
        for r in resultados
    ]


@router.get("/kpi/mascotas-por-especie")
def atenciones_por_especie(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Atenciones (consultas no anuladas) agrupadas por especie de la
    mascota (boceto: "Por tipo de mascota"). Cuenta consultas, no
    mascotas distintas -- el boceto mide "% de atenciones", no "% del
    padrón de pacientes".
    """
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = (
        db.query(Mascota.especie, func.count(Consulta.id).label("atenciones"))
        .join(Consulta, Consulta.mascota_id == Mascota.id)
        .filter(Consulta.estado != "ANULADA")
    )
    if dt_inicio:
        query = query.filter(Consulta.fecha_consulta >= dt_inicio)
    if dt_fin:
        query = query.filter(Consulta.fecha_consulta <= dt_fin)

    resultados = query.group_by(Mascota.especie).order_by(desc("atenciones")).all()

    return [{"especie": r[0], "atenciones": r[1]} for r in resultados]


@router.get("/kpi/pacientes-nuevos")
def pacientes_nuevos(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_REPORTES)),
):
    """
    Mascotas registradas (Mascota.fecha_registro) dentro del rango dado.
    El "% del total atendido" del boceto lo calcula el front combinando
    esto con /kpi/consultas (pacientes_unicos) del mismo rango.
    """
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(func.count(Mascota.id))
    if dt_inicio:
        query = query.filter(Mascota.fecha_registro >= dt_inicio)
    if dt_fin:
        query = query.filter(Mascota.fecha_registro <= dt_fin)

    total = query.scalar() or 0

    return {
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "pacientes_nuevos": total,
    }
