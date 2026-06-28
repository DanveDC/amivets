import os
from xhtml2pdf import pisa
from jinja2 import Environment, FileSystemLoader
from io import BytesIO
from datetime import datetime
from fastapi import HTTPException

class PDFService:
    @staticmethod
    def render_to_pdf(template_src, context_dict={}):
        template_path = os.path.join(os.path.dirname(__file__), '..', 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template(template_src)
        html = template.render(context_dict)

        result = BytesIO()
        pdf = pisa.pisaDocument(BytesIO(html.encode("UTF-8")), result)
        if not pdf.err:
            return result.getvalue()
        return None

    @staticmethod
    def generar_factura_pdf(factura):
        """Genera el PDF de una factura específica"""
        context = {
            "factura": factura,
            "propietario": factura.propietario,
            "detalles": factura.detalles,
            "fecha": factura.fecha_emision.strftime("%d/%m/%Y"),
            "logo_url": "https://cdn-icons-png.flaticon.com/512/809/809957.png"
        }

        return PDFService.render_to_pdf('invoice_template.html', context)

    @staticmethod
    def generar_consulta_pdf(db, consulta_id: int):
        """Genera el PDF del resumen clínico de una consulta"""
        from app.models.models import Consulta, Mascota, Propietario

        consulta = db.query(Consulta).filter(Consulta.id == consulta_id).first()
        if not consulta:
            raise HTTPException(status_code=404, detail="Consulta no encontrada")

        mascota = db.query(Mascota).filter(Mascota.id == consulta.mascota_id).first()
        propietario = db.query(Propietario).filter(Propietario.id == mascota.propietario_id).first() if mascota else None

        servicios = [s for s in consulta.servicios if not s.is_deleted]

        context = {
            "consulta": consulta,
            "mascota": mascota,
            "propietario": propietario,
            "servicios": servicios,
            "fecha_impresion": datetime.now().strftime("%d/%m/%Y %H:%M"),
        }

        return PDFService.render_to_pdf('consulta_template.html', context)

    @staticmethod
    def generar_abono_pdf(abono, factura):
        """Genera el PDF del comprobante de abono"""
        propietario = factura.propietario if factura else None

        context = {
            "abono": abono,
            "factura": factura,
            "propietario": propietario,
            "fecha_impresion": datetime.now().strftime("%d/%m/%Y %H:%M"),
        }

        return PDFService.render_to_pdf('abono_template.html', context)
