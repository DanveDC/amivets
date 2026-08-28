#!/usr/bin/env python3
"""Genera import-pacientes.sql a partir de los .xls de origen de AmiVets.

Lee los 10 archivos .xls de la carpeta de datos reales de clientes (fuera del
repositorio a proposito) y produce un SQL de PostgreSQL con veterinarios,
propietarios y mascotas, en una unica transaccion.

No contiene datos de clientes: solo logica. La salida (con datos reales) debe
escribirse SIEMPRE fuera del repositorio.

Corrige 3 bugs confirmados en la version anterior del import (ver
docs/tecnico/import-pacientes.md) y uno mas encontrado al revisar Bug 2 a
fondo:

  1. Email "generico" se decidia por frecuencia global en las 318 filas, no
     por propietario. Un dueno con varias mascotas que repite su propio
     email en cada ficha perdia ese email como si fuera compartido. Ahora se
     agrupa por propietario primero (con el nombre normalizado, ver bug 3) y
     solo se anula el email si aparece bajo mas de un propietario distinto,
     o si es uno de los 4 correos genericos conocidos de la clinica.

  2. Telefono corrompido por celdas de Excel tipadas como numero (float ->
     string con ".0" y cero inicial perdido). Se detecta el tipo de celda
     con xlrd y, si el resultado (con un 0 antepuesto) coincide con un
     prefijo venezolano valido observado en el propio dataset, se reconstruye
     y se deja constancia en las observaciones de la mascota. Si no matchea
     ningun prefijo conocido, se deja tal cual y tambien se marca como
     "no reconstruible".

     Extension del mismo bug: 8 filas de texto (no numericas) traen el
     telefono partido en "codigo de pais" + "resto" por un espacio, ej.
     "+58 412-2465509". El separado por espacios ingenuo de la version
     anterior tomaba "+58" como telefono principal (dato no marcable) y
     mandaba el numero real a las observaciones. Se detecta este patron
     (token corto tipo codigo de pais seguido de otro token) y se arma el
     numero completo, convirtiendolo a formato local venezolano (0-prefijo)
     cuando el codigo es +58/58.

  3. La deduplicacion de propietario era sensible a espacios en blanco:
     "NOHELYS CRESPO" y "NOHELYS  CRESPO" (doble espacio) se trataban como
     dos personas distintas. Se normaliza el espacio en blanco antes de usar
     el nombre como clave de agrupacion. Esto tambien es la causa raiz del
     bug 1 (dos "propietarios" distintos con emails distintos para la misma
     persona).

Bonus (no obligatorio, se hizo porque salio simple): la cedula ya no es "el
codigo de historia de la primera fila procesada" sino el de la fila con la
fecha de apertura mas antigua del propietario.

No se cambia: el esquema de cedula = codigo de historia, la ausencia de FK
veterinario-mascota, los 5 usuarios veterinarios (mismas credenciales ya
entregadas a Daniel), el paso a NULL de raza/color solo cuando el origen esta
vacio, el mecanismo de telefonos extra -> observaciones, la logica de
particion nombre/apellido (doble espacio como separador si existe, si no el
primer espacio simple; confirmado por ingenieria inversa contra el SQL
anterior, 0 discrepancias en 264 propietarios), y la estimacion de
fecha_nacimiento = fecha_apertura menos la edad declarada en anios exactos
(via dateutil.relativedelta, con el 29 de febrero recortado a 28 en anios no
bisiestos si hiciera falta).

Uso:
    python generar_import_pacientes.py \\
        --data-dir "/ruta/a/DATA DE PACIENTES" \\
        --out "/ruta/a/DATA DE PACIENTES/import-pacientes-v2.sql"

Requiere: xlrd, python-dateutil.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import xlrd
from dateutil.relativedelta import relativedelta

COLUMNS = [
    "historia", "nombre", "sexo", "edad", "especie", "raza", "color",
    "propietario", "email", "telefonos", "fecha_apertura",
]

# Duplicado exacto confirmado (65 filas identicas, la unica diferencia es la
# celda de fecha de generacion del reporte). Se descarta, igual que antes.
ARCHIVOS_DUPLICADOS = {"data de gatos(amivets).xls"}

EMAILS_GENERICOS = {
    "amivet.vzla@gmail.com",
    "amivets@gmail.com",
    "vettejera@gmail.com",
    "amivets.vzla@gmail.com",
}

ESPECIE_MAP = {"canina": "Perro", "felina": "Gato"}
SEXO_MAP = {"h": "Hembra", "m": "Macho"}

# Las credenciales de los 5 veterinarios NO se regeneran ni se versionan:
# ya fueron entregadas a Daniel en credenciales-veterinarios.txt (fuera de
# git). El bloque INSERT correspondiente se lee de un archivo externo (ver
# --veterinarios-file) para no dejar hashes de contrasena, ni siquiera
# bcrypt, adentro del repositorio.
DEFAULT_VETERINARIOS_FILE = "veterinarios.sql"


# --------------------------------------------------------------------------
# Lectura de los .xls
# --------------------------------------------------------------------------

def find_header_row(sheet) -> Optional[int]:
    for r in range(sheet.nrows):
        if str(sheet.cell_value(r, 0)).strip() == "Historia":
            return r
    return None


def read_rows(data_dir: Path) -> list[dict]:
    """Lee los .xls (menos el duplicado exacto) y devuelve una lista de
    dicts con las columnas crudas + metadatos (_types, _file)."""
    rows = []
    files = sorted(data_dir.glob("*.xls"))
    if not files:
        raise SystemExit(f"No se encontraron .xls en {data_dir}")
    for f in files:
        if f.name in ARCHIVOS_DUPLICADOS:
            continue
        book = xlrd.open_workbook(str(f))
        sheet = book.sheet_by_index(0)
        hr = find_header_row(sheet)
        if hr is None:
            raise SystemExit(f"No se encontro la fila de encabezado en {f.name}")
        for r in range(hr + 1, sheet.nrows):
            cells = [sheet.cell(r, c) for c in range(sheet.ncols)]
            values = [c.value for c in cells]
            if all(str(v).strip() == "" for v in values):
                continue
            rec = dict(zip(COLUMNS, values))
            rec["_types"] = dict(zip(COLUMNS, [c.ctype for c in cells]))
            rec["_file"] = f.name
            rows.append(rec)
    return rows


# --------------------------------------------------------------------------
# Normalizacion de texto / nombres (bug 3)
# --------------------------------------------------------------------------

def norm_ws(s) -> str:
    return re.sub(r"\s+", " ", str(s).strip())


def split_nombre_apellido(raw: str) -> tuple[str, str]:
    """Mismo criterio que la version anterior, verificado por ingenieria
    inversa contra el SQL anterior (0 discrepancias en 264 propietarios):
    si hay una corrida de 2+ espacios se usa como separador nombre/apellido
    (asi es como el origen distingue nombres compuestos de apellidos
    compuestos); si no hay doble espacio, se separa en el primer espacio
    simple."""
    m = re.search(r"\s{2,}", raw)
    if m:
        return raw[: m.start()].strip(), raw[m.end():].strip()
    parts = raw.strip().split(" ", 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1].strip()


def parse_fecha(raw) -> Optional[date]:
    raw = str(raw).strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d/%m/%Y").date()
    except ValueError:
        return None


def norm_email(raw) -> Optional[str]:
    v = str(raw).strip()
    if not v or "@" not in v:
        return None
    return v.lower()


def sql_str(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def sql_date(d: Optional[date]) -> str:
    return "NULL" if d is None else f"'{d.isoformat()}'"


# --------------------------------------------------------------------------
# Telefonos (bug 2 + extension encontrada al revisar el mismo bug)
# --------------------------------------------------------------------------

@dataclass
class PhoneParseResult:
    numbers: list[str] = field(default_factory=list)  # deduplicados, en orden
    notes: list[str] = field(default_factory=list)     # para observaciones


def build_valid_prefixes(rows: list[dict]) -> set[str]:
    """Prefijos de 4 digitos (0412, 0414, 0212, ...) que aparecen al menos 2
    veces entre las celdas de telefono correctamente tipadas como texto en
    todo el dataset. No se asume una lista externa de prefijos venezolanos:
    se deriva del propio origen, tal como pide la tarea."""
    counts = Counter()
    for r in rows:
        if r["_types"]["telefonos"] == 1:
            for tok in re.findall(r"\d{11}", str(r["telefonos"])):
                if tok.startswith("0"):
                    counts[tok[:4]] += 1
    return {p for p, c in counts.items() if c >= 2}


def _is_country_code_fragment(tok: str) -> bool:
    """True si el token, por si solo, es demasiado corto para ser un
    telefono y probablemente sea un codigo de pais partido del resto del
    numero por un espacio (ej. "+58", "58", "+57318")."""
    digits = re.sub(r"\D", "", tok)
    if not digits:
        return False
    if tok.startswith("+"):
        return len(digits) <= 6
    return len(digits) <= 3


def _classify_digits(digits: str, valid_prefixes: set[str]) -> Optional[str]:
    """Convierte una cadena de digitos ya fusionada a su forma final, o
    None si no se reconoce ningun patron (se deja el texto original tal
    cual, sin tocar)."""
    if digits.startswith("58") and len(digits) == 12:
        candidate = "0" + digits[2:]
        return candidate if candidate[:4] in valid_prefixes else None
    if len(digits) == 11 and digits.startswith("0"):
        return digits
    return None


def parse_phone_cell(raw, ctype: int, valid_prefixes: set[str]) -> PhoneParseResult:
    result = PhoneParseResult()

    if ctype == 2:
        # Bug 2 original: celda numerica de Excel. El float perdio el cero
        # inicial en la celda de origen, no es recuperable por texto.
        digits = str(int(raw))
        candidate = "0" + digits
        if candidate[:4] in valid_prefixes:
            result.numbers.append(candidate)
            result.notes.append(
                f"Tel. del propietario reconstruido (celda numerica de Excel, "
                f"cero inicial inferido a partir de un prefijo venezolano "
                f"valido, VERIFICAR con el cliente): {candidate}"
            )
        else:
            result.numbers.append(digits)
            result.notes.append(
                f"Tel. del propietario INCOMPLETO en el origen (celda numerica "
                f"de Excel, se perdio el cero inicial y no se pudo reconstruir "
                f"con ningun prefijo conocido): {digits}"
            )
        return result

    raw_text = str(raw)
    tokens = raw_text.split()
    seen_final = set()
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        merged = False
        if _is_country_code_fragment(tok) and i + 1 < len(tokens):
            merged_digits = re.sub(r"\D", "", tok) + re.sub(r"\D", "", tokens[i + 1])
            original_text = f"{tok} {tokens[i + 1]}"
            merged = True
            i += 2
        else:
            merged_digits = re.sub(r"\D", "", tok)
            original_text = tok
            i += 1

        if not merged_digits:
            continue

        if merged:
            # Solo se recompone el numero (y se toca su formato) cuando de
            # verdad hubo que unir dos tokens partidos por un espacio. Un
            # token unico ya completo se deja EXACTAMENTE como vino del
            # origen (guiones incluidos), igual que la version anterior
            # para todo lo que no estaba roto.
            final = _classify_digits(merged_digits, valid_prefixes)
            if final is None:
                # Codigo de pais no venezolano (ej. Colombia +57): se arma
                # un numero internacional limpio en vez de dejar el espacio
                # interno del origen suelto.
                final = "+" + merged_digits
        else:
            final = original_text.strip()

        dedupe_key = merged_digits if merged_digits else final
        if dedupe_key not in seen_final:
            seen_final.add(dedupe_key)
            result.numbers.append(final)
            if original_text.strip() != final:
                result.notes.append(
                    f"Tel. del propietario recompuesto a partir de "
                    f"'{original_text.strip()}' (codigo de pais separado por "
                    f"un espacio en el origen): {final}"
                )

    return result


# --------------------------------------------------------------------------
# Estructuras principales
# --------------------------------------------------------------------------

@dataclass
class Owner:
    key: str
    rows: list[dict]
    canonical: dict = None  # fila con fecha_apertura mas antigua (o primera si no hay fecha)
    cedula: str = ""
    nombre: str = ""
    apellido: str = ""
    email: Optional[str] = None
    telefono: Optional[str] = None
    fecha_registro: Optional[date] = None
    id_placeholder: int = 0


def build_owners(rows: list[dict]) -> dict[str, Owner]:
    owners: dict[str, Owner] = {}
    for r in rows:
        key = norm_ws(r["propietario"]).upper()
        owners.setdefault(key, Owner(key=key, rows=[])).rows.append(r)
    return owners


def resolve_canonical_and_cedula(owner: Owner, chronology_fixed: list) -> None:
    """Bonus: cedula = historia de la fila con fecha_apertura mas antigua,
    no la primera fila encontrada al iterar los archivos. Si ninguna fila
    tiene fecha valida, se cae de vuelta al orden de aparicion (mismo
    comportamiento que antes)."""
    dated = [r for r in owner.rows if parse_fecha(r["fecha_apertura"]) is not None]
    if dated:
        canonical = min(dated, key=lambda r: parse_fecha(r["fecha_apertura"]))
    else:
        canonical = owner.rows[0]
    if str(canonical["historia"]) != str(owner.rows[0]["historia"]):
        chronology_fixed.append((owner.rows[0]["historia"], canonical["historia"]))
    owner.canonical = canonical
    owner.cedula = str(canonical["historia"])
    owner.fecha_registro = min(
        (parse_fecha(r["fecha_apertura"]) for r in owner.rows if parse_fecha(r["fecha_apertura"])),
        default=None,
    )
    owner.nombre, owner.apellido = split_nombre_apellido(str(canonical["propietario"]))


def resolve_emails(owners: dict[str, Owner], report: dict) -> None:
    """Bug 1: agrupar por propietario (ya resuelto en `owners`), y solo
    anular el email si aparece bajo mas de un propietario distinto o es uno
    de los 4 genericos conocidos de la clinica."""
    email_to_owners: dict[str, set[str]] = defaultdict(set)
    owner_non_generic: dict[str, set[str]] = {}

    for key, owner in owners.items():
        emails = {norm_email(r["email"]) for r in owner.rows}
        emails.discard(None)
        non_generic = emails - EMAILS_GENERICOS
        owner_non_generic[key] = non_generic
        for e in non_generic:
            email_to_owners[e].add(key)

    compartidos_entre_propietarios = {
        e for e, ks in email_to_owners.items() if len(ks) > 1
    }
    report["compartidos_entre_propietarios"] = compartidos_entre_propietarios

    conservan = 0
    anulados = 0
    conflictos = []
    for key, owner in owners.items():
        non_generic = owner_non_generic[key]
        if len(non_generic) == 1:
            e = next(iter(non_generic))
            if e in compartidos_entre_propietarios:
                owner.email = None
                anulados += 1
            else:
                owner.email = e
                conservan += 1
        elif len(non_generic) == 0:
            owner.email = None
            anulados += 1
        else:
            # Mas de un email real distinto para el mismo propietario: no
            # se observo en el dataset actual, pero por seguridad se anula
            # para los dos (evita adivinar cual es el correcto) y se
            # reporta para que Daniel decida.
            owner.email = None
            anulados += 1
            conflictos.append((key, sorted(non_generic)))

    report["emails_conservados"] = conservan
    report["emails_anulados"] = anulados
    report["emails_conflicto"] = conflictos


def resolve_telefonos(
    owners: dict[str, Owner], valid_prefixes: set[str], report: dict
) -> dict[str, PhoneParseResult]:
    """Telefono por fila (para armar observaciones) + telefono canonico por
    propietario (para la tabla propietarios)."""
    per_row: dict[str, PhoneParseResult] = {}
    reconstruidos = []
    no_reconstruibles = []
    recompuestos = []

    for owner in owners.values():
        for r in owner.rows:
            res = parse_phone_cell(r["telefonos"], r["_types"]["telefonos"], valid_prefixes)
            per_row[str(r["historia"])] = res
            for note in res.notes:
                if "reconstruido" in note:
                    reconstruidos.append(str(r["historia"]))
                elif "INCOMPLETO" in note:
                    no_reconstruibles.append(str(r["historia"]))
                elif "recompuesto" in note:
                    recompuestos.append(str(r["historia"]))

        canonical_res = per_row[str(owner.canonical["historia"])]
        owner.telefono = canonical_res.numbers[0] if canonical_res.numbers else None

    report["telefonos_reconstruidos"] = reconstruidos
    report["telefonos_no_reconstruibles"] = no_reconstruibles
    report["telefonos_recompuestos_codigo_pais"] = recompuestos
    return per_row


# --------------------------------------------------------------------------
# fecha_nacimiento estimada (sin cambios de criterio, solo implementacion limpia)
# --------------------------------------------------------------------------

def estimar_fecha_nacimiento(fecha_apertura: Optional[date], edad, edad_ctype: int) -> Optional[date]:
    if fecha_apertura is None or edad_ctype != 2:
        return None
    try:
        anios = int(edad)
    except (TypeError, ValueError):
        return None
    return fecha_apertura - relativedelta(years=anios)


# --------------------------------------------------------------------------
# Deteccion de posibles mascotas duplicadas (solo reporte, no se fusiona nada)
# --------------------------------------------------------------------------

def find_duplicate_candidates(owners: dict[str, Owner]) -> list[tuple]:
    candidates = []
    for key, owner in owners.items():
        rows = owner.rows
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                a, b = rows[i], rows[j]
                if a["especie"] != b["especie"] or a["sexo"] != b["sexo"]:
                    continue
                na = norm_ws(a["nombre"]).upper()
                nb = norm_ws(b["nombre"]).upper()
                if not (na == nb or na in nb or nb in na):
                    continue
                if a["_types"]["edad"] != 2 or b["_types"]["edad"] != 2:
                    continue
                if abs(float(a["edad"]) - float(b["edad"])) > 1:
                    continue
                candidates.append((a, b))
    return candidates


# --------------------------------------------------------------------------
# Generacion del SQL
# --------------------------------------------------------------------------

def generate_sql(data_dir: Path, veterinarios_sql: str) -> tuple[str, dict]:
    rows = read_rows(data_dir)
    valid_prefixes = build_valid_prefixes(rows)
    owners = build_owners(rows)

    report: dict = {"total_rows": len(rows), "total_owners": len(owners)}

    chronology_fixed: list = []
    for owner in owners.values():
        resolve_canonical_and_cedula(owner, chronology_fixed)
    report["cedula_chronology_fixed"] = chronology_fixed

    resolve_emails(owners, report)
    per_row_phones = resolve_telefonos(owners, valid_prefixes, report)

    duplicate_candidates = find_duplicate_candidates(owners)
    report["duplicate_candidates"] = [
        (a["historia"], b["historia"], norm_ws(a["nombre"]), a["sexo"], a["especie"],
         float(a["edad"]) if a["_types"]["edad"] == 2 else None,
         float(b["edad"]) if b["_types"]["edad"] == 2 else None,
         a["_file"], b["_file"])
        for a, b in duplicate_candidates
    ]

    # -- propietarios --
    prop_lines = []
    for owner in sorted(owners.values(), key=lambda o: int(o.cedula)):
        prop_lines.append(
            "INSERT INTO propietarios (nombre, apellido, cedula, telefono, email, "
            "fecha_registro, activo) VALUES ("
            f"{sql_str(owner.nombre)}, {sql_str(owner.apellido)}, {sql_str(owner.cedula)}, "
            f"{sql_str(owner.telefono)}, {sql_str(owner.email)}, "
            f"{sql_date(owner.fecha_registro)}, TRUE"
            ") ON CONFLICT (cedula) DO NOTHING;"
        )

    # -- mascotas --
    masc_lines = []
    sin_raza = 0
    sin_color_na = 0
    fecha_nac_estimadas = 0
    all_rows_sorted = sorted(
        (r for owner in owners.values() for r in owner.rows),
        key=lambda r: int(r["historia"]),
    )
    for r in all_rows_sorted:
        hist = str(r["historia"])
        owner_key = norm_ws(r["propietario"]).upper()
        owner = owners[owner_key]

        especie = ESPECIE_MAP.get(str(r["especie"]).strip().lower(), str(r["especie"]).strip())
        sexo = SEXO_MAP.get(str(r["sexo"]).strip().lower(), str(r["sexo"]).strip())
        raza = str(r["raza"]).strip() if r["_types"]["raza"] != 0 and str(r["raza"]).strip() else None
        if raza is None:
            sin_raza += 1
        color = str(r["color"]).strip() if str(r["color"]).strip() else None
        if color and color.strip().upper() in ("N/A", "NA"):
            sin_color_na += 1

        fecha_apertura = parse_fecha(r["fecha_apertura"])
        fecha_nac = estimar_fecha_nacimiento(fecha_apertura, r["edad"], r["_types"]["edad"])
        if fecha_nac is not None:
            fecha_nac_estimadas += 1

        obs_parts = [f"Importado de {r['_file']}"]
        res = per_row_phones[hist]
        if hist == owner.canonical["historia"] or str(hist) == str(owner.canonical["historia"]):
            extras = res.numbers[1:]
        else:
            extras = [n for n in res.numbers if n != owner.telefono]
        if extras:
            obs_parts.append("Tel. adicionales del propietario: " + ", ".join(extras))
        for note in res.notes:
            obs_parts.append(note)
        observaciones = " | ".join(obs_parts)

        masc_lines.append(
            "INSERT INTO mascotas (nombre, especie, raza, sexo, color, fecha_nacimiento, "
            "fecha_registro, codigo_historia, observaciones, activo, propietario_id) VALUES ("
            f"{sql_str(str(r['nombre']).strip())}, {sql_str(especie)}, {sql_str(raza)}, "
            f"{sql_str(sexo)}, {sql_str(color)}, {sql_date(fecha_nac)}, "
            f"{sql_date(fecha_apertura)}, {sql_str(hist)}, {sql_str(observaciones)}, TRUE, "
            f"(SELECT id FROM propietarios WHERE cedula = {sql_str(owner.cedula)})"
            ") ON CONFLICT (codigo_historia) DO NOTHING;"
        )

    report["sin_raza"] = sin_raza
    report["sin_color_na"] = sin_color_na
    report["fecha_nac_estimadas"] = fecha_nac_estimadas
    report["total_mascotas"] = len(all_rows_sorted)

    archivos = sorted({r["_file"] for r in rows})
    sql = []
    sql.append("-- Importacion de pacientes AmiVets (v2 -- bugs de email/telefono/dedup corregidos)")
    sql.append(f"-- Origen: {len(archivos)} archivos .xls de 'DATA DE PACIENTES'.")
    sql.append("--   Se descarto 'data de gatos(amivets).xls': duplicado EXACTO de 'data de gatos amivets.xls'.")
    sql.append(f"-- 5 veterinarios . {len(owners)} propietarios . {len(all_rows_sorted)} mascotas")
    sql.append("-- PostgreSQL. Todo en una transaccion: si algo falla, no queda nada a medias.")
    sql.append("")
    sql.append("BEGIN;")
    sql.append("")
    sql.append("-- == VETERINARIOS ==")
    sql.append("-- Contrasenas provisionales en credenciales-veterinarios.txt (NO versionar).")
    sql.append(veterinarios_sql.rstrip())
    sql.append("")
    sql.append("-- == PROPIETARIOS ==")
    sql.append("-- cedula = historia del paciente con fecha de apertura mas antigua del propietario.")
    sql.append("-- email NULL cuando el original era generico/compartido entre propietarios distintos.")
    sql.append("-- fecha_registro = fecha de apertura mas antigua de sus mascotas.")
    sql.extend(prop_lines)
    sql.append("")
    sql.append("-- == MASCOTAS ==")
    sql.extend(masc_lines)
    sql.append("")
    sql.append("COMMIT;")
    sql.append("")

    return "\n".join(sql), report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument(
        "--veterinarios-file",
        type=Path,
        default=None,
        help=(
            "Archivo con el bloque INSERT INTO usuarios de los 5 "
            f"veterinarios (por defecto, '{DEFAULT_VETERINARIOS_FILE}' "
            "dentro de --data-dir). Nunca debe vivir en el repositorio: "
            "tiene los hashes de las contrasenas provisionales."
        ),
    )
    args = ap.parse_args()

    vet_file = args.veterinarios_file or (args.data_dir / DEFAULT_VETERINARIOS_FILE)
    if not vet_file.exists():
        raise SystemExit(
            f"No se encontro el archivo de veterinarios en {vet_file}. "
            "Ese bloque INSERT (con los hashes de contrasena) vive fuera "
            "del repositorio, junto a credenciales-veterinarios.txt."
        )
    veterinarios_sql = vet_file.read_text(encoding="utf-8")

    sql, report = generate_sql(args.data_dir, veterinarios_sql)
    args.out.write_text(sql, encoding="utf-8")

    print(f"SQL escrito en: {args.out}")
    print(f"Filas leidas: {report['total_rows']}")
    print(f"Propietarios: {report['total_owners']}")
    print(f"Mascotas: {report['total_mascotas']}")
    print(f"Emails conservados: {report['emails_conservados']}")
    print(f"Emails anulados (genericos/compartidos): {report['emails_anulados']}")
    if report["emails_conflicto"]:
        print(f"CONFLICTOS de email sin resolver automaticamente: {len(report['emails_conflicto'])}")
    print(f"Telefonos reconstruidos (cero inicial inferido): {len(report['telefonos_reconstruidos'])} -> historias {report['telefonos_reconstruidos']}")
    print(f"Telefonos NO reconstruibles: {len(report['telefonos_no_reconstruibles'])} -> historias {report['telefonos_no_reconstruibles']}")
    print(f"Telefonos recompuestos (codigo de pais separado por espacio): {len(report['telefonos_recompuestos_codigo_pais'])} -> historias {report['telefonos_recompuestos_codigo_pais']}")
    print(f"Cedulas corregidas por cronologia real (bonus): {len(report['cedula_chronology_fixed'])}")
    print(f"Mascotas sin raza (-> NULL): {report['sin_raza']}")
    print(f"Mascotas con color 'N/A'-like: {report['sin_color_na']}")
    print(f"fecha_nacimiento estimada en: {report['fecha_nac_estimadas']} / {report['total_mascotas']}")
    print(f"Candidatos a mascota duplicada: {len(report['duplicate_candidates'])}")
    for a, b, nombre, sexo, especie, edad_a, edad_b, fa, fb in report["duplicate_candidates"]:
        print(f"  historia {a} ({fa}) vs {b} ({fb}) - nombre~'{nombre}' sexo={sexo} especie={especie} edad {edad_a}/{edad_b}")


if __name__ == "__main__":
    main()
