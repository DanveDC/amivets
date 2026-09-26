"""Servicios directos y edicion de servicios de consulta (Tarea 09).

Un "servicio directo" es un ServicioConsulta sin consulta (consulta_id NULL) que
cuelga de la mascota (mascota_id). Sirve para lo que no amerita consulta: corte
de unas, venta de mostrador, etc.

PATCH/DELETE de un servicio individual viven aca; routers/consultas.py mantiene
los paths /api/consultas/servicios/{id} como alias que delegan a estas mismas
funciones (para no romper e2e/flujo-clinico.spec.js).
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional


def _parse_fecha(valor: Optional[str], campo: str) -> Optional[date]:
    """YYYY-MM-DD → date, o 422. Evita el 500 por cast inválido de timestamp."""
    if not valor:
        return None
    try:
        return date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{campo} debe tener formato YYYY-MM-DD")

from app.core.database import get_db
from app.schemas.schemas import (
    ServicioConsultaCreate,
    ServicioConsultaUpdate,
    ServicioConsultaResponse,
    ServicioRealizadoResponse,
)
from app.models.models import Adjunto, AreaServicio, GestorArea, OrdenServicio, ServicioConsulta, Mascota, Usuario
from app.services import consumo_service, notificacion_service, orden_service
from app.routers.usuarios import require_roles

router = APIRouter(prefix="/api/servicios", tags=["Servicios"])

# Servicios clinicos: una recepcionista NO los puede anexar (Tarea 09, decision
# 7). admin y veterinario, sin restriccion de tipo.
TIPOS_SERVICIO_CLINICOS = {
    "VACUNACION",
    "DESPARASITACION",
    "CIRUGIA",
    "HOSPITALIZACION",
    "LABORATORIO",
}


def validar_tipo_servicio_por_rol(current_user: Usuario, tipo_servicio: Optional[str]):
    """Bloquea a la recepcionista de anexar servicios clinicos.

    Solo aplica al rol 'recepcionista'; admin y veterinario pasan sin
    restriccion de tipo. Requiere sesion valida (la garantiza `require_roles`
    en el endpoint que llama a esta funcion, Tarea 06, decision 9)."""
    if current_user.role != "recepcionista":
        return
    if (tipo_servicio or "").strip().upper() in TIPOS_SERVICIO_CLINICOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Una recepcionista no puede anexar servicios clínicos "
                "(vacunación, desparasitación, cirugía, hospitalización o laboratorio)."
            ),
        )


# ---------------------------------------------------------------------------
# Despacho al area (Tarea 06, decisiones 5, 7 y 9; etapa 5)
# ---------------------------------------------------------------------------
def _es_gestor_del_area(db: Session, usuario_id: int, area_id: int) -> bool:
    """True si el usuario tiene una fila en gestor_area para esa area.

    Es la respuesta al multi-rol (decision 9.2): sirve igual para un
    'gestor' que para un 'veterinario' con gestor_area(esa_area).
    """
    return (
        db.query(GestorArea)
        .filter(GestorArea.usuario_id == usuario_id, GestorArea.area_id == area_id)
        .first()
        is not None
    )


def _requiere_adjunto(db: Session, servicio: ServicioConsulta) -> bool:
    """Decision 7: sin area no exige (atajo sin despacho, decision 4). Con
    area, el item de catalogo puede sobrescribir (NULL = hereda del area)."""
    if servicio.area_id is None:
        return False
    item = servicio.catalogo_servicio
    if item is not None and item.requiere_adjunto is not None:
        return bool(item.requiere_adjunto)
    area = db.query(AreaServicio).filter(AreaServicio.id == servicio.area_id).first()
    return bool(area.requiere_adjunto) if area else False


def _tiene_adjunto_vivo(db: Session, servicio_id: int) -> bool:
    return (
        db.query(Adjunto)
        .filter(Adjunto.servicio_id == servicio_id, Adjunto.is_deleted == False)  # noqa: E712
        .first()
        is not None
    )


def _validar_permiso_ejecutar(db: Session, servicio: ServicioConsulta, current_user: Optional[Usuario]) -> None:
    """Fila 11 de la matriz: admin siempre; gestor solo el que tomo (asignado_a_id
    == el); veterinario solo si tiene el area (gestor_area). Recepcion no ejecuta."""
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere sesión")
    if current_user.role == "admin":
        return
    if current_user.role == "gestor":
        if servicio.asignado_a_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el gestor que tomó este servicio puede ejecutarlo.",
            )
        return
    if current_user.role == "veterinario":
        if not _es_gestor_del_area(db, current_user.id, servicio.area_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Necesitás estar habilitado como gestor de esa área para ejecutar este servicio.",
            )
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tu rol no puede ejecutar un servicio despachado a un área.",
    )


# ---------------------------------------------------------------------------
# Logica compartida de PATCH / DELETE de un servicio individual.
# routers/consultas.py delega en estas funciones.
# ---------------------------------------------------------------------------
def actualizar_servicio_impl(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session,
    current_user: Optional[Usuario],
) -> ServicioConsultaResponse:
    """Actualiza estado, precio o cantidad de un servicio.

    Al entrar a un estado consumido (consumo_service.ESTADOS_CONSUMIDOS =
    EJECUTADO/FACTURADO) consume materiales; al salir de esos estados los
    revierte (lee consumo_material, no la receta). Unificado en consumo_service
    (Tarea 07, decisión 3; renombre de estados: Tarea 06, decisión 4).

    La condición es pertenencia al conjunto, no igualdad contra un literal:
    EJECUTADO -> FACTURADO se queda del mismo lado de la frontera y NO debe
    devolver stock (Riesgo 2 de docs/diseno/ordenes-de-servicio.md).
    """
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    old_estado = servicio.estado

    update_dict = update_data.model_dump(exclude_unset=True)
    consumos_override = update_dict.pop("consumos", None)

    # M2: editar cantidad/consumos de un servicio que se queda del lado
    # consumido cambiaria solo la columna, sin tocar el ledger ni
    # ConsumoMaterial -> la reversa posterior devolveria un monto distinto al
    # consumido (drift). Se exige revertir el estado primero. Con estado
    # SOLICITADO/CANCELADO el edit es libre.
    #
    # El criterio es pertenencia al conjunto en AMBOS extremos, no solo
    # EJECUTADO: el drift existe igual si el servicio queda en FACTURADO
    # (EJECUTADO->FACTURADO, FACTURADO->FACTURADO, FACTURADO->EJECUTADO), porque
    # en los tres casos el consumo sigue vivo en el ledger. Es la traduccion
    # exacta del guard viejo (`Aplicado` -> `Aplicado`), sin agregar una regla
    # nueva: prohibir tambien FACTURADO -> SOLICITADO con cambio de cantidad
    # seria politica de facturacion, no parte del renombre.
    nuevo_estado = update_dict.get("estado", servicio.estado)
    toca_cantidad = "cantidad" in update_dict and update_dict["cantidad"] != servicio.cantidad
    toca_consumos = consumos_override is not None
    sigue_consumido = (
        servicio.estado in consumo_service.ESTADOS_CONSUMIDOS
        and nuevo_estado in consumo_service.ESTADOS_CONSUMIDOS
    )
    if sigue_consumido and (toca_cantidad or toca_consumos):
        raise HTTPException(
            status_code=409,
            detail="No se puede cambiar la cantidad de un servicio en EJECUTADO/FACTURADO; revertí el estado primero",
        )

    # --- Fila 11 de la matriz (etapa 5): EN_PROCESO -> EJECUTADO de un
    # servicio despachado a un area es una transicion con gate propio, mas
    # fino que el require_roles del endpoint (que solo filtra por rol, no por
    # "es EL gestor que lo tomo" ni "tiene esa area"). ---
    transicion_area_a_ejecutado = (
        servicio.area_id is not None
        and old_estado != "EJECUTADO"
        and nuevo_estado == "EJECUTADO"
    )

    if current_user is not None and current_user.role == "gestor":
        # Fila 13: un gestor no edita precio/cantidad de un servicio. Su unico
        # uso legitimo de este PATCH es ejecutar el que tomo (fila 11); todo
        # lo demas queda 403, aunque require_roles ya lo dejo pasar por rol.
        if not transicion_area_a_ejecutado:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Un gestor solo puede ejecutar (EN_PROCESO → EJECUTADO) los servicios de su área.",
            )

    if transicion_area_a_ejecutado:
        if old_estado != "EN_PROCESO":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Un servicio despachado a un área solo se ejecuta desde EN_PROCESO; "
                    "tomalo primero con POST /api/servicios/{id}/tomar."
                ),
            )
        _validar_permiso_ejecutar(db, servicio, current_user)
        # Decision 7: "la transicion devuelve 422 con el mensaje exacto de
        # qué falta" (docs/diseno/ordenes-de-servicio.md ~956). Etapa 5 usaba
        # 409 porque todavía no existía el endpoint de upload (etapa 6) para
        # probar la rama de éxito -- con el candado ya resuelto en los dos
        # sentidos, se corrige al código de estado que pide el diseño: esto
        # NO es un conflicto de estado (como el 409 de arriba, "tomalo
        # primero"), es una entidad inválida para la transición pedida (falta
        # un dato que la transición exige), que es exactamente el caso de uso
        # de 422 Unprocessable Entity.
        if _requiere_adjunto(db, servicio) and not _tiene_adjunto_vivo(db, servicio.id):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Este servicio exige un adjunto antes de poder ejecutarse; cargá el resultado primero.",
            )

    for k, v in update_dict.items():
        setattr(servicio, k, v)

    new_estado = servicio.estado
    uid = current_user.id if current_user else None

    # Frontera de consumo: se cruza hacia adentro (consume) o hacia afuera
    # (revierte). Moverse DENTRO del conjunto (EJECUTADO <-> FACTURADO) no toca
    # stock. Ver consumo_service.ESTADOS_CONSUMIDOS.
    consumidos = consumo_service.ESTADOS_CONSUMIDOS
    advertencias = []
    if old_estado not in consumidos and new_estado in consumidos:
        advertencias = consumo_service.consumir_para_servicio(
            db,
            servicio,
            overrides=consumo_service.overrides_from_payload(consumos_override),
            usuario_id=uid,
        )
        if new_estado == "EJECUTADO":
            servicio.ejecutado_at = datetime.now(timezone.utc)
        if transicion_area_a_ejecutado:
            # Solo para el camino despachado: en el atajo sin despacho
            # (decision 4) el mismo usuario que anexa el servicio lo ejecuta,
            # avisarle a si mismo no aporta nada (ver notificacion_service).
            notificacion_service.notificar_ejecucion(db, servicio)
    elif old_estado in consumidos and new_estado not in consumidos:
        consumo_service.revertir_para_servicio(db, servicio, usuario_id=uid)

    db.commit()
    db.refresh(servicio)
    resp = ServicioConsultaResponse.model_validate(servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp


def eliminar_servicio_impl(
    servicio_id: int,
    db: Session,
    current_user: Optional[Usuario],
) -> None:
    """Elimina lógicamente un servicio (Soft Delete) y revierte el consumo de
    materiales si estaba aplicado (Tarea 07, decisión 3)."""
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    if servicio.estado in consumo_service.ESTADOS_CONSUMIDOS:
        consumo_service.revertir_para_servicio(
            db, servicio, usuario_id=current_user.id if current_user else None
        )

    servicio.is_deleted = True
    servicio.estado = "CANCELADO"
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/", response_model=ServicioConsultaResponse, status_code=status.HTTP_201_CREATED)
def crear_servicio_directo(
    servicio_data: ServicioConsultaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Crea un servicio directo (sin consulta). Exige mascota_id y orden_id.

    Misma lógica de consumo que anexar un servicio a una consulta: si entra en
    un estado consumido (EJECUTADO/FACTURADO), descuenta materiales vía
    consumo_service.

    Matriz de permisos (Tarea 06, decisión 9, filas 7-8): admin/recepción/
    veterinario pueden anexar servicios no clínicos; los clínicos (vacuna,
    desparasitación, cirugía, hospitalización, laboratorio) quedan bloqueados
    para recepción por `validar_tipo_servicio_por_rol`. `gestor` no anexa.

    `orden_id` es obligatorio desde Tarea 06 etapa 4 (decisión 1: no hay
    trabajo fuera de una orden -- un servicio directo es trabajo igual que
    cualquier otro). Se valida a nivel de endpoint y no en el schema porque
    `ServicioConsultaCreate` también lo usa POST /api/consultas/{id}/servicios,
    donde el backend lo DERIVA de la consulta y nunca lo acepta del cliente
    (mismo criterio que ya se aplica acá con `mascota_id`).
    """
    if not servicio_data.mascota_id:
        raise HTTPException(status_code=422, detail="mascota_id es obligatorio para un servicio directo")

    mascota = db.query(Mascota).filter(Mascota.id == servicio_data.mascota_id).first()
    if not mascota:
        raise HTTPException(status_code=404, detail="Mascota no encontrada")

    validar_tipo_servicio_por_rol(current_user, servicio_data.tipo_servicio)

    if not servicio_data.orden_id:
        raise HTTPException(
            status_code=422,
            detail="orden_id es obligatorio para un servicio directo (Tarea 06, decisión 1: no hay trabajo fuera de una orden)",
        )
    orden = orden_service.obtener_orden(db, servicio_data.orden_id)
    orden_service.asegurar_recibe_trabajo(orden)
    if orden.mascota_id and orden.mascota_id != servicio_data.mascota_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La mascota del servicio no coincide con la mascota de la orden",
        )

    nuevo_servicio = ServicioConsulta(
        orden_id=orden.id,
        consulta_id=None,
        mascota_id=servicio_data.mascota_id,
        tipo_servicio=servicio_data.tipo_servicio,
        referencia_id=servicio_data.referencia_id,
        catalogo_servicio_id=servicio_data.catalogo_servicio_id,
        nombre_servicio=servicio_data.nombre_servicio,
        cantidad=servicio_data.cantidad,
        precio_unitario=servicio_data.precio_unitario,
        detalles_clinicos=servicio_data.detalles_clinicos,
        estado=servicio_data.estado,
        origen=None,  # alta normal, no migración
        is_deleted=False,
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

    # Decisión 1, regla 1: la transición ABIERTA -> EN_ATENCION es automática
    # la primera vez que alguien toma trabajo sobre la orden, no un botón
    # aparte -- mismo criterio que crear_linea_consulta.
    orden_service.marcar_en_atencion(orden)

    db.commit()
    db.refresh(nuevo_servicio)
    resp = ServicioConsultaResponse.model_validate(nuevo_servicio)
    if advertencias:
        resp.advertencias = advertencias
    return resp


@router.get("/", response_model=List[ServicioConsultaResponse])
def listar_servicios_mascota(
    mascota_id: int,
    alcance: str = "directos",
    tipo_servicio: Optional[str] = None,
    estado: Optional[str] = None,
    facturado: Optional[bool] = None,
    fecha_desde: Optional[str] = None,
    fecha_hasta: Optional[str] = None,
    db: Session = Depends(get_db),
    # HALLAZGO DE SEGURIDAD (Tarea 10, gate parcial): unico endpoint de este
    # router sin Depends(require_roles) -- los otros 4 (POST, PATCH, DELETE,
    # /tomar, /bandeja) ya lo tenian. admin/recepcionista/veterinario, igual
    # que el resto del router y que MASCOTAS_ROLES del front. `gestor` queda
    # afuera de esta lectura general (no tiene pantalla que la use; su vista
    # es /bandeja, ya gateada aparte).
    _: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario")),
):
    """Feed de servicios de una mascota. Excluye los borrados lógicamente.

    `alcance` (Tarea 09, pestaña "Servicios" = historia unificada):
      - `directos` (default): solo los sueltos (consulta_id IS NULL). Compatible
        con el flujo de cobro de servicios directos.
      - `todos`: anexados a una consulta + directos, ordenados por fecha desc.
      - `consulta`: solo los anexados a alguna consulta.

    Filtros opcionales para el timeline: `tipo_servicio`, `estado`
    (SOLICITADO / EJECUTADO / FACTURADO / CANCELADO), `facturado`, y rango `fecha_desde` /
    `fecha_hasta` (YYYY-MM-DD, sobre `created_at`).
    """
    q = db.query(ServicioConsulta).filter(
        ServicioConsulta.mascota_id == mascota_id,
        ServicioConsulta.is_deleted == False,  # noqa: E712
    )

    if alcance == "directos":
        q = q.filter(ServicioConsulta.consulta_id.is_(None))
    elif alcance == "consulta":
        q = q.filter(ServicioConsulta.consulta_id.isnot(None))
    elif alcance != "todos":
        raise HTTPException(status_code=422, detail="alcance debe ser 'directos', 'todos' o 'consulta'")

    if tipo_servicio:
        q = q.filter(ServicioConsulta.tipo_servicio == tipo_servicio)
    if estado:
        q = q.filter(ServicioConsulta.estado == estado)
    if facturado is not None:
        q = q.filter(ServicioConsulta.facturado == facturado)
    d_desde = _parse_fecha(fecha_desde, "fecha_desde")
    d_hasta = _parse_fecha(fecha_hasta, "fecha_hasta")
    if d_desde:
        q = q.filter(ServicioConsulta.created_at >= d_desde)
    if d_hasta:
        # inclusivo: hasta el fin de ese día (< día siguiente a medianoche)
        q = q.filter(ServicioConsulta.created_at < d_hasta + timedelta(days=1))

    return q.order_by(ServicioConsulta.created_at.desc(), ServicioConsulta.id.desc()).all()


@router.patch("/{servicio_id}", response_model=ServicioConsultaResponse)
def actualizar_servicio(
    servicio_id: int,
    update_data: ServicioConsultaUpdate,
    db: Session = Depends(get_db),
    # Fila 13 de la matriz (editar precio/cantidad): admin/recepción/
    # veterinario. La restricción "recepción solo en servicios no clínicos"
    # queda para cuando exista el modelo de orden (Fase 2); acá solo se
    # cierra el hueco de autenticación.
    # `gestor` se suma en la etapa 5 (fila 11): SOLO puede usar este PATCH
    # para ejecutar (EN_PROCESO -> EJECUTADO) el servicio que tomó -- el gate
    # fino vive en actualizar_servicio_impl, que rechaza cualquier otro uso.
    current_user: Usuario = Depends(require_roles("admin", "recepcionista", "veterinario", "gestor")),
):
    return actualizar_servicio_impl(servicio_id, update_data, db, current_user)


@router.delete("/{servicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_servicio(
    servicio_id: int,
    db: Session = Depends(get_db),
    # Fila 12 (cancelar servicio): admin/veterinario. Recepción y gestor no.
    current_user: Usuario = Depends(require_roles("admin", "veterinario")),
):
    return eliminar_servicio_impl(servicio_id, db, current_user)


@router.post("/{servicio_id}/tomar", response_model=ServicioConsultaResponse)
def tomar_servicio(
    servicio_id: int,
    db: Session = Depends(get_db),
    # Fila 10 de la matriz: admin siempre; gestor/veterinario solo si tienen
    # gestor_area para el area del servicio (se verifica abajo, es alcance
    # por datos -- decision 9.2 -- no por rol).
    current_user: Usuario = Depends(require_roles("admin", "veterinario", "gestor")),
):
    """ASIGNADO -> EN_PROCESO: el gestor se apropia del servicio (decisión 5,
    "el primero que lo toma se lo apropia").

    El despacho va al área, no a una persona (`asignado_a_id` nace NULL en
    ASIGNADO); el primero que lo toma queda dueño. Un segundo que lo intente
    recibe 409 -- se resuelve con un UPDATE condicional (`estado='ASIGNADO'
    AND asignado_a_id IS NULL`) para cerrar la carrera entre dos tomas
    simultáneas, no solo con un chequeo en Python que deja una ventana entre
    el SELECT y el UPDATE.
    """
    servicio = db.query(ServicioConsulta).filter(ServicioConsulta.id == servicio_id).first()
    if not servicio:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    if servicio.area_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este servicio no tiene área de despacho; no hay nada que tomar.",
        )
    if current_user.role != "admin" and not _es_gestor_del_area(db, current_user.id, servicio.area_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No estás habilitado como gestor del área de este servicio.",
        )
    if servicio.estado != "ASIGNADO":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El servicio está {servicio.estado}; solo se puede tomar un servicio ASIGNADO.",
        )

    filas = (
        db.query(ServicioConsulta)
        .filter(
            ServicioConsulta.id == servicio_id,
            ServicioConsulta.estado == "ASIGNADO",
            ServicioConsulta.asignado_a_id.is_(None),
        )
        .update({"estado": "EN_PROCESO", "asignado_a_id": current_user.id}, synchronize_session=False)
    )
    db.commit()

    if filas == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este servicio ya fue tomado por otro gestor.",
        )

    db.refresh(servicio)
    return ServicioConsultaResponse.model_validate(servicio)


