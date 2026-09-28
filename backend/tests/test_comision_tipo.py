"""Unit tests for the commission split by type (comision-tipo-mixto-encargado).

Pure: calcular_comision receives the encargado cache and the default
percentage, so it never touches the database (db=None).
"""
from decimal import Decimal as D
from types import SimpleNamespace

import pytest

from app.services.comision_service import _repartir_con_tipo, calcular_comision

ENCARGADO = 7


def _propia(tipo, monto_fijo=None, porcentaje=None):
    return SimpleNamespace(tipo_comision=tipo, monto_fijo=monto_fijo, porcentaje=porcentaje)


def _catalogo(tipo, monto=None, porcentaje=None):
    return SimpleNamespace(tipo_comision_servicio=tipo, monto_fijo_servicio=monto, porcentaje_servicio=porcentaje)


def _calc(subtotal, propia=None, catalogo=None, defecto=D("0")):
    return calcular_comision(
        None, D(subtotal), ENCARGADO,
        catalogo_servicio=catalogo,
        propias={ENCARGADO: propia},
        defecto=defecto,
    )


@pytest.mark.parametrize("propia, enc, ami, tipo", [
    (_propia("PORCENTAJE", porcentaje=D("20")), D("200.00"), D("800.00"), "PORCENTAJE"),
    (_propia("FIJO", monto_fijo=D("150")), D("150.00"), D("850.00"), "FIJO"),
    (_propia("MIXTO", monto_fijo=D("50"), porcentaje=D("10")), D("150.00"), D("850.00"), "MIXTO"),
])
def test_encargado_types(propia, enc, ami, tipo):
    r = _calc("1000", propia=propia)
    assert (r["monto_encargado"], r["monto_amivets"], r["tipo_comision_usado"]) == (enc, ami, tipo)


def test_used_params_only_for_the_type():
    fijo = _calc("1000", propia=_propia("FIJO", monto_fijo=D("150")))
    assert fijo["monto_fijo_usado"] == D("150") and fijo["porcentaje_usado"] is None
    pct = _calc("1000", propia=_propia("PORCENTAJE", porcentaje=D("20")))
    assert pct["monto_fijo_usado"] is None and pct["porcentaje_usado"] == D("20")
    mixto = _calc("1000", propia=_propia("MIXTO", monto_fijo=D("50"), porcentaje=D("10")))
    assert mixto["monto_fijo_usado"] == D("50") and mixto["porcentaje_usado"] == D("10")


def test_catalog_override_wins_over_encargado():
    r = _calc("1000", propia=_propia("PORCENTAJE", porcentaje=D("20")), catalogo=_catalogo("FIJO", monto=D("200")))
    assert r["tipo_comision_usado"] == "FIJO"
    assert r["monto_encargado"] == D("200.00")


def test_catalog_percentage_override():
    r = _calc("1000", propia=_propia("FIJO", monto_fijo=D("50")), catalogo=_catalogo("PORCENTAJE", porcentaje=D("5")))
    assert (r["tipo_comision_usado"], r["monto_encargado"]) == ("PORCENTAJE", D("50.00"))


def test_catalog_hereda_uses_encargado():
    r = _calc("1000", propia=_propia("MIXTO", monto_fijo=D("50"), porcentaje=D("10")), catalogo=_catalogo("HEREDA"))
    assert (r["tipo_comision_usado"], r["monto_encargado"]) == ("MIXTO", D("150.00"))


def test_default_percentage_without_own_commission():
    r = _calc("1000", propia=None, defecto=D("12.5"))
    assert (r["tipo_comision_usado"], r["monto_encargado"], r["monto_amivets"]) == ("PORCENTAJE", D("125.00"), D("875.00"))


@pytest.mark.parametrize("tipo, monto, pct", [("FIJO", D("100"), D("0")), ("MIXTO", D("70"), D("50"))])
def test_fixed_amount_capped_to_subtotal(tipo, monto, pct):
    r = _repartir_con_tipo(D("80"), tipo, monto, pct)
    assert r["monto_encargado"] == D("80.00")
    assert r["monto_amivets"] == D("0.00")


@pytest.mark.parametrize("tipo, monto, pct", [
    ("PORCENTAJE", D("0"), D("20")),
    ("FIJO", D("150"), D("0")),
    ("MIXTO", D("50"), D("10")),
    ("FIJO", D("100"), D("0")),
])
@pytest.mark.parametrize("subtotal", [D("1000"), D("80"), D("33.33")])
def test_negative_subtotal_is_symmetric(tipo, monto, pct, subtotal):
    pos = _repartir_con_tipo(subtotal, tipo, monto, pct)
    neg = _repartir_con_tipo(-subtotal, tipo, monto, pct)
    assert neg["monto_encargado"] == -pos["monto_encargado"]
    assert neg["monto_amivets"] == -pos["monto_amivets"]
    assert neg["tipo_comision_usado"] == tipo


def test_parts_always_add_up_to_subtotal():
    for subtotal in (D("0.01"), D("33.33"), D("999.99")):
        r = _repartir_con_tipo(subtotal, "MIXTO", D("0.50"), D("33.33"))
        assert r["monto_encargado"] + r["monto_amivets"] == subtotal
