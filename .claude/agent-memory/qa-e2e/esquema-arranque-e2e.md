---
name: esquema-arranque-e2e
description: Cómo se prueba el esquema al arrancar (scripts/e2e-esquema-arranque.mjs), CA-05 requiere MYSQL_ADMIN_*, y selectores de login/Maestros
metadata:
  type: project
---

- `scripts/e2e-esquema-arranque.mjs` (spawn del servidor por escenario, reset entre escenarios) corre dentro de `npm run test:e2e:api` antes del E2E de carga; si falla, aborta. Puerto: `E2E_ESQUEMA_PORT` o el PORT de .env.test.
- CA-05 (sin privilegio CREATE) exige `MYSQL_ADMIN_USER`/`MYSQL_ADMIN_PASSWORD` en `.env.test`; local sin ellas se omite con aviso (no queda verificado), en CI falla.
- Login: `getByLabel('Usuario')`, `getByLabel('Contraseña')`, botón `Entrar`, alerta `getByRole('alert')`. Tras login de admin se ve heading `/^Hola,/` (el operador no).
- Maestros mantenimiento: ir a `/#maestros/admin` y acotar a `#panel-maestros-admin` (el panel Excel `#panel-maestros-excel` también tendrá alertas).
- Escenarios CA-03/04/15 pasan ya en rojo-previo (son invariantes/regresión); los demás fallan hasta que exista la implementación.
