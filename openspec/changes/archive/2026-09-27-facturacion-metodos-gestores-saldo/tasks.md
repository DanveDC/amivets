# Tasks

## 1. Migración Alembic - Abono.orden_id

- [x] 1.1 Generar migración: `cd backend && alembic revision -m "add orden_id to abonos table"`
  - Hecho a mano (no con `alembic revision --autogenerate`) siguiendo el estilo de las migraciones existentes: `backend/alembic/versions/a2b3c4d5e6f7_add_orden_id_to_abonos.py`, `down_revision='c1d2e3f4a5b6'` (head real, confirmado con `alembic heads` y caminando la cadena de `down_revision`).
- [x] 1.2 Editar upgrade(): agrega la columna sin FK inline (índice y FK nombrados por separado, ver decisión del orquestador): `op.add_column('abonos', sa.Column('orden_id', sa.Integer(), nullable=True))`, `op.create_foreign_key('fk_abonos_orden', 'abonos', 'ordenes_servicio', ['orden_id'], ['id'])`, `op.create_index('ix_abonos_orden_id', 'abonos', ['orden_id'])`. Idempotente (guardas `if ... not in cols/fks/indices`), mismo patrón que `e4f5a6b7c8d9_asignacion_directa_servicio_gestor.py`.
- [x] 1.3 Editar downgrade(): dropea índice, FK y columna en ese orden (también idempotente).
- [x] 1.4 Ejecutado `alembic upgrade head` contra la DB real del stack docker (`veterinaria_db`). Verificado con `\d abonos`: columna `orden_id`, `ix_abonos_orden_id`, `fk_abonos_orden` presentes. `alembic current` → `a2b3c4d5e6f7 (head)`.

## 2. Modelos (backend/app/models/models.py)

- [x] 2.1 En clase `Abono`: agregado `orden_id = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=True, index=True)` y `orden = relationship("OrdenServicio")`. `factura_id` se mantiene `NOT NULL` (decisión del orquestador: `orden_id` es un vínculo ADICIONAL, no excluyente).
- [x] 2.2 Imports verificados (ForeignKey, relationship ya importados en el módulo).

## 3. Schemas (backend/app/schemas/schemas.py)

- [x] 3.1 `AbonoCreate`: agregado `orden_id: Optional[int] = Field(None, gt=0)`.
- [x] 3.2 `AbonoResponse`: agregado `orden_id`, `orden_numero`, `model_config = ConfigDict(from_attributes=True)` y un `model_validator(mode='before')` que resuelve `orden_numero` desde `Abono.orden.numero` cuando el input es el objeto ORM (deja pasar dicts tal cual).
- [x] 3.3 Agregados `GestorPagoResponse` y `SaldoPendienteOrdenResponse` después de `AbonoResponse`. `FacturaHoyResponse` NO se creó como alias: el endpoint `/hoy` usa `FacturaResponse` directamente (permitido por este mismo task, "puede ser alias").

## 4. FacturacionService (backend/app/services/facturacion_service.py)

- [x] 4.1 Imports agregados: `date`, `time`, `timedelta`, `timezone` de `datetime`; `func` de sqlalchemy; `LiquidacionComision`, `LiquidacionComisionDetalle` de models.
- [x] 4.2 `obtener_hoy()` implementado tal como el diseño, verificado contra datos reales (100 facturas de hoy en el seed de e2e).
- [x] 4.3 `obtener_pagos_gestores()` implementado; verificado contra datos reales de liquidaciones ya existentes en la DB (incluye una fila con `total_ajustes` negativo, confirmando la suma algebraica de ajustes).
- [x] 4.4 `obtener_saldo_pendiente_orden()` implementado; usa `HTTPException` con `status.HTTP_404_NOT_FOUND` / `status.HTTP_409_CONFLICT` (misma convención que el resto del servicio). Verificado con 3 órdenes reales: CERRADA sin factura, FACTURADA con factura PENDIENTE, y ABIERTA (409).
- [x] 4.5 FUERA DE ALCANCE (decisión del usuario, 2026-09-27): no se agregan tests unitarios. `backend/tests/` no tiene infraestructura de tests con DB (sin `conftest.py` ni fixtures) y los 3 métodos hacen `db.query(...)` real. La cobertura funcional la dan los tests E2E de la sección 7, que ejercitan todos los escenarios listados acá contra los endpoints reales.

## 5. Router facturas (backend/app/routers/facturas.py)

