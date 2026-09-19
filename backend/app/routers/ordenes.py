"""Órdenes de servicio (Tarea 06, decisión 1; matriz de permisos, decisión 9).

La orden es el contenedor de una visita: el tutor que paga, el paciente (si
hay), el veterinario asignado y todas las líneas de servicio que se le van
anexando. Este router expone su ciclo de vida; las transiciones viven en
`services/orden_service.py` porque la de ABIERTA -> EN_ATENCION se dispara
también desde el alta de una consulta.

Fuera de alcance en esta etapa (llega con el despacho, etapa 5): la vista
acotada del gestor (fila 4 de la matriz con alcance 🔸), el despacho al área y
la bandeja. Por eso `gestor` todavía no tiene acceso a ningún endpoint de acá.
"""
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Mascota, OrdenServicio, Propietario, Usuario
from app.routers.usuarios import get_current_admin, require_roles
from app.routers.servicios import validar_tipo_servicio_por_rol
from app.schemas.schemas import (
    OrdenServicioAnexarServicio,
    OrdenServicioAnular,
    OrdenServicioAsignarVeterinario,
    OrdenServicioCreate,
    OrdenServicioDetalleResponse,
    OrdenServicioResponse,
    ServicioConsultaResponse,
)
from app.services import orden_service

router = APIRouter(prefix="/api/ordenes", tags=["Órdenes"])


def _parse_fecha(valor: Optional[str], campo: str) -> Optional[date]:
    """YYYY-MM-DD -> date, o 422 (mismo helper que routers/servicios.py)."""
    if not valor:
        return None
    try:
        return date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{campo} debe tener formato YYYY-MM-DD")


def _validar_veterinario(db: Session, veterinario_id: int) -> Usuario:
    """El destino tiene que ser un usuario con rol veterinario.

    Mismo criterio y mismo código (400) que ConsultaService.crear_consulta: sin
    esto una orden puede quedar "asignada" a la recepcionista y no aparecer
    nunca en la lista de nadie.
    """
    vet = db.query(Usuario).filter(Usuario.id == veterinario_id).first()
    if not vet or vet.role != "veterinario":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El veterinario_id indicado no corresponde a un usuario con rol veterinario",
        )
    return vet


