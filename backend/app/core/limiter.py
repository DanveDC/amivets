from starlette.requests import Request
from slowapi import Limiter


def get_client_ip(request: Request) -> str:
    """Resuelve la IP del cliente para el rate limiter.

    Preferimos X-Forwarded-For (lo setea nginx en local y Render en
    producción) sobre request.client.host, que detrás de un proxy siempre
    es la IP del proxy, no la del cliente real. Esto es un límite best-effort
    contra abuso por script, no un control de seguridad duro: quien le pega
    directo al backend sin pasar por el proxy puede falsificar el header.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_client_ip)
