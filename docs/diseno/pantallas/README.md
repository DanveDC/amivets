# Pantallas del rediseño — AmiVets

Nueve maquetas estáticas de 1440×900, autocontenidas: cada `.html` se abre en el
navegador sin servidor y sin dependencias (el logo va incrustado como data URI;
las fuentes se cargan de Google Fonts).

**Estos archivos son la fuente para pasar el diseño a código**, no el canvas
publicado en claude.ai. Aquí los valores están literales —colores, tamaños,
espaciados, alturas de control— y se leen y copian directamente.

| Archivo | Pantalla |
|---|---|
| `Login.html` | Inicio de sesión |
| `Main.html` | Panel del día — inicio de Admisión |
| `OrdenAbierta.html` | Orden de servicio abierta (la pantalla de trabajo) |
| `AnexarServicio.html` | Panel lateral para anexar un servicio a la orden |
| `FichaMascota.html` | Ficha de paciente e historia clínica |
| `Insumos.html` | Inventario con unidad de medida y stock fraccionado |
| `Catalogo.html` | Catálogo de servicios, su receta de insumos y su historial de precios |
| `Facturacion.html` | Facturación de una orden |
| `Reportes.html` | KPI y reportes |

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

Son los mismos tokens estructurales que ya usa `static/css/styles.css`; lo único
que cambia respecto al sistema actual es la familia de color, que pasa del verde
clínico al teal de la marca.

## Datos de la maqueta

Todos los nombres, montos, pacientes y cifras son **de ejemplo**. La única
excepción conceptual son las cifras que tenían que cuadrar entre sí (la orden
OS-2418 suma $51,20 en las tres pantallas donde aparece; los ingresos por médico
suman el total del mes) — se cuidaron para que la maqueta no enseñe aritmética
equivocada, no porque sean datos reales.

## Lo que estas pantallas dibujan y la base todavía no soporta

- **Órdenes de servicio** — no existe la tabla; hoy el contenedor es `Consulta`.
- **Tutores jurídicos** — `Propietario` solo tiene nombre, apellido y cédula.
- **Catálogo de diagnósticos** — `Consulta.diagnostico` es texto libre, así que
  "reportes por patología" no se puede agrupar.
- **Unidad de medida y stock fraccionado** en insumos (tarea 07).
- **Historial de precios** de servicios y materiales (tarea 08).

Ver `docs/diseno/arquitectura-informacion-v2.md`.
