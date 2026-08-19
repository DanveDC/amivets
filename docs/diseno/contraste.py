#!/usr/bin/env python3
"""
Auditor de contraste WCAG 2.1 AA para el sistema de diseño de AmiVets.

Esta es la fuente de verdad de los ratios publicados en `sistema.md`.
Si en la Fase 3 se cambia el valor de un token, se cambia acá y se vuelve
a correr: los números del documento no se estiman, se calculan.

Uso:
    python3 docs/diseno/contraste.py           # informe completo
    python3 docs/diseno/contraste.py --strict  # sale con código 1 si algo falla

Umbrales aplicados:
    4.5:1  texto normal (WCAG 1.4.3, nivel AA)
    3.0:1  componentes de interfaz y gráficos no textuales (WCAG 1.4.11, AA)
"""

import sys

# --------------------------------------------------------------------------
# Cálculo de contraste (fórmula oficial WCAG 2.1)
# --------------------------------------------------------------------------

def _srgb_to_linear(channel: int) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_color: str) -> float:
    """Luminancia relativa de un color sRGB."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (0.2126 * _srgb_to_linear(r)
            + 0.7152 * _srgb_to_linear(g)
            + 0.0722 * _srgb_to_linear(b))


def contrast(fg: str, bg: str) -> float:
    """Ratio de contraste entre dos colores, de 1:1 a 21:1."""
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# --------------------------------------------------------------------------
# Tokens — deben coincidir exactamente con las tablas de sistema.md
# --------------------------------------------------------------------------

LIGHT = {
    "bg":             "#F2F5F6",
    "surface":        "#FFFFFF",
    "surface-sunken": "#E9EEEF",
    "surface-hover":  "#F3F6F7",
    "border-subtle":  "#E4E9EA",
    "border":         "#D3DBDD",
    "border-control": "#7E8C90",
    "text-primary":   "#101718",
    "text-secondary": "#4A585B",
    "text-muted":     "#626F73",
    "accent":         "#0B6B70",
    "accent-hover":   "#085458",
    "accent-subtle":  "#E3F0F1",
    "action":         "#1A2426",
    "action-hover":   "#0E1517",
    "on-action":      "#FFFFFF",
    "success":        "#0F7A44",
    "success-text":   "#0B5E34",
    "success-subtle": "#E3F3EA",
    "warning":        "#B26A00",
    "warning-text":   "#8A5200",
    "warning-subtle": "#FBEEDC",
    "danger":         "#B4231F",
    "danger-text":    "#97201C",
    "danger-subtle":  "#FBE7E6",
    "info":           "#1A56C4",
    "info-text":      "#164AAB",
    "info-subtle":    "#E5EDFB",
    "neutral":        "#7E8C90",
    "neutral-text":   "#4A585B",
    "neutral-subtle": "#E9EEEF",
}

DARK = {
    "bg":             "#0D1214",
    "surface":        "#141A1C",
    "surface-sunken": "#0A0F10",
    "surface-hover":  "#1A2224",
    "border-subtle":  "#1E2628",
    "border":         "#2A3436",
    "border-control": "#5E6A6D",
    "text-primary":   "#E8EDEE",
    "text-secondary": "#A5B0B3",
    "text-muted":     "#8B9699",
    "accent":         "#4CC9D0",
    "accent-hover":   "#7ADCE1",
    "accent-subtle":  "#0F2C2E",
    "action":         "#E8EDEE",
    "action-hover":   "#FFFFFF",
    "on-action":      "#0D1214",
    "success":        "#3FBF7F",
    "success-text":   "#5CD494",
    "success-subtle": "#0C2A1C",
    "warning":        "#E0A040",
    "warning-text":   "#EDB863",
    "warning-subtle": "#2E2008",
    "danger":         "#F0736B",
    "danger-text":    "#F58C85",
    "danger-subtle":  "#33130F",
    "info":           "#6BA0F5",
    "info-text":      "#8FB8F8",
    "info-subtle":    "#0F1F3D",
    "neutral":        "#5E6A6D",
    "neutral-text":   "#A5B0B3",
    "neutral-subtle": "#1E2628",
}

# Paleta categórica de gráficos (Chart.js). Solo exige 3:1 (no es texto).
SERIES_LIGHT = ["#0B6B70", "#1A56C4", "#B26A00", "#0F7A44", "#8E3B86", "#B4231F"]
SERIES_DARK  = ["#4CC9D0", "#6BA0F5", "#E0A040", "#3FBF7F", "#D588CC", "#F0736B"]

# (token_texto, token_fondo, minimo, descripción)
PAIRS = [
    ("text-primary",   "bg",             4.5, "Texto principal sobre fondo de página"),
    ("text-primary",   "surface",        4.5, "Texto principal sobre tarjeta / tabla"),
    ("text-primary",   "surface-sunken", 4.5, "Texto principal sobre cabecera de tabla"),
    ("text-primary",   "surface-hover",  4.5, "Texto principal sobre fila con hover"),
    ("text-secondary", "surface",        4.5, "Texto secundario sobre tarjeta"),
    ("text-secondary", "bg",             4.5, "Texto secundario sobre fondo"),
    ("text-muted",     "surface",        4.5, "Texto atenuado / placeholder sobre tarjeta"),
    ("text-muted",     "bg",             4.5, "Texto atenuado sobre fondo"),
    ("accent",         "surface",        4.5, "Enlace / navegación activa sobre tarjeta"),
    ("accent",         "bg",             4.5, "Enlace sobre fondo de página"),
    ("accent",         "accent-subtle",  4.5, "Navegación activa sobre tinte de acento"),
    ("on-action",      "action",         4.5, "Etiqueta de botón primario"),
    ("on-action",      "action-hover",   4.5, "Etiqueta de botón primario (hover)"),
    ("success-text",   "success-subtle", 4.5, "Badge: pagado / activo / finalizado"),
    ("warning-text",   "warning-subtle", 4.5, "Badge: por vencer / bajo stock / en sala"),
    ("danger-text",    "danger-subtle",  4.5, "Badge: vencido / agotado / cancelado"),
    ("info-text",      "info-subtle",    4.5, "Badge: programada / informativo"),
    ("neutral-text",   "neutral-subtle", 4.5, "Badge: inactivo / sin datos / borrador"),
    ("success-text",   "surface",        4.5, "Texto de éxito en línea"),
    ("warning-text",   "surface",        4.5, "Texto de advertencia en línea"),
    ("danger-text",    "surface",        4.5, "Mensaje de error de formulario"),
    ("info-text",      "surface",        4.5, "Nota informativa en línea"),
    ("border-control", "surface",        3.0, "Borde de input sobre tarjeta [1.4.11]"),
    ("border-control", "bg",             3.0, "Borde de input sobre fondo [1.4.11]"),
    ("accent",         "surface",        3.0, "Anillo de foco sobre tarjeta [1.4.11]"),
    ("accent",         "bg",             3.0, "Anillo de foco sobre fondo [1.4.11]"),
    ("accent",         "surface-sunken", 3.0, "Anillo de foco sobre cabecera [1.4.11]"),
    ("success",        "surface",        3.0, "Punto de estado / serie de gráfico [1.4.11]"),
    ("warning",        "surface",        3.0, "Punto de estado / serie de gráfico [1.4.11]"),
    ("danger",         "surface",        3.0, "Punto de estado / serie de gráfico [1.4.11]"),
    ("info",           "surface",        3.0, "Punto de estado / serie de gráfico [1.4.11]"),
    ("neutral",        "surface",        3.0, "Punto de estado neutro [1.4.11]"),
]

# Pares con color literal (relleno sólido de acento o de peligro).
LITERAL_LIGHT = [
    ("#FFFFFF", "#0B6B70", 4.5, "Blanco sobre acento sólido (día de hoy, chip activo)"),
    ("#FFFFFF", "#B4231F", 4.5, "Blanco sobre rojo sólido (confirmar borrado)"),
]
LITERAL_DARK = [
    ("#0D1214", "#4CC9D0", 4.5, "Grafito sobre acento sólido (día de hoy, chip activo)"),
    ("#0D1214", "#F0736B", 4.5, "Grafito sobre rojo sólido (confirmar borrado)"),
]


def audit(title, theme, literals, series):
    print(f"\n{'=' * 100}\n{title}\n{'=' * 100}")
    print(f"{'par texto / fondo':<48}{'texto':<10}{'fondo':<10}{'ratio':>9}{'mín':>6}   ")
    failures = []

    for fg, bg, minimum, label in PAIRS:
        ratio = contrast(theme[fg], theme[bg])
        ok = ratio >= minimum
        if not ok:
            failures.append((label, theme[fg], theme[bg], ratio, minimum))
        print(f"{label:<48}{theme[fg]:<10}{theme[bg]:<10}{ratio:>7.2f}:1{minimum:>6.1f}   "
              f"{'PASS' if ok else 'FALLA'}")

    for fg, bg, minimum, label in literals:
        ratio = contrast(fg, bg)
        ok = ratio >= minimum
        if not ok:
            failures.append((label, fg, bg, ratio, minimum))
        print(f"{label:<48}{fg:<10}{bg:<10}{ratio:>7.2f}:1{minimum:>6.1f}   "
              f"{'PASS' if ok else 'FALLA'}")

    print(f"\n  paleta categórica de gráficos sobre {theme['surface']} (mínimo 3.0:1)")
    for i, color in enumerate(series, start=1):
        ratio = contrast(color, theme["surface"])
        ok = ratio >= 3.0
        if not ok:
            failures.append((f"serie-{i} de gráfico", color, theme["surface"], ratio, 3.0))
        print(f"    serie-{i}  {color}  {ratio:>6.2f}:1   {'PASS' if ok else 'FALLA'}")

    print(f"\n  FALLOS: {len(failures)}")
    for label, fg, bg, ratio, minimum in failures:
        print(f"    -> {label}: {ratio:.2f}:1 (necesita {minimum}) — {fg} sobre {bg}")
    return failures


if __name__ == "__main__":
    problems = audit("TEMA CLARO", LIGHT, LITERAL_LIGHT, SERIES_LIGHT)
    problems += audit("TEMA OSCURO", DARK, LITERAL_DARK, SERIES_DARK)

    print(f"\n{'=' * 100}")
    print(f"TOTAL DE FALLOS EN AMBOS TEMAS: {len(problems)}")
    print(f"{'=' * 100}")

    if "--strict" in sys.argv and problems:
        sys.exit(1)
