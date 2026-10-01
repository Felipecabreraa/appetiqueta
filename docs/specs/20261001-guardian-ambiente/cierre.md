# Cierre — Guardián de ambiente

- **Rama:** feat/guardian-ambiente → developer · **Producción:** pendiente de aprobación del usuario.

## Solución
- `server/envGuard.cjs`: `checkEnvironment(env)`, una función pura y testeable.
- `server/index.cjs`: el guardián corre antes de abrir el pool de MySQL. Si falla, registra `[guardian] …` y termina con código 1. `GET /api/health` expone `env`.
- Smoke `@smoke`: con `E2E_EXPECTED_ENV` confirma el ambiente del servicio desplegado.

## Trazabilidad
| CA | Prueba | Resultado |
|---|---|---|
| CA-01 staging solo con trn_etiquetatest | `tests/unit/envGuard.test.ts` (función + arranque real del servidor) | ✅ |
| CA-02 producción sin BD de pruebas | ídem (3 casos + arranque real) | ✅ |
| CA-03 combinaciones válidas | ídem | ✅ |
| CA-04 APP_ENV desconocido | ídem | ✅ |
| CA-05 sin APP_ENV → arranca con advertencia | ídem + E2E local (no define APP_ENV) | ✅ |
| CA-06 /api/health informa `env` | `tests/e2e/smoke.spec.ts` (desktop + móvil) | ✅ |
| Regresión | verify (26 unit) · build · Playwright 8/8 · E2E API 43/43 | ✅ |

## Revisión
- El guardián corre antes de cualquier conexión: un error de configuración no llega a tocar la BD.
- El arranque real se prueba con `MYSQL_HOST=guardian.invalid`: aunque el guardián fallara, no se conectaría a ninguna BD real.
- Riesgo residual: mientras `APP_ENV` no esté definido en Render, el guardián queda inactivo (CA-05). **Acción:** definir `APP_ENV=staging` en appetiqueta-dev y `APP_ENV=production` en appetiqueta.
