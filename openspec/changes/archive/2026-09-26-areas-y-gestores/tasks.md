# Tasks

## 1. Roles y API

- [x] 1.1 Sumar "Recepcionista" y "Gestor de área" a los selects de rol de alta y edición de usuarios; verificar con el test de 3.1
- [x] 1.2 Agregar `GET /api/areas/{id}/gestores` (admin); verificar con el test de 3.1

## 2. Pantalla

- [x] 2.1 Crear `sec-areas` (markup), `static/js/sections/areas.js` y registrarla en el módulo Servicios (solo admin): áreas (crear, editar, desactivar), gestores (asignar, quitar) y servicios (asignar, quitar); verificar con el test de 3.1

## 3. Tests

- [x] 3.1 Crear `e2e/areas-y-gestores.spec.js`: crear un gestor con el rol nuevo, crear un área que exige adjunto, asignarle el gestor y un servicio desde la pantalla, confirmar una orden con ese servicio y verlo en la bandeja del gestor; y listar gestores por API; verificar que pasa
