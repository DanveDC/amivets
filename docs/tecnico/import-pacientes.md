# Verificación del import de pacientes

**Fuente:** 10 archivos `.xls` en `DATA DE PACIENTES` (fuera del repo, datos reales de
clientes). **Generador:** `backend/scripts/generar_import_pacientes.py` (sin PII,
sí en git). **Salida:** `import-pacientes-v2.sql`, fuera del repo — 5 veterinarios,
263 propietarios, 318 mascotas, en una sola transacción autocontenida (incluye las
credenciales de los veterinarios, no depende de correr ningún otro archivo).

**Método:** parseo de los 10 `.xls` con `xlrd`, cruce fila a fila contra el SQL, y
ejecución real contra un contenedor Postgres 15 descartable — **el import no se
corrió contra ninguna base real del proyecto en ningún momento de esta tarea**.
Revisado con `judgment-day` en dos rondas completas (cuatro jueces ciegos en
total, cada uno re-derivando los números desde cero, nunca confiando en el
análisis anterior).

**No se importó nada todavía.** Este documento certifica que la versión v2 está
verificada y lista — la decisión de correrla contra una base real (local o
producción) sigue siendo tuya.

## Veredicto

**v2 aprobada.** La primera versión (`import-pacientes.sql`, sin el sufijo `v2`)
tenía tres problemas reales de pérdida/corrupción silenciosa de datos — no se
llegó a correr contra ninguna base. La v2 los corrige y pasó dos rondas de
revisión adversarial sin hallazgos críticos.

## Ronda 1 — lo que se encontró en la versión original (ya corregido en v2)

1. **Pérdida silenciosa de email — 21 propietarios reales**, no 2 como se pensó
   al principio. La regla "anular el email si es genérico" se implementó
   comparando las 318 filas entre sí en bloque, así que el propio email de un
   dueño con varias mascotas (repetido en cada ficha) se confundía con un email
   compartido de la clínica y se borraba sin dejar rastro en ningún otro campo.
2. **Corrupción de teléfono — 8 propietarios.** El teléfono se guardó como
   número (no texto) en 8 filas del Excel; el import viejo lo pasaba a texto sin
   limpiar (`4143217490.0` en vez de `04143217490`), perdiendo el cero inicial
   que necesita todo celular venezolano.
3. **Un cuarto bug, no documentado en la primera pasada:** 8 filas más tenían el
   teléfono partido por el código de país en dos pedazos (`+58 412-2465509`), y
   el import viejo guardaba el pedazo inútil (`+58`) como teléfono principal.
4. **264 propietarios en vez de 263** por un bug de espacios: el dedup
   comparaba el nombre crudo, y `"NOHELYS CRESPO"` con doble espacio no
   matcheaba con la versión de un solo espacio de la misma persona.

## Cómo se corrigió (v2)

- **Email:** se agrupan las filas por dueño (nombre normalizado) primero, y
  recién ahí se decide si un email es genérico (aparece bajo más de un dueño
  distinto, o es una de las 4 direcciones conocidas de la clínica). Resultado:
  **173 de 263 conservan email** (antes 152 de 264). Cero colisiones reales
  entre dueños distintos.
- **Teléfono:** los 8 casos de celda numérica se reconstruyen (cero inicial
  recuperado, verificado contra los prefijos venezolanos que sí aparecen en el
  resto de los datos) y quedan marcados en `observaciones` con
  *"...VERIFICAR con el cliente"* — nadie debería tratarlos como un dato 100%
  confirmado sin preguntarle al cliente. Los 8 casos de código de país partido
  se recomponen igual, marcados como *"...recompuesto"*.
- **Dedup de propietarios:** se normaliza el espaciado antes de agrupar.
  Confirmado: **263 propietarios**, no 264.
- **Extra (no pedido, pero ordenado):** la cédula ahora corresponde de verdad a
  la historia con la fecha de apertura más antigua del propietario (antes era
  "la primera que el script encontró al recorrer los archivos", que no es lo
  mismo). Cambió en 12 de 263 casos.

## Lo que sigue pendiente — no bloquea, pero hay que saberlo

