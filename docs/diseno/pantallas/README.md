# Pantallas del rediseño — AmiVets

Once maquetas estáticas de 1440×900, autocontenidas: cada `.html` se abre en el
navegador sin servidor y sin dependencias (el logo va incrustado como data URI;
las fuentes se cargan de Google Fonts).

**Estos archivos son la fuente para pasar el diseño a código**, no el canvas
publicado en claude.ai. Aquí los valores están literales —colores, tamaños,
espaciados, alturas de control— y se leen y copian directamente.

| Archivo | Pantalla |
|---|---|
| `Login.html` | Inicio de sesión |
| `Inicio.html` | Inicio — el lanzador de los seis módulos (la entrada de sesión) |
| `Main.html` | Panel del día — inicio de Admisión |
| `OrdenAbierta.html` | Orden de servicio abierta (la pantalla de trabajo) |
| `AnexarServicio.html` | Panel lateral para anexar un servicio a la orden |
| `BandejaGestor.html` | Bandeja del gestor — su cola de trabajo, ejecutar y cargar el resultado |
| `Mascotas.html` | Listado de mascotas — landing del módulo 3 (etapa 8) |
| `FichaMascota.html` | Ficha de paciente e historia clínica |
| `Insumos.html` | Inventario con unidad de medida y stock fraccionado |
| `Catalogo.html` | Catálogo de servicios, su receta de insumos y su historial de precios |
| `Facturacion.html` | Facturación de una orden |
| `Reportes.html` | KPI y reportes |

`Inicio.html` y `BandejaGestor.html` se agregaron en la etapa 7 de la tarea 06;
`Mascotas.html` se agregó en la etapa 8 (era el único listado sin maqueta —
ver navegacion-v2.md, "Puntos abiertos"). Dos diferencias respecto de las
nueve primeras, hechas a propósito:

- El logo va como **SVG inline** (huella blanca sobre el cuadro teal de 40 px,
  radio 8) en vez del PNG en data URI. El PNG pesa ~60 KB en base64 y no se
  puede duplicar carácter por carácter sin riesgo de corromperlo; el SVG mantiene
  la misma caja, el mismo radio y la autonomía del archivo.
- Ambas traen un bloque con **borde punteado** rotulado *"Nota de diseño · no es
  parte de la pantalla"*: el recorte por rol del lanzador y el estado vacío de la
  bandeja. Es anotación para quien implemente, no interfaz.

## Tokens

```
Marca        teal #0C7A89 · teal oscuro #0B6976 · cian #13ABDF · azul #165788
Estado       ok #3D7A2C / #EEF6E9   ·  aviso #8A5A00 / #FBF3DB
             error #9F2F2D / #FDEBEC ·  info #0E6F8C / #E4F3F8
Superficie   fondo #FBFBFA · tarjeta #FFFFFF · hover #F7F6F3
Texto        #2F3437 principal · #787774 secundario · #9B9A97 etiquetas
Bordes       #EAEAEA · #F0F0EF
Radios       4 / 6 / 8 px · píldora 9999px
Sombra       0 1px 2px rgba(0,0,0,0.03)  (techo: 0 2px 8px rgba(0,0,0,0.04))
Tipografía   Geist (UI) · Newsreader (títulos, clase .ser) · Geist Mono (cifras, clase .num)
Controles    38-46 px de alto · barra lateral 248 px · cabecera 68 px
```

Son los mismos tokens estructurales que ya declara `static/css/styles.css`
—superficies, texto, bordes, radios y las tres familias tipográficas—; lo único
que cambia ahí es la familia de color, que pasa del verde clínico al teal de la
marca.

> ⚠️ **Corrección (etapa 7).** Esa frase describe `styles.css`, no lo que el
> navegador pinta hoy. `static/css/bridge.css` se carga al final y remapea
> `--primary`, las superficies y las tipografías a la capa 1A (Nocturne oscuro,
> acento `#9184d9`, Inter), y `index.html` solo carga Inter de Google Fonts, así
> que Geist y Newsreader nunca llegan a cargarse. La distancia entre estas
> maquetas y la aplicación actual es mayor que "un color": es toda la capa 1A.
> Qué se retira y cuándo está en `docs/diseno/navegacion-v2.md`.

## Datos de la maqueta

Todos los nombres, montos, pacientes y cifras son **de ejemplo**. La única
excepción conceptual son las cifras que tenían que cuadrar entre sí (la orden
OS-2418 suma $51,20 en las tres pantallas donde aparece; los ingresos por médico
suman el total del mes) — se cuidaron para que la maqueta no enseñe aritmética
equivocada, no porque sean datos reales.

`BandejaGestor.html` usa la misma OS-2418 que `OrdenAbierta.html`,
`AnexarServicio.html` y `Facturacion.html`: el hemograma de Luna que en la orden
figura como servicio de laboratorio es el que el gestor tiene en proceso.

## Lo que estas pantallas dibujan y la base todavía no soporta

- ~~**Órdenes de servicio**~~ — resuelto: la tabla, los estados, el despacho a
  gestores, las notificaciones y los adjuntos se implementaron en las etapas 1-6
  de la tarea 06. Ver `docs/diseno/ordenes-de-servicio.md`.
- **Tutores jurídicos** — `Propietario` solo tiene nombre, apellido y cédula.
- **Catálogo de diagnósticos** — `Consulta.diagnostico` es texto libre, así que
  "reportes por patología" no se puede agrupar.
- **Unidad de medida y stock fraccionado** en insumos (tarea 07).
- **Historial de precios** de servicios y materiales (tarea 08).

Ver `docs/diseno/arquitectura-informacion-v2.md`.
