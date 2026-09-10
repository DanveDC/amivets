# Flujo consulta → servicios (Tarea 09) — Diseño

> FASE 1 de `docs/tareas/09-servicios-desde-la-consulta.md`. Sin código hasta
> aprobación. Este documento fija las 8 decisiones, su fundamento y el impacto
> verificado contra el código actual (rama `redesign/minimalist-ui`).

---

## 1. Estado actual — verificado, no asumido

### 1.1 El modelo ya unifica; la fragmentación es de UI

`ServicioConsulta` (`backend/app/models/models.py:194`) es el nodo pivote. Campos
reales hoy:

| Campo | Tipo | Nota |
|---|---|---|
| `consulta_id` | `Integer FK`, **`nullable=False`** | el obstáculo central |
| `tipo_servicio` | `String(50)` | `VACUNACION`, `CIRUGIA`, `HOSPITALIZACION`, `LABORATORIO`, `INSUMO`, `ESTETICA`, y en la práctica también `DESPARASITACION`, `PROCEDIMIENTO`, `DIAGNOSTICO` (texto libre, sin enum) |
| `referencia_id` | `Integer`, nullable | id de la tabla clínica de detalle |
| `catalogo_servicio_id` | `Integer FK`, nullable | **nuevo (Tarea 07)** — ancla al catálogo, sin backfill |
| `nombre_servicio` | `String(255)` | denormalizado |
| `cantidad` | `Float` | ya es Float |
| `precio_unitario` | `Float` | **snapshot al anexar**, no vive atado al historial de precios (Tarea 08) |
| `estado` | `String(50)` | `Pendiente` / `Aplicado` / `Cancelado` (este último lo pone el soft-delete) |
| `detalles_clinicos` | `Text` | lote, dosis, hallazgos |
| `facturado` | `Boolean` | |
| `is_deleted` | `Boolean` | soft-delete de auditoría |

Relaciones a stock ya existentes: `movimientos` (`MovimientoInventario`),
`consumos_material` (`ConsumoMaterial`). O sea: el carrito heterogéneo por
consulta **ya está resuelto en el modelo y en el ledger de inventario**.

### 1.2 El obstáculo es triple, no solo el modelo

"Agregar servicio directo" está bloqueado en **tres capas**:

1. **Modelo**: `ServicioConsulta.consulta_id` es `nullable=False`
   (`models.py:199`).
2. **Schema**: `ServicioConsultaBase.consulta_id: int` — requerido, sin default
   (`schemas.py:167`).
3. **Ruteo**: no existe `/api/servicios`. La única puerta es
   `POST /api/consultas/{consulta_id}/servicios` (`routers/consultas.py:153`).
   El id sale del path.

Misma inconsistencia que marca la tarea, confirmada:

| Tabla | `consulta_id` |
|---|---|
| `ServicioConsulta` | **NOT NULL** (`models.py:199`) |
| `Vacunacion` | **NOT NULL** (`models.py:614`) |
| `Desparasitacion` | **NOT NULL** (`models.py:630`) |
| `PruebaComplementaria` | nullable (`models.py:265`) |
| `Cirugia` | nullable (`models.py:547`) |
| `Hospitalizacion` | nullable (`models.py:517`) |

Además: **`Consulta.veterinario_id` es `nullable=False`** (`models.py:152`). No
se puede crear una consulta sin veterinario asignado. Esto pesa fuerte en la
Decisión 1.

### 1.3 Las 8 relaciones de `Consulta` — cuáles se llenan y por quién

`pruebas`, `recetas`, `vacunaciones`, `desparasitaciones`, `cirugias`,
`hospitalizaciones`, `servicios`, `facturas` (`models.py:160-172`).

