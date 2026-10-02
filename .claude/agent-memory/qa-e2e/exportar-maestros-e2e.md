---
name: exportar-maestros-e2e
description: Trampas del E2E de exportar maestros (xlsx en ESM, zsh, puertos alternos, worktree appetiquetado-export)
metadata:
  type: project
---

- En specs/helpers Playwright, `import * as XLSX from 'xlsx'` NO tiene `XLSX.readFile` (ESM sin fs): usar `XLSX.read(fs.readFileSync(p), {type:'buffer', cellNF:true})`. `writeFile` sí funciona en los specs existentes.
- zsh no separa variables sin comillas: para pasar varios archivos a `playwright test` usar `${=FILES}`.
- Worktree `/Users/felipelagos/Projects/appetiquetado-export`: config temporal `scratchpad/pwx.config.mjs` (API 3131, Vite 5186, cwd del worktree). `scripts/e2e-api.mjs` fija 3101/5174 y no admite override: no se puede correr `test:e2e:api` completo si esos puertos son del Lead; el runner de volumen sí admite `E2E_VOLUMEN_PORT`.
- Helpers nuevos: `tests/e2e/helpers/fotoMaestros.ts` (instantánea 7 tablas) y `maestros-exportar.ts` (exportar por UI, fixtures de temporada propia `E2E-EXP-<sfx>`, `parsearConImportador` con import dinámico de `src/lib/masterExcel`).
