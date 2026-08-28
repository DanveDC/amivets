# Tarea 05 — Notas clínicas con dictado por voz, y verificación del import

**Proyecto:** AmiVets
**Dos unidades.** La A verifica trabajo ya hecho; la B y la C construyen algo
nuevo. **Empezá por la A**: si el import está mal, lo demás espera.

## Skills a cargar antes de trabajar

- `/home/dalec/.claude/skills/judgment-day/SKILL.md` — obligatoria en la A.
- `/home/dalec/.claude/skills/work-unit-commits/SKILL.md`
- `/home/dalec/.claude/skills/impeccable/SKILL.md` — unidades B y C.
- `/home/dalec/.claude/skills/fixing-accessibility/SKILL.md` — unidad C.

---

# Unidad A — Verificar el import de pacientes

Hay un archivo generado, **fuera del repositorio a propósito** porque lleva
datos reales de clientes:

```
C:\Users\dalec\Desktop\veterinaria\DATA DE PACIENTES\import-pacientes.sql
```

**5 veterinarios · 264 propietarios · 318 mascotas**, en una sola transacción.
Origen: 10 archivos `.xls` en esa misma carpeta.

## Tu trabajo: buscarle los fallos

No lo des por bueno. Abrí los `.xls` —hay `xlrd` en el proyecto— y contrastá
contra el SQL. Preguntas concretas a responder con números:

1. ¿Las 318 mascotas del SQL corresponden 1 a 1 con las filas de los Excel?
2. ¿Algún `codigo_historia` se perdió o se duplicó?
3. ¿Los 264 propietarios cubren todos los nombres distintos del origen?
4. ¿Algún nombre quedó mal partido en nombre/apellido de forma que estropee el
   dato? (ver más abajo)
5. ¿Los tipos encajan con el modelo — longitudes de `String(n)`, formatos de
   fecha, booleanos?
6. ¿El SQL es válido para **PostgreSQL**? Es lo que usa AmiVets, no MySQL.

## Decisiones ya tomadas — no las cambies, verificá que estén bien aplicadas

| Punto | Decisión de Daniel |
|---|---|
| Correos repetidos | `NULL` cuando el original era un correo genérico compartido. 152 de 264 conservan correo. |
| Cédulas | El origen **no trae cédulas**. Se usa el nº de historia del primer paciente del propietario. |
| Veterinario ↔ paciente | **Sin relación.** Se crean los 5 usuarios; el vínculo se hará por consultas más adelante. |
| Contraseñas | Provisionales, en `credenciales-veterinarios.txt`. Deben cambiarse al primer ingreso. |
| Archivo duplicado | `data de gatos(amivets).xls` se descartó: duplicado exacto, 65 filas idénticas verificadas. |

## Lo que YA SE SABE que queda fuera — confirmá y documentá

Esto no es una lista de bugs, es transparencia. Verificá cada punto y dejá el
resultado en `docs/tecnico/import-pacientes.md`:

- **`fecha_nacimiento` es estimada**, no real: fecha de apertura menos la edad
  declarada. 315 de 318. El origen nunca tuvo fecha de nacimiento.
- **112 propietarios quedan sin correo** por la decisión de arriba.
- **Teléfonos adicionales**: 18 propietarios tenían 2 o 3 números. `telefono`
  es `String(20)` y no caben. Los extras se anotaron en las `observaciones` de
  la mascota. **Evaluá si merecen un campo propio** y proponelo — no lo
  implementes en esta tarea.
- **34 mascotas sin raza y 17 sin color** en el origen. Van `NULL`.
- **Nombres de empresa mal partidos**: el origen separa nombre y apellido con
  doble espacio, y eso funciona en el 49% de los casos. `VETERINARIA  LO
  CHORROS` queda como nombre `VETERINARIA`, apellido `LO CHORROS`. Es feo pero
  no rompe nada y se corrige desde el panel. **Contá cuántos casos hay.**

## Antes de ejecutar nada

Comprobá contra qué base se va a importar:

```sql
SELECT COUNT(*) FROM usuarios;
SELECT COUNT(*) FROM propietarios;
SELECT COUNT(*) FROM mascotas;
```

Si todavía están los 10 médicos `dr_*` y el inventario del seed, **la limpieza
va primero** — es la unidad A de la tarea 04. Mezclar datos reales de clientes
con datos de prueba deja una base que nadie sabe leer después.

## Cierre

`judgment-day` sobre el SQL, con esta pregunta: *¿qué dato del Excel se pierde
y nadie lo va a notar hasta que un cliente pregunte por él?*

---

# Unidad B — Notas clínicas en la historia del paciente

## Lo que hay hoy

