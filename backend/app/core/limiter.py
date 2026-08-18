from slowapi import Limiter
from slowapi.util import get_remote_address

# Deliberadamente NO leemos ningún header (X-Forwarded-For, X-Real-IP, etc.)
# para la key del rate limiter. Ambos son controlables por el cliente salvo
# que se verifique que el único hop que puede escribirlos es un proxy de
# confianza -- y no podemos garantizar eso para el despliegue en Render:
# start.sh corre uvicorn directo, sin nginx ni ningún proxy bajo nuestro
# control delante, así que no hay forma de distinguir "lo puso nuestro
# proxy" de "lo puso el atacante" para ningún header. Confiar en uno de
# todos modos (probamos X-Real-IP primero, asumiendo que nginx lo pone
# siempre) reabre exactamente el mismo bypass que este fix debía cerrar,
# solo que en el único ambiente que está expuesto a internet de verdad.
#
# get_remote_address usa el peer TCP real (request.client.host), que un
# cliente no puede falsificar vía headers. La contrapartida, aceptada a
# propósito: detrás de cualquier proxy que no preserve la conexión TCP
# original (nginx local, el borde de Render en producción), todo el
# tráfico que pasa por ese proxy comparte una sola key -- el límite se
# vuelve más grueso, no más laxo. Preferimos ese costo (posibles 429 entre
# usuarios legítimos concurrentes) antes que un límite spoofeable que no
# frena nada. Es un límite best-effort contra abuso por script, no un
# control de seguridad duro.
limiter = Limiter(key_func=get_remote_address)
