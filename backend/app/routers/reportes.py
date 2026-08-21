from datetime import datetime, time, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any, Optional

from app.core.database import get_db
from app.models.models import DetalleFactura, Inventario, Consulta, Usuario

router = APIRouter(prefix="/api/reportes", tags=["Reportes y Analitica"])


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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
):
    """
    Retorna el rendimiento por veterinario (cantidad de consultas realizadas).
    Agrupa por veterinario_id (FK a Usuario), no por el texto libre legado.
    """
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = (
        db.query(
            Usuario.id,
            Usuario.username,
            func.count(Consulta.id).label("total_consultas")
        )
        .join(Consulta, Consulta.veterinario_id == Usuario.id)
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

    return [
        {"veterinario_id": r[0], "veterinario": r[1], "consultas_realizadas": r[2]}
        for r in resultados
    ]

@router.get("/kpi/consultas")
def resumen_consultas(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Consultas atendidas y pacientes unicos en el rango dado."""
    dt_inicio, dt_fin = _rango_utc(fecha_inicio, fecha_fin)

    query = db.query(Consulta)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
