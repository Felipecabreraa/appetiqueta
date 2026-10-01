# Cierre — Deadlock en POST /api/movements

- **Tipo:** bug · **Talla:** S · **Rama:** feat/ambientes-y-equipo → developer
- **Estado:** publicado en pruebas (developer). Producción: **pendiente de aprobación del usuario.**

## Problema
Los cambios en curso de `server/index.cjs` (validación del orden JC → acopio en el servidor) agregaron
`SELECT type FROM movements WHERE label_id = ? FOR UPDATE`. Cuando dos etiquetas distintas aún no tenían
movimientos, InnoDB tomaba gap locks sobre el mismo hueco del índice `idx_movements_label_at`, y los
`INSERT` posteriores se bloqueaban entre sí. Resultado: `ER_LOCK_DEADLOCK` → HTTP 500 en ~3 de 120 lecturas JC
concurrentes. Lo detectó `npm run test:e2e:api`. No afectaba a producción: el código no estaba publicado.

## Solución
La lectura de `movements` pasa a ser no bloqueante. El `SELECT … FROM labels … FOR UPDATE` previo ya serializa
las transacciones de una misma etiqueta. La lectura de movimientos crea su vista después de obtener ese lock,
así que ve lo que commiteó la transacción anterior.

## Trazabilidad
| Criterio | Prueba | Resultado |
|---|---|---|
| JC concurrentes sobre etiquetas distintas no fallan | `test:e2e:api` — "Primer trackeo JC 120/120" | ✅ 3 corridas (conc. 4) + 1 corrida (200 etiquetas, conc. 8) |
| Solo un JC gana entre 3 simultáneos en la misma etiqueta | `test:e2e:api` — "Carrera: solo un JC gana" | ✅ |
| Orden JC → acopio → completo (409 en lecturas fuera de orden) | `test:e2e:api` + `tests/e2e/flujo-qr.spec.ts` | ✅ desktop + móvil |
| Regresión | `npm run verify` (18 unit) · build · Playwright 8/8 · E2E API 43/43 | ✅ |
