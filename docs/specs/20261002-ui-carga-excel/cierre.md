# Cierre — 20261002-ui-carga-excel

**Necesidad:** la pantalla Maestros → Carga desde Excel mezclaba exportar, plantilla e importar ("no se logra visualizar qué es para qué"), y en móvil los campos desbordaban.
**Talla:** S · **Rama:** `fix/ui-carga-excel` · **Diseño:** "Dos tarjetas" elegido y aprobado visualmente por el usuario (capturas `antes-*.png` / `despues-*.png`).

## Matriz CA → prueba → resultado
| CA | Prueba | Resultado |
|---|---|---|
| CA-01 dos secciones con título y descripción, exportar primero | `tests/e2e/maestros-carga-excel-ui.spec.ts` | ✅ desktop + móvil |
| CA-02 cada control en su sección | ídem (9 controles) | ✅ desktop + móvil |
| CA-03 avisos en su sección, role="status" único, sin alert; región siempre en el árbol a11y | ídem | ✅ desktop + móvil |
| CA-04 sin desborde en móvil | ídem (Pixel 7) | ✅ móvil |
| CA-05 sin regresión | suites `maestros-*`, `permisos-*` y suite completa | ✅ |

## Evidencia
- `/verificar` sobre 86760d1: lint 0 errores · tsc ok · unit 328/328 · build ok · E2E UI 267 ok + 9 skip intencionales · E2E API 43/43 + CA-27 + esquema-arranque + CA-19.
- Revisor: APROBADO CON CAMBIOS → IMP a11y corregido con prueba primero.

## Migración / Rollback
Solo frontend (MasterDataView.tsx, App.css). Rollback: `git revert` del merge o redeploy del commit anterior.

## Publicación en staging
- 2026-10-02: publicado en staging (075a1e9), CI verde.


## Aprobación para producción
- **Fecha y hora:** 2026-10-02 20:44 (America/Santiago)
- **Frase textual del usuario:** "Sí, apruebo publicar en producción" (respuesta a "¿Apruebas publicar en producción estos 4 cambios?", tras ver el paquete: admin-maestros, exportar-maestros-excel, esquema-y-errores-login y ui-carga-excel, con migración, rollback y comprobaciones previas).
- **Comprobaciones previas pedidas al usuario (BD de producción, solo lectura):** `SHOW GRANTS FOR CURRENT_USER();` (ALTER/REFERENCES) y conteo de relaciones con variedad de otra especie.
