# Proposal

## Why

- Al abrir una orden desde el Panel del día, elegir el paciente crea la orden en el acto, sin asignarle un veterinario, así que la orden no aparece en el panel del veterinario (que solo ve las suyas).
- La tabla del Panel del día no muestra qué veterinario tiene cada orden.
- Propietarios no tiene su propia entrada en el menú: solo se llega desde un botón de Mascotas.
- Al elegir un tutor en la búsqueda global, la app lleva al listado general de propietarios en lugar de mostrar sus mascotas; y los selectores de propietario (nueva mascota, transferencia) piden `/propietarios/` sin límite y el API corta en 100, así que dos tercios de los tutores reales (263) no aparecen.
- No hay una forma documentada de reiniciar los datos a los iniciales (padrón real) en otra máquina.

## What Changes

- **Abrir orden:** elegido el paciente, se abre un paso para asignar el veterinario (obligatorio para el admin y la recepción; un veterinario se asigna a sí mismo) y el motivo. La orden se crea con `veterinario_id` y aparece en el panel de ese veterinario. La pantalla de la orden permite cambiar el veterinario (`PUT /ordenes/{id}/veterinario`, ya existe).
- **Panel del día:** nueva columna "Veterinario".
- **Menú:** el módulo Mascotas/Tutores muestra dos entradas, "Mascotas" y "Propietarios", además de Historia clínica.
- **Tutor → mascotas:** elegir un tutor en la búsqueda global muestra todas sus mascotas; los selectores de propietario cargan todos los tutores.
- **Datos iniciales:** script `backend/scripts/reiniciar_datos_iniciales.sh` y guía `docs/instalacion/reiniciar-datos-iniciales.md`. El SQL con los datos reales sigue fuera de git (el repositorio es público).

## Capabilities

### New Capabilities
- `orden-veterinario-y-tutores`: asignación de veterinario al abrir una orden, visibilidad del veterinario en el panel, navegación de propietarios y sus mascotas, y reinicio de datos iniciales.

### Modified Capabilities
*(Ninguna con spec principal.)*

## Impact

- Frontend: `hoy.js`, `orden-abierta.js`, `propietarios.js`, `consultorio.js`, `core/cmdk.js`, `core/router.js`, `index.html`.
- Backend: sin cambios de API (usa `POST /ordenes/` con `veterinario_id` y `PUT /ordenes/{id}/veterinario`).
- Scripts y docs de reinicio de datos.
- Test: `e2e/orden-veterinario-y-tutores.spec.js`.
