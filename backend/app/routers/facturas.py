from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from io import BytesIO

from app.core.database import get_db
from app.schemas.schemas import FacturaCreate, FacturaUpdate, FacturaResponse, AbonoCreate, AbonoResponse
from app.models.models import Factura, Abono
from app.services.facturacion_service import FacturacionService
from app.services.pdf_service import PDFService

router = APIRouter(prefix="/api/facturas", tags=["Facturación"])


@router.post("/", response_model=FacturaResponse, status_code=status.HTTP_201_CREATED)
def crear_factura(
    factura: FacturaCreate,
    db: Session = Depends(get_db)
):
    """
    Crea una nueva factura y descuenta automáticamente el inventario.
    
    - Valida stock disponible
    - Descuenta productos del inventario
    - Calcula totales automáticamente
    - Genera número de factura único
    """
    return FacturacionService.crear_factura(db, factura)


@router.get("/{factura_id}", response_model=FacturaResponse)
def obtener_factura(
    factura_id: int,
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
):
    """Lista todas las facturas con filtros opcionales (estado, propiedad, búsqueda)"""
    return FacturacionService.listar_facturas(db, skip, limit, propietario_id, estado, search)


@router.put("/{factura_id}", response_model=FacturaResponse)
def actualizar_factura(
    factura_id: int,
    factura: FacturaUpdate,
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
):
    """Obtiene todos los items pendientes de cobro de una consulta"""
    return FacturacionService.obtener_items_pendientes_consulta(db, consulta_id)

@router.get("/mascota/{mascota_id}", response_model=List[FacturaResponse])
def obtener_facturas_mascota(
    mascota_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene facturas asociadas a una mascota a través de sus consultas"""
    from app.models.models import Consulta, Factura
    facturas = db.query(Factura).join(Consulta, Factura.consulta_id == Consulta.id).filter(Consulta.mascota_id == mascota_id).all()
    return facturas


@router.post("/{factura_id}/abonar", response_model=AbonoResponse, status_code=status.HTTP_201_CREATED)
def registrar_abono(
    factura_id: int,
    abono_data: AbonoCreate,
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
