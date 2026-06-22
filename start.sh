#!/bin/sh
# start.sh — Entry point for AmiVets container (Render + Docker)
# Launches uvicorn and sync_worker in parallel.
# If uvicorn exits, the container exits (Render detects failure).

set -e

echo "▶ Initializing database..."
# init_db.py runs Base.metadata.create_all — idempotent
python /app/scripts/init_db.py

echo "▶ Starting Sync Worker in background..."
python /app/sync_worker.py &
WORKER_PID=$!

echo "▶ Starting AmiVets server on port ${PORT:-8000}..."
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1

# Clean up worker when uvicorn exits
kill $WORKER_PID 2>/dev/null || true
