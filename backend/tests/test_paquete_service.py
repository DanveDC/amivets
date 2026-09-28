"""Unit tests for paquete_service pure functions (plantillas-paquete-catalogo).

Pure: agregar_necesidades / evaluar_disponibilidad / tipo_servicio_de_categoria
never touch the database (SimpleNamespace stands in for Inventario rows), same
convention as test_comision_tipo.py.
"""
from decimal import Decimal as D
from types import SimpleNamespace

from app.services.paquete_service import (
    agregar_necesidades,
    evaluar_disponibilidad,
    tipo_servicio_de_categoria,
)


def _material(nombre, unidad, stock):
    return SimpleNamespace(nombre=nombre, unidad_medida=unidad, stock_actual=stock)


def test_same_material_from_two_recipes_is_summed_with_both_origins():
    necesidades = agregar_necesidades([
        (1, D("50"), "Cirugía de esterilización"),
        (1, D("20"), "Anestesia general"),
    ])
    assert necesidades[1]["requerido"] == D("70.000")
    assert necesidades[1]["origenes"] == ["Cirugía de esterilización", "Anestesia general"]


def test_shortage_gives_the_right_faltante_and_suficiente_false():
    necesidades = agregar_necesidades([(1, D("70"), "Paquete")])
    materiales = {1: _material("Isoflurano", "ml", D("30"))}
    r = evaluar_disponibilidad(necesidades, materiales)
    assert r["suficiente"] is False
    assert r["insumos"][0]["faltante"] == D("40.000")
    assert r["insumos"][0]["requerido"] == D("70.000")
    assert r["insumos"][0]["disponible"] == D("30.000")


def test_exact_stock_gives_faltante_zero():
    necesidades = agregar_necesidades([(1, D("70"), "Paquete")])
    materiales = {1: _material("Isoflurano", "ml", D("100"))}
    r = evaluar_disponibilidad(necesidades, materiales)
    assert r["suficiente"] is True
    assert r["insumos"][0]["faltante"] == D("0")


def test_empty_input_gives_suficiente_true():
    r = evaluar_disponibilidad(agregar_necesidades([]), {})
    assert r["suficiente"] is True
    assert r["insumos"] == []


def test_null_unit_reports_unidad():
    necesidades = agregar_necesidades([(1, D("2"), "Paquete")])
    materiales = {1: _material("Gasas", None, D("10"))}
    r = evaluar_disponibilidad(necesidades, materiales)
    assert r["insumos"][0]["unidad"] == "unidad"


def test_insumos_sorted_by_nombre():
    necesidades = agregar_necesidades([
        (2, D("1"), "Paquete"),
        (1, D("1"), "Paquete"),
    ])
    materiales = {
        1: _material("Zeta", "unidad", D("5")),
        2: _material("Alfa", "unidad", D("5")),
    }
    r = evaluar_disponibilidad(necesidades, materiales)
    assert [i["nombre"] for i in r["insumos"]] == ["Alfa", "Zeta"]


def test_categoria_mapping():
    assert tipo_servicio_de_categoria("QUIROFANO") == "CIRUGIA"
    assert tipo_servicio_de_categoria("FARMACIA") == "INSUMO"
    assert tipo_servicio_de_categoria("  laboratorio  ") == "LABORATORIO"
    assert tipo_servicio_de_categoria("imagenologia") == "LABORATORIO"
    assert tipo_servicio_de_categoria("hospitalizacion".upper()) == "HOSPITALIZACION"
    assert tipo_servicio_de_categoria("peluqueria".upper()) == "ESTETICA"
    assert tipo_servicio_de_categoria("servicios".upper()) == "OTRO"
    assert tipo_servicio_de_categoria("administracion varios".upper()) == "OTRO"
    assert tipo_servicio_de_categoria("ALGO_DESCONOCIDO") == "OTRO"
    assert tipo_servicio_de_categoria(None) == "OTRO"