LIMITE_REALIZADOS = 200


@router.get("/realizados", response_model=List[ServicioRealizadoResponse])
def listar_realizados(
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("gestor", "veterinario")),
):
    """Lo que el usuario tomó y ejecutó (pantalla-encargado, decisión 4): sus
    servicios EJECUTADO por fecha de ejecución, del más reciente al más viejo.
    Sin fechas, devuelve los de hoy. Un servicio facturado sigue EJECUTADO (la
    facturación es un flag), así que el filtro de estado alcanza."""
    hoy = datetime.now(timezone.utc).date()
    desde = desde or hoy
    hasta = hasta or hoy
    if hasta < desde:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'hasta' no puede ser anterior a 'desde'")
    dt_desde = datetime.combine(desde, datetime.min.time(), tzinfo=timezone.utc)
    dt_hasta = datetime.combine(hasta, datetime.max.time(), tzinfo=timezone.utc)

    q = db.query(ServicioConsulta).filter(
        ServicioConsulta.asignado_a_id == current_user.id,
        ServicioConsulta.estado == "EJECUTADO",
        ServicioConsulta.is_deleted == False,  # noqa: E712
        ServicioConsulta.ejecutado_at >= dt_desde,
        ServicioConsulta.ejecutado_at <= dt_hasta,
    )
    if area_id is not None:
        es_mia = db.query(GestorArea.id).filter(
            GestorArea.usuario_id == current_user.id, GestorArea.area_id == area_id
        ).first()
        if not es_mia:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esa área no es tuya")
        q = q.filter(ServicioConsulta.area_id == area_id)
    servicios = q.order_by(ServicioConsulta.ejecutado_at.desc()).limit(LIMITE_REALIZADOS).all()
    if not servicios:
        return []

    # Nombres por lote, sin N+1.
    area_ids = {s.area_id for s in servicios if s.area_id}
    mascota_ids = {s.mascota_id for s in servicios if s.mascota_id}
    orden_ids = {s.orden_id for s in servicios if s.orden_id}
    ids = [s.id for s in servicios]
    areas = dict(db.query(AreaServicio.id, AreaServicio.nombre).filter(AreaServicio.id.in_(area_ids)).all()) if area_ids else {}
    mascotas = dict(db.query(Mascota.id, Mascota.nombre).filter(Mascota.id.in_(mascota_ids)).all()) if mascota_ids else {}
    ordenes = dict(db.query(OrdenServicio.id, OrdenServicio.numero).filter(OrdenServicio.id.in_(orden_ids)).all()) if orden_ids else {}
    adjuntos = dict(
        db.query(Adjunto.servicio_id, func.count(Adjunto.id))
        .filter(Adjunto.servicio_id.in_(ids), Adjunto.is_deleted == False)  # noqa: E712
        .group_by(Adjunto.servicio_id)
        .all()
    )
    return [
        ServicioRealizadoResponse(
            id=s.id,
            nombre_servicio=s.nombre_servicio,
            area_id=s.area_id,
            area_nombre=areas.get(s.area_id),
            mascota_nombre=mascotas.get(s.mascota_id),
            orden_id=s.orden_id,
            orden_numero=ordenes.get(s.orden_id),
            ejecutado_at=s.ejecutado_at,
            detalles_clinicos=s.detalles_clinicos,
            adjuntos=adjuntos.get(s.id, 0),
        )
        for s in servicios
    ]


