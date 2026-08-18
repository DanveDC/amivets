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
# original (nginx local, el borde de Render en producción), TODO el
# tráfico que pasa por ese proxy comparte una sola key. En producción esto
# no es un caso raro de alta concurrencia: como Render es el único que le
# habla al contenedor y no verificamos ningún hop de confianza, en la
# práctica el límite es efectivamente global para esta ruta (5/min para
# toda la clínica), no por visitante. Preferimos ese costo -- coordinar
# turnos QR simultáneos entre clientes reales -- antes que un límite
# spoofeable que no frena nada. Es un límite best-effort contra abuso por
# script, no un control de seguridad duro; si el volumen real de la
# clínica hace que esto moleste, la solución es un proxy de confianza
# verificable delante (ver discusión en docs/tareas/01-pruebas-funcionales-y-seguridad.md, B3),
# no volver a confiar en un header.
limiter = Limiter(key_func=get_remote_address)