**No existe sección de notas.** Buscá en `models.py`: hay campos
`observaciones` sueltos en `Mascota`, `Cita`, `Consulta`, `ServicioConsulta` y
otros, pero **ninguna bitácora de notas fechadas atada al paciente**.

Eso significa que hoy no hay dónde escribir *"la dueña llamó, el animal sigue
sin comer"* si no es dentro de una consulta formal.

## Lo que hay que construir

Una tabla nueva de notas asociada a la mascota. Como mínimo: a qué paciente
pertenece, quién la escribió, cuándo, y el texto.

Decisiones tuyas, con argumentos:

- **¿La nota puede colgar también de una consulta concreta**, o siempre del
  paciente? Mirá cómo se usa el sistema antes de decidir.
- **¿Se pueden editar y borrar?** En un contexto clínico, una nota modificada
  sin rastro es un problema. Considerá borrado lógico y registro de ediciones —
  el proyecto ya usa `is_deleted` en `ServicioConsulta`, hay precedente.
- **¿Categorías** —seguimiento, llamada, incidencia— o texto libre? Empezá
  simple; es más fácil añadir que quitar.

## Criterios

- Las notas se ven en orden cronológico dentro de la historia del paciente,
  con autor y fecha visibles.
- Una historia sin notas muestra un estado vacío que invite a escribir, no un
  hueco.
- **Migración con Alembic**, como el resto del proyecto. No `create_all`.
- Permisos: quién puede escribir, editar y borrar. Consultá
  `docs/tecnico/matriz-permisos.md` si existe, o preguntá a Daniel.

---

# Unidad C — Dictado por voz en las notas

Poder dictar en vez de escribir. Un veterinario con las manos ocupadas o
guantes no teclea.

## La vía sensata

**Web Speech API** (`SpeechRecognition`) del navegador. No necesita servidor,
no cuesta nada, no añade dependencias. Configurada en español, con resultados
provisionales para que se vea el texto mientras se habla.

## ⚠️ Lo que hay que decirle a Daniel antes de implementarlo

**La Web Speech API de Chrome envía el audio a servidores de Google para
transcribirlo.** No se procesa en el dispositivo.

Eso significa que dictar *"el paciente presenta un cuadro compatible con
insuficiencia renal"* manda esa frase a un tercero. Son datos clínicos de
animales, no de personas, así que el marco legal es mucho más laxo que en
medicina humana — pero **es una decisión que Daniel tiene que tomar sabiendo
esto, no descubrirlo después.**

**Planteáselo antes de escribir el código.** Si le preocupa, la alternativa es
transcripción en el servidor con un modelo propio: más control, pero cuesta
dinero, hay que montarlo y consume recursos del contenedor de 1 GB. Es una tarea
aparte, no una variante de esta.

## Criterios

- **El dictado complementa al teclado, nunca lo reemplaza.** El campo se puede
  escribir a mano siempre.
- Estado visible de que se está grabando. Nadie debe dudar de si el micrófono
  está abierto.
- Si el navegador no lo soporta —Firefox, Safari— el botón no aparece y el
  campo funciona normal. Nada de errores en consola ni botones muertos.
- Permiso de micrófono denegado: mensaje claro, no un fallo silencioso.
- El texto dictado es **editable antes de guardar**. La transcripción se
  equivoca con términos veterinarios y nombres propios.
- Accesible por teclado.

---

# Verificación

- [x] `docs/tecnico/import-pacientes.md` documenta qué se importó, qué quedó
      fuera y por qué.
- [x] El SQL fue validado contra los Excel con números, no de vista (2 rondas
      de judgment-day, 4 jueces en total; el original tenía pérdida real de
      datos, corregido en v2, ver commits 2b61e17/388355e).
- [x] La tabla de notas tiene migración de Alembic y se ve en la historia
      (commit 35e22f7).
- [x] El dictado funciona en Chrome y **desaparece limpiamente** donde no
      (commit f31c226).
- [x] Lo dictado se puede corregir antes de guardar.
- [x] La suite de Playwright pasa, actualizada si cambiaron selectores
      (23 passed, 1 skipped por falta de Supabase — sin selectores que
      cambiar en esta tarea).
- [x] Commits separados por unidad.

## Pendiente de tu decisión — no bloqueante

- Historia 988/682 en el import: ¿es el mismo animal cargado dos veces?
  Ver `docs/tecnico/import-pacientes.md`.
- El import v2 sigue sin ejecutarse contra ninguna base — falta tu
  autorización explícita (local o producción).

# Fuera de alcance

- No cambies las decisiones de la tabla de arriba: son de Daniel.
- No ejecutes el import contra producción sin confirmárselo.
- No implementes transcripción en servidor.
- No toques el rediseño del front — eso es la tarea 03.