@router.post("/", response_model=OrdenServicioDetalleResponse, status_code=status.HTTP_201_CREATED)
def abrir_orden(
    data: OrdenServicioCreate,
    db: Session = Depends(get_db),
    # Fila 1 de la matriz: admin / recepción / veterinario. `gestor` no abre.
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Abre una orden de servicio (estado ABIERTA).

    El `numero` (OS-NNNNNN) lo genera la SEQUENCE de Postgres, no la
    aplicación: en el mostrador dos altas simultáneas leyendo "el último + 1"
    chocan (decisión 1).
    """
    propietario = db.query(Propietario).filter(Propietario.id == data.propietario_id).first()
    if not propietario:
        raise HTTPException(status_code=404, detail="Propietario no encontrado")

    if data.mascota_id:
        mascota = db.query(Mascota).filter(Mascota.id == data.mascota_id).first()
        if not mascota:
            raise HTTPException(status_code=404, detail="Mascota no encontrada")
        # Mismo criterio (400) que notas.py para un ancla que no corresponde:
        # facturarle a un tutor el servicio de la mascota de otro es un error
        # de datos, no un problema de permisos.
        if mascota.propietario_id != data.propietario_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La mascota indicada no pertenece a ese propietario",
            )

    if data.veterinario_id:
        _validar_veterinario(db, data.veterinario_id)

    orden = OrdenServicio(
        propietario_id=data.propietario_id,
        mascota_id=data.mascota_id,
        veterinario_id=data.veterinario_id,
        estado="ABIERTA",
        abierta_por_id=current_user.id,
        motivo_visita=data.motivo_visita,
        observaciones=data.observaciones,
        origen=None,  # alta normal, no migración
    )
    db.add(orden)
    db.commit()
    db.refresh(orden)
    return orden


@router.get("/", response_model=List[OrdenServicioResponse])
def listar_ordenes(
    estado: Optional[str] = Query(
        None,
        description="Uno o varios estados separados por coma, ej. ABIERTA,EN_ATENCION",
    ),
    veterinario_id: Optional[int] = None,
    mascota_id: Optional[int] = None,
    propietario_id: Optional[int] = None,
    fecha_desde: Optional[str] = None,
    fecha_hasta: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Listado de órdenes con filtros, ordenado por `fecha_apertura`.

    Es la fuente del "Panel del día" (`?estado=ABIERTA,EN_ATENCION`), que el
    frontend refresca con un poll periódico (decisión 6, "actualización en
    vivo"). El índice compuesto (estado, fecha_apertura) está puesto para
    exactamente esta query.
    """
    q = db.query(OrdenServicio)

    if estado:
        estados = [e.strip().upper() for e in estado.split(",") if e.strip()]
        if estados:
            q = q.filter(OrdenServicio.estado.in_(estados))
    if veterinario_id:
        q = q.filter(OrdenServicio.veterinario_id == veterinario_id)
    if mascota_id:
        q = q.filter(OrdenServicio.mascota_id == mascota_id)
    if propietario_id:
        q = q.filter(OrdenServicio.propietario_id == propietario_id)

    d_desde = _parse_fecha(fecha_desde, "fecha_desde")
    d_hasta = _parse_fecha(fecha_hasta, "fecha_hasta")
    if d_desde:
        q = q.filter(OrdenServicio.fecha_apertura >= d_desde)
    if d_hasta:
        # inclusivo: hasta el fin de ese día (mismo criterio que /api/servicios)
        q = q.filter(OrdenServicio.fecha_apertura < d_hasta + timedelta(days=1))

    return (
        q.order_by(OrdenServicio.fecha_apertura.desc(), OrdenServicio.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{orden_id}", response_model=OrdenServicioDetalleResponse)
def obtener_orden(
    orden_id: int,
    db: Session = Depends(get_db),
    # Fila 4 de la matriz. El gestor tiene alcance recortado (solo sus
    # servicios + cabecera) y eso necesita un schema propio: llega con el
    # despacho (etapa 5). Hasta entonces no se le da acceso a la orden completa.
    _: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """La orden completa: paciente, tutor, veterinario, estado y sus servicios."""
    return orden_service.obtener_orden(db, orden_id)


@router.put("/{orden_id}/veterinario", response_model=OrdenServicioDetalleResponse)
def asignar_veterinario(
    orden_id: int,
    data: OrdenServicioAsignarVeterinario,
    db: Session = Depends(get_db),
    # Fila 2 de la matriz: admin / recepción. El veterinario no se autoasigna.
    _: Usuario = Depends(require_roles("admin", "recepcionista")),
):
    """Asigna o cambia el veterinario de una orden que todavía admite trabajo."""
    orden = orden_service.obtener_orden(db, orden_id)
    orden_service.asegurar_recibe_trabajo(orden)
    _validar_veterinario(db, data.veterinario_id)

    orden.veterinario_id = data.veterinario_id
    db.commit()
    db.refresh(orden)
    return orden


@router.post("/{orden_id}/tomar", response_model=OrdenServicioDetalleResponse)
def tomar_orden(
    orden_id: int,
    db: Session = Depends(get_db),
    # Fila 3: admin siempre; veterinario solo si es el asignado (lo verifica
    # orden_service sobre la fila, no acá: es alcance, no rol).
    current_user: Usuario = Depends(require_roles("admin", "veterinario")),
):
    """ABIERTA -> EN_ATENCION explícito.

    La misma transición ocurre sola cuando alguien abre una consulta contra la
    orden (decisión 1, regla 1); este endpoint es para el caso en que el
    veterinario toma la orden antes de cargar nada.
    """
    orden = orden_service.obtener_orden(db, orden_id)
    return orden_service.tomar_orden(db, orden, current_user)


@router.post("/{orden_id}/servicios", response_model=ServicioConsultaResponse, status_code=status.HTTP_201_CREATED)
def anexar_servicio_orden(
    orden_id: int,
    data: OrdenServicioAnexarServicio,
    db: Session = Depends(get_db),
    # Filas 7-8 de la matriz: admin/recepción/veterinario anexan; recepción
    # queda bloqueada en tipos clínicos por validar_tipo_servicio_por_rol
    # (misma función que ya usan POST /api/servicios/ y
    # POST /api/consultas/{id}/servicios -- no se duplica el criterio).
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Anexa un servicio a la orden sin pasar por una consulta.

    Es la hermana de POST /api/consultas/{id}/servicios para el caso en que la
    orden no tiene consulta (decisión 1: venta de mostrador, orden solo de
    estética -- una orden puede no tener paciente y de todas formas necesitar
    líneas facturables). La línea `tipo_servicio='CONSULTA'` queda reservada a
    POST /api/consultas/ -- única fuente, decisión 3, índice
    `uq_orden_una_consulta` -- y este endpoint la rechaza con 400.
    """
    orden = orden_service.obtener_orden(db, orden_id)
    orden_service.asegurar_recibe_trabajo(orden)

    tipo = (data.tipo_servicio or "").strip().upper()
    if tipo == orden_service.TIPO_SERVICIO_CONSULTA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "La línea CONSULTA no se anexa por acá: la crea únicamente "
                "POST /api/consultas/ (decisión 3)."
            ),
        )

    validar_tipo_servicio_por_rol(current_user, data.tipo_servicio)

    servicio, advertencias = orden_service.crear_servicio_en_orden(
        db,
        orden,
        tipo_servicio=data.tipo_servicio,
        referencia_id=data.referencia_id,
        catalogo_servicio_id=data.catalogo_servicio_id,
        nombre_servicio=data.nombre_servicio,
        cantidad=data.cantidad,
        precio_unitario=data.precio_unitario,
        detalles_clinicos=data.detalles_clinicos,
        consumos_override=data.consumos,
        current_user=current_user,
    )
    db.commit()
    db.refresh(servicio)
    resp = ServicioConsultaResponse.model_validate(servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp


@router.post("/{orden_id}/confirmar", response_model=OrdenServicioDetalleResponse)
def confirmar_servicios(
    orden_id: int,
    db: Session = Depends(get_db),
    # Fila 9 de la matriz: admin / veterinario. Recepción y gestor no
    # confirman servicios.
    current_user: Usuario = Depends(require_roles("admin", "veterinario")),
):
    """Confirma los servicios SOLICITADO de la orden (decisión 4): a ASIGNADO
    los que tienen área de ejecución (despacho, a la espera de un gestor); a
    EJECUTADO directo los que no la tienen (atajo sin despacho).

    Idempotente: si no queda ninguna línea en SOLICITADO, devuelve 200 sin
    cambios -- confirmar una orden ya confirmada no es un error.
    """
    orden = orden_service.obtener_orden(db, orden_id)
    return orden_service.confirmar_servicios(db, orden, current_user)


@router.post("/{orden_id}/cerrar", response_model=OrdenServicioDetalleResponse)
def cerrar_orden(
    orden_id: int,
    db: Session = Depends(get_db),
    # Fila 5: admin / recepción / veterinario.
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """ABIERTA|EN_ATENCION -> CERRADA.

    Bloqueada mientras quede un servicio en SOLICITADO / ASIGNADO / EN_PROCESO
    (decisión 1, regla 2): es el candado que impide facturar y olvidar trabajo
    pendiente del gestor.
    """
    orden = orden_service.obtener_orden(db, orden_id)
    return orden_service.cerrar_orden(db, orden, current_user)


@router.post("/{orden_id}/anular", response_model=OrdenServicioDetalleResponse)
def anular_orden(
    orden_id: int,
    data: OrdenServicioAnular,
    db: Session = Depends(get_db),
    # Fila 6: SOLO admin. Mismo guard que /api/liquidaciones.
    current_user: Usuario = Depends(get_current_admin),
):
    """ABIERTA|EN_ATENCION|CERRADA -> ANULADA, con motivo obligatorio.

    Revierte el consumo de insumos de los servicios EJECUTADO de la orden. Es
    terminal: una orden FACTURADA o ya ANULADA no se puede anular.
    """
    orden = orden_service.obtener_orden(db, orden_id)
    return orden_service.anular_orden(db, orden, current_user, data.motivo_anulacion)
