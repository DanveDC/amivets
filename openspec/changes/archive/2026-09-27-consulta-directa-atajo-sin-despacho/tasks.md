# Tasks

## 1. Backend - orden_service.py

- [x] 1.1 Mover/importar `_validar_veterinario` a `orden_service.py` (o crear helper local) para validar que un user_id corresponde a rol veterinario
- [x] 1.2 Modificar `crear_servicio_en_orden`:
  - Agregar parámetro `veterinario_id: Optional[int] = None`
  - Detectar `tipo_servicio.strip().upper() == TIPO_SERVICIO_CONSULTA`
  - Resolver `vet_id = veterinario_id or orden.veterinario_id`
  - Validar: si no hay `vet_id` → 422 "La orden no tiene veterinario asignado..."
  - Validar: `_validar_veterinario(db, vet_id)`
  - Aplicar atajo: `estado="EJECUTADO"`, `area_id=None`, `asignado_a_id=vet_id`, `ejecutado_at=_ahora()`
  - NO llamar `consumo_service.consumir_para_servicio` (CONSULTA no tiene receta, igual que `crear_linea_consulta`)
- [x] 1.3 Agregar `selectinload(ServicioConsulta.area)` en `obtener_orden(con_asignados=True)` para resolver `area_nombre` en response
- [x] 1.4 Test unitario: anexar CONSULTA con veterinario de orden → estado EJECUTADO, asignado_a_id correcto, area_id NULL
- [x] 1.5 Test unitario: anexar CONSULTA con veterinario_id explícito → usa el explícito
- [x] 1.6 Test unitario: anexar CONSULTA sin veterinario en orden ni body → 422
- [x] 1.7 Test unitario: anexar CONSULTA con veterinario_id inválido → 400
- [x] 1.8 Test unitario: segunda CONSULTA en misma orden → 409 (índice único)

## 2. Backend - schemas.py

- [x] 2.1 Agregar `veterinario_id: Optional[int] = Field(None, gt=0)` a `OrdenServicioAnexarServicio` con docstring
- [x] 2.2 En `ServicioConsultaResponse`:
  - Agregar `@computed_field @property def veterinario_nombre(self) -> Optional[str]: return self.asignado_a_nombre` (alias semántico para CONSULTA)
  - Agregar `@computed_field @property def area_nombre(self) -> Optional[str]:` que resuelve `self.area.nombre` si `self.area` cargado, `"NINGUNO"` si `self.area_id is None`, `None` si `self.area_id` no cargado
- [x] 2.3 Verificar que `OrdenServicioDetalleResponse.servicios[]` hereda los nuevos campos (ya usa `List[ServicioConsultaResponse]`)

## 3. Backend - routers/ordenes.py

- [x] 3.1 En `anexar_servicio_orden`: quitar validación que rechaza `tipo_servicio='CONSULTA'` (líneas 288-296)
- [x] 3.2 Extraer `veterinario_id` del body (`data.veterinario_id` si existe)
- [x] 3.3 Pasar `veterinario_id` a `orden_service.crear_servicio_en_orden(...)`
- [x] 3.4 Test: anexar CONSULTA sin body veterinario_id → usa orden.veterinario_id
- [x] 3.5 Test: anexar CONSULTA con body veterinario_id → usa el del body

## 4. Frontend - orden-abierta.js

- [x] 4.1 En renderizado de líneas de servicio: mostrar `servicio.veterinario_nombre` cuando exista (columna "Veterinario" o badge en la línea)
- [x] 4.2 Mostrar `servicio.area_nombre` (o "NINGUNO") en badge de área
- [x] 4.3 Verificar que `estado_toma` muestra "completada" para CONSULTA directa (ya debería funcionar via computed_field existente)

## 5. Tests E2E

- [x] 5.1 En `e2e/orden-servicio-carrito.spec.js` (o nuevo spec):
  - Escenario: orden con veterinario asignado → anexar CONSULTA directa → ver línea en EJECUTADO, veterinario_nombre, area_nombre="NINGUNO"
  - Escenario: orden sin veterinario → anexar CONSULTA con veterinario_id en body → ok
  - Escenario: orden sin veterinario → anexar CONSULTA sin veterinario_id → 422
  - Escenario: anexar CONSULTA con veterinario_id inválido → 400
  - Escenario: segunda CONSULTA → 409
  - Escenario: GET /api/ordenes/{id} incluye veterinario_nombre y area_nombre en todas las líneas
## 6. Backend - comisiones

- [x] 6.1 `comision_service._filtro_encargado`: una CONSULTA sin `consulta_id` se atribuye por `asignado_a_id`; con consulta clínica sigue mandando `Consulta.veterinario_id`
- [x] 6.2 Test E2E en `e2e/comisiones.spec.js`: la comisión de la CONSULTA directa va al veterinario ejecutor, no al de la orden