| Relación | Quién escribe | ¿Viva? |
|---|---|---|
| `servicios` | `POST /consultas/{id}/servicios` (carrito UI) **+ espejo automático** desde `routers/clinico.py` para vacuna/desparasitación/cirugía/hospitalización/prueba cuando hay `consulta_id` | **Sí, es la principal** |
| `vacunaciones` | `POST /api/clinico/vacunacion` — que además crea un `ServicioConsulta` espejo (`clinico.py:69`) | Sí, bajo volumen (4) |
| `desparasitaciones` | `POST /api/clinico/desparasitacion` — ídem espejo (`clinico.py:143`) | Sí, bajo volumen (4) |
| `cirugias` | `routers/clinico.py` (con espejo si hay consulta) y `routers/cirugias.py` (sin espejo) | Sí (23) |
| `hospitalizaciones` | `routers/clinico.py` (con espejo) y `routers/hospitalizaciones.py` | Sí (42) |
| `pruebas` | `routers/clinico.py` (con espejo) y `routers/pruebas.py` | Sí (4) |
| `recetas` | `POST /consultas/{id}/recetas` | Sí (113) |
| `facturas` | `POST /api/facturas/` con `consulta_id` | Sí (3) |

Volúmenes de la base (memoria de auditoría, agosto 2026): `servicios_consulta`
79, `cirugias` 23, `hospitalizaciones` 42, `recetas` 113, `vacunaciones` 4,
`desparasitaciones` 4, `pruebas` 4, `facturas` 3.

**Doble escritura confirmada.** `routers/clinico.py` graba la fila de detalle
(`Vacunacion`, etc.) **y** un `ServicioConsulta` espejo con
`referencia_id` → detalle. La vacuna existe dos veces.

**Doble conteo en facturación confirmado.**
`FacturacionService.obtener_items_pendientes_consulta`
(`services/facturacion_service.py:337`) recorre `consulta.servicios` (agarra el
espejo) **y además** `consulta.vacunaciones` / `pruebas` / `cirugias` /
`hospitalizaciones` / `desparasitaciones` (agarra el original). Si ambos están
sin `facturado`, la línea se propone dos veces. Es deuda preexistente, y la
Decisión 2 la tiene que cerrar.

### 1.4 Impacto en facturación, liquidaciones y reportes

**Facturación** (`services/facturacion_service.py`):
`FacturaCreate.detalles[]` lleva `producto_id` y `servicio_id`.
`crear_factura` descuenta stock solo si hay `producto_id` y el consumo no está
ya en el ledger (`_consumo_en_ledger`). `Factura.consulta_id` **ya es
`nullable=True`** (`models.py:366`) — una factura sin consulta ya es un caso
soportado por el modelo.

**Liquidaciones** (`routers/liquidaciones.py`):
`LiquidacionDetalle.consulta_id` es **`unique` + `NOT NULL`** (`models.py:459`).
`_consultas_elegibles` hace `JOIN Factura ON Factura.consulta_id == Consulta.id`
con `Factura.estado == "PAGADA"` y `Consulta.veterinario_id == vet`. Un servicio
sin consulta **nunca** entra a liquidación — que es lo correcto: la liquidación
paga honorarios por consulta atendida, no por un corte de uñas de recepción.
Riesgo: si la Decisión 1 fuera "consulta liviana implícita", esas consultas
sintéticas **entrarían** como candidatas a liquidación en cuanto tuvieran
factura PAGADA.

**Reportes** (`routers/reportes.py`): **ninguno** lee `ServicioConsulta`
asumiendo que tiene consulta. `kpi/servicios` usa `DetalleFactura.producto_id`
(solo productos de inventario — hueco conocido, los servicios no aparecen).
`kpi/rendimiento`, `kpi/consultas` y `consultas-por-veterinario` cuentan filas
de `Consulta` directo. `finanzas/*` salen de `Factura`. → **Hacer
`ServicioConsulta.consulta_id` nullable no rompe ningún reporte.** El riesgo
está concentrado en `facturacion_service` y `liquidaciones`.

**Historial de peso** (`MascotaService.obtener_historial_peso`, usado por
`flujo-clinico.spec.js`): se arma **solo** desde consultas con `peso`. Consultas
sintéticas para servicios sueltos ensuciarían esta serie.

### 1.5 Roles — qué existe de verdad en el backend

Vocabulario real en código: **`admin` / `veterinario` / `user`**. El comentario
del modelo dice "admin, user" (`models.py:335`) pero `consulta_service`,
`liquidaciones`, `usuarios.py` (`/veterinarios`) y `e2e/helpers.js`
(`createTestVeterinario`) usan `"veterinario"` como rol real.

- **`recepcionista` NO existe en el backend.** Es un concepto solo del rediseño
  1A (`docs/diseno/capturas/1A/review/role-recepcionista.png`).
