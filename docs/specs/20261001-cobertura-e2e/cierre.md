# Cierre — cobertura E2E

Resultado: `npm run test:e2e` 30/30 (desktop + móvil, dos corridas seguidas), `npm run test:e2e:api` 43/43, `npm run verify` sin errores (2 warnings de lint preexistentes).

| CA | Spec | Desktop | Móvil | Resultado |
|---|---|---|---|---|
| CA-01 | tests/e2e/generar-lote.spec.ts | OK | OK | Verificado |
| CA-02 | tests/e2e/generar-lote.spec.ts | OK | OK | Verificado |
| CA-03 | tests/e2e/maestros-excel.spec.ts | OK | OK | Verificado |
| CA-04 | tests/e2e/excel-trackeo.spec.ts | OK | OK | Verificado |
| CA-05 | tests/e2e/permisos-ui.spec.ts (4 tests) | OK | OK | Verificado |
| CA-06 | tests/e2e/permisos-api.spec.ts (3 tests) | OK | OK | Verificado |

## Hallazgo de producto (no corregido)
En `src/App.tsx` el aviso "No tiene permisos para acceder al módulo ..." al forzar `/#maestros/excel` con rol operador desaparece de forma intermitente (~50 %): la respuesta de `fetchCurrentUser` hace `setUser(...)` con un objeto nuevo, el efecto `applyHashTab` se reejecuta tras `replaceState` ya con `#generar` y llama `navigateToTab('generar')`, que borra el mensaje (`setAccessDeniedMessage(null)`). La redirección sí funciona, así que no impide el CA-05; el test no afirma el aviso.

## Notas
- CA-03 importa a una temporada nueva no vigente para no alterar la temporada actual que usan otros tests.
- El QR se localiza con `.label-sheet svg` (el SVG de `qrcode.react` no tiene nombre accesible).
- Los tests de escritura no llevan `@smoke`.
