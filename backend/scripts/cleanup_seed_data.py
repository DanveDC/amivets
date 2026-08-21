"""
Explicit, dev-only cleanup tool for data created by scripts/seed_data.py
(Unidad A2, docs/tareas/04-kpis-recetas-y-veterinarios.md).

Never runs automatically — invoke by hand:
    python scripts/cleanup_seed_data.py                 # dry-run, counts only
    python scripts/cleanup_seed_data.py --execute        # applies the delete

Inside the dev container:
    docker compose exec backend python scripts/cleanup_seed_data.py
    docker compose exec backend python scripts/cleanup_seed_data.py --execute

Refuses to run when ENVIRONMENT=production, same as seed_data.py.

Identification is by the only stable markers seed_data.py leaves behind:
  - Usuario.username in the fixed dr_* list (10 hardcoded apellidos)
  - Inventario.codigo in the fixed {prefijo}-{100+i} set (fixed categorias dict)
  - Consulta.veterinario matching the free-text "Dr. {Apellido}" label seed_data.py
    writes for those same 10 médicos (see obstáculo estructural #1 in the task doc:
    Consulta.veterinario is not a foreign key)
  - Everything hanging off those consultas (Receta/DetalleReceta, PruebaComplementaria,
    Vacunacion, Desparasitacion, ServicioConsulta, Hospitalizacion, Cirugia)

Propietario and Mascota carry NO stable marker at all: seed_data.py assigns them
random cedulas and names drawn from a name pool, with no seed flag or fixed value
to filter on. This script does NOT delete them by default — see report_untagged()
below. --include-orphaned-contacts is a separate, explicit opt-in that only
touches Propietario/Mascota rows left with zero consultas after the delete above,
which is a heuristic, not a marker: use it only once it's already confirmed there
is no real data in the database.

ALSO cleans up scripts/populate_demo.py's data (found in the live DB during the
dry run, NOT created by seed_data.py — a separate, undocumented demo script run
manually against this database at some point): Propietario.cedula == "DEMO-001",
Mascota.codigo_historia == "PAT-DEMO", and every Consulta with
veterinario == "Dr. Antigravity" plus their children. These markers are just as
deterministic as seed_data.py's, so they're included the same way.

Also targeted: one Consulta with veterinario == 'dr_garcía' (lowercase, no "Dr."
prefix). This one does NOT match any known script's output pattern — it was
flagged as unclassified during the first dry run, and Daniel explicitly
authorized treating it as populate_demo.py-style noise and deleting it (same
"local only, no real data" justification). It is listed separately in
AUTHORIZED_ONEOFF_VETERINARIO_LABELS rather than folded into the deterministic
marker lists above, since it is an explicit one-off authorization, not something
this script can derive/prove on its own. See
docs/tareas/04-kpis-recetas-y-veterinarios.md Unidad A2 — "si no lográs
distinguirlos con certeza, parás y preguntás": this is the "preguntás" resolved.
"""
import argparse
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, or_

from app.core.database import SessionLocal
from app.models.models import (
    Usuario, Inventario, Consulta, Receta, DetalleReceta,
    PruebaComplementaria, Vacunacion, Desparasitacion,
    ServicioConsulta, Hospitalizacion, Cirugia, Propietario, Mascota,
    Factura, DetalleFactura, Abono, MovimientoInventario, Cita,
    HojaTratamiento, ProtocoloAnestesico,
)

# Deben coincidir con las listas fijas de scripts/seed_data.py: son la única
# marca estable que ese script deja. Si seed_data.py cambia estas listas, hay
# que actualizar esto también.
SEED_APELLIDOS = [
    "Pérez", "García", "Rodríguez", "Martínez", "López",
    "Sánchez", "González", "Díaz", "Fernández", "Moreno",
]
SEED_USERNAMES = [f"dr_{a.lower()}" for a in SEED_APELLIDOS]
SEED_VETERINARIO_LABELS = [f"Dr. {a}" for a in SEED_APELLIDOS]

SEED_CATEGORIAS_PREFIJOS = {
    "Antibiótico": "AB",
    "Antiinflamatorio": "AI",
    "Vacuna": "VC",
    "Desparasitante": "DP",
    "Insumo": "IN",
    "Alimento": "AL",
    "Laboratorio": "LB",
    "Imagen": "IM",
}
# Cantidad de items por categoría en seed_data.py, para reconstruir los
# códigos {PREFIJO}-{100+i} exactos que genera.
SEED_ITEM_COUNTS = {
    "Antibiótico": 4,
    "Antiinflamatorio": 4,
    "Vacuna": 5,
    "Desparasitante": 5,
    "Insumo": 5,
    "Alimento": 3,
    "Laboratorio": 4,
    "Imagen": 3,
}
SEED_INVENTARIO_CODIGOS = [
    f"{prefix}-{100 + i}"
    for cat, prefix in SEED_CATEGORIAS_PREFIJOS.items()
    for i in range(SEED_ITEM_COUNTS[cat])
]

