# Cierre — 20261002-admin-maestros

**Necesidad:** el Admin completa y edita los maestros del sistema (todos, incluida la importación Excel y activar/desactivar), excepto Usuarios, que sigue exclusivo del SuperAdmin. Se agregó auditoría por registro (quién y cuándo creó y modificó por última vez).
**Talla:** L · **Rama:** `feat/admin-maestros` · **Staging:** https://appetiqueta-dev.onrender.com

## Matriz CA → prueba → resultado

| CA | Prueba | Ámbito | Resultado |
|---|---|---|---|
| CA-01 | `tests/e2e/permisos-ui.spec.ts` "CA-01: admin ve … Maestros, no Usuarios" | desktop + móvil | ✅ |
| CA-02 | `tests/e2e/maestros-admin.spec.ts` CA-02 | desktop + móvil | ✅ |
| CA-03 | `maestros-admin.spec.ts` CA-03 | desktop + móvil | ✅ |
| CA-04 | `maestros-admin.spec.ts` CA-04 | desktop + móvil | ✅ |
| CA-05 (+ D1 "Inactivo") | `maestros-admin.spec.ts` CA-05 (chip y filtro) | desktop + móvil | ✅ |
| CA-06 | `maestros-admin.spec.ts` CA-06 | desktop + móvil | ✅ |
| CA-07 | `maestros-auditoria-api.spec.ts` CA-07 · `permisos-api.spec.ts` CA-07/09 | API | ✅ |
| CA-08 | `maestros-auditoria-api.spec.ts` CA-08 | API | ✅ |
| CA-09 | `permisos-api.spec.ts` CA-07/CA-09 | API | ✅ |
| CA-10 | `maestros-admin.spec.ts` CA-10 | desktop + móvil | ✅ |
| CA-11 | `permisos-ui.spec.ts` operador (×2) | desktop + móvil | ✅ |
| CA-12 | `permisos-api.spec.ts` CA-12 | API | ✅ |
| CA-13 | `permisos-api.spec.ts` CA-13 | API | ✅ |
| CA-14 | `permisos-api.spec.ts` CA-14 · `permisos-ui.spec.ts` superadmin | API + UI | ✅ |
| CA-15 | `tests/unit/roleAccess.test.ts` | unit | ✅ |
| CA-16 | `maestros-admin.spec.ts` CA-16 · `maestros-bordes-api.spec.ts` CA-16 | UI + API | ✅ |
| CA-17..CA-20 | `maestros-auditoria-api.spec.ts` CA-17..CA-20 · `masterAuditServer.test.ts` | API + unit | ✅ |
| CA-21/22/23 | `maestros-auditoria-ui.spec.ts` · `masterAudit.test.ts` | desktop + móvil + unit | ✅ |
| CA-24 | `maestros-auditoria-ui.spec.ts` CA-24 · `masterAudit.test.ts` | desktop + móvil + unit | ✅ |
| CA-25 | `maestros-auditoria-api.spec.ts` CA-25 · `maestros-auditoria-ui.spec.ts` CA-25 (UI) | API + UI | ✅ |
| CA-26 | `maestros-auditoria-api.spec.ts` CA-26 (a y b) · unit | API + unit | ✅ |
| CA-27 | `scripts/e2e-migracion-maestros.mjs` (en `test:e2e:api`) · unit (42/0/0 ALTER) | script + unit | ✅ |
| CA-28 | `maestros-auditoria-api.spec.ts` CA-28 · unit | API + unit | ✅ |
| CA-29 | `maestros-auditoria-api.spec.ts` CA-29 · unit (rama importación) | API + unit | ✅ |
| D4 (modo degradado) | `masterAuditServer.test.ts` | unit | ✅ |
| D5 (fecha inválida → 400) | `maestros-auditoria-api.spec.ts` D5 · `maestros-bordes-api.spec.ts` D5 | API | ✅ |
| Recortar textos largos | `maestros-bordes-api.spec.ts` Recorte (7 tablas) | API | ✅ |
| Concurrencia §6 | `maestros-bordes-api.spec.ts` (×3) | API | ✅ |

## Evidencia
- `/verificar` (fase 5): lint 0 errores · typecheck ok · unit 101/101 · build ok · E2E UI 100 ok · E2E API 43/43 + CA-27 OK.
- Fase 6 (qa-e2e): E2E UI 122 ok (8 skip intencionales: `multiusuario` solo móvil, pasa 8/8 en móvil) · E2E API 43/43 · CA-27 OK.
- Fase 7 (revisor-codigo): **APROBADO**, 0 bloqueantes, 0 importantes, 5 menores diferidos (ver `estado.md`).
- `/verificar` sobre el merge en `developer`: ver la sección "Publicación en staging".

## Migración que se aplicará (staging y producción)
Al arrancar el servidor, `ensureMastersAuditSchema` (`server/masterAudit.cjs`) agrega, de forma idempotente, `created_by` y `updated_by` (`BIGINT UNSIGNED NULL`, índice y FK a `users` con `ON DELETE SET NULL`) en `seasons`, `companies`, `species`, `varieties`, `csg_catalog`, `jc_foremen` y `season_cost_centers`. No rellena datos: los registros existentes quedan "sin autor registrado". Verificar en el log: `Auditoría de maestros lista (7 tablas)`. Si faltan privilegios `ALTER`, Maestros funciona sin auditoría (modo degradado).

## Rollback
Solo de código: redeploy del commit anterior en Render o `git revert` del merge. El código anterior funciona con las columnas nuevas (son NULL y no se leen). No hace falta revertir el esquema.

## Publicación en staging
(pendiente)
