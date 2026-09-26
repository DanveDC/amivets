"""Consumo y reversa de materiales al aplicar un servicio de consulta.

Tarea 07 (inventario fraccionado), slice B. Reglas de negocio:

- Decision 3: el stock se descuenta cuando un ServicioConsulta entra en
  un estado consumido -- EJECUTADO, el viejo "Aplicado" (no al facturar; ver
  ESTADOS_CONSUMIDOS abajo). Guard anti-doble-descuento basado en
  el ledger (movimientos + filas de consumo_material), no en un booleano.
- Decision 4: sin stock suficiente -> si settings.STRICT_INVENTORY se bloquea
  con 400; si no, se permite (stock puede quedar negativo), se registra el
  movimiento igual y se devuelve una advertencia.
- Decision 6: la receta del catalogo es el valor por defecto; el llamador puede
  pasar overrides {inventario_id: cantidad} con el consumo real.
- Decision 7: merma_al_abrir -> ademas del SALIDA por lo usado, un MERMA por el
  resto del envase (redondeo hacia arriba al multiplo de contenido_por_envase).
- Decision 8: NULL unidad_medida -> "unidad"; NULL contenido_por_envase -> 1.
  Magnitud siempre positiva; la direccion la lleva tipo_movimiento.

Toda la aritmetica es Decimal, cuantizada a 3 decimales. Nunca float.
"""

from decimal import Decimal
import math

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import (
    Inventario,
    MovimientoInventario,
    ConsumoMaterial,
    ConsumoPrevisto,
    RecetaServicio,
    ServicioConsulta,
    Vacunacion,
    TipoMovimiento,
)

TRES_DEC = Decimal("0.001")
UNIDAD_DEFAULT = "unidad"

# Decision 4 (docs/diseno/ordenes-de-servicio.md): los estados en los que el
# servicio YA descontó sus materiales del stock. EJECUTADO es el viejo
# "Aplicado"; FACTURADO está del MISMO lado de la frontera, así que
# EJECUTADO -> FACTURADO no consume ni revierte nada.
#
# La condición hay que escribirla siempre como pertenencia a este conjunto,
# nunca como `== "EJECUTADO"`: con dos estados consumidos, un `!=` devolvería el
# stock al facturar (Riesgo 2 del doc de diseño, el punto más fácil de romper).
#
#     if old not in ESTADOS_CONSUMIDOS and new in ESTADOS_CONSUMIDOS: consume
#     elif old in ESTADOS_CONSUMIDOS and new not in ESTADOS_CONSUMIDOS: revierte
ESTADOS_CONSUMIDOS = frozenset({"EJECUTADO", "FACTURADO"})


def _q(valor) -> Decimal:
    """Cuantiza a 3 decimales sin pasar por float."""
    if not isinstance(valor, Decimal):
        valor = Decimal(str(valor if valor is not None else 0))
    return valor.quantize(TRES_DEC)


def overrides_from_payload(consumos) -> dict:
    """Convierte la lista ConsumoMaterialOverride del request en {inv_id: Decimal}.

    Acepta tanto objetos pydantic (ruta POST) como dicts planos: el PATCH hace
    ``update_data.model_dump(exclude_unset=True)`` y saca ``consumos`` ya
    convertido a lista de dicts, no de modelos (evita el AttributeError -> 500).
    """
    if not consumos:
        return {}
    out = {}
    for c in consumos:
        iid = c["inventario_id"] if isinstance(c, dict) else c.inventario_id
        cant = c["cantidad"] if isinstance(c, dict) else c.cantidad
        out[int(iid)] = _q(cant)
    return out


def guardar_consumo_previsto(db: Session, servicio: ServicioConsulta, consumos, reemplazar: bool = False) -> None:
    """Guarda el consumo real indicado para un servicio que todavía no se
    ejecutó (ver ConsumoPrevisto). No descuenta stock: eso pasa al ejecutar.
    Con `reemplazar`, lo nuevo sustituye a lo guardado (edición del servicio)."""
    if reemplazar:
        db.query(ConsumoPrevisto).filter(ConsumoPrevisto.servicio_consulta_id == servicio.id).delete()
    for inv_id, cantidad in overrides_from_payload(consumos).items():
        db.add(ConsumoPrevisto(servicio_consulta_id=servicio.id, inventario_id=inv_id, cantidad=cantidad))


