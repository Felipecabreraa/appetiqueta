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
- [x] 6 E2E completo — qa-e2e (5a049b3): 29 CA + D1 + D5 + recorte + concurrencia §6 en verde; E2E UI 122 ok / 8 skip intencionales; E2E API 43/43; CA-27 OK. Sin bugs de producto.
- [x] 7 Revisión — revisor-codigo: **APROBADO** (0 bloqueantes, 0 importantes, 5 menores diferidos a Hallazgos)
- [ ] 8 Staging
- [ ] 9 Producción

## Bucle de perfección
(vacío)

## Hallazgos fuera de alcance
- Menores del revisor (fase 7), diferidos: (1) mensaje de `invalid_payload` en masterDataApi.ts menciona fechas también en relaciones/variedades; (2) `saveMaster` con 9 parámetros posicionales → objeto de opciones + helper `auditOn(req)`; (3) `createdAt/updatedAt` tipados `string` → `string | null`; (4) `normalizeSeasonDate` más estricta que el diseño (mejora; anotar en diseño); (5) `normalizeLimitedText` corta por unidades UTF-16 (emoji en el borde).
- (qa-e2e, preexistente) un `name` duplicado en maestros responde 500 `db` en vez de 409 con código claro.
- Incidente 2026-10-02: el commit 0d6a149 (feat/script-reset-clave, otra sesión) arrastró `tests/e2e/maestros-bordes-api.spec.ts`, memorias de agentes y un cambio en `.claude/settings.json` (deny de db-reset-clave) hacia `developer` local (ba5e643, sin push). Se resuelve en el merge de esta rama a developer.
- **En cola (ciclo aparte, pedido por el usuario 2026-10-02):** exportar a Excel los datos de Maestros, en el mismo formato de la plantilla de importación (reimportable). Ningún otro módulo.
- `tests/e2e/multiusuario.spec.ts` aparece omitido en el proyecto desktop (reportado por qa-e2e). Investigado en fase 5: es `test.skip(!isMobile)` intencional y preexistente (multiusuario.spec.ts:11); los 8 corren y pasan en móvil. No es de este cambio. Mejora opcional (otro ciclo): excluirlo del proyecto desktop con `testIgnore` en playwright.config para que no figure como skip.
- Actualizar `.claude/skills/contexto-appetiquetado/SKILL.md` (tabla de roles) dentro de este cambio — fase 4.
