---
name: patrones-unit
description: Patrones y trampas para pruebas unitarias en appetiquetado (cjs, pool falso, config vitest)
metadata:
  type: project
---
- Vitest corre con jsdom e incluye `tests/unit/**/*.test.ts`; `restoreMocks: true` (los spies de console se recrean en beforeEach).
- Cargar `.cjs` del servidor con `createRequire(import.meta.url)` (ver tests/unit/rateLimit.test.ts). `server/index.cjs` no es importable.
- Para migraciones, un pool falso con estado (columnas/índices/FK) que parsea `ALTER TABLE ... ADD COLUMN|KEY|CONSTRAINT` permite contar ALTER sin BD.
- Cuando el diseño no fija firmas, documentarlas en diseno.md §7 "Contrato de pruebas" y reportarlo.
- Trampa: en SQL de CREATE TABLE aparece `ON DELETE SET NULL`; al buscar `DELETE` prohibido, quitar `ON DELETE/UPDATE` primero.
- Spec esquema-y-errores-login: pool falso con estado (tablas/columnas/idx/fks) en tests/unit/schemaBootstrap.test.ts, valida orden de FK al crear (ER_CANT_CREATE_TABLE si el padre no existe).
