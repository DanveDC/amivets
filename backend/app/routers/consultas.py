from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from io import BytesIO

from app.core.database import get_db
from app.schemas.schemas import (
    ConsultaCreate, ConsultaUpdate, ConsultaResponse,
    RecetaCreate, RecetaResponse,
    ServicioConsultaCreate, ServicioConsultaUpdate, ServicioConsultaResponse
)
from app.models.models import Consulta, Receta, DetalleReceta, ServicioConsulta, Inventario, MovimientoInventario, Vacunacion, Usuario
from app.services.consulta_service import ConsultaService
from app.services.pdf_service import PDFService
from app.services import consumo_service
from app.routers.usuarios import require_roles, get_current_admin
from app.routers.servicios import (
    actualizar_servicio_impl,
    eliminar_servicio_impl,
    validar_tipo_servicio_por_rol,
)

router = APIRouter(prefix="/api/consultas", tags=["Consultas"])


@router.post("/", response_model=ConsultaResponse, status_code=status.HTTP_201_CREATED)
def crear_consulta(
    consulta: ConsultaCreate,
    db: Session = Depends(get_db),
    # Fila 1 de la matriz (abrir orden): admin/recepción/veterinario.
    # `gestor` no abre consultas (Tarea 06, decisión 9).
    _: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Crea una nueva consulta"""
    return ConsultaService.crear_consulta(db, consulta)


@router.get("/{consulta_id}", response_model=ConsultaResponse)
def obtener_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Obtiene una consulta por ID"""
    consulta = ConsultaService.obtener_consulta(db, consulta_id)
    if not consulta:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta


@router.get("/", response_model=List[ConsultaResponse])
def listar_consultas(
    skip: int = 0,
    limit: int = 100,
    mascota_id: Optional[int] = None,
    veterinario: Optional[str] = None,
    veterinario_id: Optional[int] = None,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    estado_pago: Optional[str] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Lista todas las consultas con filtros opcionales.

    `estado` filtra por el ciclo de vida clínico (ABIERTA / CERRADA / ANULADA,
    Tarea 09, decisión 6); `estado_pago` sigue filtrando por el eje de cobro.
    `veterinario_id` filtra por el profesional asignado (FK) — lo usa la bandeja
    "Hoy" para que un veterinario vea solo sus consultas abiertas.
    """
    return ConsultaService.listar_consultas(
        db, skip, limit, mascota_id, veterinario, fecha_inicio, fecha_fin,
        estado_pago, estado, veterinario_id
    )


@router.put("/{consulta_id}", response_model=ConsultaResponse)
def actualizar_consulta(
    consulta_id: int,
    consulta: ConsultaUpdate,
    db: Session = Depends(get_db),
    # Fila 14 de la matriz (registrar diagnóstico/tratamiento): admin/
    # veterinario. Recepción y gestor no editan datos clínicos. El payload
    # también trae campos no clínicos (estado, veterinario_id, precio) que
    # en la matriz completa tienen alcance distinto por fila -- ese recorte
    # fino queda para cuando exista el modelo de orden (Fase 2); acá se
    # cierra el hueco de autenticación con el guard más estricto del set.
    _: Usuario = Depends(require_roles("admin", "veterinario")),
):
    """Actualiza una consulta existente"""
    consulta_actualizada = ConsultaService.actualizar_consulta(db, consulta_id, consulta)
    if not consulta_actualizada:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return consulta_actualizada


@router.delete("/{consulta_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_consulta(
    consulta_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    """Elimina una consulta (solo admin).

    Es un hard-delete en cascada (servicios, recetas, vacunaciones,
    desparasitaciones, pruebas — ver Consulta.__mapper__ en models.py):
    destruye historia clínica real sin posibilidad de recuperación. A
    diferencia del resto de los routers clínicos, este SÍ exige sesión
    (get_current_admin, 401 sin token / 403 si no es admin) — el riesgo de
    dejarlo abierto no es comparable al de los demás endpoints.
    """
    if not ConsultaService.eliminar_consulta(db, consulta_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consulta no encontrada"
        )
    return None

@router.post("/{consulta_id}/recetas", response_model=RecetaResponse, status_code=status.HTTP_201_CREATED)
def crear_receta(
    consulta_id: int,
    receta_data: RecetaCreate,
    db: Session = Depends(get_db),
    _: Optional[Usuario] = Depends(require_roles("admin", "veterinario")),
):
    """Crea una receta médica para una consulta (admin / veterinario)"""
    consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
        
    nueva_receta = Receta(
        consulta_id=consulta_id,
        indicaciones_generales=receta_data.indicaciones_generales
    )
    
    for det in receta_data.detalles:
        detalle = DetalleReceta(
            medicamento_id=det.medicamento_id,
            dosis=det.dosis,
            frecuencia=det.frecuencia,
            duracion=det.duracion
        )
        nueva_receta.detalles.append(detalle)
        
    db.add(nueva_receta)
    db.commit()
    db.refresh(nueva_receta)
    return nueva_receta

@router.get("/{consulta_id}/recetas", response_model=List[RecetaResponse])
def listar_recetas_por_consulta(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Trae las recetas y su detalle asociadas a una consulta"""
    recetas = db.query(Receta).filter(Receta.consulta_id == consulta_id).all()
    return recetas

@router.get("/{consulta_id}/recetas/{receta_id}/pdf")
def descargar_receta_pdf(
    consulta_id: int,
    receta_id: int,
    db: Session = Depends(get_db)
):
    """Genera y descarga el PDF de una receta médica"""
    receta = db.query(Receta).filter(Receta.id == receta_id, Receta.consulta_id == consulta_id).first()
    if not receta:
        raise HTTPException(status_code=404, detail="Receta no encontrada")

    pdf_content = PDFService.generar_receta_pdf(db, receta_id)
    if not pdf_content:
        raise HTTPException(status_code=500, detail="Error al generar el PDF de la receta")

    return StreamingResponse(
        BytesIO(pdf_content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Receta_{receta_id}.pdf"}
    )


@router.post("/{consulta_id}/servicios", response_model=ServicioConsultaResponse, status_code=status.HTTP_201_CREATED)
def agregar_servicio_consulta(
    consulta_id: int,
    servicio_data: ServicioConsultaCreate,
    db: Session = Depends(get_db),
    # Mismo gate que POST /api/servicios/ (Tarea 06, decisión 9, filas 7-8).
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Agrega un ítem o servicio a la consulta clínica (Vacuna, Cirugía, Insumo, etc.).

    Si el servicio entra directo en un estado consumido (EJECUTADO/FACTURADO,
    consumo_service.ESTADOS_CONSUMIDOS), descuenta del inventario los materiales
    que consume (receta del catálogo y/o línea INSUMO manual) a través de
    consumo_service (Tarea 07, decisión 3).
    """
    consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    # Tarea 09, decisión 7: la recepcionista no puede anexar servicios clínicos.
    validar_tipo_servicio_por_rol(current_user, servicio_data.tipo_servicio)

    nuevo_servicio = ServicioConsulta(
        consulta_id=consulta_id,
        # mascota_id se llena siempre (también con consulta) para simplificar
        # las queries de historia (Tarea 09, decisión 1).
        mascota_id=consulta.mascota_id,
        tipo_servicio=servicio_data.tipo_servicio,
        referencia_id=servicio_data.referencia_id,
        catalogo_servicio_id=servicio_data.catalogo_servicio_id,
        nombre_servicio=servicio_data.nombre_servicio,
        cantidad=servicio_data.cantidad,
        precio_unitario=servicio_data.precio_unitario,
        detalles_clinicos=servicio_data.detalles_clinicos,
        estado=servicio_data.estado,
        is_deleted=False
    )
    db.add(nuevo_servicio)
    db.flush()  # id necesario para anclar movimientos/consumos

    advertencias = []
    if nuevo_servicio.estado in consumo_service.ESTADOS_CONSUMIDOS:
        advertencias = consumo_service.consumir_para_servicio(
            db,
            nuevo_servicio,
            overrides=consumo_service.overrides_from_payload(servicio_data.consumos),
            usuario_id=current_user.id if current_user else None,
        )

    db.commit()
    db.refresh(nuevo_servicio)
    resp = ServicioConsultaResponse.model_validate(nuevo_servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp

@router.patch("/servicios/{servicio_id}", response_model=ServicioConsultaResponse)
def actualizar_servicio_consulta(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session = Depends(get_db),
    # Mismo gate que PATCH /api/servicios/{id} -- es el mismo _impl, así que
    # el mismo guard tiene que estar en las dos rutas o esta queda de bypass.
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Alias de PATCH /api/servicios/{id} (Tarea 09). La lógica vive en
    routers/servicios.py; este path se mantiene para no romper contratos
    existentes (e2e/flujo-clinico.spec.js)."""
    return actualizar_servicio_impl(servicio_id, update_data, db, current_user)

@router.get("/{consulta_id}/pdf")
def descargar_consulta_pdf(
    consulta_id: int,
    db: Session = Depends(get_db)
):
    """Genera y descarga el PDF del resumen de una consulta"""
    pdf_content = PDFService.generar_consulta_pdf(db, consulta_id)
    if not pdf_content:
        raise HTTPException(status_code=500, detail="Error al generar el PDF de la consulta")

    return StreamingResponse(
        BytesIO(pdf_content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Consulta_{consulta_id}.pdf"}
    )


@router.delete("/servicios/{servicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_servicio_consulta(
    servicio_id: int,
    db: Session = Depends(get_db),
    # Mismo gate que DELETE /api/servicios/{id}, por la misma razón que el PATCH.
    current_user: Usuario = Depends(require_roles("admin", "veterinario")),
):
    """Alias de DELETE /api/servicios/{id} (Tarea 09). La lógica vive en
    routers/servicios.py; este path se mantiene para no romper contratos
    existentes."""
    return eliminar_servicio_impl(servicio_id, db, current_user)
