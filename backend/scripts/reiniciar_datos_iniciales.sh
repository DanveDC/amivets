#!/usr/bin/env bash
# Reinicia la base local a los DATOS INICIALES: admin, padrón real
# (veterinarios, propietarios, mascotas) y catálogo de servicios.
# Borra TODO lo demás (órdenes, facturas, consultas, inventario cargado...).
#
# Requisitos:
#   - Stack de Docker levantado (contenedores veterinaria_db y veterinaria_backend).
#   - El archivo de datos reales en backend/scripts/data/import-pacientes-v2.sql.
#     NO está en git (tiene datos personales de clientes y el repositorio es
#     público): se copia a mano desde una máquina que lo tenga.
#
# Uso (desde la raíz del repo):
#   bash backend/scripts/reiniciar_datos_iniciales.sh
#
# Ver docs/instalacion/reiniciar-datos-iniciales.md
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL="$RAIZ/backend/scripts/data/import-pacientes-v2.sql"
DB=veterinaria_db
BACKEND=veterinaria_backend

if [ ! -f "$SQL" ]; then
  echo "Falta $SQL"
  echo "Copialo desde una máquina que lo tenga (no está en git). Ver docs/instalacion/reiniciar-datos-iniciales.md"
  exit 1
fi
for c in "$DB" "$BACKEND"; do
  if ! docker ps --format '{{.Names}}' | grep -qx "$c"; then
    echo "El contenedor $c no está corriendo. Levantá el stack con docker compose up -d."
    exit 1
  fi
done

read -r -p "Esto BORRA todos los datos de la base local y la deja con los datos iniciales. Escribí REINICIAR para seguir: " OK
if [ "$OK" != "REINICIAR" ]; then
  echo "Cancelado."
  exit 1
fi

mkdir -p "$RAIZ/backups"
BACKUP="$RAIZ/backups/antes_de_reiniciar_$(date +%Y%m%d_%H%M%S).dump"
echo "Respaldo previo en $BACKUP"
docker exec "$DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"

echo "Reiniciando la base (reinicio oficial de scripts/init_db.py)..."
docker exec -w /app -e FORCE_RESET_DB=true -e FORCE_RESET_DB_CONFIRM=ELIMINAR_TODOS_LOS_DATOS \
  "$BACKEND" python scripts/init_db.py > /dev/null

echo "Reiniciando el backend para sembrar el catálogo de servicios..."
docker restart "$BACKEND" > /dev/null
sleep 15

docker exec "$DB" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F": " -c "
  select '"'"'usuarios'"'"', count(*) from usuarios union all
  select '"'"'propietarios'"'"', count(*) from propietarios union all
  select '"'"'mascotas'"'"', count(*) from mascotas union all
  select '"'"'catalogo_servicios'"'"', count(*) from catalogo_servicios"'
echo "Listo. Esperado: 6 usuarios, 263 propietarios, 318 mascotas, 215 servicios."
