---
name: revision-codigo
description: Checklist de revisión de código y de diseño para App Etiquetado (correctitud, seguridad, roles, SQL, consistencia front/back, pruebas). Usar antes de cerrar cualquier cambio o para revisar un diseño de talla L.
---

# Revisión de código

Revisa el diff (`git diff` + archivos nuevos) contra `docs/specs/<id>/diseno.md` y los CA.

## Checklist
**Correctitud**
- [ ] Cada CA está implementado y tiene su prueba. Ningún CA queda sin cubrir.
- [ ] Los IDs se normalizan (`trim().toUpperCase()`) en cada frontera nueva.
- [ ] Se respeta el orden JC → acopio y no hay forma de saltárselo desde la UI ni desde la API.
- [ ] Los estados de carga, error y vacío están manejados. No hay promesas sin `catch` ni `void` que oculten errores.

**Seguridad**
- [ ] El SQL usa placeholders `?`, sin interpolar valores de entrada.
- [ ] Cada endpoint nuevo tiene `authMiddleware` + `requireRoles`, o está justificado como público en el diseño.
- [ ] Los permisos son coherentes entre `roleAccess.ts` y `ACCESS`.
- [ ] Ningún secreto, contraseña o token queda en el código, en los logs o en las respuestas.
- [ ] Los inputs tienen límites de largo y tipo (ver `normalizeLimitedText`).

**Datos**
- [ ] La migración es idempotente y `schema.sql` está actualizado.
- [ ] Las escrituras multi-tabla van en transacción.

**Calidad**
- [ ] El estilo y los nombres son coherentes con el código vecino, y los textos de UI están en español.
- [ ] No hay código muerto, `console.log` de depuración ni dependencias nuevas injustificadas.
- [ ] `npm run verify` está en verde.

## Formato de hallazgos
Lista ordenada por severidad. Cada hallazgo indica: **[BLOQUEANTE | IMPORTANTE | MENOR]**, `archivo:línea`, el problema, un escenario concreto de falla y la corrección sugerida. Reporta solo lo que puedas sostener leyendo el código; si dudas, márcalo como "a verificar".

## Modo diseño (talla L)
Aplica la checklist de Seguridad y Datos al `diseno.md` antes de implementar, y revisa que el plan de pruebas cubra todos los CA.
