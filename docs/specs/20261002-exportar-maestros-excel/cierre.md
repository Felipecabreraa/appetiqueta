# Cierre — 20261002-exportar-maestros-excel

**Necesidad:** exportar a Excel los datos de Maestros en el formato de la plantilla, para editar y reimportar sin pérdida.
**Talla:** L · **Rama:** `feat/exportar-maestros-excel` · **Staging:** https://appetiqueta-dev.onrender.com

## Qué cambia
- **Maestros → Carga desde Excel:** selector "Temporada a exportar" y botón "Exportar maestros a Excel" junto a "Descargar plantilla Excel". Archivo `maestros-<código>-<AAAA-MM-DD>.xlsx` con hojas **Maestros** (reimportable, 6 columnas con NOMBRE CC), **No importables** (con MOTIVO, incluida "Variedad de otra especie") y **Temporada**. Celdas como texto.
- **Importación corregida (P3/P4/P5):** busca catálogos por nombre (ya no da 500 con "Agrícola Esmeralda"), no borra `center_name` si la columna no viene o está vacía, y no toca `source` ni la auditoría si los datos no cambian. Rechaza un archivo cuya primera hoja sea "No importables".
- Permisos sin cambios: Admin y SuperAdmin.

## Matriz CA → prueba → resultado
| CA | Prueba | Resultado |
|---|---|---|
| CA-01..CA-04, CA-17 | `tests/e2e/maestros-exportar.spec.ts` · `tests/unit/masterExcel.test.ts` | ✅ desktop + móvil |
| CA-05 | `tests/unit/masterExcel.test.ts` | ✅ |
| CA-06, CA-08..CA-10, CA-16, CA-21, CA-22, P3, P4, P5 | `tests/e2e/maestros-exportar-api.spec.ts` · `tests/unit/masterImport.test.ts` | ✅ |
| CA-07 (ida y vuelta) | UI + API + unit | ✅ |
| CA-11..CA-15, CA-18, CA-20, P1/P10/P11/P14 | `maestros-exportar.spec.ts` | ✅ desktop + móvil |
| CA-19 (5000 filas) | `scripts/e2e-exportar-volumen.mjs` (en `test:e2e:api`) · unit | ✅ |
| MEN-6 | unit | ✅ |
| Bordes §6 (concurrencia, edición combinada, espacios, temporada inactiva) | `tests/e2e/maestros-exportar-bordes.spec.ts` | ✅ desktop + móvil |

## Evidencia
- `/verificar` en serie (517bc73): lint 0 errores · tsc ok · unit 328/328 · build ok · E2E UI 216 ok + 8 skip intencionales · E2E API 43/43 + CA-27 + esquema-arranque + CA-19.
- Fase 6 (cc839ff): E2E UI 234 ok + 8 skip · API ok.
- Revisor: **APROBADO** (diseño: aprobado con cambios, resuelto en §11).

## Antes de producción
Consulta de solo lectura (no bloquea): `SELECT COUNT(*) FROM season_cost_centers scc JOIN varieties v ON v.id = scc.variety_id WHERE v.species_id <> scc.species_id;` — cuántas relaciones irán a "No importables".

## Migración / Rollback
Sin cambios de esquema ni backfill. Rollback de código: `git revert` del merge o redeploy del commit anterior.

## Publicación en staging
- 2026-10-02: publicado en staging (d4c491b), CI verde, smoke 6/6.


## Aprobación para producción
- **Fecha y hora:** 2026-10-02 20:44 (America/Santiago)
- **Frase textual del usuario:** "Sí, apruebo publicar en producción" (respuesta a "¿Apruebas publicar en producción estos 4 cambios?", tras ver el paquete: admin-maestros, exportar-maestros-excel, esquema-y-errores-login y ui-carga-excel, con migración, rollback y comprobaciones previas).
- **Comprobaciones previas pedidas al usuario (BD de producción, solo lectura):** `SHOW GRANTS FOR CURRENT_USER();` (ALTER/REFERENCES) y conteo de relaciones con variedad de otra especie.
