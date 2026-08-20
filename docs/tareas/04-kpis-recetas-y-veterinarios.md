# Tarea 04 — KPIs, recetas en PDF y control por veterinario

**Proyecto:** AmiVets
**Cinco unidades.** La B es independiente; A → C → D → E van en ese orden,
porque medir sobre datos de prueba no sirve de nada.

## Skills a cargar antes de trabajar

- `/home/dalec/.claude/skills/work-unit-commits/SKILL.md`
- `/home/dalec/.claude/skills/judgment-day/SKILL.md` — **obligatoria** en la
  unidad A (se borran datos) y en la E (se calcula dinero de personas).
- `/home/dalec/.claude/skills/impeccable/SKILL.md` — unidades C y D.
- `/home/dalec/.claude/skills/fixing-accessibility/SKILL.md` — pantallas nuevas.

---

# ⚠️ Dos obstáculos estructurales — leelos antes de planificar

## 1. El veterinario de una consulta es texto libre

```python
class Consulta(Base):
    ...
    veterinario = Column(String(100))   # "Profesional responsable"
```

**No es una clave foránea.** No apunta a `Usuario`, ni al `role='veterinario'`,
ni a la tabla `veterinarios` de Supabase. Es una cadena escrita a mano.

Esto rompe las unidades D y E de raíz: `"Dr. Pérez"`, `"dr perez"` y `"Pérez"`
son tres veterinarios distintos para un `GROUP BY`. El endpoint actual
`/kpi/rendimiento` ya agrupa así — y por eso sus números no son fiables.

**Si vas a repartir dinero según esa columna, un espacio de más se lo paga a
otro.**

Tu primer trabajo es diagnosticar: consultá los valores distintos que hay hoy en
`Consulta.veterinario` y cuántas consultas tiene cada uno. Con eso en la mano,
proponé el camino —normalizar a una FK contra `Usuario`, con su migración de
datos, es lo más probable— y **consultalo con Daniel antes de ejecutarlo.**
Es un cambio de esquema sobre datos existentes.

## 2. No existe ninguna regla de pago a veterinarios

Buscá en `models.py`: no hay tarifa, porcentaje, honorario ni comisión por
profesional. `ServicioConsulta.precio_unitario` es lo que paga el cliente, no lo
que cobra el veterinario.

**La unidad E no se puede implementar sin que Daniel defina la regla.** Ver ahí.

---

# Unidad B — Receta en PDF *(independiente, empezá por acá)*

La más acotada y la que da valor inmediato.

## Lo que existe

`backend/app/services/pdf_service.py` ya tiene la infraestructura:

```python
def render_to_pdf(template_src, context_dict={})   # motor genérico
def generar_factura_pdf(factura)
def generar_consulta_pdf(db, consulta_id)
def generar_abono_pdf(abono, factura)
```

Y `consultas.py:235` ya expone un endpoint que descarga PDF. **El patrón está
resuelto**: replicalo, no inventes uno nuevo.

## Lo que hay que hacer

`generar_receta_pdf(db, receta_id)` más su endpoint y su botón.

**Solo la receta.** Daniel fue explícito: ni factura, ni resumen de consulta,
ni precios. Un documento clínico que el dueño de la mascota lleva a la farmacia.

Lo que sí debe llevar, leyendo `Receta` y `DetalleReceta`:

- Datos de la clínica y del veterinario que la firma
- Mascota y propietario
- Fecha de emisión
- Por cada medicamento: nombre, **dosis, frecuencia y duración**
- Indicaciones generales
- Espacio para la firma

Lo que **no** debe llevar: precios, totales, estado de facturación, ni nada
de `ServicioConsulta`.

## Criterios

- Pensado para imprimirse en papel: márgenes reales, legible en blanco y negro,
  sin depender del color para nada.
- Una receta sin medicamentos no debe generar un PDF vacío: avisá.

---

# Unidad A — Limpiar la base y sanear el arranque

> **Se borran datos. `judgment-day` obligatorio antes de ejecutar nada
> destructivo.**

## A1 — Arreglar la bomba del arranque *(hacer esto primero)*

`backend/scripts/init_db.py` corre en **cada arranque** y contiene esto:

```python
try:
    tables = inspector.get_table_names()
except Exception as e:
    print(f"Error al inspeccionar la base de datos: {e}")
    tables = []                     # ← un fallo de red se vuelve "base vacía"

if force_reset or not tables or "usuarios" not in tables:
    reset_database()                # ← Base.metadata.drop_all(bind=engine)
    seed_data()
```

**Un error transitorio de conexión es indistinguible de una base nueva, y el
castigo por confundirlos es perder todo.** Esto ya ocurrió: en el despliegue del
2026-08-18 el inspector falló, el `except` puso `tables = []` y el script
intentó `reset_database()`. No borró nada solo porque tampoco había conexión con
la que borrar. Y aun así imprimió *"CONFIGURACIÓN DE BASE DE DATOS FINALIZADA"*.

Qué hacer:

1. **Un fallo del inspector debe fallar**, no asumir base vacía. Si no se puede
   determinar el estado, la app no arranca y lo dice claramente.
2. Que la inicialización **no corra en cada arranque**. Un comando explícito, o
   una comprobación que no pueda destruir nada.
3. `FORCE_RESET_DB=true` no puede seguir siendo una variable de entorno que
   borre producción con un typo. Como mínimo, que exija confirmación adicional
   y se niegue cuando `ENVIRONMENT=production`.
