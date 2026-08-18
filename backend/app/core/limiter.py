from starlette.requests import Request
from slowapi import Limiter


def get_client_ip(request: Request) -> str:
    """Resuelve la IP del cliente para el rate limiter.

    Usamos X-Real-IP, que nginx en local (ver nginx/nginx.conf) setea
    siempre a $remote_addr -- nginx sobreescribe este header en cada
    request, nunca lo concatena, así que un cliente no puede falsificarlo
    para saltarse el límite. Deliberadamente NO usamos X-Forwarded-For:
    nginx lo arma con proxy_add_x_forwarded_for, que ANEXA la IP real al
    valor que ya venga en el header entrante, así que un atacante puede
    mandar un X-Forwarded-For distinto en cada request y obtener un bucket
    de rate limit nuevo cada vez, evadiendo el límite por completo.

    Si no hay X-Real-IP (por ejemplo pegándole directo al backend en el
    puerto 8000 en desarrollo local, sin pasar por nginx), caemos a
    request.client.host.

    Limitación conocida en producción (Render, sin nginx delante según
    start.sh/render.yaml): Render corre uvicorn directo y no seteamos acá
    ningún header de confianza equivalente a X-Real-IP para ese proxy de
    borde. En ese caso el fallback a request.client.host puede terminar
    siendo la IP del load balancer de Render en vez de la del cliente
    real, agrupando todo el tráfico de producción bajo una sola key. No
    implementamos lógica de "single trusted hop" para X-Forwarded-For acá
    a propósito -- queda fuera de alcance de este fix.
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_client_ip)
