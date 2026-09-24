# Instalar AmiVets con Docker en un servidor de la red local

Guía para dejar el sistema corriendo en una máquina de la oficina y que todos
los equipos conectados a esa red entren desde el navegador.

Sirve en Linux, Windows o macOS: Docker es el mismo en los tres, y lo único que
cambia son dos pasos (instalar Docker y abrir el puerto en el firewall), que
están separados por sistema.

---

## Qué vas a montar

Tres contenedores en una red interna de Docker:

```
   Red de la oficina                    Servidor
   ────────────────────                 ─────────────────────────────────
   PC recepción    ──┐
   Tablet consultorio ├──►  puerto 80 ──►  nginx  ──►  backend  ──►  db
   Celular (QR)    ──┘                    (único      (FastAPI,   (Postgres,
                                          ingreso)    sin puerto   sin puerto
                                                      publicado)   publicado)
```

Solo **el puerto 80 queda expuesto**. El backend y la base no se publican al
host: se hablan entre sí por la red interna de Docker. Eso es a propósito —
`docker-compose.yml` lo documenta: publicar el backend permitía saltarse nginx.

Los datos viven en un volumen de Docker llamado `postgres_data`. Sobrevive a
reinicios y a actualizaciones del código; **solo se borra si lo borras a mano**.

---

## Paso 1 — Elegir la máquina

Cualquier PC que quede encendida durante el horario de trabajo sirve. Mínimo
razonable: 2 núcleos, 4 GB de RAM, 20 GB libres.

**Linux (Ubuntu Server 24.04 LTS) es la mejor opción** si puedes elegir: menos
consumo, arranca solo, no pide licencia y Docker corre nativo. En Windows y
macOS, Docker corre dentro de una máquina virtual (Docker Desktop), lo que gasta
más RAM y **exige que un usuario tenga sesión iniciada** para que los
contenedores estén arriba — si el servidor se reinicia y nadie inicia sesión, la
app queda caída. Para Windows conviene Docker Engine sobre WSL2 configurado como
servicio, o directamente una VM con Ubuntu.

Lo que sí es obligatorio en cualquier sistema: que la máquina tenga **IP fija**
en la red (Paso 8).

---

## Paso 2 — Instalar Docker

### Ubuntu / Debian

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Cierra sesión y vuelve a entrar para que el grupo `docker` tome efecto.

### Fedora / RHEL / Rocky

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

### Windows

Instala **Docker Desktop** desde docker.com. Requiere WSL2 (el instalador lo
habilita). Después, en *Settings → General*, marca **Start Docker Desktop when
you log in**, y configura el usuario para que inicie sesión automáticamente al
arrancar; si no, los contenedores no levantan solos.

### macOS

Instala **Docker Desktop**. Misma advertencia sobre el inicio de sesión.

### Verificar (en cualquier sistema)

```bash
docker --version
docker compose version
```

Si `docker compose version` falla pero `docker-compose --version` funciona,
tienes la versión vieja: usa `docker-compose` en lugar de `docker compose` en
todos los comandos de esta guía.

---

## Paso 3 — Copiar el proyecto al servidor

```bash
git clone <url-del-repo> amivets
cd amivets
```

Si no hay repositorio, copia la carpeta completa por red o USB. Lo que
**necesitas sí o sí**: `Dockerfile`, `docker-compose.yml`, `start.sh`,
`requirements.txt`, `backend/`, `static/`, `nginx/` y `sync_worker.py`.

---

## Paso 4 — Neutralizar el archivo de desarrollo ⚠️

Este es el paso que más fácil se olvida y el que más daño hace.

`docker-compose.override.yml` **se aplica solo**, sin que lo pidas, cuando está
presente en la carpeta. Y ese archivo está hecho para desarrollo: monta el
código fuente desde el disco, arranca uvicorn con `--reload` y fija la
contraseña del admin en `admin123`.

En el servidor, renómbralo:

```bash
mv docker-compose.override.yml docker-compose.override.yml.local
```

O, si prefieres conservarlo, **agrega `-f docker-compose.yml` a cada comando**
de esta guía para que compose ignore el override. Ejemplo:
`docker compose -f docker-compose.yml up -d`.

---

## Paso 5 — Cerrar el puerto de la base de datos ⚠️

Tal como está, `docker-compose.yml` publica Postgres al host:

```yaml
  db:
    ports:
      - "5432:5432"
```

Eso deja la base **accesible desde toda la red**, con el usuario y la contraseña
por defecto del ejemplo. En un servidor compartido no va. Edita
`docker-compose.yml` y elimina esas dos líneas (`ports:` y `- "5432:5432"` del
servicio `db`).

El backend le sigue hablando por la red interna de Docker; no se rompe nada.

Si necesitas conectarte a la base con un cliente desde el propio servidor, en
vez de publicarla usa:

```bash
docker compose exec db psql -U vetuser -d veterinaria_db
```

---

## Paso 6 — Configurar el archivo `.env`

```bash
cp .env.example .env
```

Ábrelo y ajusta:

| Variable | Qué poner |
|---|---|
| `POSTGRES_PASSWORD` | Una contraseña nueva y larga. **No dejes `vetpass123`.** |
| `SECRET_KEY` | Generar: `openssl rand -hex 32` |
| `JWT_SECRET_KEY` | Otro distinto: `openssl rand -hex 32` |
| `ENVIRONMENT` | `production` |
| `DEBUG` | `False` |
| `CORS_ORIGINS` | `http://192.168.1.50` — la IP fija que le vas a dar al servidor (Paso 8). Agrega el nombre si vas a usar uno. |
| `ADMIN_INITIAL_PASSWORD` | Una contraseña temporal, **solo para el primer arranque**. Se borra en el Paso 9. |
| `FORCE_RESET_DB` | `false`. Nunca lo cambies en el servidor: borra la base entera. |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Solo si vas a usar el agendamiento público por QR. Si no, déjalas vacías. |

Los valores por defecto de `SECRET_KEY` y `JWT_SECRET_KEY` que trae
`docker-compose.yml` dicen literalmente `change-in-production`. Cámbialos.

En Windows, protege el archivo: clic derecho → Propiedades → Seguridad, y deja
acceso solo al usuario que corre Docker. En Linux: `chmod 600 .env`.

---

## Paso 7 — Levantar el sistema

```bash
docker compose up -d --build
```

La primera vez tarda varios minutos: compila la imagen del backend. Después:

```bash
docker compose ps
```

Los tres contenedores (`veterinaria_db`, `veterinaria_backend`,
`veterinaria_nginx`) deben aparecer como `Up`, y el de la base como `healthy`.

Prueba desde el propio servidor:

```bash
curl -I http://localhost
```

Debe responder `HTTP/1.1 200 OK`.

Si algo falla, mira los registros:

```bash
docker compose logs -f backend
```

---

## Paso 8 — Exponer el puerto en la red

Aquí es donde la app pasa de "funciona en el servidor" a "la usa toda la
oficina". Son tres cosas.

### 8.1 — IP fija para el servidor

Si la IP cambia, mañana nadie entra. Dos formas, cualquiera sirve:

- **Reserva DHCP en el router** (lo más simple): entra al router, busca la lista
  de dispositivos, ubica el servidor por su MAC y asígnale siempre la misma IP.
- **IP estática en el servidor**: en Ubuntu se configura en `/etc/netplan/`; en
  Windows, en las propiedades del adaptador de red.

Anota la IP elegida. En el resto de la guía uso `192.168.1.50` de ejemplo.

Para verla:

```bash
ip addr show          # Linux
ipconfig              # Windows
ifconfig | grep inet  # macOS
```

### 8.2 — Abrir el puerto 80 en el firewall

El `ports: "80:80"` de `docker-compose.yml` ya publica el puerto en **todas** las
interfaces del servidor. Lo único que puede estar bloqueando es el firewall del
sistema operativo.

**Ubuntu / Debian (ufw):**

```bash
sudo ufw allow 80/tcp
sudo ufw reload
```

**Fedora / RHEL (firewalld):**

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --reload
```

**Windows (PowerShell como administrador):**

```powershell
New-NetFirewallRule -DisplayName "AmiVets HTTP" -Direction Inbound `
  -Protocol TCP -LocalPort 80 -Action Allow -Profile Private
```

El `-Profile Private` es importante: abre el puerto en la red de la oficina, no
en redes públicas. Asegúrate de que Windows tenga la red clasificada como
*Privada*.

**macOS:** el firewall por defecto permite conexiones entrantes a procesos
autorizados; si está activo, autoriza Docker cuando lo pregunte
(*Preferencias → Red → Firewall → Opciones*).

⚠️ **Ojo con Docker y ufw en Linux:** Docker escribe sus propias reglas en
iptables y **se salta ufw**. En la práctica esto significa que un puerto
publicado con `ports:` queda accesible aunque ufw diga que está cerrado. Es
justamente por esto que el Paso 5 importa tanto: no basta con "tener firewall",
hay que no publicar lo que no debe salir.

Si necesitas que el puerto 80 escuche solo en una interfaz concreta, cámbialo en
`docker-compose.yml`:

```yaml
  nginx:
    ports:
      - "192.168.1.50:80:80"
```

### 8.3 — Cómo entran los demás

Desde cualquier equipo de la red, en el navegador:

```
http://192.168.1.50
```

Sin puerto al final (el 80 es el que asume el navegador) y **sin `https://`** —
no hay certificado, y si lo escriben con `https` no va a cargar.

**Para no depender de recordar la IP**, dale un nombre. La opción sin
infraestructura es agregar una línea al archivo `hosts` de cada equipo:

- Windows: `C:\Windows\System32\drivers\etc\hosts` (editar como administrador)
- Linux / macOS: `/etc/hosts`

```
192.168.1.50   amivets
```

Con eso entran escribiendo `http://amivets`. Si el router lo permite, es mejor
crear la entrada DNS ahí una sola vez en lugar de tocar cada equipo.