- Único guard de rol: `get_current_admin` (`routers/usuarios.py:58`).
- **Los routers clínicos (`consultas`, `clinico`) no exigen login.**
  `get_optional_current_user` nunca levanta 401 (`usuarios.py:41`) — solo sirve
  para anotar `usuario_responsable_id` en el ledger.

→ La Decisión 7 (matriz de permisos en el backend) es prácticamente terreno
virgen: hoy no hay casi nada que hacer cumplir.

### 1.6 Estado del front (Tarea 06 en curso)

- Shell 1A ya aplicado: `av-topbar`, `av-tabs`, `av-usermenu`, `role="tabpanel"`.
- `app.js` ya troceado: 264 líneas + `core/*` + `sections/*.js` (módulos ES).
- **Las 11 secciones siguen existiendo** en `index.html`. Barra: Consultorio,
  Agenda, Propietarios, Facturación, Inventario, Informes. Menú de usuario:
  Catálogo, Citas web/QR, Usuarios (admin), Perfil. `sec-ordenes-medico` sigue
  ahí (17 líneas, `index.html:1586`).
- ~25 modales siguen como `.modal` (el restyle a `.dialog` quedó para etapa 5).
- **El "carrito de consulta" ya existe como modal**: `modalDetalleConsulta` en
  `sections/consultorio.js` — `renderDetalleServicios`, `formAgregarServicio` →
  `POST /consultas/{id}/servicios`, `cambiarEstadoServicio` → PATCH,
  `eliminarServicioConsulta` → DELETE. Anexar es un **sub-form dentro del
  modal**, no un modal anidado. Promoverlo a pantalla es evolución, no reescritura.

### 1.7 Red de seguridad e2e

- `e2e/flujo-clinico.spec.js`: cadena Propietario → Mascota → Cita → Consulta →
  **anexar servicio + receta + cambiar estado** → Factura (emitir, abonar,
  anular, 409 en re-factura). Consulta/servicio/factura se ejercen por **API**
  (el modal de consulta es exclusivo del rol médico).
- `e2e/clinico.spec.js`: vacunación/desparasitación (descuentan stock, exigen
  consulta, crean el `ServicioConsulta` espejo — aserción explícita
  `clinico.spec.js:120`), hospitalización, cirugía (una por UI en pestaña
  "procedimientos"), pruebas (CRUD).

Ambos asumen: `consulta_id` obligatorio en servicios, el espejo automático, y
`POST /api/clinico/*` como puerta. Los tres supuestos cambian con esta tarea.

---

## 2. Las 8 decisiones

### Decisión 1 — Cómo se representa un servicio sin consulta

**Recomendación: `ServicioConsulta.consulta_id` pasa a `nullable=True`, y se
agrega `mascota_id` (FK nullable) para el enganche a la historia. NO consultas
sintéticas.**

- **Contra las consultas sintéticas**: `Consulta.veterinario_id` es NOT NULL —
  no hay forma limpia de crear una consulta "sin médico". Y aunque se forzara,
  contaminaría `LiquidacionDetalle` (unique `consulta_id`),
  `rendimiento_veterinarios`, `kpi/consultas` y el historial de peso. Cada una
  necesitaría un filtro "esto no es una consulta de verdad".
- **A favor de nullable**: el radio de impacto está acotado y ya medido (§1.4).
  Solo `facturacion_service` y `liquidaciones` joinean por `consulta_id`, y
  `Factura.consulta_id` ya es nullable. `PruebaComplementaria` ya vive así
  (`consulta_id` null + `mascota_id` obligatorio) — hay precedente en el repo
  (también `NotaClinica`).
- **Contrato**: `CHECK (consulta_id IS NOT NULL OR mascota_id IS NOT NULL)`.
  Going forward `mascota_id` se llena **siempre** (también en servicios con
  consulta, para simplificar queries de historia); backfill desde
  `consulta.mascota_id` para las 79 filas existentes.
- **Coste**: revisar `obtener_items_pendientes_consulta` (ya se toca en la
  Dec. 2), agregar un endpoint de listado por mascota (Dec. 8), y un guard en
  `_consultas_elegibles` no hace falta porque el servicio suelto no tiene
  consulta y el JOIN lo excluye solo.

### Decisión 2 — `ServicioConsulta` como única puerta de entrada

