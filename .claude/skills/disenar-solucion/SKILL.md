---
name: disenar-solucion
description: Método y plantilla de diseño técnico para App Etiquetado (impacto por capa, contrato de API, migración SQL, tareas por dueño y plan de pruebas trazable a los criterios de aceptación). Usar después de aprobar un requerimiento.
---

# Diseño técnico

Entrada: `docs/specs/<id>/requerimiento.md` aprobado. Salida: `docs/specs/<id>/diseno.md` con [plantilla.md](plantilla.md).

## Reglas de diseño para este repo
- **Antes de proponer, lee el código real** (`server/index.cjs`, `src/lib/*`, `database/schema.sql`). Cita `archivo:línea`.
- **Usa la solución mínima que cumpla los CA.** Nada de abstracciones especulativas, y ninguna dependencia nueva sin justificarla (peso, mantenimiento, alternativa nativa).
- **BD:** cada cambio de esquema tiene un SQL idempotente (`ADD COLUMN IF NOT EXISTS`, o una verificación en `information_schema`, como hace `ensureMovementsSchema`). Actualiza también `database/schema.sql`. Indica si hace falta backfill.
- **API:** define método, ruta, rol requerido (`requireRoles`), body, respuestas (`{ ok, ... }`) y códigos de error. Indica si el endpoint es público y por qué.
- **Roles:** si cambian los permisos, lista los cambios en `roleAccess.ts` **y** en `ACCESS`.
- **Estado dual:** aclara qué se persiste en MySQL (la fuente de verdad) y qué en localStorage, y cómo se sincroniza.
- **Terreno/móvil:** considera la conectividad intermitente y los dobles envíos. Las operaciones deben ser idempotentes o estar protegidas por transacción.

## Plan de tareas
Divide el trabajo en tareas `T-01…`, cada una con su dueño (`dev-backend` o `dev-frontend`), los archivos que toca, sus dependencias y los CA que cubre. Las tareas de backend y frontend que no comparten archivos se marcan como paralelizables.

## Plan de pruebas (obligatorio)
Tabla con columnas CA → nivel → archivo → caso:
- **Unitario (Vitest):** lógica pura en `src/lib`, validaciones, transformaciones y exportaciones.
- **E2E de UI (Playwright):** flujos de usuario, permisos visibles y vista operativa `?e=`.
- **E2E de API (`scripts/e2e-carga-trackeo.mjs`):** reglas del servidor, como el orden JC/acopio, los 401/403/409 y la concurrencia.
Todo CA debe tener al menos una prueba.
