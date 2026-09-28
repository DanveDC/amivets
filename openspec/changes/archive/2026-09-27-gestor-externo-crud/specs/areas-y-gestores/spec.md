# areas-y-gestores Specification (Delta)

## Purpose
Extender la gestión de áreas y gestores con soporte para gestores externos (proveedores, laboratorios de referencia, especialistas) que no son usuarios del sistema pero reciben trabajo despachado a sus áreas.

## ADDED Requirements

### Requirement: Tabla GestorExterno

El sistema SHALL proveer una tabla `gestores_externos` con los siguientes campos:
- `id` (Integer, PK, autoincrement)
- `nombre` (String(120), not null) — razón social o nombre del proveedor, visible en la UI
- `rif` (String(20), único, not null) — identificación fiscal
- `telefono` (String(20), not null)
- `metodo_pago` (String(50), not null) — uno de "TRANSFERENCIA", "EFECTIVO", "ZELLE", "CHEQUE", "OTRO" (CHECK constraint)
- `numero_cuenta` (String(50), nullable) — cuenta bancaria para pagos
- `es_movil` (Boolean, default false) — indica si el teléfono es móvil (para WhatsApp/SMS)
- `zelle` (String(100), nullable) — email/teléfono Zelle para pagos internacionales
- `usuario_id` (Integer, FK a `usuarios.id`, nullable) — vinculación opcional a usuario interno
- `activo` (Boolean, default true) — para soft delete/desactivación
- `created_at` (DateTime, server_default now())

#### Scenario: Crear gestor externo completo
- **WHEN** admin envía POST con todos los campos
- **THEN** se crea el registro con `activo=true`, `created_at` automático

#### Scenario: RIF duplicado
- **WHEN** se intenta crear gestor con RIF ya existente
- **THEN** respuesta 409 "RIF ya registrado"

#### Scenario: usuario_id opcional
- **WHEN** se crea gestor sin `usuario_id`
- **THEN** queda `NULL` (gestor puramente externo)
- **WHEN** se vincula a un `usuario_id` existente
- **THEN** se valida que el usuario exista

### Requirement: Relación N:M GestorExterno ↔ AreaServicio

El sistema SHALL proveer tabla pivote `gestor_area_externo`:
- `id` (Integer, PK)
- `gestor_externo_id` (FK a `gestores_externos.id`, ON DELETE CASCADE, not null)
- `area_id` (FK a `areas_servicio.id`, ON DELETE CASCADE, not null)
- `created_at` (DateTime, server_default now())
- UniqueConstraint(`gestor_externo_id`, `area_id`)

#### Scenario: Asignar gestor externo a área
- **WHEN** admin asigna gestor externo a "LABORATORIO"
- **THEN** se crea fila en `gestor_area_externo`
- **AND** el gestor externo recibe notificaciones de servicios despachados a esa área

#### Scenario: Desasignar gestor externo de área
- **WHEN** admin quita la asignación
- **THEN** se elimina la fila de `gestor_area_externo`
- **AND** el gestor ya no recibe notificaciones de esa área

#### Scenario: Duplicado gestor-área
- **WHEN** se intenta asignar mismo gestor a misma área dos veces
- **THEN** respuesta 409 "El gestor ya está asignado a esa área"

### Requirement: CRUD GestorExterno (solo admin)

El sistema SHALL exponer endpoints REST bajo `/api/gestores-externos/`:
- `GET /api/gestores-externos/` — lista paginada con filtros (activo, área)
- `GET /api/gestores-externos/{id}` — detalle con áreas asignadas
- `POST /api/gestores-externos/` — crear (validar RIF único, usuario_id existe si se manda)
- `PATCH /api/gestores-externos/{id}` — actualizar (RIF editable solo si NO tiene áreas asignadas; desactivar con `activo=false`)
- `DELETE /api/gestores-externos/{id}` — hard delete solo si no tiene áreas NI notificaciones; 409 en cualquier otro caso (se desactiva vía PATCH)