**Recomendación: Sí. `ServicioConsulta` es la única línea de carrito y de
factura. `Vacunacion`, `Desparasitacion`, `Cirugia`, `Hospitalizacion`,
`PruebaComplementaria` se quedan como tablas de detalle clínico apuntadas por
`referencia_id`. No se absorben.**

- **No absorber**: meter `riesgo_asa`, protocolo anestésico, `jaula_nro`,
  resultados de laboratorio, `monitoreo_constantes` (JSON) dentro de
  `detalles_clinicos` (texto) es lossy e irreversible. El esquema ya modela bien
  "cabecera facturable + detalle clínico".
- **Cerrar la doble escritura**: los routers clínicos siguen grabando su fila de
  detalle, pero el `ServicioConsulta` espejo pasa a ser la **única**
  representación facturable/de carrito. `obtener_items_pendientes_consulta` lee
  **solo `consulta.servicios`** y se le sacan los 5 loops que double-cuentan
  (`vacunaciones`, `pruebas`, `cirugias`, `hospitalizaciones`,
  `desparasitaciones`).
- **Nada se pierde**: migración de backfill — por cada fila de detalle histórica
  sin espejo (`referencia_id` no la apunta desde ningún `ServicioConsulta`), se
  crea el `ServicioConsulta` correspondiente con `precio_unitario` =
  `precio_aplicado` de la fila, `facturado` = el de la fila, `estado` según
  corresponda. Reversible: la migración `down` borra exactamente los espejos que
  creó (marcados por un rango de id o un flag temporal).

### Decisión 3 — Qué secciones del menú desaparecen

**Recomendación:**

| Sección | Destino |
|---|---|
| `sec-ordenes-medico` | **Desaparece.** Se convierte en la pantalla de inicio "Hoy / Consultas": bandeja de consultas `ABIERTA` + los dos botones de entrada. |
| Pestañas clínicas como superficie de **alta** (lab, vacunas, cirugía sueltas) | **Desaparecen como formularios de alta paralelos.** Todo se anexa desde la consulta abierta. Siguen existiendo como **vista de lectura** en la historia del paciente. |
| Consultorio / Propietarios | Se mantienen (búsqueda y ficha del paciente). |
| Agenda, Inventario, Facturación, Informes, Catálogo, Usuarios, Perfil, Citas web | **Se mantienen** — operan transversalmente sobre muchas consultas. |

Entrada nueva en la barra: **Hoy** (primera pestaña, pantalla de aterrizaje).

### Decisión 4 — Cómo se ve la consulta abierta

**Recomendación: pantalla completa (no modal), con el shell 1A (`av-*`).**
Boceto en §3.2. Reutiliza `renderDetalleServicios` / `cambiarEstadoServicio` /
`eliminarServicioConsulta` que ya existen; lo que cambia es el contenedor
(modal → `<section>`) y que el sub-form de anexar sale a primer plano.

### Decisión 5 — Anexar un servicio: ¿modal o algo mejor?

**Recomendación: fila en línea que se expande + panel lateral para el detalle
clínico pesado. Nada de modal.**

- "+ Anexar servicio" es una fila que se despliega in situ en un form compacto
  (tipo, buscador de catálogo, cantidad, precio, estado). Al guardar, agrega la
  fila y re-arma una vacía. Tres servicios seguidos = tres llenados rápidos,
  cero apertura/cierre.
- El detalle clínico pesado (informe quirúrgico, protocolo anestésico,
  resultados de laboratorio) abre un **panel lateral** (`slide-over`), no un
  modal a pantalla completa.
- Es exactamente cómo ya funciona `formAgregarServicio` (sub-form, no modal
  anidado) — solo hay que sacarlo de `modalDetalleConsulta`.

### Decisión 6 — Consultas abiertas / a medias

**Recomendación: agregar `Consulta.estado` con `ABIERTA` / `CERRADA` /
`ANULADA`, default `ABIERTA`.**

- Eje **clínico-de-ciclo-de-vida**, separado del eje **de cobro**
  (`estado_pago`, que se queda como está).
- Una consulta pasa a `CERRADA` cuando se factura, o cuando el veterinario la
  cierra explícitamente. `ANULADA` para el caso de error.
- La pantalla "Hoy" lista las `ABIERTA`. Todos los roles las ven; el veterinario
  ve las suyas destacadas. Retomar = abrirla de nuevo, no hay estado especial.
