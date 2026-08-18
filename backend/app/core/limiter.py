from starlette.requests import Request
from slowapi import Limiter


def get_client_ip(request: Request) -> str:
    """Resuelve la IP del cliente para el rate limiter.

    Tarea 02, unidad C -- revierte la decisión de la tarea 01, que
    descartó X-Forwarded-For entero por ser escribible por el cliente y
    terminó confiando solo en request.client.host (peer TCP), aceptando
    que el límite quedara efectivamente global detrás de cualquier proxy.
    Esa conclusión se pasó de conservadora: X-Forwarded-For no es de
    confianza *como conjunto*, pero sí lo es *por posición*.

    Cuando un cliente falsifica el header, el proxy de borde AGREGA su
    propia observación del peer al final de la lista en vez de
    reemplazarla:

        Cliente envía:  X-Forwarded-For: 1.2.3.4          (falsificado)
        La app recibe:  X-Forwarded-For: 1.2.3.4, 203.0.113.7
                                                    ^^^^^^^^^^ esto lo escribió el proxy

    Con exactamente un proxy de confianza delante, la clave correcta es
    la ÚLTIMA entrada -- lo que el atacante meta a la izquierda se
    descarta sin más. No es confiar en el header, es confiar en la parte
    que el proxy escribió y el cliente no puede tocar.

    La premisa sin verificar todavía: que hay *exactamente un* proxy de
    confianza delante en cada entorno (nginx local: confirmado, escribe
    una sola entrada; Render en producción: sin confirmar, start.sh corre
    uvicorn directo y no hay evidencia acá de cuántos saltos agrega su
    borde). Por eso el límite baja de 5 a 60/minuto de forma temporal --
    alcanza igual para frenar un script que llena la agenda a miles de
    peticiones por minuto, y si el supuesto de "un solo salto" resulta
    incorrecto, el costo de quedar un poco más laxo mientras se verifica
    es mucho menor que el de quedar spoofeable. Verificación empírica:
    GET /api/admin/diagnostics/proxy-chain (main.py) expone la cadena
    completa y el peer TCP para confirmar el conteo real tras el deploy.

    Sin X-Forwarded-For (desarrollo local pegándole directo al backend en
    el puerto 8000, sin pasar por nginx), cae a request.client.host.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        chain = [p.strip() for p in xff.split(",") if p.strip()]
        if chain:
            return chain[-1]
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_client_ip)
