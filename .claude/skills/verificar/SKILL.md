---
name: verificar
description: Compuerta de calidad de App Etiquetado. Ejecuta lint, typecheck, unit, build, E2E UI (desktop+móvil) y E2E API contra la BD local de pruebas, y reporta un veredicto. Usar antes de revisar, cerrar o publicar.
argument-hint: "[rapido]"
allowed-tools: Bash(npm run lint) Bash(npm run typecheck) Bash(npm test) Bash(npm run test) Bash(npm run build) Bash(npm run test:e2e) Bash(npm run test:e2e:api) Bash(npx vitest *) Bash(npx playwright test *)
---

# Compuerta de calidad

Cambios actuales:
!`git status --short --branch`

Ejecuta en orden y **detente en el primer fallo**. Todas las pruebas con escritura usan `.env.test`: la BD local `*_test`, recreada en cada corrida y protegida por el guardián de `scripts/test-env.mjs`.

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run test:e2e` (Playwright, desktop + móvil)
6. `npm run test:e2e:api` (lote + JC + acopio + reglas + concurrencia)

Con el argumento `rapido` ("$ARGUMENTS") solo se corren los pasos 1 a 3 (útil durante el desarrollo). **Nunca** sirve para cerrar ni publicar.

| Paso | Resultado | Detalle |
|---|---|---|
| lint | ✅/❌ | nº de errores o el primero con `archivo:línea` |
| typecheck | ... | ... |
| unit | ... | pasaron/fallaron |
| build | ... | ... |
| e2e UI | ... | desktop x/y · móvil x/y |
| e2e API | ... | pasaron/fallaron + fallos |

**Veredicto:** APTO / NO APTO. Si es NO APTO, indica la causa más probable (con el log) y el dueño (dev-backend, dev-frontend o qa). No corrijas código en esta skill.