- Bonus: da a `_consultas_elegibles` y a los reportes un filtro limpio, y sirve
  para distinguir consultas reales de las que agrupan solo servicios directos
  (que directamente no tienen consulta, Dec. 1).
- Migración: `server_default='CERRADA'` para las 255 filas históricas (ya
  pasaron), `default='ABIERTA'` para las nuevas.

### Decisión 7 — Permisos por rol, aplicados en el backend

**Recomendación: introducir `recepcionista` como rol real del backend y una
dependencia `require_roles(...)`. Hoy no hay casi nada gateado (§1.5).**

| Acción | admin | veterinario | recepcionista |
|---|:---:|:---:|:---:|
| Abrir consulta | ✓ | ✓ | ✓ |
| Anexar servicio directo (estética, insumo, venta de producto) | ✓ | ✓ | ✓ |
| Anexar vacunación / desparasitación | ✓ | ✓ | ✗ |
| Anexar cirugía / hospitalización / laboratorio | ✓ | ✓ | ✗ |
| Registrar diagnóstico / tratamiento / receta | ✓ | ✓ | ✗ |
| Cambiar estado de un servicio a "Aplicado" | ✓ | ✓ | solo los que puede anexar |
| Cerrar consulta y facturar | ✓ | ✓ | ✓ |

