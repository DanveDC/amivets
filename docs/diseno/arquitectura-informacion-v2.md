# AmiVets — Arquitectura de información v2

Estructura propuesta a partir de los bocetos, reconciliada con lo que el
sistema ya hace. Es la base del rediseño de pantallas y del trabajo posterior
en código.

---

## 1. La decisión que ordena todo: la Orden de Servicio

Los bocetos ponen **"Orden de Servicios"** como el objeto central del módulo de
Admisión. Esa es la pieza que le faltaba al sistema, y resuelve de un golpe el
problema que quedó abierto en la tarea 09.

Hoy el contenedor de todo es la **consulta clínica**: `ServicioConsulta`,
`Vacunacion` y `Desparasitacion` tienen `consulta_id NOT NULL`, así que nada
puede existir sin una consulta. Eso obliga a inventar consultas ficticias para
un corte de uñas o una venta de antipulgas.

Con la orden de servicio el modelo se acomoda solo:

```
ORDEN DE SERVICIO  (se abre cuando llega el paciente)
├── Servicio: Consulta clínica      → historia, diagnóstico, tratamiento
├── Servicio: Laboratorio           → orden, resultado
├── Servicio: Cirugía               → protocolo, informe
├── Servicio: Hospitalización       → días, hoja de tratamiento
├── Servicio: Estética              → sin componente clínico
└── Servicio: Insumo / producto     → descuenta inventario
        ↓
FACTURA  (una orden se factura completa o por partes)
```

La consulta deja de ser el contenedor y pasa a ser **un servicio más** dentro
de la orden. Una orden puede tener cero consultas (vino solo a bañar al perro) o
varias. El "servicio directo" deja de ser un caso especial: es una orden con un
solo servicio.

**Estados de la orden:** Abierta → En atención → Cerrada → Facturada → Anulada.
Una orden abierta es la cola de trabajo del día.

---

## 2. Los seis módulos

Respeto la numeración de los bocetos, porque es el mapa mental del equipo.

### 1 · Admisión
El centro operativo. Crear, cerrar y modificar órdenes de servicio. Reportes
diario, semanal y mensual. **Presupuestos** (una orden que todavía no se
ejecuta) y el **módulo de recepción**: quién llegó, quién está esperando, quién
está en atención.

### 2 · Servicios
El catálogo y la ejecución: consultas (con emergencias marcadas aparte),
laboratorios, cirugías, hospitalización, insumos médicos y otros servicios.
Submódulo de **consultas online**.

Aquí vive la definición de cada servicio —precio, categoría, y la receta de
insumos que consume (tarea 07)— y el seguimiento de los que están en curso.

### 3 · Mascotas / Tutores
Mascotas separadas por perros, gatos y otras. Tutores **naturales y jurídicos**.
Reportes por fecha.

> ⚠️ **Hallazgo:** hoy `Propietario` tiene nombre, apellido y cédula. No hay
> forma de registrar una persona jurídica (una fundación, una perrera, una
> empresa). Eso es un cambio de modelo, no de pantalla.

### 4 · Insumos
Medicamentos, consumibles, insumos generales y accesorios. Con unidad de medida
y consumo fraccionado (tarea 07): media botella de alcohol, dos gasas de un
paquete de cincuenta.

### 5 · Facturación
La orden de servicio con su forma de pago, servicios cobrados, servicios por
cobrar, y resumen de facturas por día, semana y mes, **desglosado por método**:
efectivo, punto, Zelle, USDT y otros.

> ⚠️ **Hallazgo:** `Factura.metodo_pago` es texto libre. Para que el resumen por
> método funcione, los métodos tienen que ser un catálogo cerrado.

### 6 · KPI / Reportes
Por servicio, por tipo de mascota, por médico y **por patología**.

> ⚠️ **Hallazgo:** `Consulta.diagnostico` es texto libre. No se puede agrupar
> por patología sobre texto libre. Hace falta un catálogo de diagnósticos, o al
> menos un campo codificado además del texto.

---

## 3. Navegación

Los bocetos son un **árbol de funciones**, y traducirlos literalmente a menús
reproduce el problema que ya tiene el sistema: once pestañas que no se hablan y
veinticinco modales.

La propuesta separa las dos cosas:

**El mapa de seis módulos se conserva** como estructura mental y como barra
lateral. Es lo que el equipo ya tiene en la cabeza.

**Pero el trabajo diario no pasa por el menú.** Pasa por tres cosas:

1. **El panel del día** (Admisión) como pantalla de inicio: órdenes abiertas,
   sala de espera, lo que falta cobrar.
2. **La orden abierta** como pantalla de trabajo: se entra una vez y desde ahí
   se anexa todo, sin volver al menú.
3. **La búsqueda global** en la barra superior: mascota, tutor, número de orden
   o factura. En la práctica reemplaza la navegación por menús.

Los modales se reservan para confirmaciones cortas. Anexar un servicio es un
panel lateral, no un modal que hay que abrir y cerrar tres veces seguidas.

---

## 4. Identidad visual

Colores tomados del logo:

| Token | Valor | Uso |
|---|---|---|
| Teal profundo | `#0C7A89` | Color principal: navegación activa, botones primarios, encabezados |
| Teal oscuro | `#0B6976` | Hover y estados presionados |
| Cian | `#13ABDF` | Acento, enlaces, elementos seleccionados |
| Azul profundo | `#165788` | Texto sobre fondos claros, contornos |
| Verde | `#7FC96A` | Estados positivos: pagado, aplicado, disponible |
| Ámbar | `#E0A030` | Advertencias: por cobrar, stock bajo |
| Rojo | `#C0504A` | Errores, anulado, vencido |
| Fondo | `#F7F9FA` | Lienzo de la aplicación |
| Superficie | `#FFFFFF` | Tarjetas y tablas |

El teal es el color de la marca y funciona como color de navegación. El cian se
reserva como acento puntual — si se usa en todo, deja de señalar nada.

Tipografía: una sans legible a distancia, porque estas pantallas se miran de
reojo desde el otro lado del consultorio. Tamaño base 15-16px, no 13.

---

## 5. Pantallas a diseñar

1. **Login** — con el logo.
2. **Panel del día** — inicio de Admisión: órdenes abiertas, sala de espera,
   pendientes de cobro, accesos rápidos.
3. **Orden de servicio abierta** — la pantalla estrella: paciente y tutor
   arriba, servicios anexados, total acumulado, acciones.
4. **Anexar servicio** — panel lateral con el catálogo, la cantidad y los
   insumos que va a consumir.
5. **Ficha de mascota** — historia clínica completa, órdenes anteriores, tutor.
6. **Insumos** — inventario con unidad de medida, stock fraccionado y alertas.
7. **Catálogo de servicios** — con la receta de insumos de cada uno.
8. **Facturación de una orden** — líneas, métodos de pago, abonos.
9. **KPI / Reportes** — por servicio, mascota, médico y patología.

---

## 6. Lo que hay que resolver en modelo antes de codificar

Tres cosas de esta estructura no existen en la base y no son trabajo de front:

1. **La tabla de órdenes de servicio**, y migrar las consultas actuales para que
   cada una quede dentro de una orden.
2. **Tutores jurídicos** — `Propietario` no los soporta.
3. **Catálogo de diagnósticos** — sin él, "reportes por patología" no es
   posible.

Y dos que ya están cubiertas por tareas escritas: el consumo fraccionado de
insumos (tarea 07) y el historial de precios (tarea 08).
