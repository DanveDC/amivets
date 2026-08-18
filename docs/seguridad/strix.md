# Strix — barrido de seguridad automatizado

Estado: **pendiente de ejecutar**. Instalación no realizada todavía porque
requiere una API key de LLM (o una cuenta en app.strix.ai) que no estaba
disponible al momento de escribir esto (2026-08-18). Este documento deja el
procedimiento listo para que correrlo la próxima vez tome minutos, no
investigación.

Repo oficial: [github.com/usestrix/strix](https://github.com/usestrix/strix)
(Apache 2.0, ~39k stars). Nunca se usó antes en broker-suite, Cabal ni
AmiVets — es la primera vez que se documenta el procedimiento.

## Qué es

Strix es un framework de pentesting autónomo: agentes de IA que atacan la
app dinámicamente (no análisis estático) y validan cada hallazgo con un
proof-of-concept real, no solo lo reportan. Corre en un sandbox Docker.

## Prerrequisitos

- Docker corriendo.
- Python 3.12+ (o usar el instalador que trae su propio entorno).
- Una API key de un proveedor LLM soportado (OpenAI, Anthropic, Google,
  Bedrock, Azure, o un modelo local vía Ollama/LMStudio) — **o**, para la
  opción gestionada, una cuenta en app.strix.ai en vez de key propia.

## Opción A — CLI local (recomendada para "nunca contra producción")

Corre 100% local, contra el entorno Docker de AmiVets. Es la opción que
pide la tarea 01 ("Nunca contra producción ni contra Supabase. Solo contra
el entorno local").

```bash
# 1. Instalar
curl -sSL https://strix.ai/install | bash

# 2. Configurar el proveedor LLM (propio, no reutiliza esta sesión de Claude Code)
export STRIX_LLM="anthropic/claude-sonnet-4-6"   # o el modelo/proveedor que corresponda
export LLM_API_KEY="sk-..."

# 3. Levantar el stack local de AmiVets (si no está arriba)
cd /mnt/c/Users/dalec/desktop/veterinaria/amivets
docker compose up -d

# 4. Correr el scan apuntando al backend local, NUNCA a Render/Supabase
strix --target http://localhost:8000
# alternativa: análisis de código fuente sin atacar nada en vivo
strix --target ./backend

# 5. Ver resultados (levanta un server local en 127.0.0.1, puerto random)
strix view
```

Los resultados quedan en `strix_runs/<nombre-de-run>/` dentro del repo —
agregar esa carpeta a `.gitignore` antes de correrlo la primera vez, no
commitear reportes de vulnerabilidades.

## Opción B — Skill de Claude Code (sin instalar el CLI a mano)

El repo de Strix se distribuye también como skill instalable:

```bash
npx skills add usestrix/strix
```

Esto agrega cuatro skills a este proyecto:

- `penetration-testing-with-strix` — correr scans headless y leer resultados
  desde Claude Code directamente.
- `fix-security-vulnerabilities-with-strix` — remediar hallazgos y
  re-escanear para confirmar el fix.
- `ci-security-scanning-with-strix` — scanning en PRs vía CI.
- `managed-pentesting-with-strix` — corre contra la plataforma gestionada
  **app.strix.ai** vía REST. **No necesita Docker local ni API key de LLM
  propia** — solo una cuenta en app.strix.ai. Es la opción más rápida si en
  algún momento no hay una API key de LLM a mano, pero implica mandar el
  código/tráfico a un servicio de terceros — confirmar con el equipo antes
  de usarla si el proyecto maneja datos sensibles (acá: datos de dueños y
  mascotas).

Para uso local puro (sin mandar nada a terceros), la Opción A es la
correcta.

## Triaje de resultados (obligatorio antes de "arreglar" nada)

Las herramientas automatizadas producen falsos positivos. Antes de tocar
código por un hallazgo de Strix:

1. Leer el PoC que Strix genera para cada hallazgo — si no hay PoC
   reproducible, es sospechoso de falso positivo.
2. Cruzarlo contra lo que ya se revisó a mano en la Unidad B de esta tarea
   (`docs/tareas/01-pruebas-funcionales-y-seguridad.md`) — si reporta algo
   ya cerrado ahí (auth de `supabase_admin.py`, CORS, rate limit de
   `citas-qr`), correrlo *después* de esos commits para no reportar ruido
   viejo.
3. Clasificar cada hallazgo real: acotado → arreglar directo; grande →
   convertir en tarea propuesta aparte, no improvisar el fix.

## Qué falta para poder ejecutarlo

- [ ] Conseguir una API key de LLM (Anthropic/OpenAI) para la Opción A, o
      una cuenta de app.strix.ai para la Opción B.
- [ ] Correrlo contra el AmiVets local, después de los commits de la
      Unidad B (para no reportar lo que ya se arregló).
- [ ] Triaje de resultados según el procedimiento de arriba.
- [ ] Arreglar lo acotado; convertir lo grande en tarea propuesta.
