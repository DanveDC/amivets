"""Ciclo de vida de una orden de servicio (Tarea 06, decision 1).

Toda transicion de estado de `OrdenServicio` vive aca y NO en el router: la
transicion automatica ABIERTA -> EN_ATENCION se dispara desde dos lados (el
boton "tomar la orden" y el alta de una consulta contra la orden), y duplicar
la regla en los dos garantiza que se separen.

Mismo patron que consumo_service / facturacion_service: funciones que reciben
la Session y NO commitean salvo que se diga lo contrario -- el llamador cierra
la transaccion, para poder componer varios pasos en una sola.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import CatalogoServicio, Consulta, OrdenServicio, ServicioConsulta, Usuario
from app.services import consumo_service

# La orden todavia recibe trabajo: se le pueden anexar servicios y abrir la
# consulta. CERRADA / FACTURADA / ANULADA ya no.
ESTADOS_ABIERTOS = frozenset({"ABIERTA", "EN_ATENCION"})
# Terminales de verdad: no se puede volver de aca (decision 1, reglas 5 y 6).
ESTADOS_TERMINALES = frozenset({"FACTURADA", "ANULADA"})
# El candado del cierre (decision 1, regla 2): mientras un servicio este en
# alguno de estos estados, la orden NO se puede cerrar. Es lo que impide que el
# trabajo del gestor "desaparezca en silencio".
ESTADOS_SERVICIO_PENDIENTES = frozenset({"SOLICITADO", "ASIGNADO", "EN_PROCESO"})

# tipo_servicio de la linea que representa el honorario de la consulta dentro
# de la orden (decision 3). Hay como maximo UNA viva por orden, garantizado por
# el indice unico parcial uq_orden_una_consulta.
TIPO_SERVICIO_CONSULTA = "CONSULTA"


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Lecturas
# ---------------------------------------------------------------------------
def obtener_orden(db: Session, orden_id: int) -> OrdenServicio:
    """Trae la orden o levanta 404. No valida estado."""
    orden = db.query(OrdenServicio).filter(OrdenServicio.id == orden_id).first()
    if not orden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden no encontrada")
    return orden


def orden_de_consulta(db: Session, consulta_id: int) -> Optional[OrdenServicio]:
    """La orden a la que pertenece una consulta.

    `consultas` NO tiene columna `orden_id` a proposito (decision 3: seria una
    segunda fuente de verdad). El camino es la linea de servicio CONSULTA, que
    es unica por orden y apunta a la consulta.
    """
    linea = (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.consulta_id == consulta_id,
            ServicioConsulta.tipo_servicio == TIPO_SERVICIO_CONSULTA,
            ServicioConsulta.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not linea or not linea.orden_id:
        return None
    return db.query(OrdenServicio).filter(OrdenServicio.id == linea.orden_id).first()


def servicios_pendientes(db: Session, orden_id: int):
    """Servicios vivos de la orden que bloquean el cierre (decision 1, regla 2)."""
    return (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.orden_id == orden_id,
            ServicioConsulta.is_deleted == False,  # noqa: E712
            ServicioConsulta.estado.in_(ESTADOS_SERVICIO_PENDIENTES),
        )
        .all()
    )


# ---------------------------------------------------------------------------
# Guards de estado
# ---------------------------------------------------------------------------
def asegurar_recibe_trabajo(orden: OrdenServicio) -> None:
    """409 si la orden ya no admite trabajo nuevo (CERRADA/FACTURADA/ANULADA)."""
    if orden.estado not in ESTADOS_ABIERTOS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La orden {orden.numero} está {orden.estado} y no admite cambios. "
                "Abrí una orden nueva."
            ),
        )


# ---------------------------------------------------------------------------
# Transiciones
# ---------------------------------------------------------------------------
def marcar_en_atencion(orden: OrdenServicio) -> bool:
    """ABIERTA -> EN_ATENCION. Idempotente: si ya esta EN_ATENCION no hace nada.

    Decision 1, regla 1: la transicion es AUTOMATICA la primera vez que alguien
    toma trabajo sobre la orden, no un boton aparte. Por eso vive en una funcion
    sola: la usan tanto POST /api/ordenes/{id}/tomar como el alta de consulta.

    No commitea: el llamador decide la transaccion.
    """
    if orden.estado == "ABIERTA":
        orden.estado = "EN_ATENCION"
        return True
    return False


def tomar_orden(db: Session, orden: OrdenServicio, current_user: Usuario) -> OrdenServicio:
    """ABIERTA -> EN_ATENCION explicito (fila 3 de la matriz de permisos).

    El veterinario solo puede tomar la orden que tiene asignada; admin siempre.
    """
    if current_user.role == "veterinario" and orden.veterinario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el veterinario asignado a la orden puede tomarla.",
        )
    if orden.estado != "ABIERTA":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La orden {orden.numero} está {orden.estado}; solo se puede tomar una orden ABIERTA.",
        )
    marcar_en_atencion(orden)
    db.commit()
    db.refresh(orden)
    return orden


def confirmar_servicios(db: Session, orden: OrdenServicio, current_user: Usuario) -> OrdenServicio:
    """Despacha los servicios SOLICITADO de la orden (decision 4, fila 9 de la
    matriz de permisos): es el paso "el veterinario confirma los servicios"
    del diagrama de estados.

    - Si el item tiene area de ejecucion (area_id no nulo, snapshot tomado al
      anexar): pasa a ASIGNADO. Queda a la espera de que un gestor lo tome
      (POST /api/servicios/{id}/tomar, etapa 5).
    - Si no tiene area (atajo sin despacho de la decision 4 -- CONSULTA,
      INSUMO, o cualquier item de catalogo con area_id NULL): pasa directo a
      EJECUTADO y dispara consumo_service.consumir_para_servicio, exactamente
      como hace actualizar_servicio_impl al cruzar hacia un estado consumido.

    Idempotente: si no queda ninguna linea en SOLICITADO no es un error --
    confirmar una orden ya confirmada es un 200 sin cambios, no un 409. No hay
    nada que "reconfirmar": una vez que una linea sale de SOLICITADO, este
    endpoint ya no vuelve a tocarla.

    Fuera de alcance a proposito (etapa 5, despacho y bandejas): no crea
    `Notificacion` para el gestor del area ni calcula advertencias de "area
    sin gestor" (decision 5, defensas 1 y 2). Ese seam se agrega en la etapa 5
    sin tocar esta funcion salvo para sumar esos efectos.
    """
    asegurar_recibe_trabajo(orden)

    solicitados = (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.orden_id == orden.id,
            ServicioConsulta.is_deleted == False,  # noqa: E712
            ServicioConsulta.estado == "SOLICITADO",
        )
        .all()
    )

    ahora = _ahora()
    for servicio in solicitados:
        if servicio.area_id is not None:
            servicio.estado = "ASIGNADO"
            servicio.asignado_at = ahora
            # TODO(etapa 5): notificar a los gestores del area (Notificacion
            # tipo SERVICIO_ASIGNADO); si el area no tiene ningun gestor
            # activo, notificar a los admins (SERVICIO_SIN_GESTOR) y sumar el
            # servicio a un advertencias[] en la respuesta del endpoint.
        else:
            servicio.estado = "EJECUTADO"
            servicio.ejecutado_at = ahora
            consumo_service.consumir_para_servicio(db, servicio, usuario_id=current_user.id)

    db.commit()
    db.refresh(orden)
    return orden


def crear_servicio_en_orden(
    db: Session,
    orden: OrdenServicio,
    *,
    tipo_servicio: str,
    referencia_id: Optional[int],
    catalogo_servicio_id: Optional[int],
    nombre_servicio: Optional[str],
    cantidad: float,
    precio_unitario: float,
    detalles_clinicos: Optional[str],
    consumos_override,
    current_user: Usuario,
) -> tuple:
    """Anexa una linea de servicio a la orden SIN pasar por una consulta
    (Tarea 06, decision 1: venta de mostrador, orden solo de estetica). La usa
    POST /api/ordenes/{id}/servicios.

    Decide el estado inicial por el AREA del item (decision 4, "atajo sin
    despacho"): sin area (sin catalogo_servicio_id, o con uno cuyo area_id es
    NULL) entra directo en EJECUTADO -- no hay a quien despacharselo, lo
    ejecuta quien lo anexa --; con area queda SOLICITADO a la espera de
    POST /api/ordenes/{id}/confirmar.

    Esto es DELIBERADAMENTE distinto de agregar_servicio_consulta
    (routers/consultas.py) y crear_servicio_directo (routers/servicios.py):
    esos dos toman el `estado` que manda el cliente, para no romper su
    contrato ya cubierto por la suite. Este es el unico de los tres que decide
    el estado por el area, porque es el unico endpoint pensado para trabajo
    SIN consulta que puede necesitar despacho real a un area.

    No commitea: el llamador decide la transaccion. Devuelve
    (servicio, advertencias).
    """
    area_id = None
    if catalogo_servicio_id:
        item = db.query(CatalogoServicio).filter(CatalogoServicio.id == catalogo_servicio_id).first()
        area_id = item.area_id if item else None

    estado_inicial = "SOLICITADO" if area_id is not None else "EJECUTADO"

    servicio = ServicioConsulta(
        orden_id=orden.id,
        consulta_id=None,
        # mascota_id se llena desde la orden (puede ser None: venta de
        # mostrador sin paciente, decision 1). El CHECK de la DB ya tiene
        # orden_id como ancla valida.
        mascota_id=orden.mascota_id,
        tipo_servicio=tipo_servicio,
        referencia_id=referencia_id,
        catalogo_servicio_id=catalogo_servicio_id,
        nombre_servicio=nombre_servicio,
        cantidad=cantidad,
        precio_unitario=precio_unitario,
        detalles_clinicos=detalles_clinicos,
        area_id=area_id,
        estado=estado_inicial,
        is_deleted=False,
    )
    db.add(servicio)
    db.flush()  # id necesario para anclar movimientos/consumos

    advertencias = []
    if servicio.estado in consumo_service.ESTADOS_CONSUMIDOS:
        advertencias = consumo_service.consumir_para_servicio(
            db,
            servicio,
            overrides=consumo_service.overrides_from_payload(consumos_override),
            usuario_id=current_user.id if current_user else None,
        )

    # Decision 1, regla 1: automatica, no un boton aparte.
    marcar_en_atencion(orden)
    return servicio, advertencias


def cerrar_orden(db: Session, orden: OrdenServicio, current_user: Usuario) -> OrdenServicio:
    """ABIERTA|EN_ATENCION -> CERRADA, con el candado de la decision 1, regla 2."""
    if orden.estado == "CERRADA":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La orden {orden.numero} ya está cerrada.",
        )
    asegurar_recibe_trabajo(orden)

    pendientes = servicios_pendientes(db, orden.id)
    if pendientes:
        detalle = ", ".join(
            f"{s.nombre_servicio or s.tipo_servicio} ({s.estado})" for s in pendientes[:5]
        )
        if len(pendientes) > 5:
            detalle += ", …"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se puede cerrar la orden {orden.numero}: quedan {len(pendientes)} "
                f"servicio(s) sin resolver ({detalle}). Ejecutalos o cancelalos primero."
            ),
        )

    orden.estado = "CERRADA"
    orden.fecha_cierre = _ahora()
    orden.cerrada_por_id = current_user.id
    db.commit()
    db.refresh(orden)
    return orden


def anular_orden(
    db: Session,
    orden: OrdenServicio,
    current_user: Usuario,
    motivo: str,
) -> OrdenServicio:
    """ABIERTA|EN_ATENCION|CERRADA -> ANULADA (solo admin, fila 6 de la matriz).

    Revierte el consumo de insumos de los servicios EJECUTADO (decision 1,
    regla 5) reusando consumo_service.revertir_para_servicio -- la misma
    funcion que usa el PATCH de servicio al salir de un estado consumido.
    Los servicios FACTURADO no se tocan: su reversa es anular la factura.
    """
    if orden.estado in ESTADOS_TERMINALES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La orden {orden.numero} está {orden.estado} y no se puede anular.",
        )

    servicios = (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.orden_id == orden.id,
            ServicioConsulta.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    for servicio in servicios:
        if servicio.estado == "FACTURADO" or servicio.facturado:
            # Ya cobrado: la reversa de dinero es anular la factura, no anular
            # la orden. Se deja como esta para no descuadrar el ledger.
            continue
        if servicio.estado in consumo_service.ESTADOS_CONSUMIDOS:
            consumo_service.revertir_para_servicio(db, servicio, usuario_id=current_user.id)
        # Una orden anulada no puede dejar trabajo vivo colgando: sus lineas
        # quedan CANCELADO, que es el terminal del ciclo de servicio (decision 4).
        servicio.estado = "CANCELADO"

    orden.estado = "ANULADA"
    orden.anulada_por_id = current_user.id
    orden.motivo_anulacion = motivo
    db.commit()
    db.refresh(orden)
    return orden


# ---------------------------------------------------------------------------
# La consulta como linea de servicio de la orden (decision 3)
# ---------------------------------------------------------------------------
def crear_linea_consulta(
    db: Session,
    orden: OrdenServicio,
    consulta: Consulta,
) -> ServicioConsulta:
    """Anexa la linea `tipo_servicio='CONSULTA'` de una consulta a su orden.

    Decision 3: la consulta es un servicio mas de la orden, con
    referencia_id -> consultas.id y precio_unitario = consulta.precio_consulta.
    Decision 4 (atajo sin despacho): CONSULTA no tiene area de ejecucion -- la
    ejecuta el mismo veterinario que la crea --, asi que entra directo en
    EJECUTADO en vez de pasar por SOLICITADO/ASIGNADO/EN_PROCESO.

    No commitea ni flushea: el llamador arma la transaccion completa (consulta
    + linea + transicion de la orden) para que un 409 del indice unico parcial
    uq_orden_una_consulta no deje una consulta huerfana.
    """
    linea = ServicioConsulta(
        orden_id=orden.id,
        consulta_id=consulta.id,
        mascota_id=consulta.mascota_id,
        tipo_servicio=TIPO_SERVICIO_CONSULTA,
        referencia_id=consulta.id,
        nombre_servicio="Consulta veterinaria",
        cantidad=1,
        precio_unitario=consulta.precio_consulta or 0.0,
        # Atajo sin despacho (decision 4). No dispara consumo_service: una
        # consulta no tiene receta de materiales propia; los insumos que se
        # usan durante la atencion se anexan como sus propias lineas.
        estado="EJECUTADO",
        origen=None,
        is_deleted=False,
    )
    db.add(linea)
    return linea


def consulta_viva_en_orden(db: Session, orden_id: int) -> Optional[ServicioConsulta]:
    """La linea CONSULTA viva de la orden, si ya hay una (maximo 1, decision 3)."""
    return (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.orden_id == orden_id,
            ServicioConsulta.tipo_servicio == TIPO_SERVICIO_CONSULTA,
            ServicioConsulta.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def error_una_consulta_por_orden(orden: OrdenServicio) -> HTTPException:
    """El 409 legible del indice unico parcial uq_orden_una_consulta."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"La orden {orden.numero} ya tiene una consulta. Una orden admite como "
            "máximo una consulta (decisión 3): abrí una orden nueva para una "
            "segunda atención."
        ),
    )
