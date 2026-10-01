---
name: pruebas-unitarias
description: Cómo escribir y ejecutar pruebas unitarias con Vitest en App Etiquetado (estructura, jsdom/localStorage, mocks de fetch, trazabilidad a CA). Usar al crear o corregir pruebas unitarias o al hacer TDD.
paths:
  - tests/unit/**
  - src/**/*.test.ts
  - src/**/*.test.tsx
---

# Pruebas unitarias (Vitest)

- Configuración: `vitest.config.ts` (entorno `jsdom`, `restoreMocks: true`).
- Ubicación: `tests/unit/<modulo>.test.ts`. Se importa desde `../../src/...`.
- Ejecutar: `npm test`, o `npx vitest run tests/unit/<archivo>` para una sola suite. Cobertura: `npm run test:coverage`.

## Convenciones
- `describe` por módulo o función, e `it` en español, describiendo el comportamiento: `it('rechaza ids duplicados')`.
- **Trazabilidad:** cuando un test cubre un criterio de aceptación, el CA va al inicio del nombre: `it('CA-03: operador no puede exportar Excel')`.
- **Patrón AAA** (preparar / actuar / verificar). Un comportamiento por `it`. Usa `it.each` para tablas de casos.
- **Aislamiento:** `beforeEach(() => localStorage.clear())` en todo test que use `src/lib/storage.ts` o `batchHistory.ts`.
- **Red:** `vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))`. No hagas llamadas reales a la API en tests unitarios.
- **Tiempo:** `vi.useFakeTimers()` + `vi.setSystemTime(...)` cuando el resultado depende de la fecha.
- Prueba la **interfaz pública**, no los detalles internos. No hagas snapshots de objetos grandes.

## TDD (fase 3 del flujo)
1. Escribe el test desde el CA, antes de que exista la implementación.
2. Ejecútalo y confirma que **falla por la razón esperada** (aserción, o función inexistente), no por un error de sintaxis o de import mal escrito.
3. Reporta la salida roja como evidencia. El dev la pondrá en verde.

## Qué cubrir en este repo
Prioriza `src/lib/`: storage (fases JC/acopio, unicidad, normalización), creación de lotes, payload QR, roles, exportación a Excel (columnas y orden), clientes de API (manejo de `ok:false` y errores de red) y `labelFormValues`.

## Límite actual
`server/index.cjs` no es importable sin arrancar el servidor. Las reglas del backend se prueban con E2E de API (skill `pruebas-e2e`) hasta que se haga el refactor descrito en `contexto-appetiquetado`.
