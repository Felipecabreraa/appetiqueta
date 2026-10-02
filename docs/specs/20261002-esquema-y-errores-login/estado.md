# Estado — 20261002-esquema-y-errores-login

- **Necesidad (usuario):** "puedes corregirlo para que no vuelva a pasar esta problemática" — staging quedó sin la tabla `auth_sessions` (un DROP masivo en phpMyAdmin falló a medias por FK) y el login mostró "Credenciales inválidas o servidor no disponible" ante un 500 `ER_NO_SUCH_TABLE`, lo que hizo buscar el problema en la clave.
- **Tipo:** bug con impacto en API/arranque + UI · **Talla:** M
- **Rama:** `fix/esquema-y-errores-login` (desde `developer` @ 2a2f458)

## Decisiones iniciales (Lead, recomendadas; el usuario no objetó)
1. Al arrancar, el servidor asegura las tablas base que falten con el DDL idempotente de `database/schema.sql` (solo CREATE TABLE IF NOT EXISTS; nunca DROP/DELETE/ALTER destructivo) y lo registra en el log.
2. `/api/health` informa si el esquema está incompleto (tablas faltantes) para que el smoke remoto falle.
3. El login distingue: 401 → "Usuario o contraseña incorrectos." · 5xx → "El servidor tuvo un problema. Intente más tarde." · red → "Sin conexión con el servidor." · 429 se mantiene.

## Fases
- [x] 0 Triage y rama
- [x] 1 Levantamiento — compuerta 1 aprobada por el usuario el 2026-10-02 ("Sí, aprobado con las recomendadas"): P1 health 200 + campos de esquema; P2 (b) re-detección sin DDL, degradar; P3 tablas + flags de migraciones; P4 "No fue posible iniciar sesión."; P5 guía prod→staging en docs/AMBIENTES.md
- [x] 2 Diseño — compuerta 2 aprobada por el usuario el 2026-10-02 ("Sí, aprobado")
- [x] 3 Pruebas primero — unit: 4 suites rojas por la razón correcta; E2E UI 30 rojos (nuevos), API: e2e-esquema-arranque 17 rojos; existentes en verde. CA-05 no ejecutable en local (faltan MYSQL_ADMIN_* en .env.test), sí en CI.
- [x] 4 Implementación — backend bf10431, 98422af, 2472712; frontend 19ac5d2, a7b1bc9. Lead aprueba: getSessionToken → string|null; texto "No se pudieron cargar los registros." en tablas de Maestros con error.
- [x] 5 Verificación local — /verificar APTO (2026-10-02): lint/tsc/build ok, unit 211/211, E2E UI 152 ok + 8 skip intencionales (2.ª corrida; 1.ª: 1 flaky en multiusuario.spec.ts:110, aislado 55/55 ok), E2E API 43/43 + CA-27 + esquema-arranque OK (CA-05 omitido en local, corre en CI)
- [ ] 6 E2E completo — en curso
- [ ] 7 Revisión — en curso
- [ ] 8 Staging
- [ ] 9 Producción

## Bucle de perfección
(vacío)

## Hallazgos fuera de alcance
- Inestable: `tests/e2e/multiusuario.spec.ts:110` (carrera de JC entre 2 celulares) falló 1 vez en la suite completa; aislado 55/55. Posible relación con el deadlock conocido de POST /api/movements. Investigar en otro ciclo.
- (diseño) `OperationalJcForm.tsx`/`TrackingView.tsx` muestran el código crudo `db` si falla `/api/master-data/jc-foremen`; la importación Excel tampoco pasa por `describeApiError`.
