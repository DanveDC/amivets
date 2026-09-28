"""Plantillas de paquete del catalogo (plantillas-paquete-catalogo).

Funciones puras (sin Session) para la agregacion de insumos y el mapeo de
categoria -> tipo_servicio (design D3/D4), mas `disponibilidad_servicio`
(wrapper con DB que las alimenta) y `anexar_paquete` (orquestacion del anexo a
una orden, tarea 5.1).
"""
from decimal import Decimal
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models.models import CatalogoPaqueteComponente, CatalogoServicio, Inventario, OrdenServicio, Usuario
from app.routers.servicios import validar_tipo_servicio_por_rol
from app.services import orden_service

TRES_DEC = Decimal("0.001")
UNIDAD_DEFAULT = "unidad"

# Categoria del catalogo -> tipo_servicio (design D3). Espejo de CATEGORIA_TIPO
# en static/js/sections/orden-abierta.js -- si uno cambia, cambiar el otro
# (ambos llevan este comentario cruzado, riesgo documentado en design.md).
_CATEGORIA_TIPO = {
    "LABORATORIO": "LABORATORIO",
    "IMAGENOLOGIA": "LABORATORIO",
    "QUIROFANO": "CIRUGIA",
    "HOSPITALIZACION": "HOSPITALIZACION",
    "PELUQUERIA": "ESTETICA",
    "FARMACIA": "INSUMO",
    "SERVICIOS": "OTRO",
    "ADMINISTRACION VARIOS": "OTRO",
}
_TIPO_DEFAULT = "OTRO"


def tipo_servicio_de_categoria(categoria: Optional[str]) -> str:
    """Mapea la categoria del catalogo al tipo_servicio de una linea de
    orden (usado por anexar_paquete para correr validar_tipo_servicio_por_rol
    antes de crear nada). Default 'OTRO' para categorias no mapeadas."""
    clave = (categoria or "").strip().upper()
    return _CATEGORIA_TIPO.get(clave, _TIPO_DEFAULT)


def rechazar_si_es_paquete(db: Session, catalogo_servicio_id: Optional[int]) -> None:
    """422 si `catalogo_servicio_id` apunta a un item `es_paquete=true`
    (plantillas-paquete-catalogo): crear o repuntar UNA sola línea a un
    paquete lo armaría a medio construir (solo la base, al precio del
    paquete, sin sus componentes). Punto único para los cuatro entry points
    que pueden dejar una línea con ese `catalogo_servicio_id`:
    `anexar_servicio_orden` (POST /ordenes/{id}/servicios),
    `agregar_servicio_consulta` (POST /consultas/{id}/servicios),
    `crear_servicio_directo` (POST /servicios/) y `actualizar_servicio_impl`
    (PATCH /servicios/{id}, solo cuando el payload trae el campo). NO se
    llama desde `anexar_paquete`: ese flujo pasa el id del paquete a
    `orden_service.crear_servicio_en_orden` a propósito, para la línea base.
    """
    if not catalogo_servicio_id:
        return
    item = db.query(CatalogoServicio).filter(CatalogoServicio.id == catalogo_servicio_id).first()
    if item is not None and item.es_paquete:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Es un paquete: agregalo con POST /api/ordenes/{id}/paquetes",
        )


def _q(valor) -> Decimal:
    if not isinstance(valor, Decimal):
        valor = Decimal(str(valor if valor is not None else 0))
    return valor.quantize(TRES_DEC)


def agregar_necesidades(lineas: Iterable[tuple]) -> dict:
    """Suma cantidades por material a partir de lineas (inventario_id,
    cantidad, nombre_servicio_origen).

    Mismo criterio que consumo_service._necesidades: cada linea de receta
    entra UNA vez por servicio de origen, no se multiplica por la cantidad
    del componente (design D4, Riesgo "Recipe not scaled by component
    quantity"). Devuelve {inv_id: {"requerido": Decimal, "origenes": [str, ...]}}.
    """
    necesidades: dict = {}
    for inventario_id, cantidad, nombre_origen in lineas:
        qty = _q(cantidad)
        entrada = necesidades.setdefault(inventario_id, {"requerido": Decimal("0"), "origenes": []})
        entrada["requerido"] += qty
        if nombre_origen not in entrada["origenes"]:
            entrada["origenes"].append(nombre_origen)
    for entrada in necesidades.values():
        entrada["requerido"] = _q(entrada["requerido"])
    return necesidades


