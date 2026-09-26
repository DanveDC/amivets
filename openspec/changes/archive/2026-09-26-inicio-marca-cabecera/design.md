# Design

## Context

`router.js::syncHeaderTitle` hace `return` temprano para `sec-inicio`, así que la cabecera (`#avHeaderTitleText` / `#avHeaderSubtitleText`) conserva lo que dejó la sección anterior. El lanzador (`sec-inicio`) arma su encabezado en `inicio.js` (saludo + fecha). El logo está en `/static/img/logo-amivets.png`.

## Goals / Non-Goals

**Goals:** marca visible en el inicio; cabecera coherente.
**Non-Goals:** rediseñar el lanzador o las tarjetas de módulos.

## Decisions

1. En `syncHeaderTitle`, para `sec-inicio` se escribe título "AMIVETS" y subtítulo "Sistema integral de gestión" en lugar de salir sin tocar nada.
2. El encabezado del lanzador suma un bloque de marca (logo 56px + "AMIVETS" + "Sistema integral de gestión") arriba del saludo, en el markup de `sec-inicio`, con clases nuevas en `shell.css`.
3. La marca de la barra lateral cambia "Sistema de gestión" por "Sistema integral de gestión".

## Risks / Trade-offs

- Ninguno relevante: son cambios de presentación.
