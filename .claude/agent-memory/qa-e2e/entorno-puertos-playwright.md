---
name: entorno-puertos-playwright
description: Choque de puertos al correr Playwright/E2E API cuando el Lead tiene server:test (3101) y Vite (5173) levantados; cómo correr sin matarlos
metadata:
  type: project
---

playwright.config.ts levanta API en :3101 y Vite en :5174 con `reuseExistingServer:false`, y resetea la BD `appetiquetado_test` (única BD permitida; el usuario MySQL solo tiene GRANT sobre ella). Si el Lead ya corre `npm run server:test` en 3101, `npm run test:e2e`/`test:e2e:api` fallan por puerto ocupado.

**How to apply:** no matar procesos. Usar un config temporal fuera del repo (scratchpad, `.mjs`, import de `node_modules/@playwright/test/index.js` con default import) con `PORT: '3111'` y Vite 5175; para la migración usar `E2E_MIGRACION_PORT=3112 node scripts/e2e-migracion-maestros.mjs`. El reset de BD afecta igual al servidor del Lead (misma BD): avisarlo.

Selectores estables: nav `Módulos` (botones exact), nav `Módulos del maestro` (botones `^Catálogo` con contador), `#masters-panel-form`, buscador `getByPlaceholder('Buscar código, nombre o dato…')`, grupo `Filtrar por estado`. `getByLabel('Estado')` es ambiguo (el label envuelve el select y el grupo del filtro): usar `#masters-panel-form label` + `select`. `/` abre en "Crear etiquetas", no en Resumen: ir con `irAModulo(page,'Resumen')`.