def consumo_previsto(db: Session, servicio_id: int) -> dict:
    """{inventario_id: cantidad} guardado al agregar el servicio, o {}."""
    return {
        c.inventario_id: _q(c.cantidad)
        for c in db.query(ConsumoPrevisto).filter(ConsumoPrevisto.servicio_consulta_id == servicio_id).all()
    }


def _resolver_inventario_legacy(db: Session, servicio: ServicioConsulta):
    """Resuelve el Inventario de la ruta ad-hoc (INSUMO manual / VACUNACION).

    Mantiene intacto el overload de referencia_id: para VACUNACION es un
    Vacunacion.id que se re-resuelve a vacuna_id; para INSUMO es un Inventario.id.
    """
    if not servicio.referencia_id:
        return None
    if servicio.tipo_servicio == "VACUNACION":
        vac = db.query(Vacunacion).filter(Vacunacion.id == servicio.referencia_id).first()
        if vac:
            return db.query(Inventario).filter(Inventario.id == vac.vacuna_id).first()
    return db.query(Inventario).filter(Inventario.id == servicio.referencia_id).first()


def _ya_consumido(db: Session, servicio_consulta_id: int) -> bool:
    """True si este servicio ya genero consumo no revertido (Decision 3).

    Cuenta SOLO SALIDA contra REVERSA. La MERMA queda EXCLUIDA del conteo: siempre
    viaja al lado de una SALIDA para el mismo material, pero la reversa escribe una
    unica REVERSA combinada (usado + merma). Si sumaramos MERMA, tras revertir un
    servicio con merma quedaria salidas(2) > reversas(1) y el re-aplicar seria un
    no-op silencioso (bug H3). Con SALIDA-vs-REVERSA el balance cierra en cada
    ciclo aplicar/revertir/re-aplicar.
    """
    if db.query(ConsumoMaterial.id).filter(
        ConsumoMaterial.servicio_consulta_id == servicio_consulta_id
    ).first():
        return True
    salidas = db.query(MovimientoInventario.id).filter(
        MovimientoInventario.servicio_consulta_id == servicio_consulta_id,
        MovimientoInventario.tipo_movimiento == TipoMovimiento.SALIDA,
    ).count()
    reversas = db.query(MovimientoInventario.id).filter(
        MovimientoInventario.servicio_consulta_id == servicio_consulta_id,
        MovimientoInventario.tipo_movimiento == TipoMovimiento.REVERSA,
    ).count()
    return salidas > reversas


def _necesidades(db: Session, servicio: ServicioConsulta, overrides: dict) -> dict:
    """Arma {inventario_id: cantidad_necesaria} desde receta + ruta ad-hoc.

    Dedupe por inventario_id sumando cantidades.
    """
    necesidades: dict = {}

    # (a) receta del servicio de catalogo
    if servicio.catalogo_servicio_id:
        lineas = db.query(RecetaServicio).filter(
            RecetaServicio.catalogo_servicio_id == servicio.catalogo_servicio_id
        ).all()
        for ln in lineas:
            qty = overrides.get(ln.inventario_id, _q(ln.cantidad))
            necesidades[ln.inventario_id] = necesidades.get(ln.inventario_id, Decimal("0")) + qty

    # (b) ruta manual: INSUMO / VACUNACION con referencia_id, cantidad = servicio.cantidad
    if servicio.tipo_servicio in ("INSUMO", "VACUNACION") and servicio.referencia_id:
        inv_legacy = _resolver_inventario_legacy(db, servicio)
        if inv_legacy is not None:
            if inv_legacy.id in necesidades:
                # ya cubierto por la receta (mismo material): no duplicar
                pass
            else:
                qty = overrides.get(inv_legacy.id, _q(servicio.cantidad))
                if qty > 0:
                    necesidades[inv_legacy.id] = qty

    return {k: _q(v) for k, v in necesidades.items() if _q(v) > 0}