4. Sacar `admin` / `admin123` del código. La contraseña inicial sale de una
   variable de entorno, y si no está, no se crea el usuario.

## A2 — Dejar la base limpia

Quitar los datos sembrados: los 10 médicos `dr_*`, el inventario de ejemplo, las
consultas y demás de `seed_data.py`.

**Antes de borrar nada:**

- Distinguí lo sembrado de lo real. Si ya hay datos verdaderos cargados, **no
  se pueden perder**. Si no lográs distinguirlos con certeza, parás y preguntás.
- Confirmá con Daniel si esto va sobre producción o solo sobre local.
- Que quede un usuario administrador utilizable, con contraseña por entorno.

**El seed no debe ejecutarse nunca en producción.** Que quede disponible como
herramienta explícita de desarrollo, no como comportamiento automático.

> Nota: hay un cambio pendiente sin commitear en `seed_data.py` que corrige el
> rol de los médicos de `"user"` a `"veterinario"`. Si el seed deja de correr en
> producción, ese arreglo solo aplica en desarrollo — pero sigue siendo
> correcto. No lo revierta.

---

# Unidad C — Sección de KPIs con filtros de fecha

## Lo que ya existe en el backend

`backend/app/routers/reportes.py`:

```
GET /kpi/servicios              servicios más solicitados
GET /kpi/rendimiento            consultas por veterinario
GET /finanzas/ingresos          resumen de ingresos
GET /finanzas/cuentas-por-cobrar
```

**Ninguno acepta filtro de fechas.** Ahí está el trabajo del backend.

## Qué construir

Rango de fechas aplicable a **todos** los indicadores, con atajos —este mes, mes
anterior, este año— y rango libre. El rango elegido se muestra siempre en
pantalla: un número sin período no significa nada.

Indicadores mínimos, revisá con los datos reales cuáles tienen sentido:
consultas atendidas, pacientes únicos, ingresos del período, ticket promedio,
servicios más solicitados, cuentas por cobrar.

## Criterios

- Un período sin datos muestra "sin datos", no un cero que parece un dato.
- Todo indicador de dinero dice **qué mide** y **de qué período**.
- Los gráficos usan el mismo Chart.js que ya está en el proyecto.
- Cuidado con las zonas horarias: un rango "de hoy" no puede dejar fuera las
  consultas de la mañana por un desfase de UTC.

---

# Unidad D — Consultas por veterinario

Sección para ver qué ha atendido cada profesional, con filtro por veterinario y
por rango de fechas.

**Depende del obstáculo 1.** Con el campo en texto libre, esta pantalla va a
mostrar el mismo veterinario repetido con variantes de su nombre. Resolvé eso
primero o la sección nace rota.

Detalle por consulta: fecha, mascota, propietario, motivo y servicios aplicados.
Con totales del período y acceso a la consulta completa.

---

# Unidad E — Pago a cada veterinario ⛔ **Requiere decisión de Daniel**

**No implementes nada hasta tener la regla.**

El modelo no tiene tarifas, porcentajes ni honorarios. Antes de escribir código,
Daniel tiene que responder:

1. **¿Cómo se calcula?** ¿Un porcentaje del precio de los servicios aplicados?
   ¿Un monto fijo por consulta? ¿Distinto según el tipo de servicio?
2. **¿Sobre qué base?** ¿Todos los servicios de la consulta, o solo los que
   ejecutó el veterinario? ¿Solo los ya facturados y cobrados, o también los
   pendientes?
3. **¿La tarifa es igual para todos** o cada profesional tiene la suya?
4. **¿Qué pasa con las consultas anuladas o los servicios con `is_deleted`?**

Con las respuestas: un campo o tabla de tarifas, el cálculo, y una vista por
veterinario y período con el detalle de cómo se llega al total.

## Criterios

- **El total debe poder desglosarse.** Un número suelto que dice "usted cobra X"
  es inútil: quien lo recibe necesita ver de qué consultas sale.
- Ningún servicio puede contarse dos veces ni quedar fuera.
- Cambiar una tarifa **no puede alterar lo ya liquidado**. Si eso importa —y con
  dinero de personas suele importar—, la tarifa aplicada se guarda con el
  registro, no se recalcula.

## Cierre

`judgment-day` con esta pregunta: *¿bajo qué datos este cálculo le pagaría de
menos a alguien?* Un error acá lo detecta la persona afectada, y erosiona la
confianza en el sistema entero.

---

# Verificación

- [ ] **B:** la receta genera PDF, sin precios ni datos de facturación, legible
      impresa en blanco y negro.
- [ ] **A1:** un fallo del inspector hace fallar el arranque, no vaciar la base.
      `FORCE_RESET_DB` no puede destruir producción por accidente.
      `admin123` no está en el código.
- [ ] **A2:** la base no tiene datos de prueba y ningún dato real se perdió.
- [ ] **C:** todos los indicadores respetan el rango, y el rango se ve en
      pantalla.
- [ ] **D:** cada veterinario aparece una sola vez.
- [ ] **E:** el total se desglosa consulta por consulta.
- [ ] La suite de Playwright pasa, **actualizada si cambiaron selectores, no
      debilitada**.
- [ ] Commits separados por unidad.

# Fuera de alcance

- No rediseñes visualmente la app: eso es la tarea 03.
- No toques el flujo de agendamiento por QR ni Supabase.
- Sobre el esquema: proponé y esperá aprobación. No lo cambies de paso.