# Marcadores de scripts/populate_demo.py (script separado, no seed_data.py —
# encontrado ya sembrado en la base durante el dry-run de Unidad A2).
DEMO_PROPIETARIO_CEDULA = "DEMO-001"
DEMO_MASCOTA_CODIGO = "PAT-DEMO"
DEMO_VETERINARIO_LABEL = "Dr. Antigravity"

# No son un marcador derivable de ningún script: es una autorización puntual
# de Daniel (vía orchestrator, 2026-08-21) para tratar esta fila suelta como
# ruido de populate_demo.py y borrarla. Sin esto, quedaría sin tocar (ver
# report_unclassified). Mantenerla separada dificulta que se confunda con un
# marcador "real" si seed_data.py o populate_demo.py cambian.
AUTHORIZED_ONEOFF_VETERINARIO_LABELS = ["dr_garcía"]


def _refuse_in_production():
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        print("[cleanup] ENVIRONMENT=production: rechazado sin excepción. Este script es solo para desarrollo.")
        sys.exit(1)


def find_targets(db):
    veterinario_labels = (
        SEED_VETERINARIO_LABELS + [DEMO_VETERINARIO_LABEL] + AUTHORIZED_ONEOFF_VETERINARIO_LABELS
    )
    consultas = db.query(Consulta).filter(Consulta.veterinario.in_(veterinario_labels)).all()
    consulta_ids = [c.id for c in consultas]

    usuarios = db.query(Usuario).filter(Usuario.username.in_(SEED_USERNAMES)).all()
    inventario = db.query(Inventario).filter(Inventario.codigo.in_(SEED_INVENTARIO_CODIGOS)).all()
    demo_propietarios = db.query(Propietario).filter(Propietario.cedula == DEMO_PROPIETARIO_CEDULA).all()
    demo_mascotas = db.query(Mascota).filter(Mascota.codigo_historia == DEMO_MASCOTA_CODIGO).all()

    if consulta_ids:
        recetas = db.query(Receta).filter(Receta.consulta_id.in_(consulta_ids)).all()
        receta_ids = [r.id for r in recetas]
        detalles = db.query(DetalleReceta).filter(DetalleReceta.receta_id.in_(receta_ids)).all() if receta_ids else []
        pruebas = db.query(PruebaComplementaria).filter(PruebaComplementaria.consulta_id.in_(consulta_ids)).all()
        vacunaciones = db.query(Vacunacion).filter(Vacunacion.consulta_id.in_(consulta_ids)).all()
        desparasitaciones = db.query(Desparasitacion).filter(Desparasitacion.consulta_id.in_(consulta_ids)).all()
        servicios = db.query(ServicioConsulta).filter(ServicioConsulta.consulta_id.in_(consulta_ids)).all()
        hospitalizaciones = db.query(Hospitalizacion).filter(Hospitalizacion.consulta_id.in_(consulta_ids)).all()
        cirugias = db.query(Cirugia).filter(Cirugia.consulta_id.in_(consulta_ids)).all()
    else:
        recetas = detalles = pruebas = vacunaciones = desparasitaciones = []
        servicios = hospitalizaciones = cirugias = []

    # Facturacion/inventario/citas: hijos con FK real (no cascada) hacia
    # tablas ya cubiertas arriba (consultas, propietarios, inventario,
    # servicios_consulta, usuarios). Confirmados por Round 1 de revisión
    # (2026-08-21): sin esto, Postgres rechaza el borrado de esas tablas
    # padre en cuanto haya filas de facturación/citas reales apuntando a
    # ellas (ver detalle en el docstring del módulo y en el historial de
    # revisión — no repetido acá para no duplicar mantenimiento).
    demo_propietario_ids = [p.id for p in demo_propietarios]
    inventario_ids = [i.id for i in inventario]
    usuario_ids = [u.id for u in usuarios]
    servicio_ids = [s.id for s in servicios]
    hospitalizacion_ids = [h.id for h in hospitalizaciones]
    cirugia_ids = [c.id for c in cirugias]

    if consulta_ids or demo_propietario_ids:
        facturas = (
            db.query(Factura)
            .filter(
                or_(
                    Factura.consulta_id.in_(consulta_ids),
                    Factura.propietario_id.in_(demo_propietario_ids),
                )
            )
            .all()
        )
    else:
        facturas = []
    factura_ids = [f.id for f in facturas]

    abonos = db.query(Abono).filter(Abono.factura_id.in_(factura_ids)).all() if factura_ids else []

    if factura_ids:
        detalles_factura = (
            db.query(DetalleFactura)
            .filter(DetalleFactura.factura_id.in_(factura_ids))
            .all()
        )
    else:
        detalles_factura = []

    movimientos_inventario = (
        db.query(MovimientoInventario).filter(MovimientoInventario.producto_id.in_(inventario_ids)).all()
        if inventario_ids else []
    )

    citas = (
        db.query(Cita).filter(Cita.veterinario_id.in_(usuario_ids)).all()
        if usuario_ids else []
    )

    hojas_tratamiento = (
        db.query(HojaTratamiento).filter(HojaTratamiento.hospitalizacion_id.in_(hospitalizacion_ids)).all()
        if hospitalizacion_ids else []
    )

    protocolos_anestesicos = (
        db.query(ProtocoloAnestesico).filter(ProtocoloAnestesico.cirugia_id.in_(cirugia_ids)).all()
        if cirugia_ids else []
    )

    return {
        "usuarios (dr_*)": usuarios,
        "inventario (codigo seed)": inventario,
        "consultas (seed_data.py + populate_demo.py + authorized one-off)": consultas,
        "recetas": recetas,
        "detalle_recetas": detalles,
        "pruebas_complementarias": pruebas,
        "vacunaciones": vacunaciones,
        "desparasitaciones": desparasitaciones,
        "servicios_consulta": servicios,
        "hospitalizaciones": hospitalizaciones,
        "cirugias": cirugias,
        "abonos": abonos,
        "detalles_factura": detalles_factura,
        "facturas": facturas,
        "movimientos_inventario": movimientos_inventario,
        "hojas_tratamiento": hojas_tratamiento,
        "protocolos_anestesicos": protocolos_anestesicos,
        "citas": citas,
        "mascotas (populate_demo.py, PAT-DEMO)": demo_mascotas,
        "propietarios (populate_demo.py, DEMO-001)": demo_propietarios,
    }


