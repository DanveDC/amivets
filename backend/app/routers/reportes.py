from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any

from app.core.database import get_db
from app.models.models import DetalleFactura, Inventario, Consulta

router = APIRouter(prefix="/api/reportes", tags=["Reportes y Analitica"])

@router.get("/kpi/servicios")
def servicios_mas_solicitados(
    limit: int = 5,
    db: Session = Depends(get_db)
):
    """
    Retorna los servicios/productos mas solicitados basandose en el detalle de facturas.
    """
    # Consulta agrupada para contar ocurrencias de productos en facturas
    # Se asume que Inventario contiene tanto productos como servicios
    resultados = (
        db.query(
            Inventario.nombre,
            func.sum(DetalleFactura.cantidad).label("total_vendido")
        )
        .join(DetalleFactura, DetalleFactura.producto_id == Inventario.id)
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
    db: Session = Depends(get_db)
):
    """
    Retorna el rendimiento por veterinario (cantidad de consultas realizadas).
    """
    # Consulta agrupada por el campo veterinario de la tabla consultas
    resultados = (
        db.query(
            Consulta.veterinario,
            func.count(Consulta.id).label("total_consultas")
        )
        .filter(Consulta.veterinario.isnot(None))
        .group_by(Consulta.veterinario)
        .order_by(desc("total_consultas"))
        .all()
    )
    
    return [
        {"veterinario": r[0], "consultas_realizadas": r[1]} 
        for r in resultados
    ]
@router.get("/finanzas/ingresos")
def resumen_ingresos(
    periodo: str = "diario", # diario, mensual
    db: Session = Depends(get_db)
):
    """Resumen de ingresos para la Subfamilia Administración"""
    from app.models.models import Factura
    from sqlalchemy import extract
    
    query = db.query(func.sum(Factura.total).label("total"))
    
    if periodo == "diario":
        query = query.filter(func.date(Factura.fecha_emision) == func.current_date())
    elif periodo == "mensual":
        query = query.filter(extract('month', Factura.fecha_emision) == extract('month', func.now()))
        query = query.filter(extract('year', Factura.fecha_emision) == extract('year', func.now()))
        
    resultado = query.scalar() or 0.0
    return {"periodo": periodo, "total_ingresos": resultado}

@router.get("/finanzas/cuentas-por-cobrar")
def cuentas_por_cobrar(db: Session = Depends(get_db)):
    """Gestión de cobros pendientes"""
    from app.models.models import Factura, Propietario
    
    pendientes = (
        db.query(
            Factura.numero_factura,
            Factura.saldo_pendiente,
            Propietario.nombre,
            Propietario.apellido
        )
        .join(Propietario)
        .filter(Factura.saldo_pendiente > 0)
        .all()
    )
    
    return [
        {
            "factura": p[0],
            "saldo_deudor": p[1],
            "cliente": f"{p[2]} {p[3]}"
        } for p in pendientes
    ]