- Se aplica **en el endpoint** vía dependencia, no escondiendo botones.
- **Aviso**: esto toca el backend. La Tarea 06 dijo "no toques el backend"; la
  Tarea 09 lo revierte explícitamente ("Define la matriz y aplícala **en el
  backend**, no solo escondiendo botones"). Lo dejo marcado para que sea una
  decisión consciente.
- Migración de datos: los usuarios `role='user'` actuales → hay que decidir si
  pasan a `recepcionista` o a `veterinario`. Propuesta: los que aparezcan como
  `veterinario_id` en alguna consulta → `veterinario`; el resto → `recepcionista`.

### Decisión 8 — Cómo entra esto en facturación

**Recomendación: la factura de una consulta sale de su lista de servicios casi
sin intervención.**

- Endpoint dedicado (o extensión del flujo actual):
  `POST /api/facturas/from-consulta/{id}` — el servidor arma `detalles[]` desde
  `consulta.servicios` (no borrados, no facturados) + el honorario de consulta
  (`precio_consulta`), usando el `precio_unitario` snapshot de cada línea; setea
  `Factura.consulta_id`, marca las líneas `facturado=True`, y pone
  `estado_pago='COBRADO'` + `estado='CERRADA'`.
- Servicio directo (sin consulta): mismo mecanismo, `Factura.consulta_id=NULL`,
  `detalles[]` desde los `ServicioConsulta` sueltos seleccionados.
- `obtener_items_pendientes_consulta` queda como **única fuente** del preview y
  pierde los 5 loops que double-cuentan (Dec. 2).
- El descuento de stock no cambia: lo maneja `_consumo_en_ledger` +
  `consumo_service` como hoy. Las líneas que ya consumieron material al aplicarse
  no se vuelven a descontar.

---

## 3. Bocetos

### 3.1 Menú (después)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AmiVets     [ ⌘K  buscar paciente · dueño · factura ]     + Nuevo ▾    user ▾ │
│                                                             ├ Consulta       │
│                                                             └ Servicio directo│
├─────────────────────────────────────────────────────────────────────────────┤
│  Hoy · Pacientes · Agenda · Facturación · Inventario · Informes              │
└─────────────────────────────────────────────────────────────────────────────┘
   menú de usuario (▽) :  Catálogo · Citas web/QR · Usuarios (admin) · Mi perfil
```

- **Hoy** — pantalla de aterrizaje. Bandeja de consultas `ABIERTA` (paciente,
  motivo, veterinario, total acumulado, tiempo abierta) + los accesos
  "Agregar consulta" y "Agregar servicio directo". Absorbe por completo
  `sec-ordenes-medico`.
- **Pacientes** — el actual Consultorio + Propietarios como segunda lente del
  buscador. La ficha del paciente muestra la historia: consultas (con sus
  servicios) y servicios directos, en una sola línea de tiempo.
- Las pestañas clínicas de alta suelta (vacuna/lab/cirugía como sección propia)
  ya no están; su contenido se ve en la ficha como lectura.

### 3.2 Consulta abierta (pantalla, no modal)

```
┌ Consulta #128 · ABIERTA ──────────────────────── [Guardar y salir]  [Cerrar y facturar] ┐
│                                                                                          │
│  🐕  Firulito · Canino · Mestizo · 12.5 kg          Dueño: Ana Pérez · 099 111 222       │
│      ⚠ Alergia a penicilina                          Veterinario: Dra. Gómez             │
│  ─────────────────────────────────────────────────────────────────────────────────────  │
│  Vitales:   Peso 12.5 kg    Temp 38.4 °C    FC 90 bpm        Motivo: control anual       │
│                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  Servicios anexados                                                     Total:  $ 43.000  │
│                                                                                          │
│   ●  Consulta clínica                       1 × 25.000      —              [Aplicado ▾]   │
│   ●  Vacuna Quíntuple                       1 × 12.000    Lote A23         [Aplicado ▾] ✕ │
│   ○  Corte de uñas                          1 ×  6.000      —              [Pendiente ▾] ✎ ✕│
│                                                                                          │
│   ┌ + Anexar servicio ───────────────────────────────────────────────────────────────┐  │
│   │  Tipo [ Estética ▾ ]   Buscar catálogo [ …………………… ]   Cant [ 1 ]   Precio [ 6.000 ]│  │
│   │  Estado [ Pendiente ▾ ]                                              [ Anexar ]     │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ▸ Diagnóstico y tratamiento          ▸ Recetas (1)          ▸ Notas clínicas             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Header del paciente fijo arriba. Franja de vitales editable.
- Lista de servicios con estado por fila (`○` Pendiente / `●` Aplicado),
  acciones en línea (cambiar estado, editar, quitar). Total acumulado a la
  derecha, siempre visible.
- Anexar = fila que se expande in situ; al guardar re-arma una vacía. El detalle
  clínico pesado (informe quirúrgico, protocolo) abre panel lateral.
- Diagnóstico, recetas y notas: bloques colapsables en la misma pantalla, no
  secciones aparte.
- `[Cerrar y facturar]` → `POST /api/facturas/from-consulta/{id}` (Dec. 8),
  la consulta pasa a `CERRADA`.

### 3.3 Servicio directo

Mismo form compacto que "Anexar servicio", precedido de un paso de selección de
mascota (o "sin mascota" para venta mostrador de producto). Crea uno o más
`ServicioConsulta` con `consulta_id = NULL` y `mascota_id` seteado. Botón
"Cobrar" → factura sin consulta (`Factura.consulta_id = NULL`).

---

## 4. Riesgos y puntos abiertos

1. **Tocar el backend** contradice la Tarea 06 (Dec. 7 y el nuevo esquema). La
   09 lo autoriza; confirmar que se asume.
2. **Migración de roles** (`user` → `veterinario` / `recepcionista`): la regla
   propuesta (aparece como `veterinario_id` ⇒ `veterinario`) hay que validarla
   contra los datos reales.
3. **Backfill de espejos** (Dec. 2): las filas de detalle históricas sin
   `ServicioConsulta` tienen que quedar visibles y facturables. Es la parte más
   delicada de la migración; su `down` tiene que borrar exactamente lo que creó.
4. **e2e**: `clinico.spec.js:120` asume el espejo automático y
   `flujo-clinico.spec.js` asume `consulta_id` obligatorio y `POST
   /api/clinico/*`. Hay que reescribir esos pasos para el flujo nuevo sin
   debilitar aserciones (lo pide la tarea).
5. **`precio_unitario` snapshot**: hoy el precio del servicio se congela al
   anexar y no se re-lee del historial de precios (Tarea 08). Mantener ese
   comportamiento salvo que se pida lo contrario.
6. **Tarea 06 en curso**: esta tarea reordena la navegación que la 06 está
   construyendo. Hay que hacerlas juntas o esta encima de la 06, nunca al revés
   (lo dice el encabezado de la 09).

---

## 5. Punto de parada

No se escribe código hasta aprobación de las 8 decisiones, el menú y la pantalla
de consulta abierta. FASE 2 (migración → endpoints → pantalla → entradas →
limpieza de menú → facturación) arranca recién con el visto bueno.
