# App Etiquetado — guía para Claude

Sistema de etiquetas QR y trazabilidad JC → acopio para Agrícola Esmeralda.
React 19 + TS + Vite (`src/`) · Express + MySQL en un archivo (`server/index.cjs`) · Render.
Contexto de dominio completo en `.claude/skills/contexto-appetiquetado/SKILL.md`. Ambientes: `docs/AMBIENTES.md`.

## Ambientes y ramas
| Ambiente | Rama | Render | BD |
|---|---|---|---|
| Pruebas local | `feat/*`, `fix/*` | — | `appetiquetado_test` (local, `.env.test`) |
| **Pruebas (staging)** | `developer` | `appetiqueta-dev` | `trn_etiquetatest` |
| **Producción** | `main` | `appetiqueta` | producción |

- Flujo: `feat/x` (desde developer) → merge a `developer` → CI verde → staging → **aprobación del usuario** → merge a `main` → CI → producción.
- Render despliega solo si el CI pasa (`autoDeployTrigger: checksPass`).
- **A producción no llega nada sin la aprobación explícita del usuario.** El hook `.claude/hooks/git-push-gate.mjs` bloquea el push forzado, el push a `main` con contenido que no esté en `origin/developer` y el push con `verify` en rojo.
- Nunca leer ni editar `.env` (puede ser producción). Nunca `npm run server` / `npm start` desde Claude: usar `npm run server:test`.

## Cómo se trabaja
- Toda necesidad no trivial pasa por **`/equipo <necesidad>`** (o `claude --agent lead`). Los entregables quedan en `docs/specs/<id>/`.
- Compuerta de calidad: **`/verificar`** (lint, typecheck, unit, build, E2E UI desktop+móvil, E2E API).
- Publicar: **`/desplegar pruebas`** o **`/desplegar produccion`** (este último exige aprobación).

## Comandos
- `npm run dev` · `npm run server:test` · `npm run db:test:reset`
- `npm run verify` · `npm test` · `npm run test:e2e` · `npm run test:e2e:api` · `npm run test:all`
- `E2E_REMOTE_URL=<url> npm run test:smoke:remote` (solo lectura, para staging/producción)

## Convenciones clave
- UI y mensajes en español. Códigos de error de la API en `snake_case`. Respuestas `{ ok, ... }`.
- IDs de etiqueta: 12 caracteres en mayúsculas, normalizados con `trim().toUpperCase()` en cada frontera.
- Permisos en dos lugares que deben coincidir: `src/lib/roleAccess.ts` y `ACCESS` en `server/index.cjs`.
- SQL siempre con placeholders `?`. Cambios de esquema idempotentes y reflejados en `database/schema.sql`.
