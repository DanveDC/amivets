# Verificación del import de pacientes

**Fuente:** 10 archivos `.xls` en `DATA DE PACIENTES` (fuera del repo, datos reales de
clientes). **Salida verificada:** `import-pacientes.sql` — 5 veterinarios, 264
propietarios, 318 mascotas, en una sola transacción.

**Método:** parseo de los 10 `.xls` con `xlrd`, cruce fila a fila contra el SQL,
y ejecución real contra un contenedor Postgres 15 descartable (el import
**no se corrió contra ninguna base real del proyecto**). Revisado además con
`judgment-day` (dos jueces ciegos, en paralelo, cada uno re-derivando los
números desde cero en vez de confiar en el análisis anterior).

**No se importó nada todavía.** Este documento es el resultado de la
verificación, no una confirmación de que el import se ejecutó.

## Veredicto

**No ejecutar este SQL tal como está.** Tiene tres problemas reales que
pierden o corrompen datos de clientes de forma silenciosa — nadie se entera
hasta que un cliente pregunta por su email o llama a un teléfono que ya no
es el suyo.

## Lo que está bien (verificado, no solo revisado a ojo)

- Las 318 mascotas del SQL corresponden 1 a 1 con las filas de los 10 Excel
  (conteo exacto por archivo).
- Ningún `codigo_historia` se perdió ni se duplicó (318 valores distintos en
  ambos lados, mismo conjunto).
- El SQL es PostgreSQL válido — se corrió de punta a punta contra un Postgres
  real, sin errores, commit limpio.
- Todos los tipos y longitudes encajan con el modelo (`String(n)`, fechas,
  booleanos) — verificado campo por campo, no solo con ejemplos.
- El archivo duplicado (`data de gatos(amivets).xls`) es en efecto un
  duplicado: mismos 65 registros, la única diferencia es la celda de fecha de
  generación del reporte.
- No hay vínculo veterinario↔mascota en el SQL (correcto, se decidió que ese
  vínculo se arma después vía consultas).
- `credenciales-veterinarios.txt` tiene exactamente 5 credenciales, no subidas
  a git, con exigencia de cambio en el primer ingreso.

## Problemas reales encontrados

### 1. Pérdida silenciosa de email — ~21 propietarios, no 2

La regla "anular el email si es genérico/compartido" se implementó como *"anular
cualquier email que aparezca más de una vez en las 318 filas"*, sin distinguir
entre "aparece repetido porque es el email genérico de la clínica" y "aparece
repetido porque el mismo dueño tiene varias mascotas y puso su propio email en
cada ficha". Resultado: **21 propietarios con un email real y personal en el
Excel terminan con `NULL` en el SQL**, sin ningún rastro en ningún otro campo
(a diferencia de los teléfonos, el email no tiene un lugar de respaldo en
`observaciones`).

De los 112 propietarios que hoy quedan sin correo: 91 realmente nunca dieron
uno recuperable (correcto), y 21 sí lo dieron y el import lo destruyó.

### 2. Corrupción de teléfono — 7 propietarios, número no marcable

En 7 filas, el teléfono se guardó como número (no texto) en el Excel de
origen. El import lo convirtió a texto sin limpiar, dejando un `.0` al final
(ej. `4143217490.0` en vez de `04143217490`). El `.0` se puede arreglar, pero
el cero inicial que necesita todo celular venezolano **ya se perdió en la
celda de origen** y no se puede recuperar desde el Excel — hay que
reconstruirlo a mano por otra vía (llamar al cliente, cruzar con otra
fuente) antes de dar el teléfono por bueno.

### 3. Posible mascota duplicada entre archivos

La historia 988 y la historia 682 (dos archivos `.xls` distintos) tienen
mismo nombre de mascota, mismo sexo, misma edad, mismo teléfono de contacto —
todo indica que es el mismo animal, visto por dos veterinarios que le
abrieron cada uno su propia historia. El import las cargó como dos mascotas
separadas. No se hizo una búsqueda exhaustiva de más casos así; antes de
importar conviene cruzar nombre+edad+sexo+dueño entre los 10 archivos.

## Decisiones de Daniel — verificadas

| Punto | Estado |
|---|---|
| Emails genéricos → NULL (152/264 conservan email) | Aplicado, pero con el bug del punto 1 |
| Cédula = historia del primer paciente del propietario | El número es estable y sirve como identificador, pero **no es realmente "el primero"** en 12 de 264 casos — el import usa el orden en que procesó los archivos, no la fecha real más antigua. No pierde datos, pero la descripción de la regla no es exacta |
| Veterinario sin vínculo a paciente | Confirmado, sin FK en el SQL |
| Contraseñas provisionales | Confirmado, archivo con 5 credenciales, fuera de git |
| Archivo duplicado descartado | Confirmado a nivel de dato, no solo de nombre de archivo |

## Gaps ya conocidos — confirmados con números

- **`fecha_nacimiento` estimada:** 315 de 318 (exacto). El origen nunca tuvo
  fecha de nacimiento real.
- **112 propietarios sin correo:** el número es correcto, pero 21 de esos 112
  no deberían estar sin correo (ver Problema 1).
- **18 propietarios con 2-3 teléfonos:** los números extra están todos
  rastreables en `observaciones` de alguna mascota, ninguno se perdió.
- **34 mascotas sin raza → NULL:** exacto.
- **Color sin dato:** la cifra real es más alta de lo documentado
  originalmente. El Excel usa texto tipo "N/A", "NA" y una variante con
  typo como marcador de "no sé" — son ~24 casos en total, no 16 ni 17. No es
  pérdida de dato: el import copia ese texto tal cual, no lo convierte a
  `NULL`.
- **Nombres de empresa mal partidos** (el origen separa nombre/apellido por el
  primer espacio, no por doble espacio como se pensaba): son **8-9 casos**
  además del ejemplo dado, no 6. Cosmético, se corrige desde el panel, no
  rompe nada.

## Antes de importar esto a cualquier lado

1. Corregir la lógica de "email genérico": debe evaluarse por propietario
   (¿aparece bajo más de un dueño distinto?), no por frecuencia global en las
   318 filas.
2. Corregir el formateo de teléfono para no arrastrar `.0`, y resolver a mano
   los 7 números con el cero inicial perdido.
3. Confirmar si la historia 988/682 (y potencialmente otras) son la misma
   mascota antes de aceptar "318 mascotas distintas" como un hecho.
4. Re-generar el SQL con esas correcciones y volver a verificar antes de
   correrlo contra cualquier base — local o de producción.