def consumir_para_servicio(db: Session, servicio: ServicioConsulta, *, overrides=None, usuario_id=None):
    """Descuenta stock de los materiales del servicio al pasar a Aplicado.

    Idempotente: si ya hay consumo no revertido para este servicio, no hace
    nada. Devuelve la lista de advertencias [{material, faltante, unidad}].
    """
    # Candado de fila sobre el ServicioConsulta ANTES de leer el guard: sin esto,
    # dos PATCH concurrentes Pendiente->Aplicado (doble-click en el select de
    # estado) pasan ambos el _ya_consumido y consumen dos veces (bug H2). La
    # transaccion del router no hace commit entre este lock y las escrituras.
    db.query(ServicioConsulta.id).filter(
        ServicioConsulta.id == servicio.id
    ).with_for_update().first()

    if _ya_consumido(db, servicio.id):
        return []

    # El consumo indicado al agregar el servicio a la orden (ConsumoPrevisto)
    # es la base; un override explicito lo pisa material por material, no
    # entero (un override parcial no debe tirar el resto de lo previsto).
    overrides = {**consumo_previsto(db, servicio.id), **(overrides or {})}
    necesidades = _necesidades(db, servicio, overrides)
    if not necesidades:
        return []

    ref = f"Consulta #{servicio.consulta_id}" if servicio.consulta_id else f"Servicio directo #{servicio.id}"
    advertencias = []

    for inv_id, necesita in necesidades.items():
        inv = db.query(Inventario).filter(Inventario.id == inv_id).with_for_update().first()
        if inv is None:
            continue

        necesita = _q(necesita)
        unidad = inv.unidad_medida or UNIDAD_DEFAULT

        if inv.stock_actual < necesita:
            if settings.STRICT_INVENTORY:
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuficiente de {inv.nombre}: hay {_q(inv.stock_actual)} {unidad}, se necesitan {necesita} {unidad}",
                )
            faltante = _q(necesita - inv.stock_actual)
            advertencias.append({
                "material": inv.nombre,
                "faltante": float(faltante),
                "unidad": unidad,
            })

        # SALIDA por lo efectivamente usado (magnitud positiva)
        mov_salida = MovimientoInventario(
            producto_id=inv.id,
            tipo_movimiento=TipoMovimiento.SALIDA,
            cantidad=necesita,
            costo_unitario=inv.precio_unitario,
            origen_destino=f"Consumo servicio - {ref}",
            servicio_consulta_id=servicio.id,
            usuario_responsable_id=usuario_id,
        )
        db.add(mov_salida)
        db.flush()  # necesitamos mov_salida.id para enlazar el consumo

        db.add(ConsumoMaterial(
            servicio_consulta_id=servicio.id,
            inventario_id=inv.id,
            cantidad=necesita,
            unidad_medida=unidad,
            movimiento_id=mov_salida.id,
        ))

        delta_total = necesita

        # Decision 7: merma al abrir -> descartar el resto del envase
        if inv.merma_al_abrir and inv.contenido_por_envase:
            envase = _q(inv.contenido_por_envase)
            if envase > 0:
                n_envases = math.ceil(necesita / envase)
                sobrante = _q(Decimal(n_envases) * envase - necesita)
                if sobrante > 0:
                    db.add(MovimientoInventario(
                        producto_id=inv.id,
                        tipo_movimiento=TipoMovimiento.MERMA,
                        cantidad=sobrante,
                        costo_unitario=inv.precio_unitario,
                        origen_destino=f"Merma al abrir - {ref}",
                        servicio_consulta_id=servicio.id,
                        usuario_responsable_id=usuario_id,
                    ))
                    delta_total = _q(delta_total + sobrante)

        inv.stock_actual = _q(inv.stock_actual - delta_total)

    return advertencias