def report_unclassified(db):
    known_labels = (
        SEED_VETERINARIO_LABELS + [DEMO_VETERINARIO_LABEL] + AUTHORIZED_ONEOFF_VETERINARIO_LABELS
    )
    unclassified = (
        db.query(Consulta.veterinario, func.count(Consulta.id))
        .filter(~Consulta.veterinario.in_(known_labels))
        .group_by(Consulta.veterinario)
        .all()
    )
    if unclassified:
        print("\n[cleanup] Consultas con veterinario que NO matchea ningún marcador conocido ni")
        print("[cleanup] autorización puntual — no se tocan, requieren revisión manual:")
        for label, count in unclassified:
            print(f"[cleanup]   {label!r}: {count}")
    else:
        print("\n[cleanup] Sin consultas sin clasificar: todo veterinario en la base matchea un")
        print("[cleanup] marcador conocido o una autorización puntual.")

    total_propietarios = db.query(Propietario).count()
    total_mascotas = db.query(Mascota).count()
    print("\n[cleanup] Propietario/Mascota (salvo DEMO-001/PAT-DEMO) no tienen ninguna marca que los")
    print("[cleanup] distinga de datos reales (cedula y nombre son aleatorios en seed_data.py).")
    print(f"[cleanup]   Propietarios en la base ahora mismo: {total_propietarios}")
    print(f"[cleanup]   Mascotas en la base ahora mismo:     {total_mascotas}")
    print("[cleanup]   No se borran por default. Usar --include-orphaned-contacts solo si ya se")
    print("[cleanup]   confirmó que no hay datos reales — borra los que queden con 0 consultas")
    print("[cleanup]   después del borrado de arriba (heurística, no marcador).")


