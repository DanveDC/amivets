from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from io import BytesIO

from app.core.database import get_db
from app.schemas.schemas import (
    FacturaCreate, FacturaUpdate, FacturaResponse, AbonoCreate, AbonoResponse,
    FacturaDesdeConsulta, DetalleFacturaCreate,
)
from app.models.models import Factura, Abono, Consulta, Usuario
from app.services.facturacion_service import FacturacionService
from app.services.pdf_service import PDFService
from app.routers.usuarios import require_roles

router = APIRouter(prefix="/api/facturas", tags=["Facturación"])

# HALLAZGO DE SEGURIDAD (encontrado revisando la etapa 8 de Tarea 06, no
# introducido por ella -- este router nunca tuvo Depends(require_roles) en
# NINGUN endpoint, desde antes de Tarea 06). Confirmado en vivo contra el
# stack real: POST /api/facturas/ sin token devolvia 201 y creaba una
# factura de verdad. Se gatea TODO el router ahora.
#
# admin + recepcionista + veterinario en todos los endpoints (no solo
# admin+recepcion, que es lo que dice la fila 19 de la matriz de permisos,
# docs/diseno/ordenes-de-servicio.md decision 9): el veterinario YA
# factura hoy en produccion via cerrarYFacturarConsulta()
# (consultorio.js) -- POST /facturas/from-consulta/{id} -- que es el
# cierre-y-cobro en un paso de una consulta (Tarea 09, decision 8), un
# flujo que funciona para veterinarios desde antes de que existiera esta
# matriz. Restringir a solo admin+recepcion rompe ese flujo YA EN USO.
# La tension entre la matriz (fila 19: veterinario NO deberia facturar) y
# este flujo real es una decision de producto, no algo para resolver acá
# adivinando -- queda anotada para que el usuario la resuelva.
#
# gestor SI queda afuera de todo: ningun caller del frontend
# (cmdk.js, facturacion.js, orden-abierta.js, consultorio.js, hoy.js) es
# una pantalla alcanzable por gestor, y la matriz lo excluye en toda la
# fila de dinero (filas 19-20).
_ROLES_FACTURACION = ("admin", "recepcionista", "veterinario")