- [x] 5.1 Imports agregados: `GestorPagoResponse`, `SaldoPendienteOrdenResponse`, `date`, `OrdenServicio`, `FacturaOrden`.
- [x] 5.2 `GET /api/facturas/hoy` — registrado ANTES de `GET /{factura_id}` para que "hoy" no se intente parsear como `factura_id: int` (path shadowing). Verificado con TestClient: sin token → 401 (no 422), con token admin → 200.
- [x] 5.3 `GET /api/facturas/gestores-pagos` — solo `require_roles("admin")`; valida formato de fecha y `hasta >= desde` con 422. Verificado: admin 200, recepcionista/veterinario 403, fecha inválida 422, rango invertido 422.
- [x] 5.4 `GET /api/facturas/orden/{orden_id}/saldo-pendiente` — verificado: orden inexistente 404.
- [x] 5.5 `POST /api/facturas/{factura_id}/abonar` actualizado: `orden_id` opcional, valida existencia (404), estado CERRADA/FACTURADA (409) y que la orden no esté vinculada a otra factura (409). Verificado end-to-end: abono válido con `orden_id` (201, incluye `orden_numero` en la respuesta), orden inexistente (404), orden ABIERTA (409), orden de otra factura (409).

## 6. Frontend (static/js/sections/facturacion.js)

- [x] 6.1 Pestaña "Hoy": tabla reusa columnas de factura (número, fecha, estado, total, método) + botón "Ver" (reusa `abrirPreviewFactura`). Llama `GET /api/facturas/hoy`. Verificado por e2e (Playwright, con browser real).
- [x] 6.2 Pestaña "Pagos a gestores" (solo admin, oculta con `hidden` para el resto y revelada en `initFacturacion()` via `getRole() === 'admin'`; el backend igual rechaza con 403): selector desde/hasta + botón "Calcular" + tabla. Verificado por e2e: visible para admin, oculta para veterinario.
- [x] 6.3 Columna "Saldo pendiente" en "Órdenes por cobrar": se resuelve por orden, de forma asíncrona (una llamada a `GET /api/facturas/orden/{id}/saldo-pendiente` por fila, después del primer render, para no bloquear la tabla). Badge de 3 estados: verde ($0 saldado), naranja (parcial), rojo (nada cobrado). Verificado por e2e.
- [x] 6.4 Modal de abono: agregado `<select id="abonoOrdenId">` que se puebla con las órdenes CERRADA/FACTURADA del propietario de la factura (`GET /api/ordenes/?propietario_id=&estado=CERRADA,FACTURADA`); si se elige una, se manda `orden_id` en el body de `/abonar`. `abrirModalAbono` ahora recibe `propietarioId` como 3er argumento opcional (actualizados los 2 call sites: historial y preview de factura).

## 7. Tests E2E

- [x] 7.1 Creado `e2e/facturacion-metodos-gestores-saldo.spec.js` (17 tests, corridos contra el stack docker real — TODOS PASAN):
  - Facturas de hoy: factura recién creada aparece en `/hoy`; filtro de estado la excluye correctamente.
  - Pagos a gestores: liquidación real de un gestor PORCENTAJE 20% → totales correctos (`total_encargado`, `total_amivets`, `cantidad_lineas`, `total_ajustes`); rango sin liquidaciones → `[]`; permisos (403 recepcionista/veterinario); 422 fecha inválida / rango invertido.
  - Saldo pendiente orden: FACTURADA con factura PARCIAL (saldo = `factura.saldo_pendiente`); CERRADA sin factura (saldo = total de ítems pendientes); ABIERTA (409); inexistente (404); factura anulada (saldo vuelve a ítems pendientes, no la factura muerta); orden refacturada tras anular (saldo muestra la factura nueva, no la anulada).
  - Abono con `orden_id`: abono válido (incluye `orden_numero`); orden de otra factura (409); orden inexistente (404).
  - Pantalla: pestañas "Hoy"/"Pagos a gestores" (visibilidad por rol) y columna "Saldo pendiente" en "Órdenes por cobrar".

## 8. Verificación

- [x] 8.1 Backend arranca sin errores: `docker exec veterinaria_backend python -c "from app.main import app"` OK; contenedor reiniciado (`docker restart veterinaria_backend`), logs muestran `Application startup complete` sin errores.
- [x] 8.2 OpenAPI docs muestran los nuevos endpoints y schemas: `/api/facturas/hoy`, `/api/facturas/gestores-pagos`, `/api/facturas/orden/{orden_id}/saldo-pendiente` presentes en `openapi()['paths']`; `AbonoCreate`, `AbonoResponse`, `GestorPagoResponse`, `SaldoPendienteOrdenResponse` presentes en `components.schemas` con los campos nuevos.
- [x] 8.3 Migración aplicada correctamente: `alembic current` → `a2b3c4d5e6f7 (head)`; columna/índice/FK verificados con `\d abonos` en `psql`.
- [x] 8.4 Tests E2E pasan: `npx playwright test e2e/facturacion-metodos-gestores-saldo.spec.js` → 17/17 passed (incluye los 2 casos de factura anulada/refacturada agregados tras la revisión). Además se corrieron sin regresiones `comision-tipo-mixto.spec.js`, `servicio-directo.spec.js` y `regresiones-revision.spec.js` (42/42 passed) para confirmar que los cambios en `facturas.py`/`facturacion_service.py`/`schemas.py`/`models.py` no rompieron flujos existentes.
