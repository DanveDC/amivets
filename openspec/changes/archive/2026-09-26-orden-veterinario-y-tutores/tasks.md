# Tasks

## 1. Abrir orden con veterinario

- [x] 1.1 Agregar `#modalAbrirOrden` y cambiar `hoy.js::abrirNuevaOrdenFlow` para pedir veterinario (obligatorio para admin/recepción, preseleccionado para veterinario) y motivo antes de crear la orden; verificar con el test de 1.4
- [x] 1.2 Mostrar y permitir cambiar el veterinario en la pantalla de la orden (`PUT /ordenes/{id}/veterinario`); verificar con el test de 1.4
- [x] 1.3 Sumar la columna "Veterinario" a la tabla del Panel del día; verificar con el test de 1.4
- [x] 1.4 Crear `e2e/orden-veterinario-y-tutores.spec.js`: el admin abre una orden asignando un veterinario, la ve con su nombre en el panel, sin veterinario no se crea, el veterinario la ve en su panel, y se puede cambiar desde la orden; verificar que pasa

## 2. Propietarios y sus mascotas

- [x] 2.1 Dar a `sec-propietarios` entrada propia en el módulo Mascotas/Tutores; verificar con el test de 2.4
- [x] 2.2 Llevar un tutor elegido en la búsqueda global a todas sus mascotas (`verMascotasPropietario`); verificar con el test de 2.4
- [x] 2.3 Cargar todos los propietarios en los selectores de alta y transferencia de mascota; verificar con el test de 2.4
- [x] 2.4 Sumar al spec: entrada "Propietarios" en el menú, tutor con varias mascotas desde la búsqueda global y desde Propietarios, y selector de propietario con más de 100 tutores; verificar que pasa

## 3. Reinicio de datos iniciales

- [x] 3.1 Crear `backend/scripts/reiniciar_datos_iniciales.sh` y `docs/instalacion/reiniciar-datos-iniciales.md`; verificar los chequeos previos del script (falta el SQL → aborta; sin confirmar → cancela). El reinicio en sí es `init_db.py` con `FORCE_RESET_DB`, ya verificado contra la base local con los conteos esperados (6 usuarios, 263 propietarios, 318 mascotas, 215 servicios); no se volvió a correr para no borrar una orden real abierta por el usuario
