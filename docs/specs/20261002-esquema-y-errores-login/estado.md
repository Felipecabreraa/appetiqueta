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
- [ ] 3 Pruebas primero — en curso
- [ ] 4 Implementación
- [ ] 5 Verificación local
- [ ] 6 E2E completo
- [ ] 7 Revisión
- [ ] 8 Staging
- [ ] 9 Producción

## Bucle de perfección
(vacío)

## Hallazgos fuera de alcance
(vacío)
