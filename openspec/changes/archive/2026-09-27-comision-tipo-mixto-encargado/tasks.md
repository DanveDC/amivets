# Tasks

## 1. Migración Alembic

- [x] 1.1 Generar migración: `cd backend && alembic revision -m "add tipo_comision and monto_fijo to comision_encargados, catalogo_servicios, liquidacion_comision_detalles"`
- [x] 1.2 Editar upgrade():
  - `comision_encargados`: ADD `tipo_comision` VARCHAR(20) NOT NULL DEFAULT 'PORCENTAJE', ADD `monto_fijo` NUMERIC(10,2) NULL, ALTER `porcentaje` DROP NOT NULL
  - ADD CHECK constraints: `ck_comision_encargado_tipo`, `ck_comision_encargado_campos`
  - `catalogo_servicios`: ADD `tipo_comision_servicio` VARCHAR(20) NOT NULL DEFAULT 'HEREDA', ADD `monto_fijo_servicio` NUMERIC(10,2) NULL, ADD `porcentaje_servicio` NUMERIC(5,2) NULL
  - ADD CHECK constraint `ck_catalogo_comision_campos`
  - `liquidacion_comision_detalles`: ADD `tipo_comision` VARCHAR(20) NOT NULL DEFAULT 'PORCENTAJE', ADD `monto_fijo` NUMERIC(10,2) NULL
  - Backfill: UPDATE `liquidacion_comision_detalles` SET `tipo_comision`='PORCENTAJE' WHERE `tipo_comision` IS NULL
- [x] 1.3 Editar downgrade(): DROP COLUMNS en orden inverso
- [x] 1.4 Ejecutar: `alembic upgrade head` y verificar en DB

## 2. Modelos (backend/app/models/models.py)

- [x] 2.1 Modificar `ComisionEncargado`: agregar `tipo_comision`, `monto_fijo`, hacer `porcentaje` nullable, agregar CHECK constraints
- [x] 2.2 Modificar `CatalogoServicio`: agregar `tipo_comision_servicio`, `monto_fijo_servicio`, `porcentaje_servicio`, CHECK constraint
- [x] 2.3 Modificar `LiquidacionComisionDetalle`: agregar `tipo_comision`, `monto_fijo`
- [x] 2.4 Verificar imports y relaciones

## 3. Schemas (backend/app/schemas/schemas.py)

- [x] 3.1 Actualizar `PorcentajeEncargadoUpdate` → `ComisionEncargadoUpdate` con `tipo_comision`, `monto_fijo`, validador cruzado
- [x] 3.2 Actualizar `EncargadoComisionResponse`: agregar `tipo_comision`, `monto_fijo`, mantener `porcentaje_efectivo` (compat)
- [x] 3.3 Actualizar `CatalogoServicioBase/Create/Update/Response`: agregar `tipo_comision_servicio`, `monto_fijo_servicio`, `porcentaje_servicio` con validador
- [x] 3.4 Actualizar `ComisionLineaResponse`: agregar `tipo_comision_usado`, `monto_fijo_usado`, `porcentaje_usado`
- [x] 3.5 Actualizar `LiquidacionComisionDetalle` response si existe (verificar)

## 4. Servicio de comisiones (backend/app/services/comision_service.py)

- [x] 4.1 Agregar `_repartir_con_tipo(subtotal, tipo, monto_fijo, porcentaje) -> dict` (nueva función core)
- [x] 4.2 Agregar `calcular_comision(db, subtotal, encargado_id, servicio=None, catalogo_servicio=None) -> dict`
- [x] 4.3 Modificar `lineas_pendientes()`:
  - Eager load `servicio.catalogo_servicio` en query `_pares_cobrados`
  - Para cada par, llamar `calcular_comision(db, cobrado, encargado_id, servicio, catalogo)`
  - Usar valores retornados para `Linea`
- [x] 4.4 Modificar `ajustes_pendientes()`:
  - Leer `tipo_comision` y `monto_fijo` del detalle congelado
  - Usar `_repartir_con_tipo(-subtotal, tipo_congelado, monto_fijo_congelado, porcentaje_congelado)`
  - Nota de implementación: el ajuste niega los montos congelados en vez de recalcular (el resultado es idéntico porque `_repartir_con_tipo` es simétrico en el signo, pero así el ajuste revierte exactamente lo pagado aunque cambie el redondeo o las reglas).
- [x] 4.5 Modificar `liquidar()`:
  - En cada `Linea` incluir `tipo_comision_usado`, `monto_fijo_usado`
  - Al crear `LiquidacionComisionDetalle`, setear `tipo_comision`, `monto_fijo`
- [x] 4.6 Modificar `control()`: incluir campos nuevos en respuesta de pendientes y liquidadas
- [x] 4.7 Tests unitarios (`backend/tests/test_comision_tipo.py`; liquidación/ajustes cubiertos en el e2e):
  - `calcular_comision` con cada tipo (FIJO, PORCENTAJE, MIXTO)
  - Override por catálogo (servicio manda sobre encargado)
  - Cap monto_fijo > subtotal
  - Ajustes negativos con tipos congelados
  - Liquidación copia campos congelados

## 5. Router comisiones (backend/app/routers/comisiones.py)

- [x] 5.1 Actualizar endpoint `PATCH /api/comisiones/encargados/{usuario_id}` para aceptar nuevo schema
  - Nota de implementación: el endpoint real es `PUT` y se mantuvo. Sin `tipo_comision` ni valores quita la comisión propia (vuelve al defecto); sin tipo pero con `porcentaje` es PORCENTAJE (compat con el payload anterior).
- [x] 5.2 Actualizar `GET /api/comisiones/encargados` para devolver `tipo_comision`, `monto_fijo`
- [x] 5.3 Actualizar `GET /api/comisiones/control/{encargado_id}` para incluir `tipo_comision_usado`, `monto_fijo_usado`, `porcentaje_usado` en cada línea
- [x] 5.4 Tests: config encargado FIJO/MIXTO, control muestra tipos correctos

## 6. Frontend

- [x] 6.1 Pantalla configuración comisiones (`comisiones.js` o similar):
  - Select `tipo_comision` (FIJO/PORCENTAJE/MIXTO)
  - Campos condicionales: `monto_fijo` visible si FIJO/MIXTO, `porcentaje` visible si PORCENTAJE/MIXTO
  - Validación frontend coherente con backend
- [x] 6.2 Catálogo de servicios (`catalogo-servicios.js`):
  - Agregar selector `tipo_comision_servicio` (FIJO/PORCENTAJE/HEREDA)
  - Campos condicionales `monto_fijo_servicio`, `porcentaje_servicio`
- [x] 6.3 Control de comisiones: mostrar columnas `Tipo`, `Monto Fijo`, `%` en tabla de líneas

## 7. Tests E2E

- [x] 7.1 Crear `e2e/comision-tipo-mixto.spec.js`:
  - Configurar encargado PORCENTAJE 20% → liquidar → verificar líneas
  - Configurar encargado FIJO $100 → liquidar → verificar monto_encargado = 100 (cap a subtotal)
  - Configurar encargado MIXTO $50 + 10% → liquidar → verificar 50 + 10%
  - Crear servicio catálogo FIJO $200, encargado PORCENTAJE 20% → liquidar servicio → usa $200 (override)
  - Cambiar config encargado tras liquidar → liquidación histórica no cambia
  - Ajuste por factura anulada respeta tipo congelado
  - Frontend: crear/editar encargado con tipos, catálogo con override