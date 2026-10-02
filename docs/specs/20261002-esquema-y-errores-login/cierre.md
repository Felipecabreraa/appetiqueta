# Cierre — 20261002-esquema-y-errores-login

**Necesidad:** que no vuelva a pasar el incidente de staging (tabla `auth_sessions` ausente → login con "Credenciales inválidas" ante un 500; Maestros vacío tras importar un dump con el servidor encendido).
**Talla:** M · **Rama:** `fix/esquema-y-errores-login` · **Staging:** https://appetiqueta-dev.onrender.com

## Qué cambia
- Al arrancar, el servidor crea solo las tablas base que falten (`CREATE TABLE IF NOT EXISTS` de `schema.sql`, una por una, en orden de FK; nunca DROP/DELETE/INSERT). Si no puede, lo registra y sigue: ya no deja toda la API en 503.
- `/api/health` sigue en 200 y agrega `schemaComplete`, `missingTables`, `mastersAuditReady`, `movementsSchemaReady`. El smoke remoto falla si el esquema está incompleto.
- Si el esquema cambia con el servidor encendido, se re-detecta (solo SELECT, máx. 1 cada 10 s) y las lecturas reintentan una vez.
- Login: 5 mensajes diferenciados (401, 5xx, red, 429, otros 4xx). Maestros muestra el error en español en vez de "db".
- `docs/AMBIENTES.md`: guía para copiar producción → staging.

## Matriz CA → prueba → resultado
| CA | Prueba | Resultado |
|---|---|---|
| CA-01, CA-02 (+borde users) | `scripts/e2e-esquema-arranque.mjs` · `tests/unit/schemaBootstrap.test.ts` | ✅ |
| CA-03 (idempotencia) | `e2e-esquema-arranque.mjs` · `e2e-migracion-maestros.mjs` · unit | ✅ |
| CA-04 (nada destructivo) | `e2e-esquema-arranque.mjs` · unit | ✅ |
| CA-05 (sin privilegio CREATE) | `e2e-esquema-arranque.mjs` (solo en CI, MariaDB 10.6) · unit con pool falso | ⏳ CI |
| CA-06, CA-17 (health sin datos sensibles) | `tests/e2e/health-esquema-api.spec.ts` (+ borde de fuga) · `permisos-api.spec.ts` | ✅ |
| CA-07, CA-08 | `e2e-esquema-arranque.mjs` · `tests/unit/schemaState.test.ts` | ✅ |
| CA-09, CA-10 (smoke) | `tests/e2e/smoke.spec.ts` · `tests/unit/healthCheck.test.ts` | ✅ |
| CA-11..CA-14, P4 (login) | `tests/e2e/login-errores.spec.ts` · `login-red-intermitente.spec.ts` · `tests/unit/authApi.test.ts` | ✅ desktop + móvil |
| CA-15 | `e2e-esquema-arranque.mjs` | ✅ |
| CA-16 (Maestros ante 5xx / esquema en caliente) | `maestros-error-servidor.spec.ts` · `maestros-error-guardado.spec.ts` · `e2e-esquema-arranque.mjs` · unit | ✅ desktop + móvil |

## Evidencia
- `/verificar` sobre 8852e5f: lint 0 errores · tsc ok · unit 218/218 · build ok · E2E UI 158 ok (8 skip intencionales de multiusuario en desktop) · E2E API 43/43 + CA-27 + esquema-arranque OK.
- Revisor: vuelta 1 APROBADO CON CAMBIOS → vuelta 2 **APROBADO**.

## Migración
Ninguna de datos. Solo crea tablas faltantes del esquema oficial al arrancar.

## Rollback
Solo de código (`git revert` del merge o redeploy del commit anterior en Render). Nada que deshacer en la BD.

## Publicación en staging
(pendiente)
