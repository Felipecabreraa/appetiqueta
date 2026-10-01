---
name: pruebas-e2e
description: Cómo escribir y ejecutar pruebas end-to-end en App Etiquetado con Playwright (UI desktop/móvil) y el script de E2E de API, incluidas las reglas de seguridad de datos. Usar para validar flujos completos antes de cerrar un cambio.
paths:
  - tests/e2e/**
  - playwright.config.ts
  - scripts/e2e-carga-trackeo.mjs
---

# Pruebas E2E

## Entorno aislado (siempre)
- Las pruebas cargan **solo `.env.test`**. `scripts/test-env.mjs` aborta si `MYSQL_HOST` no es local o si `MYSQL_DATABASE` no termina en `_test`. Nunca usan `.env`, que puede apuntar a producción.
- Cada corrida **recrea la BD** (`schema.sql` + `database/seed.test.sql` + usuario de prueba). Eso permite escribir datos sin miedo y repetir el resultado. Para resetear a mano: `npm run db:test:reset`.
- Puertos propios: API en :3101 y Vite en :5174 (con proxy a :3101). Nunca se reutiliza un servidor de desarrollo.
- Semilla: temporada `2025-2026` vigente, empresa `Agrícola Esmeralda`, CC `CC01` (Cereza/Lapins/CSG001) y `CC02` (Arándano/Duke/CSG002), y los jefes `Juan Pérez` y `María Soto`. Si una funcionalidad necesita más datos, se amplía `seed.test.sql`.

## Niveles
| Nivel | Herramienta | Comando |
|---|---|---|
| UI | Playwright (`tests/e2e/*.spec.ts`), proyectos `desktop` y `movil` (Pixel 7) | `npm run test:e2e` |
| API | `scripts/e2e-api.mjs`, que corre `scripts/e2e-carga-trackeo.mjs` (lote, JC, acopio, reglas, concurrencia) | `npm run test:e2e:api` |
| Smoke remoto | solo los tests con la etiqueta `@smoke` (de **solo lectura**) | `E2E_REMOTE_URL=<url> npm run test:smoke:remote` |

**Regla:** contra staging o producción solo se ejecuta el smoke `@smoke`. Un test que escribe datos jamás lleva `@smoke`.

## Convenciones Playwright
- Un archivo por flujo: `tests/e2e/<flujo>.spec.ts`. El nombre del test empieza con el CA: `test('CA-02: operador no ve Maestros', ...)`.
- **Selectores accesibles:** `getByRole`, `getByLabel`, `getByText`. Evita selectores CSS frágiles. Si falta un nombre accesible, pide al dev que agregue `aria-label` o un `<label>`; no uses `data-testid` salvo que no haya alternativa.
- **Sin esperas fijas** (`waitForTimeout`): usa las aserciones auto-esperadas `expect(...).toBeVisible()`.
- **Login reutilizable:** `loginAs(page)` en `tests/e2e/helpers/auth.ts` (inicia sesión por API y siembra `localStorage`). La UI de login se prueba solo en su propio spec.
- **Datos por test:** cada test crea sus propias etiquetas (prefijo `E2E`), por ejemplo vía `POST /api/labels/batch` (ver `tests/e2e/flujo-qr.spec.ts`). No dependas del orden entre tests.
- **Flujo operativo QR:** se prueba navegando a `/?e=<CODIGO>`. Corresponde a lo que hace el celular al escanear.
- Ante un fallo, revisa la traza (`playwright-report/`, `test-results/`) y reporta la causa raíz, no solo el síntoma.

## Cobertura mínima esperada por funcionalidad
Camino feliz por rol, permiso denegado, validación con error visible, vista en móvil y, si toca etiquetas o movimientos, el ciclo completo generar → JC → acopio → completo.
