"""Aviso al gestor y al equipo cuando cambia el estado de un servicio
despachado (Tarea 06, decisión 6; etapa 5).

Fan-out en escritura: una fila `Notificacion` por destinatario (nunca se
resuelve el destinatario al leer -- decisión 6 explícita). Mismo patrón que
`consumo_service` / `orden_service`: funciones que reciben la `Session` y NO
commitean, para que el llamador (`orden_service.confirmar_servicios`,
`routers/servicios.py::actualizar_servicio_impl`) las componga en su propia
transacción.

OJO: esto NO es la bandeja del gestor. La bandeja es una query sobre
`servicios_consulta` (ver `servicios.py::listar_bandeja`); acá solo se crea el
"empujón" que el gestor puede ignorar sin que el trabajo desaparezca.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import GestorArea, Notificacion, ServicioConsulta, Usuario


def _titulo_servicio(servicio: ServicioConsulta) -> str:
    return servicio.nombre_servicio or servicio.tipo_servicio or f"Servicio #{servicio.id}"


def notificar_asignacion(db: Session, servicio: ServicioConsulta) -> Optional[dict]:
    """SOLICITADO -> ASIGNADO: notifica al gestor elegido, o a cada gestor
    ACTIVO del área si no se eligió ninguno.

    Asignación directa (asignacion-directa-servicio-gestor, decisión 3): si
    `servicio.asignado_directo_a_id` está seteado (lo llenó
    `orden_service.confirmar_servicios` al validar el gestor elegido), se
    crea un único `SERVICIO_ASIGNADO` para ese usuario y se devuelve `None`
    -- se lee del propio servicio, no de un parámetro nuevo, para que la
    firma no cambie y el llamador no pueda desincronizar servicio y
    notificación. Como ese gestor ya se validó activo antes de llegar acá, la
    rama `SERVICIO_SIN_GESTOR` de abajo no aplica a un despacho directo.

    Si no hay asignación directa (comportamiento de siempre): notifica a cada
    gestor activo del área. Si el área no tiene ningún gestor activo
    (`GestorArea` + `Usuario.is_active`), notifica a todos los admins con
    `SERVICIO_SIN_GESTOR` en su lugar (decisión 5, defensa 2) y devuelve una
    advertencia para que el llamador la sume a `advertencias[]` de la
    respuesta (defensa 1) -- reutiliza el canal que ya existe en
    `ServicioConsultaResponse.advertencias`, no se inventa un mecanismo nuevo.

    No hace nada (devuelve None sin crear filas) si el servicio no tiene área:
    es el atajo sin despacho de la decisión 4, no hay a quién avisarle.
    """
    if servicio.area_id is None:
        return None

    titulo = _titulo_servicio(servicio)

    if servicio.asignado_directo_a_id is not None:
        db.add(
            Notificacion(
                destinatario_id=servicio.asignado_directo_a_id,
                tipo="SERVICIO_ASIGNADO",
                titulo=f"Nuevo servicio asignado: {titulo}",
                cuerpo=f"Se te asignó '{titulo}'.",
                orden_id=servicio.orden_id,
                servicio_id=servicio.id,
            )
        )
        return None

    gestores = (
        db.query(Usuario)
        .join(GestorArea, GestorArea.usuario_id == Usuario.id)
        .filter(GestorArea.area_id == servicio.area_id, Usuario.is_active == True)  # noqa: E712
        .all()
    )

    if gestores:
        for gestor in gestores:
            db.add(
                Notificacion(
                    destinatario_id=gestor.id,
                    tipo="SERVICIO_ASIGNADO",
                    titulo=f"Nuevo servicio asignado: {titulo}",
                    cuerpo=f"Se despachó '{titulo}' a tu área.",
                    orden_id=servicio.orden_id,
                    servicio_id=servicio.id,
                )
            )
        return None

    admins = db.query(Usuario).filter(Usuario.role == "admin", Usuario.is_active == True).all()  # noqa: E712
    area_nombre = servicio.area.nombre if servicio.area else str(servicio.area_id)
    for admin in admins:
        db.add(
            Notificacion(
                destinatario_id=admin.id,
                tipo="SERVICIO_SIN_GESTOR",
                titulo=f"Servicio sin gestor: {titulo}",
                cuerpo=f"El área '{area_nombre}' no tiene ningún gestor activo asignado.",
                orden_id=servicio.orden_id,
                servicio_id=servicio.id,
            )
        )

    return {
        "servicio_id": servicio.id,
        "mensaje": (
            f"El área '{area_nombre}' no tiene ningún gestor activo; "
            "se notificó a los administradores."
        ),
    }


def _cuerpo_orden(servicio: ServicioConsulta) -> str:
    """Armado defensivo del cuerpo con paciente/tutor/motivo/servicios
    (toma-exclusiva-servicio-gestor, decisión 3): cualquiera de esas
    relaciones puede ser None (venta de mostrador sin paciente, orden sin
    tutor resuelto todavía) y esto no debe romper la notificación por eso.
    """
    orden = servicio.orden
    paciente = servicio.mascota.nombre if servicio.mascota else "sin paciente"
    tutor = "sin tutor"
    if orden is not None and orden.propietario is not None:
        tutor = f"{orden.propietario.nombre} {orden.propietario.apellido}"
    motivo = (orden.motivo_visita if orden is not None else None) or "sin especificar"
    numero = orden.numero if orden is not None else f"#{servicio.orden_id}"
    servicios = [s.nombre_servicio for s in (orden.servicios if orden is not None else []) if s.nombre_servicio]
    listado = ", ".join(servicios) if servicios else _titulo_servicio(servicio)
    return (
        f"Orden {numero}. Paciente: {paciente}. Tutor: {tutor}. "
        f"Motivo: {motivo}. Servicios: {listado}."
    )


def notificar_toma(db: Session, servicio: ServicioConsulta, tomador: Usuario) -> None:
    """ASIGNADO -> EN_PROCESO: avisa al veterinario de la orden que un gestor
    se apropió del servicio (toma-exclusiva-servicio-gestor, decisión 3), con
    los datos para que arranque la atención sin tener que ir a buscarlos.

    No hace nada si la orden no tiene veterinario asignado, o si el propio
    veterinario fue quien tomó el servicio (no hay a quién avisarle nada que
    no sepa).
    """
    orden = servicio.orden
    if orden is None or not orden.veterinario_id or orden.veterinario_id == tomador.id:
        return
    db.add(
        Notificacion(
            destinatario_id=orden.veterinario_id,
            tipo="SERVICIO_TOMADO",
            titulo=f"Servicio tomado: {_titulo_servicio(servicio)}",
            cuerpo=f"El gestor {tomador.username} tomó '{_titulo_servicio(servicio)}'. {_cuerpo_orden(servicio)}",
            orden_id=servicio.orden_id,
            servicio_id=servicio.id,
        )
    )


def notificar_liberacion(db: Session, servicio: ServicioConsulta, liberador: Usuario) -> None:
    """EN_PROCESO -> ASIGNADO (liberación): avisa al veterinario de la orden
    que el servicio quedó disponible de nuevo. Mismo guard que
    notificar_toma: sin veterinario, o liberador == veterinario, no hay nada
    que avisar."""
    orden = servicio.orden
    if orden is None or not orden.veterinario_id or orden.veterinario_id == liberador.id:
        return
    db.add(
        Notificacion(
            destinatario_id=orden.veterinario_id,
            tipo="SERVICIO_LIBERADO",
            titulo=f"Servicio liberado: {_titulo_servicio(servicio)}",
            cuerpo=f"El gestor {liberador.username} liberó '{_titulo_servicio(servicio)}'. {_cuerpo_orden(servicio)}",
            orden_id=servicio.orden_id,
            servicio_id=servicio.id,
        )
    )


def notificar_ejecucion(db: Session, servicio: ServicioConsulta) -> None:
    """EN_PROCESO -> EJECUTADO: avisa a quien tiene que seguir el caso.

    Decisión deliberada sobre el destinatario (sin sumar ninguna columna
    nueva, tal como pide el enunciado): se usa `OrdenServicio.veterinario_id`
    si está seteado -- es quien atiende al paciente y necesita el resultado
    del laboratorio/imagen/estética --, y si la orden no tiene veterinario
    (venta de mostrador, orden solo de estética) se cae a `OrdenServicio.
    abierta_por_id`, que es quien la va a facturar y necesita saber que ya
    está lista para cobrar. `ServicioConsulta` no tiene una columna "quién lo
    anexó" propia, así que estos dos son los únicos datos disponibles que
    identifican a un responsable razonable de la orden.
    """
    orden = servicio.orden
    if orden is None:
        return
    destinatario_id = orden.veterinario_id or orden.abierta_por_id
    if not destinatario_id:
        return

    titulo = _titulo_servicio(servicio)
    db.add(
        Notificacion(
            destinatario_id=destinatario_id,
            tipo="SERVICIO_EJECUTADO",
            titulo=f"Resultado cargado: {titulo}",
            cuerpo=f"El servicio '{titulo}' pasó a EJECUTADO.",
            orden_id=servicio.orden_id,
            servicio_id=servicio.id,
        )
    )
