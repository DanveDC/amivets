# Design

## Context

- `orden_service.py::crear_servicio_en_orden` (líneas 306-371): crea servicio en estado `SOLICITADO` siempre; el atajo sin despacho (CONSULTA, INSUMO, sin área) se resuelve en `confirmar_servicios` (línea 290-293) pasando a `EJECUTADO`.
- `orden_service.py::crear_linea_consulta` (líneas 474-508): usado por `POST /api/consultas/`; crea la línea CONSULTA directo en `EJECUTADO`, `area_id=NULL`, sin consumo (las consultas no tienen receta).
- `routers/ordenes.py::anexar_servicio_orden` (líneas 265-318): valida `tipo_servicio != 'CONSULTA'` (400), llama a `crear_servicio_en_orden`, commitea.
- `schemas.py`: 
  - `OrdenServicioAnexarServicio` (líneas 1206-1228): no tiene `veterinario_id`
  - `ServicioConsultaResponse` (líneas 214-297): tiene `asignado_a_nombre` (computed via model_validator), `estado_toma` (computed_field), pero no `veterinario_nombre` ni `area_nombre`
  - `AreaServicioResponse` (líneas 1333-1340): tiene `nombre`
- `models.py::ServicioConsulta` (líneas 343-451): tiene `asignado_a_id`, `area_id`, `estado`, `ejecutado_at`, relaciones `asignado_a`, `area`

## Goals / Non-Goals

**Goals:**
1. `crear_servicio_en_orden` detecta `tipo_servicio == 'CONSULTA'` y aplica atajo: `estado=EJECUTADO`, `area_id=NULL`, `asignado_a_id=orden.veterinario_id` (o body.veterinario_id), `ejecutado_at=now()`
2. `OrdenServicioAnexarServicio` gana `veterinario_id: Optional[int]` con validación de rol
3. `ServicioConsultaResponse` gana `veterinario_nombre` (alias de `asignado_a_nombre` para CONSULTA) y `area_nombre` (nombre de área o "NINGUNO")

**Non-Goals:**
- Cambiar el flujo de `POST /api/consultas/` (sigue usando `crear_linea_consulta`)
- Permitir anexar CONSULTA a orden CERRADA/FACTURADA/ANULADA (guard `asegurar_recibe_trabajo` sigue vigente)
- Cambiar el índice único `uq_orden_una_consulta` (máximo 1 CONSULTA viva por orden)

## Decisions

1. **Detección en `crear_servicio_en_orden`**: agregar branch temprano tras calcular `area_id`:
   ```python
   if tipo_servicio.strip().upper() == TIPO_SERVICIO_CONSULTA:
       veterinario_id = veterinario_id_body or orden.veterinario_id
       if not veterinario_id:
           raise HTTPException(422, "La orden no tiene veterinario asignado; indique veterinario_id en el body o asigne uno a la orden")
       # Validar que veterinario_id sea usuario con role='veterinario'
       _validar_veterinario(db, veterinario_id)
       
       servicio.estado = "EJECUTADO"
       servicio.area_id = None
       servicio.asignado_a_id = veterinario_id
       servicio.ejecutado_at = _ahora()
       # CONSULTA no dispara consumo (no tiene receta), igual que crear_linea_consulta
   ```
   
   El resto del flujo (flush, guardar consumo previsto, return) sigue igual.

2. **Validación de veterinario**: reutilizar `_validar_veterinario` de `routers/ordenes.py` (línea 59-72) — moverla a `orden_service.py` o importarla.

3. **Schema `OrdenServicioAnexarServicio`**: agregar `veterinario_id: Optional[int] = Field(None, gt=0)` con docstring explicando herencia.

4. **Schema `ServicioConsultaResponse`**: 
   - `veterinario_nombre`: computed_field que retorna `asignado_a_nombre` (ya resuelto por model_validator) — para CONSULTA es el vet ejecutor
   - `area_nombre`: computed_field que resuelve `area.nombre` si `area_id` cargado, sino `"NINGUNO"` si `area_id is None`, sino `None`
   - Requiere eager load de `area` en `obtener_orden(con_asignados=True)` (ya carga `servicios[].area` via selectinload? verificar)

5. **Eager load de `area`**: `obtener_orden(con_asignados=True)` (línea 58-62) ya hace `selectinload(OrdenServicio.servicios)` pero no `area`. Agregar `.selectinload(ServicioConsulta.area)`.

6. **Router `anexar_servicio_orden`**: quitar la validación que rechaza `tipo_servicio='CONSULTA'` (líneas 288-296) y pasar `veterinario_id` del body a `crear_servicio_en_orden`.

## Risks / Trade-offs

- **Duplicación de lógica de atajo**: `crear_linea_consulta` y `crear_servicio_en_orden` tendrán lógica similar para CONSULTA. Aceptable porque `crear_linea_consulta` vincula a una `Consulta` clínica (tiene `consulta_id`, `mascota_id` de la consulta, precio de `consulta.precio_consulta`), mientras que la versión directa es honorario suelto (sin consulta clínica, precio libre).
- **Validación de veterinario en service vs router**: mover `_validar_veterinario` a `orden_service.py` evita dependencia circular (router ya importa service).
- **Eager load de `area`**: `con_asignados=True` se usa solo en GET `/api/ordenes/{id}` (Panel del día). El costo marginal de cargar `area` es bajo (join a `areas_servicio`, tabla chica).
- **`area_nombre = "NINGUNO"` vs `None`**: string literal "NINGUNO" es más explícito para el front que `null`; el front puede mostrar badge "Sin área" sin lógica extra.
- **Comisiones de la CONSULTA directa**: sin `Consulta` detrás, `comision_service._filtro_encargado` no la atribuía a nadie. Se resuelve por `asignado_a_id` solo cuando `consulta_id IS NULL`; si hay consulta clínica, manda `Consulta.veterinario_id` (puede reasignarse y divergir de `asignado_a_id`).