def evaluar_disponibilidad(necesidades: dict, materiales: dict) -> dict:
    """Compara lo necesitado contra el stock actual de cada material.

    `materiales`: {inv_id: obj con .nombre, .unidad_medida, .stock_actual}.
    Devuelve {"suficiente": bool, "insumos": [...]}; `insumos` ordenado por
    nombre. `faltante = max(requerido - disponible, 0)`; unidad None -> "unidad".
    """
    insumos = []
    suficiente = True
    for inv_id, datos in necesidades.items():
        material = materiales.get(inv_id)
        nombre = getattr(material, "nombre", None) or f"#{inv_id}"
        unidad = (getattr(material, "unidad_medida", None) or UNIDAD_DEFAULT) if material else UNIDAD_DEFAULT
        disponible = _q(getattr(material, "stock_actual", 0) if material else 0)
        requerido = datos["requerido"]
        faltante = requerido - disponible
        if faltante < 0:
            faltante = Decimal("0")
        else:
            suficiente = False if faltante > 0 else suficiente
        insumos.append({
            "inventario_id": inv_id,
            "nombre": nombre,
            "unidad": unidad,
            "requerido": requerido,
            "disponible": disponible,
            "faltante": faltante,
            "origenes": datos["origenes"],
        })
    insumos.sort(key=lambda i: i["nombre"])
    return {"suficiente": suficiente, "insumos": insumos}


def disponibilidad_servicio(db: Session, catalogo_servicio: CatalogoServicio) -> dict:
    """Disponibilidad de insumos de un servicio del catalogo (design D4): su
    receta propia mas, si es un paquete, la receta de cada componente ACTIVO
    (los componentes inactivos van a `componentes_omitidos`, no a la cuenta de
    materiales). No consulta stock aparte: una sola query trae los
    `Inventario` involucrados.
    """
    lineas = [(r.inventario_id, r.cantidad, catalogo_servicio.nombre) for r in catalogo_servicio.recetas]
    componentes_omitidos = []

    if catalogo_servicio.es_paquete:
        filas = (
            db.query(CatalogoPaqueteComponente)
            .options(
                joinedload(CatalogoPaqueteComponente.componente).joinedload(CatalogoServicio.recetas)
            )
            .filter(CatalogoPaqueteComponente.paquete_id == catalogo_servicio.id)
            .order_by(CatalogoPaqueteComponente.posicion, CatalogoPaqueteComponente.id)
            .all()
        )
        for fila in filas:
            comp = fila.componente
            if comp is None:
                continue
            if not comp.activo:
                componentes_omitidos.append({"catalogo_servicio_id": comp.id, "nombre": comp.nombre})
                continue
            for r in comp.recetas:
                lineas.append((r.inventario_id, r.cantidad, comp.nombre))

    necesidades = agregar_necesidades(lineas)

    materiales = {}
    if necesidades:
        inv_ids = list(necesidades.keys())
        materiales = {
            inv.id: inv
            for inv in db.query(Inventario).filter(Inventario.id.in_(inv_ids)).all()
        }

    resultado = evaluar_disponibilidad(necesidades, materiales)
    return {
        "catalogo_servicio_id": catalogo_servicio.id,
        "suficiente": resultado["suficiente"],
        "insumos": resultado["insumos"],
        "componentes_omitidos": componentes_omitidos,
    }


