# Design

## Context

- `hoy.js::abrirNuevaOrdenFlow` abre el selector de mascota y crea la orden con `{propietario_id, mascota_id}` al elegir.
- `POST /api/ordenes/` acepta `veterinario_id` y `motivo_visita`; `PUT /api/ordenes/{id}/veterinario` ya existe. `GET /api/ordenes/` devuelve `veterinario_nombre`. El Panel del día filtra por `veterinario_id` para el rol veterinario.
- `sec-propietarios` está registrada con `tab:false` y fuera de los `sectionIds` del módulo 3.
- `cmdk.js::activate` lleva un resultado de propietario a `sec-propietarios` sin filtrar. `propietarios.js::verMascotasPropietario` ya muestra todas las mascotas del tutor.
- `consultorio.js` pide `/propietarios/` sin `limit` para los selectores de alta y transferencia: el API devuelve 100.
- `init_db.py` ya tiene el reinicio oficial (`FORCE_RESET_DB` + frase de confirmación) y el catálogo se siembra solo al arrancar si está vacío. El SQL real vive en `backend/scripts/data/` (git-ignored).

## Goals / Non-Goals

**Goals:** asignar veterinario al abrir; mostrarlo; navegación de propietarios; todas las mascotas; reinicio reproducible.
**Non-Goals:** subir datos personales al repositorio; cambiar la API de órdenes.

## Decisions

1. **Modal "Abrir orden".** Nuevo `#modalAbrirOrden` (paciente elegido, select de veterinario desde `/usuarios/veterinarios`, motivo). Para el rol veterinario el select viene preseleccionado con él mismo. Confirmar hace `POST /ordenes/` con `veterinario_id` y abre la orden.
2. **Cambiar veterinario en la orden.** En el resumen de `orden-abierta` se muestra el veterinario con un select que llama `PUT /ordenes/{id}/veterinario`.
3. **Columna Veterinario** en la tabla del Panel del día (`o.veterinario_nombre || 'Sin asignar'`, escapado).
4. **Menú.** `sec-propietarios` pasa a `tab:true` y entra en `sectionIds` del módulo 3 (roles de Mascotas).
5. **Tutor en la búsqueda global** llama `verMascotasPropietario(id)`. Los selectores de propietario piden `/propietarios/?activo=true&limit=1000`.
6. **Reinicio de datos.** `backend/scripts/reiniciar_datos_iniciales.sh`: exige el SQL en `backend/scripts/data/import-pacientes-v2.sql`, hace un `pg_dump` de respaldo, corre `init_db.py` con el reinicio oficial y reinicia el backend para sembrar el catálogo. La guía explica de dónde sacar el archivo (fuera de git) y los comandos.

## Risks / Trade-offs

- [Datos personales] El archivo real no viaja por git; hay que copiarlo a mano a la otra máquina. Es a propósito: el repositorio es público.