- **Historia 988 y 682: posible mismo animal, cargado dos veces.** Mismo dueño,
  mismo nombre de mascota, mismo sexo, misma edad — todo indica que dos
  veterinarios distintos le abrieron cada uno su propia historia al mismo
  gato. Se buscó sistemáticamente en las 318 filas (dentro y fuera del mismo
  grupo de dueño) y **no apareció ningún otro caso así**. Se dejó como dos
  registros separados a propósito — fusionarlos es una decisión tuya, no algo
  que se resuelve solo.
- **Algunos teléfonos con cantidad de dígitos rara ya vienen así del Excel
  original** (ej. un número de 8 dígitos en vez de 11, o al revés) y no
  quedaron marcados como los 16 casos de arriba, porque el import solo detecta
  los dos patrones de error que causaban pérdida de datos, no cualquier
  teléfono con forma sospechosa. No es algo que el import rompió — es un dato
  mal cargado en la planilla original — pero conviene saber que "tiene
  teléfono" no es lo mismo que "el teléfono es válido."
- Un propietario (un registro tipo fundación/refugio, no una persona) termina
  con `cedula = '0'` porque su historia más antigua tiene ese valor en el
  origen. Si en el futuro alguien carga manualmente un cliente con cédula
  desconocida como `0`, el `ON CONFLICT (cedula) DO NOTHING` lo va a ignorar en
  silencio en vez de avisar. Vale la pena evitar `0` como cédula "por defecto"
  de acá en adelante.
- El campo `telefono` de cada propietario es siempre el primer número que
  aparece en la celda de origen, no necesariamente el más completo o el mejor
  — esto ya pasaba en la versión original, no es nuevo de v2.

## Lo que está bien (verificado dos veces, no solo revisado a ojo)

- 318 mascotas ↔ 318 filas de Excel, 1 a 1, por archivo.
- Ningún `codigo_historia` se perdió ni se duplicó.
- SQL válido para PostgreSQL — ejecutado de punta a punta contra un Postgres
  real dos veces (una por cada ronda de jueces), commit limpio, y **es
  idempotente**: correrlo una segunda vez no duplica nada (`ON CONFLICT DO
  NOTHING`).
- Todos los tipos y longitudes encajan con el modelo — verificado campo por
  campo, no con ejemplos sueltos.
- Ningún email real quedó duplicado entre propietarios distintos (verificado
  además por el propio `UNIQUE` de Postgres, que no rechazó ninguna fila).
- El archivo duplicado (`data de gatos(amivets).xls`) es en efecto un
  duplicado exacto salvo la celda de fecha de generación del reporte.
- Sin vínculo veterinario↔mascota en el SQL (correcto, se arma después vía
  consultas).
- `credenciales-veterinarios.txt`: exactamente 5 credenciales, fuera de git.

## Otros gaps ya conocidos — confirmados con números

- **`fecha_nacimiento` estimada:** 315 de 318. El origen nunca tuvo fecha de
  nacimiento real.
- **18 propietarios con 2-3 teléfonos:** los números extra están rastreables en
  `observaciones` de alguna mascota, ninguno se perdió.
- **34 mascotas sin raza → NULL:** exacto.
- **Color sin dato real:** ~23 casos donde el Excel mismo dice "N/A", "NA" o
  una variante con error de tipeo. No es pérdida de dato — el import copia ese
  texto tal cual, no lo convierte a `NULL`.
- **Nombres de empresa/fundación mal partidos** entre nombre y apellido (el
  origen los separa por el primer espacio, no por doble espacio como se pensó
  al principio): 8-9 casos. Cosmético, se corrige desde el panel.

## Antes de correr esto contra cualquier base

1. Confirmá qué hacer con la historia 988/682 (¿son el mismo animal? ¿se
   fusionan o quedan separadas?).
2. Confirmá si esto va contra el entorno local o contra producción — no se
   ejecuta ninguna de las dos sin tu autorización explícita.
3. Verificá que la base destino esté limpia de datos de prueba antes de
   importar (unidad A de la tarea 04) — mezclar datos reales con datos de
   seed deja una base ilegible después.
