# Cierre — Seguridad de lecturas, endurecimiento de API y aviso de permisos

- **Ramas:** feat/seguridad-lecturas, fix/aviso-permisos → developer · **Producción:** pendiente de aprobación del usuario.

## Trazabilidad
| CA | Prueba | Resultado |
|---|---|---|
| CA-01 límite en lecturas (429 + Retry-After) | `tests/unit/rateLimit.test.ts` (unidad + servidor real) | ✅ |
| CA-02 límite en login | ídem (servidor real) | ✅ |
| CA-03 límite en consulta de etiqueta | ídem | ✅ |
| CA-04 auditoría client_ip / user_agent | `tests/e2e/auditoria.spec.ts` (consulta la BD) | ✅ desktop + móvil |
| CA-05 IP real detrás del proxy | `rateLimit.test.ts`: IPs distintas vía X-Forwarded-For se limitan por separado | ✅ |
| CA-06 CORS cerrado por defecto | `rateLimit.test.ts` (origen ajeno sin cabecera; origen configurado sí) | ✅ |
| CA-07 sin clave por defecto del superadmin | revisión de código (`ensureBaseData`); staging y producción ya tienen superadmin | ✅ |
| CA-08 mensajes rate_limited en UI | `pushMovementToServer.ts`, `authApi.ts` | ✅ (revisión) |
| Bug: aviso de permiso denegado se borraba | `tests/e2e/permisos-ui.spec.ts`: 10/10 en rojo antes del fix, 60/60 en verde después (5 repeticiones) | ✅ |
| Regresión | verify (32 unit) · build · Playwright 32/32 · E2E API 43/43 | ✅ |

## Impacto al publicar en producción
- La migración agrega 2 columnas nulas a `movements` (`client_ip`, `user_agent`) al arrancar. Es idempotente y no toca datos existentes.
- Lecturas fuera de orden JC → acopio ahora responden 409 con mensajes claros (validación en el servidor).
- CORS: si algún sistema externo llama a la API desde otro dominio, hay que declararlo en `CORS_ORIGINS`.
- Los límites por IP son configurables por variable de entorno si una cuadrilla grande comparte la misma red.
