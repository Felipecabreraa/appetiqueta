# Cierre — Restablecer contraseñas y limpieza del historial local

## Solución
- `POST /api/admin/users/:id/password` (solo SuperAdmin): mínimo 8 caracteres; cierra las sesiones del usuario (si es la propia, conserva la actual).
- Usuarios: botón "Restablecer contraseña" por fila, formulario con confirmación y aviso de éxito.
- Época operativa (`app_meta.operational_epoch`, expuesta en `/api/health`): el script de limpieza la renueva y cada navegador borra su historial local de lotes, etiquetas y lecturas al abrir la app. Al desplegar por primera vez, la época se crea y todos los navegadores limpian su copia local una vez, que es lo que se quiere tras la limpieza de producción del 2026-10-02.
- Script de limpieza: el DDL va fuera de la transacción (en MySQL un CREATE TABLE hace commit implícito).

## Trazabilidad
| CA | Prueba | Resultado |
|---|---|---|
| CA-01 restablecer desde la UI | usuarios-reset.spec.ts | ✅ desktop + móvil |
| CA-02 cierre de sesiones / propia se mantiene | usuarios-reset.spec.ts (2 tests) | ✅ |
| CA-03 validaciones (corta, no coincide, 404) | usuarios-reset.spec.ts | ✅ |
| CA-04 solo SuperAdmin (403 admin/operador, 401 sin sesión) | usuarios-reset.spec.ts | ✅ |
| CA-05 limpieza automática tras el script | limpieza-local.spec.ts (ejecuta el script real sobre la BD de pruebas) | ✅ |
| CA-06 sin cambio de época se conserva | limpieza-local.spec.ts | ✅ |
| Regresión | verify (38 unit) · build · Playwright 52/52 · E2E API 43/43 | ✅ |
