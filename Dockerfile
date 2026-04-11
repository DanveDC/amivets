# -- STAGE 1: Builder --
FROM python:3.11-slim as builder

WORKDIR /app

# Instalar dependencias del sistema necesarias para compilar librerías (ej. psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Crear entorno virtual para aislamiento limpio
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# -- STAGE 2: Final --
FROM python:3.11-slim

WORKDIR /app

# Instalar solo librerías de ejecución necesarias (libpq es vital para PostgreSQL)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copiar el entorno virtual desde el builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copiar solo el código necesario (evitando archivos temporales y locales)
COPY backend/ /app/
COPY static/ /app/static/

# Variables de entorno para optimización
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Usuario no-root por seguridad
RUN adduser --disabled-password --gecos "" vetuser
USER vetuser

EXPOSE 8000

# Comando de ejecución con reseteo y seed
CMD ["sh", "-c", "python scripts/init_db.py && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