def revertir_para_servicio(db: Session, servicio: ServicioConsulta, *, usuario_id=None):
    """Devuelve al stock EXACTAMENTE lo consumido (lee consumo_material, no la receta).

    Espejo de facturacion_service.anular_factura. Escribe REVERSA en el ledger
    (magnitud positiva) y borra las filas de consumo_material -- el rastro de
    auditoria queda en los movimientos SALIDA/MERMA/REVERSA.
    """
    # Mismo candado atomico que consumir_para_servicio (bug H2): el chequeo de
    # "ya revertido" y las escrituras van bajo un unico lock de fila.
    db.query(ServicioConsulta.id).filter(
        ServicioConsulta.id == servicio.id
    ).with_for_update().first()

    ref = f"Consulta #{servicio.consulta_id}" if servicio.consulta_id else f"Servicio directo #{servicio.id}"

    ya_revertido = db.query(MovimientoInventario.id).filter(
        MovimientoInventario.servicio_consulta_id == servicio.id,
        MovimientoInventario.tipo_movimiento == TipoMovimiento.REVERSA,
    ).first() is not None

    consumos = db.query(ConsumoMaterial).filter(
        ConsumoMaterial.servicio_consulta_id == servicio.id
    ).all()

    if consumos:
        # merma registrada para este servicio, agrupada por material
        merma_por_inv: dict = {}
        for m in db.query(MovimientoInventario).filter(
            MovimientoInventario.servicio_consulta_id == servicio.id,
            MovimientoInventario.tipo_movimiento == TipoMovimiento.MERMA,
        ).all():
            merma_por_inv[m.producto_id] = merma_por_inv.get(m.producto_id, Decimal("0")) + _q(m.cantidad)

        for c in consumos:
            inv = db.query(Inventario).filter(Inventario.id == c.inventario_id).with_for_update().first()
            if inv is None:
                db.delete(c)
                continue
            delta = _q(_q(c.cantidad) + merma_por_inv.pop(inv.id, Decimal("0")))
            inv.stock_actual = _q(inv.stock_actual + delta)
            db.add(MovimientoInventario(
                producto_id=inv.id,
                tipo_movimiento=TipoMovimiento.REVERSA,
                cantidad=delta,
                costo_unitario=inv.precio_unitario,
                origen_destino=f"Reversion consumo - {ref}",
                servicio_consulta_id=servicio.id,
                usuario_responsable_id=usuario_id,
            ))
            db.delete(c)
        return

    if ya_revertido:
        return

    # --- Fallbacks legacy: servicios aplicados antes de slice B ---
    # (i) hay movimientos anclados al servicio (p.ej. clinico.py vacunacion)
    movs = db.query(MovimientoInventario).filter(
        MovimientoInventario.servicio_consulta_id == servicio.id,
        MovimientoInventario.tipo_movimiento.in_([TipoMovimiento.SALIDA, TipoMovimiento.MERMA]),
    ).all()
    if movs:
        for m in movs:
            inv = db.query(Inventario).filter(Inventario.id == m.producto_id).with_for_update().first()
            if inv is None:
                continue
            mag = abs(_q(m.cantidad))
            inv.stock_actual = _q(inv.stock_actual + mag)
            db.add(MovimientoInventario(
                producto_id=inv.id,
                tipo_movimiento=TipoMovimiento.REVERSA,
                cantidad=mag,
                costo_unitario=inv.precio_unitario,
                origen_destino=f"Reversion consumo - {ref}",
                servicio_consulta_id=servicio.id,
                usuario_responsable_id=usuario_id,
            ))
        return

    # (ii) ruta ad-hoc INSUMO/VACUNACION sin anclaje en el ledger
    if servicio.referencia_id and servicio.tipo_servicio in ("INSUMO", "VACUNACION"):
        inv = _resolver_inventario_legacy(db, servicio)
        if inv is not None:
            inv = db.query(Inventario).filter(Inventario.id == inv.id).with_for_update().first()
            mag = _q(servicio.cantidad)
            if inv is not None and mag > 0:
                inv.stock_actual = _q(inv.stock_actual + mag)
                db.add(MovimientoInventario(
                    producto_id=inv.id,
                    tipo_movimiento=TipoMovimiento.ENTRADA,
                    cantidad=mag,
                    costo_unitario=inv.precio_unitario,
                    origen_destino=f"Reversion consumo - {ref}",
                    servicio_consulta_id=servicio.id,
                    usuario_responsable_id=usuario_id,
                ))