def run(execute: bool, include_orphaned_contacts: bool):
    _refuse_in_production()
    db = SessionLocal()
    try:
        targets = find_targets(db)
        print("[cleanup] Filas identificadas por marcador estable + autorización puntual:")
        total = 0
        for name, rows in targets.items():
            print(f"[cleanup]   {name}: {len(rows)}")
            total += len(rows)
        print(f"[cleanup]   TOTAL filas con marcador: {total}")

        report_unclassified(db)

        admin_exists = db.query(Usuario).filter(Usuario.username == "admin").first() is not None
        print(f"\n[cleanup] Usuario 'admin' presente antes del borrado: {admin_exists}")
        print("[cleanup] (no se toca — solo se filtran usernames dr_*; admin se crea aparte")
        print("[cleanup]  desde ADMIN_INITIAL_PASSWORD, ver scripts/reset_db.py::create_initial_admin)")

        if not execute:
            print("\n[cleanup] DRY-RUN: no se borró nada. Repetir con --execute para aplicar.")
            return

        # Orden de borrado: hijos antes que padres. Hospitalizacion y Cirugia
        # NO tienen cascade="all, delete-orphan" desde Consulta (ver
        # app/models/models.py) y su FK consulta_id no tiene ON DELETE, así
        # que deben borrarse antes o Postgres rechaza el borrado de Consulta.
        # Factura/DetalleFactura/Abono/MovimientoInventario/Cita/HojaTratamiento/
        # ProtocoloAnestesico tienen la misma forma de FK real sin cascada
        # (ver find_targets) — confirmado por Round 1 de revisión, 2026-08-21.
        # db.flush() explícito después de cada bloque: varias de las FKs de
        # abajo (p.ej. Cirugia.cirujano_id -> Usuario) no tienen relationship()
        # ORM asociada, así que SQLAlchemy no puede inferir el orden de DELETE
        # correcto solo por relaciones — sin el flush, decide un orden propio
        # por tabla que puede mandar el DELETE de usuarios antes que el de
        # cirugias y romper la FK aunque el for-loop de Python esté en el
        # orden correcto. El flush fuerza a Postgres a recibir cada DELETE en
        # el orden documentado arriba, sin depender de esa inferencia.
        for d in targets["detalle_recetas"]:
            db.delete(d)
        db.flush()
        for r in targets["recetas"]:
            db.delete(r)
        db.flush()
        for p in targets["pruebas_complementarias"]:
            db.delete(p)
        db.flush()
        for v in targets["vacunaciones"]:
            db.delete(v)
        db.flush()
        for de in targets["desparasitaciones"]:
            db.delete(de)
        db.flush()
        for a in targets["abonos"]:
            db.delete(a)
        db.flush()
        for df in targets["detalles_factura"]:
            db.delete(df)
        db.flush()
        for f in targets["facturas"]:
            db.delete(f)
        db.flush()
        for mi in targets["movimientos_inventario"]:
            db.delete(mi)
        db.flush()
        for ht in targets["hojas_tratamiento"]:
            db.delete(ht)
        db.flush()
        for cita in targets["citas"]:
            db.delete(cita)
        db.flush()
        for s in targets["servicios_consulta"]:
            db.delete(s)
        db.flush()
        for pa in targets["protocolos_anestesicos"]:
            db.delete(pa)
        db.flush()
        for ci in targets["cirugias"]:
            db.delete(ci)
        db.flush()
        for h in targets["hospitalizaciones"]:
            db.delete(h)
        db.flush()
        for c in targets["consultas (seed_data.py + populate_demo.py + authorized one-off)"]:
            db.delete(c)
        db.flush()
        for u in targets["usuarios (dr_*)"]:
            db.delete(u)
        db.flush()
        for i in targets["inventario (codigo seed)"]:
            db.delete(i)
        db.flush()
        for m in targets["mascotas (populate_demo.py, PAT-DEMO)"]:
            db.delete(m)
        db.flush()
        for p in targets["propietarios (populate_demo.py, DEMO-001)"]:
            db.delete(p)
        db.flush()

        if include_orphaned_contacts:
            db.flush()
            orphaned_mascotas = db.query(Mascota).filter(~Mascota.consultas.any()).all()
            for m in orphaned_mascotas:
                db.delete(m)
            db.flush()
            orphaned_propietarios = db.query(Propietario).filter(~Propietario.mascotas.any()).all()
            for p in orphaned_propietarios:
                db.delete(p)
            print(
                f"[cleanup] --include-orphaned-contacts: {len(orphaned_mascotas)} mascotas y "
                f"{len(orphaned_propietarios)} propietarios sin ninguna consulta también borrados."
            )

        db.commit()
        print("\n[cleanup] Borrado aplicado.")
    except Exception as e:
        db.rollback()
        print(f"[cleanup] Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="Aplica el borrado. Sin este flag, solo cuenta (dry-run).")
    parser.add_argument(
        "--include-orphaned-contacts",
        action="store_true",
        help="También borra Propietario/Mascota sin ninguna consulta tras el borrado anterior. "
             "Sin marcador propio — usar solo si ya se confirmó que no hay datos reales.",
    )
    args = parser.parse_args()
    run(execute=args.execute, include_orphaned_contacts=args.include_orphaned_contacts)
