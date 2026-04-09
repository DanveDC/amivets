import os
from xhtml2pdf import pisa
from jinja2 import Environment, FileSystemLoader
from io import BytesIO
from datetime import datetime

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
        """
        Genera el PDF de una factura específica
        """
        context = {
            "factura": factura,
            "propietario": factura.propietario,
            "detalles": factura.detalles,
            "fecha": factura.fecha_emision.strftime("%d/%m/%Y"),
            "logo_url": "https://cdn-icons-png.flaticon.com/512/809/809957.png" # Placeholder logo
        }
        
        return PDFService.render_to_pdf('invoice_template.html', context)