@router.post("/", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def crear_factura(
    factura: FacturaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """
    Crea una nueva factura y descuenta automáticamente el inventario.
    
    - Valida stock disponible
    - Descuenta productos del inventario
    - Calcula totales automáticamente
    - Genera número de factura único
    """
    return FacturacionService.crear_factura(db, factura)


@router.post("/from-consulta/{consulta_id}", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def crear_factura_desde_consulta(
    consulta_id: int,
    body: Optional[FacturaDesdeConsulta] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Emite la factura de una consulta en un paso (Tarea 09, decisión 8).

    El servidor arma los detalles desde consulta.servicios (no borrados, no
    facturados) + el honorario de consulta, crea la factura y cierra la consulta
    (crear_factura pone estado='CERRADA' por cualquier camino). El flujo de dos
    pasos (GET /pendientes/{id} -> POST /) sigue funcionando igual.

    Anular la factura después revierte todo: la consulta vuelve a 'ABIERTA' /
    'POR_COBRAR' y sus líneas a no facturadas (ver anular_factura).
    """
    body = body or FacturaDesdeConsulta()

    data = FacturacionService.obtener_items_pendientes_consulta(db, consulta_id)
    items = data.get("items", [])
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La consulta no tiene ítems pendientes de facturar",
        )

    detalles = []
    for it in items:
        es_servicio = it.get("tipo") == "SERVICIO"
        detalles.append(DetalleFacturaCreate(
            producto_id=it.get("producto_id"),
            servicio_id=it["id_interno"] if es_servicio else None,
            # DetalleFactura.cantidad es Integer (deuda preexistente); se
            # redondea una eventual cantidad fraccionada de servicio.
            cantidad=int(round(float(it.get("cantidad") or 1))),
            precio_unitario=it.get("precio_unitario") or 0.0,
            descripcion=it.get("descripcion"),
        ))

    factura_create = FacturaCreate(
        propietario_id=data["propietario_id"],
        consulta_id=consulta_id,
        metodo_pago=body.metodo_pago,
        total_pagado=body.total_pagado or 0.0,
        descuento=body.descuento or 0.0,
        impuesto=body.impuesto or 0.0,
        detalles=detalles,
    )

    # crear_factura ya deja la consulta CERRADA + COBRADO cuando recibe consulta_id.
    return FacturacionService.crear_factura(db, factura_create)


@router.get("/{factura_id}", response_model=FacturaResponse)
def obtener_factura(
    factura_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Obtiene una factura por ID con todos sus detalles"""
    factura = FacturacionService.obtener_factura(db, factura_id)
    if not factura:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura


@router.get("/", response_model=List[FacturaResponse])
def listar_facturas(
    skip: int = 0,
    limit: int = 100,
    propietario_id: Optional[int] = None,
    estado: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Lista todas las facturas con filtros opcionales (estado, propiedad, búsqueda)"""
    return FacturacionService.listar_facturas(db, skip, limit, propietario_id, estado, search)


@router.put("/{factura_id}", response_model=FacturaResponse)
def actualizar_factura(
    factura_id: int,
    factura: FacturaUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Actualiza el estado o información de una factura"""
    factura_actualizada = FacturacionService.actualizar_factura(db, factura_id, factura)
    if not factura_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura_actualizada


@router.post("/{factura_id}/anular", response_model=FacturaResponse)
def anular_factura(
    factura_id: int,
    db: Session = Depends(get_db),
    # Fila 20 de la matriz (decision 9): anular es exclusivo de admin --
    # a diferencia del resto del router, acá NO se suma recepcionista ni
    # veterinario.
    _: Usuario = Depends(require_roles("admin")),
):
    """
    Anula una factura y devuelve el stock al inventario.
    
    - Cambia el estado a ANULADA
    - Devuelve productos al inventario
    """
    factura_anulada = FacturacionService.anular_factura(db, factura_id)
    if not factura_anulada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return factura_anulada


@router.get("/pendientes/{consulta_id}")
def obtener_items_pendientes(
    consulta_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Obtiene todos los items pendientes de cobro de una consulta"""
    return FacturacionService.obtener_items_pendientes_consulta(db, consulta_id)

@router.get("/mascota/{mascota_id}", response_model=List[FacturaResponse])
def obtener_facturas_mascota(
    mascota_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Obtiene facturas asociadas a una mascota a través de sus consultas"""
    from app.models.models import Consulta, Factura
    facturas = db.query(Factura).join(Consulta, Factura.consulta_id == Consulta.id).filter(Consulta.mascota_id == mascota_id).all()
    return facturas


@router.post("/{factura_id}/abonar", response_model=AbonoResponse, status_code=status.HTTP_201_CREATED)
def registrar_abono(
    factura_id: int,
    abono_data: AbonoCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Registra un pago parcial (abono) sobre una factura"""
    factura = db.query(Factura).filter(Factura.id == factura_id).first()
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    if factura.estado in ("PAGADA", "ANULADA"):
        raise HTTPException(
            status_code=400,
            detail=f"No se puede abonar a una factura en estado {factura.estado}"
        )

    monto = float(abono_data.monto)
    if monto <= 0:
        raise HTTPException(status_code=400, detail="El monto del abono debe ser mayor a 0")

    saldo = float(factura.saldo_pendiente) if factura.saldo_pendiente is not None else float(factura.total)
    if monto > saldo:
        raise HTTPException(
            status_code=400,
            detail=f"El monto ({monto}) supera el saldo pendiente ({saldo})"
        )

    count_abonos = db.query(Abono).filter(Abono.factura_id == factura_id).count()
    numero_abono = f"AB-{factura.numero_factura}-{count_abonos + 1:03d}"

    nuevo_abono = Abono(
        numero_abono=numero_abono,
        factura_id=factura_id,
        monto=abono_data.monto,
        metodo_pago=abono_data.metodo_pago,
        notas=abono_data.notas
    )
    db.add(nuevo_abono)

    total_pagado = float(factura.total_pagado or 0) + monto
    nuevo_saldo = saldo - monto

    factura.total_pagado = total_pagado
    factura.saldo_pendiente = nuevo_saldo
    factura.estado = "PAGADA" if nuevo_saldo <= 0 else "PARCIAL"

    db.commit()
    db.refresh(nuevo_abono)
    return nuevo_abono


@router.get("/{factura_id}/abonos", response_model=List[AbonoResponse])
def listar_abonos(
    factura_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Lista todos los abonos registrados para una factura"""
    factura = db.query(Factura).filter(Factura.id == factura_id).first()
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    return db.query(Abono).filter(Abono.factura_id == factura_id).all()


@router.get("/{factura_id}/abonos/{abono_id}/pdf")
def descargar_abono_pdf(
    factura_id: int,
    abono_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Genera y descarga el PDF del comprobante de abono"""
    abono = db.query(Abono).filter(Abono.id == abono_id, Abono.factura_id == factura_id).first()
    if not abono:
        raise HTTPException(status_code=404, detail="Abono no encontrado")

    factura = db.query(Factura).filter(Factura.id == factura_id).first()

    pdf_content = PDFService.generar_abono_pdf(abono, factura)
    if not pdf_content:
        raise HTTPException(status_code=500, detail="Error al generar el PDF del abono")

    return StreamingResponse(
        BytesIO(pdf_content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Abono_{abono.numero_abono}.pdf"}
    )


@router.get("/{factura_id}/pdf")
def descargar_factura_pdf(
    factura_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(*_ROLES_FACTURACION)),
):
    """Genera y descarga el PDF de una factura"""
    factura = FacturacionService.obtener_factura(db, factura_id)
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    
    pdf_content = PDFService.generar_factura_pdf(factura)
    if not pdf_content:
        raise HTTPException(status_code=500, detail="Error al generar el PDF")
    
    filename = f"Factura_{factura.numero_factura}.pdf"
    
    return Response(
        content=pdf_content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