#### Scenario: Listar con filtro por área
- **WHEN** GET `?area_id=3`
- **THEN** solo gestores asignados a esa área

#### Scenario: DELETE bloqueado con áreas asignadas
- **WHEN** DELETE gestor que tiene filas en `gestor_area_externo`
- **THEN** respuesta 409 "Tiene áreas asignadas, desactive el gestor en su lugar"
- **AND** el registro y sus asignaciones no cambian

#### Scenario: DELETE bloqueado con historial de notificaciones
- **WHEN** DELETE gestor sin áreas pero con filas en `notificaciones` (`gestor_externo_id`)
- **THEN** respuesta 409 "El gestor tiene historial de notificaciones, desactívelo en su lugar"
- **AND** el gestor y su historial no cambian

#### Scenario: Hard delete sin áreas ni historial
- **WHEN** DELETE gestor sin filas en `gestor_area_externo` ni en `notificaciones`
- **THEN** respuesta 204 y el registro se elimina

#### Scenario: Desactivar (soft delete) con áreas asignadas
- **WHEN** PATCH `{activo: false}` sobre gestor con áreas
- **THEN** se pone `activo=false`, se conservan asignaciones para auditoría
- **AND** deja de recibir notificaciones

#### Scenario: RIF inmutable con áreas asignadas
- **WHEN** PATCH cambia `rif` de un gestor que tiene áreas asignadas
- **THEN** respuesta 422 "El RIF no puede cambiarse con áreas asignadas"
- **WHEN** PATCH cambia `rif` de un gestor sin áreas
- **THEN** se actualiza (normalizado a mayúsculas; 409 si colisiona con otro RIF)

### Requirement: Gestión de asignaciones área-gestor externo

El sistema SHALL exponer endpoints bajo `/api/gestores-externos/{id}/areas/`:
- `GET` — lista de áreas asignadas (id, codigo, nombre)
- `POST` — asignar área (body: `{area_id}`)
- `DELETE /{area_id}` — desasignar área

#### Scenario: Asignar área a gestor inactivo o inexistente
- **WHEN** POST `{area_id}` con gestor `activo=false`
- **THEN** respuesta 409
- **WHEN** el `area_id` no existe
- **THEN** respuesta 404

#### Scenario: Desasignar área no asignada
- **WHEN** DELETE `/{area_id}` sin fila en `gestor_area_externo`
- **THEN** respuesta 404

### Requirement: Integración con despacho de servicios

Cuando un servicio se confirma y va a un área (`confirmar_servicios`), además de notificar a gestores internos (`GestorArea`), SHALL notificar a gestores externos activos de esa área (`GestorAreaExterno` → `GestorExterno` con `activo=true`).

#### Scenario: Notificación a gestor externo
- **WHEN** se confirma orden con servicio de área "LABORATORIO" que tiene gestor externo asignado
- **THEN** se crea notificación `SERVICIO_ASIGNADO_EXTERNO` con `destinatario_id=NULL`, `gestor_externo_id` del gestor, canal APP
- **AND** el gestor externo ve el servicio en su bandeja (futuro: portal externo o email)

#### Scenario: Asignación directa no notifica externos
- **WHEN** el servicio se confirma con asignación directa a un gestor interno (`asignado_directo_a_id`)
- **THEN** solo se notifica a ese gestor; no se crean notificaciones externas

#### Scenario: Área solo con gestores externos
- **WHEN** el área no tiene gestores internos activos pero sí externos activos
- **THEN** se notifica a los externos Y se mantiene la alerta `SERVICIO_SIN_GESTOR` a los admins (los externos no tienen portal para operar la bandeja)

#### Scenario: Integridad del destinatario
- **THEN** toda notificación tiene exactamente uno de `destinatario_id` o `gestor_externo_id` (CHECK XOR)
- **AND** la FK `notificaciones.gestor_externo_id` es ON DELETE RESTRICT: la base impide borrar un gestor con historial