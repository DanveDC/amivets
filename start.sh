#!/bin/sh
# start.sh — Punto de entrada del contenedor Amivets en Render
# Lanza el servidor web (uvicorn) y el sync worker en paralelo.
# Si el servidor web muere, el contenedor termina (señal de fallo para Render).

set -e

echo "▶ Inicializando base de datos local..."
python scripts/init_db.py

echo "▶ Iniciando Sync Worker en segundo plano..."
python /app/sync_worker.py &
WORKER_PID=$!

echo "▶ Iniciando servidor Amivets (uvicorn)..."
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

# Si uvicorn termina, matamos el worker también
kill $WORKER_PID 2>/dev/null || true