@router.get("/bandeja", response_model=List[ServicioConsultaResponse])
def listar_bandeja(
    db: Session = Depends(get_db),
    # Fila 4 (alcance recortado del gestor) + multi-rol (decision 9.2): un
    # veterinario con area tambien puede pedir su propia bandeja.
    current_user: Usuario = Depends(require_roles("admin", "veterinario", "gestor")),
    area_id: Optional[int] = None,
    usuario_id: Optional[int] = None,
):
    """La cola de trabajo del gestor logueado (decisión 6, "notificación ≠
    bandeja"): NO se lee de `notificaciones`, es una query directa sobre
    `servicios_consulta` -- la notificación es el empujón, la bandeja es la
    verdad.

    Ruta propia (en vez de `?bandeja=true` sobre `listar_servicios_mascota`,
    ver deviación en el reporte de apply): esa función exige `mascota_id` y
    no tiene ningún `current_user`, y la bandeja no filtra por mascota sino
    por área del usuario logueado -- forzarla adentro habría significado
    volver `mascota_id` opcional y agregarle autenticación a un endpoint que
    hoy no la tiene, dos cambios de contrato sobre código que no es mío en
    esta etapa.

    `area_id` / `usuario_id` (solo admin): para que el admin pueda auditar la
    cola de un área o de un gestor puntual sin tener que loguearse como él.
    Para `veterinario` / `gestor` se ignoran -- su bandeja es siempre la
    propia, exactamente como filtra la query de la decisión 6.
    """
    if current_user.role == "admin":
        if area_id is not None:
            areas_ids = [area_id]
        else:
            filas = (
                db.query(GestorArea.area_id)
                .filter(GestorArea.usuario_id == (usuario_id or current_user.id))
                .all()
            )
            areas_ids = [r[0] for r in filas]
        gestor_objetivo = usuario_id
    else:
        filas = db.query(GestorArea.area_id).filter(GestorArea.usuario_id == current_user.id).all()
        areas_ids = [r[0] for r in filas]
        gestor_objetivo = current_user.id

    if not areas_ids:
        return []

    q = db.query(ServicioConsulta).filter(
        ServicioConsulta.area_id.in_(areas_ids),
        ServicioConsulta.estado.in_(("ASIGNADO", "EN_PROCESO")),
        ServicioConsulta.is_deleted == False,  # noqa: E712
    )
    if gestor_objetivo is not None:
        q = q.filter(
            (ServicioConsulta.asignado_a_id.is_(None)) | (ServicioConsulta.asignado_a_id == gestor_objetivo)
        )
    return q.order_by(ServicioConsulta.created_at.asc()).all()
