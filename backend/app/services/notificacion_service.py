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
    """SOLICITADO -> ASIGNADO: notifica a cada gestor ACTIVO del área.

    Si el área no tiene ningún gestor activo (`GestorArea` + `Usuario.
    is_active`), notifica a todos los admins con `SERVICIO_SIN_GESTOR` en su
    lugar (decisión 5, defensa 2) y devuelve una advertencia para que el
    llamador la sume a `advertencias[]` de la respuesta (defensa 1) --
    reutiliza el canal que ya existe en `ServicioConsultaResponse.
    advertencias`, no se inventa un mecanismo nuevo.

    No hace nada (devuelve None sin crear filas) si el servicio no tiene área:
    es el atajo sin despacho de la decisión 4, no hay a quién avisarle.
    """
    if servicio.area_id is None:
        return None

    titulo = _titulo_servicio(servicio)

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
