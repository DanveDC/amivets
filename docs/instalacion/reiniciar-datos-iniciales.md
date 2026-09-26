# Reiniciar la base a los datos iniciales

Deja una instalación local con los **datos iniciales**:

- el usuario admin;
- el padrón real de la clínica: 5 veterinarios, 263 propietarios y 318 mascotas;
- el catálogo de servicios (215 servicios).

Todo lo demás se borra: órdenes, facturas, consultas, inventario cargado, liquidaciones, etc. Antes de borrar, el script hace un respaldo.

## 1. El archivo de datos reales (no está en git)

El padrón real viene de los Excel de la clínica y está en:

```
backend/scripts/data/import-pacientes-v2.sql
```

Ese archivo **no está en el repositorio, y no se tiene que subir nunca**: tiene nombres, teléfonos y correos de clientes, y el repositorio es público (`.gitignore` lo excluye). En una máquina nueva, copialo a mano desde una que lo tenga, por ejemplo con un pendrive o `scp`, a esa misma ruta.

Si el archivo no está, el script no hace nada y te avisa.

## 2. Correr el reinicio

Con el stack levantado (`docker compose up -d`) y desde la raíz del repo:

```bash
bash backend/scripts/reiniciar_datos_iniciales.sh
```

El script:

1. Verifica que estén el archivo y los contenedores `veterinaria_db` y `veterinaria_backend`.
2. Pide que escribas `REINICIAR` para confirmar.
3. Guarda un respaldo en `backups/antes_de_reiniciar_<fecha>.dump`. La carpeta también está fuera de git.
4. Corre el reinicio oficial de `scripts/init_db.py` (`FORCE_RESET_DB` con su frase de confirmación). Ese reinicio borra y recrea las tablas, crea el admin, importa el padrón real y deja Alembic en la última migración.
5. Reinicia el backend, que siembra el catálogo si la tabla está vacía.
6. Muestra los conteos para que verifiques el resultado.

## 3. Volver atrás

Si necesitás recuperar lo que había antes del reinicio:

```bash
docker exec -i veterinaria_db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/antes_de_reiniciar_<fecha>.dump
```

## Notas

- El reinicio **se niega a correr con `ENVIRONMENT=production`**. Es para instalaciones locales o de prueba.
- Si corrés la suite e2e después del reinicio, los tests crean datos `PWTEST_*`. Corré los tests antes de empezar a cargar datos reales, o limpiá después.