def anexar_paquete(db: Session, orden: OrdenServicio, paquete_id: int, current_user: Usuario) -> tuple:
    """Anexa una plantilla de paquete completa (base + items activos) a una
    orden en una sola transaccion (design D3): una linea base (`es_base`) al
    precio propio del paquete, y un item por componente ACTIVO anclado a esa
    base, en orden `(posicion, id)`, cada uno a su propio precio de catalogo.
    Reusa `orden_service.crear_servicio_en_orden` para que area, `SOLICITADO`,
    `mascota_id` y la jerarquia queden identicos a un paquete armado a mano.

    `validar_tipo_servicio_por_rol` corre sobre la base y CADA componente
    ANTES de crear nada: si una recepcionista no puede anexar una linea
    clinica del paquete, no se crea ninguna (403 limpio, sin paquete a medio
    armar). No commitea -- el router (`POST /ordenes/{id}/paquetes`) decide la
    transaccion, igual que `crear_servicio_en_orden`.

    Devuelve (base, items, advertencias): una advertencia por componente
    inactivo omitido y una por cada material con `faltante > 0` segun
    `disponibilidad_servicio` -- nunca bloquea el anexo (design D4: el chequeo
    es informativo, el stock se sigue consumiendo recien al ejecutar).
    """
    paquete = (
        db.query(CatalogoServicio)
        .options(joinedload(CatalogoServicio.componentes).joinedload(CatalogoPaqueteComponente.componente))
        .filter(CatalogoServicio.id == paquete_id)
        .first()
    )
    if not paquete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Servicio no encontrado")
    if not paquete.es_paquete:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Este servicio no es un paquete: agregalo con POST /api/ordenes/{id}/servicios",
        )
    if not paquete.activo:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El paquete está inactivo")

    activos = [c for c in paquete.componentes if c.componente is not None and c.componente.activo]
    omitidos = [c for c in paquete.componentes if c.componente is not None and not c.componente.activo]
    if not activos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El paquete no tiene componentes activos",
        )

    # Gate de rol ANTES de crear nada (design D3, paso 3): admin/veterinario
    # pasan sin restricción; una recepcionista con un componente clínico corta
    # acá con 403 y ninguna línea queda creada.
    tipo_base = tipo_servicio_de_categoria(paquete.categoria)
    validar_tipo_servicio_por_rol(current_user, tipo_base)
    for c in activos:
        validar_tipo_servicio_por_rol(current_user, tipo_servicio_de_categoria(c.componente.categoria))

    base, _ = orden_service.crear_servicio_en_orden(
        db,
        orden,
        tipo_servicio=tipo_base,
        referencia_id=None,
        catalogo_servicio_id=paquete.id,
        nombre_servicio=paquete.nombre,
        cantidad=1.0,
        precio_unitario=float(paquete.precio_ref or 0),
        detalles_clinicos=None,
        consumos_override=None,
        current_user=current_user,
        es_base=True,
    )

    items = []
    for c in activos:
        comp = c.componente
        item, _ = orden_service.crear_servicio_en_orden(
            db,
            orden,
            tipo_servicio=tipo_servicio_de_categoria(comp.categoria),
            referencia_id=None,
            catalogo_servicio_id=comp.id,
            nombre_servicio=comp.nombre,
            cantidad=float(c.cantidad),
            precio_unitario=float(comp.precio_ref or 0),
            detalles_clinicos=None,
            consumos_override=None,
            current_user=current_user,
            servicio_padre_id=base.id,
        )
        items.append(item)

    advertencias = [
        {"mensaje": f'Se omitió el componente inactivo "{c.componente.nombre}"'}
        for c in omitidos
    ]
    disponibilidad = disponibilidad_servicio(db, paquete)
    for insumo in disponibilidad["insumos"]:
        if insumo["faltante"] and insumo["faltante"] > 0:
            advertencias.append({
                "mensaje": (
                    f"Stock insuficiente de {insumo['nombre']}: se necesitan "
                    f"{insumo['requerido']} {insumo['unidad']}, hay {insumo['disponible']}"
                )
            })

    return base, items, advertencias
