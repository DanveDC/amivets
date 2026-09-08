"""Import the real AmiVets client registry (veterinarians, owners, pets).

Source: a plain SQL file with INSERT statements, produced from the clinic's
Excel exports. It only touches ``usuarios``, ``propietarios`` and ``mascotas``
and every statement is ``ON CONFLICT DO NOTHING``, so the import is idempotent.

The SQL file is NEVER committed to the repository (it holds real personal data).
On Render it is provided as a Secret File and located through
``REAL_DATA_SQL_PATH``. Locally, point that variable at the real file or pass
the path as the first CLI argument.

Resolution order for the SQL path:
    1. explicit ``sql_path`` argument / first CLI argument
    2. ``REAL_DATA_SQL_PATH`` environment variable
    3. ``/etc/secrets/import-pacientes-v2.sql``  (Render Secret File default)
    4. ``/etc/secrets/import-pacientes.sql``
    5. ``backend/scripts/data/import-pacientes-v2.sql``  (local, git-ignored)

If no file is found the import is skipped without error: a fresh deploy without
the Secret File still boots, just with an empty registry.
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import inspect, text

from app.core.database import engine

# Same check the API response schema applies, so a row that imports also serves.
_email_adapter = TypeAdapter(EmailStr)

# Prefix + zero-padded width for the synthetic "cédula" built from the clinic's
# historia number (the source Excel has no national IDs for owners).
_HISTORIA_PREFIX = "EXP-"
_HISTORIA_WIDTH = 6

# The vendor SQL gives the vet logins ``@amivets.local`` addresses; ``.local`` is
# a reserved TLD that ``EmailStr`` rejects, so ``/api/usuarios`` 500s. Rewrite the
# domain to a routable placeholder while keeping the local-part (the username).
_STAFF_EMAIL_DOMAIN = "amivets.com"

_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_CANDIDATE_PATHS = (
    "/etc/secrets/import-pacientes-v2.sql",
    "/etc/secrets/import-pacientes.sql",
    os.path.join(_ROOT_DIR, "scripts", "data", "import-pacientes-v2.sql"),
)

_SKIP_LINES = {"begin;", "commit;", "rollback;"}


def resolve_sql_path(sql_path=None):
    """Return the first existing candidate SQL path, or ``None``."""
    ordered = []
    if sql_path:
        ordered.append(sql_path)
    env_path = os.getenv("REAL_DATA_SQL_PATH")
    if env_path:
        ordered.append(env_path)
    ordered.extend(_CANDIDATE_PATHS)

    for candidate in ordered:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def _iter_statements(sql_text):
    """Yield full SQL statements from the file.

    Comments and standalone transaction-control lines are dropped — the whole
    file is executed inside one managed transaction by the caller. Every data
    statement in the source file lives on a single physical line ending in
    ``;``; the buffer below is only defensive against future multi-line rows.
    """
    buffer = ""
    for raw_line in sql_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("--"):
            continue
        if not buffer and line.lower() in _SKIP_LINES:
            continue
        buffer = f"{buffer}\n{line}" if buffer else line
        if line.endswith(";"):
            yield buffer
            buffer = ""
    if buffer.strip():
        yield buffer


def _table_counts(conn):
    counts = {}
    for table in ("usuarios", "propietarios", "mascotas"):
        counts[table] = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {table}"
        ).scalar()
    return counts


def _normalize_registry(conn):
    """Reconcile the raw import with the API's validation contract.

    The vendor SQL is loaded verbatim; these fixes run in the same transaction:

    1. ``propietarios.cedula`` holds the clinic's *historia* number (e.g. ``804``,
       ``0``), not a national ID. It is rewritten to ``EXP-000804`` so it clears
       ``PropietarioResponse``'s length rules while staying unique and traceable.
       ``mascotas.codigo_historia`` keeps the plain number on purpose — that
       field legitimately *is* the historia reference.
    2. ``usuarios.email`` uses the reserved ``.local`` TLD, which ``EmailStr``
       rejects; the domain is swapped for ``amivets.com`` (local-part kept).
       ``propietarios.email`` values that still fail ``EmailStr`` (a stray dot
       before ``@`` in the source Excel, etc.) are set to NULL — the column is
       optional and we cannot guess the real address.
    3. ``fecha_registro`` is NULL for the handful of rows whose source had no
       opening date. Owners inherit their earliest pet's date; pets inherit
       their owner's; anything still empty falls back to now().

    Idempotent: rows already shaped this way are skipped.
    """
    rows = conn.execute(
        text("SELECT id, cedula FROM propietarios WHERE cedula NOT LIKE :pat"),
        {"pat": f"{_HISTORIA_PREFIX}%"},
    ).fetchall()
    reshaped = 0
    for pid, cedula in rows:
        raw = (cedula or "").strip()
        if not raw.isdigit():
            continue
        new_cedula = f"{_HISTORIA_PREFIX}{int(raw):0{_HISTORIA_WIDTH}d}"
        conn.execute(
            text("UPDATE propietarios SET cedula = :c WHERE id = :i"),
            {"c": new_cedula, "i": pid},
        )
        reshaped += 1

    staff_emails = 0
    staff_rows = conn.execute(
        text("SELECT id, email FROM usuarios WHERE email IS NOT NULL")
    ).fetchall()
    for uid, email in staff_rows:
        try:
            _email_adapter.validate_python(email)
            continue
        except Exception:
            pass
        local_part = email.split("@", 1)[0] if "@" in email else email
        conn.execute(
            text("UPDATE usuarios SET email = :e WHERE id = :i"),
            {"e": f"{local_part}@{_STAFF_EMAIL_DOMAIN}", "i": uid},
        )
        staff_emails += 1

    bad_emails = 0
    email_rows = conn.execute(
        text("SELECT id, email FROM propietarios WHERE email IS NOT NULL AND email <> ''")
    ).fetchall()
    for pid, email in email_rows:
        try:
            _email_adapter.validate_python(email)
        except Exception:
            conn.execute(
                text("UPDATE propietarios SET email = NULL WHERE id = :i"), {"i": pid}
            )
            bad_emails += 1

    prop_dates = conn.exec_driver_sql(
        "UPDATE propietarios SET fecha_registro = COALESCE("
        " (SELECT MIN(m.fecha_registro) FROM mascotas m WHERE m.propietario_id = propietarios.id),"
        " CURRENT_TIMESTAMP) "
        "WHERE fecha_registro IS NULL"
    ).rowcount
    mascota_dates = conn.exec_driver_sql(
        "UPDATE mascotas SET fecha_registro = COALESCE("
        " (SELECT p.fecha_registro FROM propietarios p WHERE p.id = mascotas.propietario_id),"
        " CURRENT_TIMESTAMP) "
        "WHERE fecha_registro IS NULL"
    ).rowcount

    print(
        f"[import] Normalización: {reshaped} cédulas → {_HISTORIA_PREFIX}NNNNNN, "
        f"{staff_emails} emails de staff → @{_STAFF_EMAIL_DOMAIN}, "
        f"{bad_emails} emails de propietarios inválidos → NULL, "
        f"{prop_dates} + {mascota_dates} fecha_registro rellenadas."
    )


def import_real_data(sql_path=None, force=False):
    """Load the real registry if it is not already present.

    Returns a dict describing the outcome:
        {"status": "skipped" | "imported" | "no-file", "counts": {...}, ...}
    """
    tables = set(inspect(engine).get_table_names())
    if not {"usuarios", "propietarios", "mascotas"}.issubset(tables):
        print("[import] Esquema incompleto: se omite la importación de datos reales.")
        return {"status": "skipped", "reason": "schema-missing"}

    with engine.connect() as conn:
        existing = _table_counts(conn)

    if existing["propietarios"] > 0 and not force:
        print(
            "[import] La base ya tiene "
            f"{existing['propietarios']} propietarios / {existing['mascotas']} mascotas: "
            "no se reimporta."
        )
        return {"status": "skipped", "reason": "already-populated", "counts": existing}

    resolved = resolve_sql_path(sql_path)
    if not resolved:
        print(
            "[import] No se encontró el SQL de datos reales "
            "(REAL_DATA_SQL_PATH / Secret File / scripts/data/). Se omite."
        )
        return {"status": "no-file"}

    print(f"[import] Cargando datos reales desde: {resolved}")
    with open(resolved, encoding="utf-8") as fh:
        raw_sql = fh.read()

    statements = list(_iter_statements(raw_sql))
    with engine.begin() as conn:
        for stmt in statements:
            conn.exec_driver_sql(stmt)
        _normalize_registry(conn)
        final = _table_counts(conn)

    print(
        "[import] Importación completa: "
        f"{final['usuarios']} usuarios, {final['propietarios']} propietarios, "
        f"{final['mascotas']} mascotas "
        f"({len(statements)} sentencias ejecutadas)."
    )
    return {"status": "imported", "counts": final, "statements": len(statements)}


if __name__ == "__main__":
    arg_path = sys.argv[1] if len(sys.argv) > 1 else None
    result = import_real_data(sql_path=arg_path)
    if result["status"] == "no-file":
        sys.exit(2)