**Celulares y tablets** (para el flujo de QR): tienen que estar en el mismo
WiFi. Si la red tiene *aislamiento de clientes* activado —común en redes de
invitados—, no van a ver al servidor aunque esté todo bien; hay que
desactivarlo o ponerlos en la red principal.

---

## Paso 9 — Crear el usuario administrador y cerrar la puerta

Al primer arranque, el backend crea el usuario admin con la contraseña de
`ADMIN_INITIAL_PASSWORD`.

1. Entra a `http://192.168.1.50`, inicia sesión con ese admin.
2. **Cambia la contraseña desde la aplicación**, en Mi Perfil.
3. Vacía la variable en `.env`:

```
ADMIN_INITIAL_PASSWORD=
```

4. Aplica el cambio:

```bash
docker compose up -d
```

Deja esa variable vacía de forma permanente. Sin ella, el usuario admin
simplemente no se recrea — que es lo que quieres.

Después crea desde la aplicación los usuarios reales de cada persona
(veterinario, recepcionista). Nadie debería trabajar con la cuenta admin.

---

## Paso 10 — Que arranque solo al prender la máquina

`docker-compose.yml` no trae política de reinicio. Agrégala a los tres servicios
(`db`, `backend`, `nginx`):

```yaml
    restart: unless-stopped
```

Y aplica:

```bash
docker compose up -d
```

En Linux, además, asegúrate de que el servicio de Docker arranque con el
sistema:

```bash
sudo systemctl enable docker
```

En Windows y macOS esto depende del inicio de sesión automático, como advertí en
el Paso 1.

Prueba de verdad que funciona: reinicia el servidor y verifica que la app
responda sin que nadie toque nada.

---

## Operación diaria

**Ver qué está corriendo:**

```bash
docker compose ps
```

**Ver registros:**

```bash
docker compose logs -f backend    # o db, o nginx
```

**Reiniciar:**

```bash
docker compose restart
```

**Actualizar a una versión nueva del código:**

```bash
git pull
docker compose up -d --build
```

Los datos no se tocan: viven en el volumen, no en la imagen.

### Respaldo de la base

Esto es lo más importante de toda la guía. Un respaldo diario:

```bash
docker compose exec -T db pg_dump -U vetuser veterinaria_db > respaldo-$(date +%F).sql
```

En Linux, automatízalo con cron (`crontab -e`):

```
0 22 * * * cd /ruta/a/amivets && docker compose exec -T db pg_dump -U vetuser veterinaria_db > /ruta/respaldos/amivets-$(date +\%F).sql
```

En Windows, con el Programador de tareas apuntando a un `.bat` equivalente.

Y guarda una copia **fuera del servidor** — un respaldo que vive en la misma
máquina que la base no protege contra el disco que se dañó.

**Restaurar:**

```bash
cat respaldo-2026-09-09.sql | docker compose exec -T db psql -U vetuser -d veterinaria_db
```

Prueba la restauración al menos una vez, en otra máquina, antes de necesitarla
de verdad.

---

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Funciona en el servidor pero no desde otros equipos | Firewall del sistema | Paso 8.2 |
| Dejó de funcionar de un día para otro | La IP del servidor cambió | Paso 8.1, reserva DHCP |
| El navegador dice "no seguro" o no carga | Escribieron `https://` | Es `http://`, sin la ese |
| Los celulares no entran, las PC sí | Aislamiento de clientes en el WiFi | Desactivarlo en el router |
| `port is already allocated` al levantar | Algo más usa el puerto 80 (IIS, Skype, otro nginx) | Apagar eso, o cambiar a `"8080:80"` y entrar por `http://ip:8080` |
| El backend reinicia en bucle | No puede hablar con la base | `docker compose logs db`; revisar `POSTGRES_PASSWORD` en `.env` |
| Cambié `.env` y no pasó nada | Las variables se leen al crear el contenedor | `docker compose up -d` (no `restart`) |
| Se puede entrar sin contraseña con admin/admin123 | Quedó el override de desarrollo aplicado | Paso 4 |

---

## Sobre seguridad, con franqueza

Esta guía deja el sistema **en HTTP plano dentro de la red local**. El tráfico
—incluidas las contraseñas al iniciar sesión— viaja sin cifrar. Para una red de
oficina cerrada es lo habitual y es una decisión razonable, pero conviene saber
qué implica:

- Cualquiera con acceso a esa red puede, con las herramientas adecuadas, leer
  ese tráfico. Si en la red hay WiFi de invitados o equipos que no controlas, el
  riesgo es real.
- **No expongas el puerto 80 a internet** abriéndolo en el router. Si hace falta
  acceso desde fuera, la vía correcta es una VPN (WireGuard, Tailscale o
  ZeroTier — el `nginx.conf` ya tiene cabeceras preparadas para ZeroTier), no
  abrir el puerto.
- Si más adelante quieres HTTPS dentro de la red, se puede con un certificado
  propio instalado en los equipos, o con un dominio real y Caddy o
  Traefik delante en lugar de nginx.
