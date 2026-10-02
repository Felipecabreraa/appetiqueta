# Estado — 20261002-admin-maestros

- **Necesidad (usuario):** "Necesito que el admin pueda completar y editar los maestros del sistema, es parte de su rol, excepto de los usuarios."
- **Tipo:** funcionalidad / cambio de permisos (API + UI)
- **Talla:** L (pasó de M a L el 2026-10-02 al incluir la auditoría por registro)
- **Rama:** `feat/admin-maestros` (desde `developer` @ d88c407)

## Hallazgos iniciales (Lead)
- Backend: `ACCESS.MASTER_ADMIN = [superadmin]` protege import Excel, GET /api/admin/masters, temporadas, empresas, especies, CSG, capataces JC, variedades y relaciones (todos upsert por `id`).
- Usuarios (`/api/admin/users*`) usan `requireRoles(ROLE.SUPERADMIN)` directo → no dependen de MASTER_ADMIN.
- Frontend: `src/lib/roleAccess.ts` no da la pestaña `maestros` a admin.

## Fases
- [x] 0 Triage y rama
- [x] 1 Levantamiento — compuerta 1 aprobada (CA-01..CA-27; P1–P4 resueltas, P4 = no auditar guardados sin cambios)
- [x] 2 Diseño — revisor: APROBADO CON CAMBIOS (3 IMP + 6 MEN, todos resueltos en iteración 2). **Compuerta 2 aprobada por el usuario el 2026-10-02** ("Sí, aprobado"), incluidos textos de ayuda "Inactivo" y CA-29 rama importación solo unit. Textos más largos que la columna: **recortar y guardar** (normalizeLimitedText), confirmado por el usuario.
  - Decisiones 2026-10-02: (Usuario) el chip de estado desactivado pasa de "Archivado" a **"Inactivo"** en MastersAdminPanel (CA-05 queda con "Inactivo"). (Lead) P3 se formaliza como CA-29. (Lead) CA-27 = aplicar schema.sql dos veces sin error + migración del arranque idempotente; sin ADD COLUMN IF NOT EXISTS en schema.sql.
- [x] 3 Pruebas primero — unit: 2 rojos por aserción + 2 suites sin módulo; E2E desktop+móvil: rojos por 403/falta UI/falta auditoría; migración 51 fallos. Override E2E_MIGRACION_PORT aceptado (Lead).
- [x] 4 Implementación — backend: 9b03293, e40c93c, 45eb22a, ee82a34; frontend: fc677ce
- [x] 5 Verificación local — /verificar APTO (2026-10-02): lint 0 err, tsc ok, unit 101/101, build ok, E2E UI 100 ok + 8 skip por diseño (multiusuario solo móvil, pasa 8/8 en móvil), E2E API 43/43 + CA-27 OK
- [ ] 6 E2E completo — en curso
- [ ] 7 Revisión — en curso
- [ ] 8 Staging
- [ ] 9 Producción

## Bucle de perfección
(vacío)

## Hallazgos fuera de alcance
- **En cola (ciclo aparte, pedido por el usuario 2026-10-02):** exportar a Excel los datos de Maestros, en el mismo formato de la plantilla de importación (reimportable). Ningún otro módulo.
- `tests/e2e/multiusuario.spec.ts` aparece omitido en el proyecto desktop (reportado por qa-e2e). Investigado en fase 5: es `test.skip(!isMobile)` intencional y preexistente (multiusuario.spec.ts:11); los 8 corren y pasan en móvil. No es de este cambio. Mejora opcional (otro ciclo): excluirlo del proyecto desktop con `testIgnore` en playwright.config para que no figure como skip.
- Actualizar `.claude/skills/contexto-appetiquetado/SKILL.md` (tabla de roles) dentro de este cambio — fase 4.
