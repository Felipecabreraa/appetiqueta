# Restablecer contraseñas y limpieza del historial local tras vaciar la BD

- **ID:** 20261002-reset-password-y-limpieza-local · **Tipo:** funcionalidad + bug · **Talla:** M · **Estado:** aprobado (pedido del usuario)

## Contexto
1. El SuperAdmin no puede cambiar la contraseña de un usuario: si alguien la olvida, no hay manera de recuperar el acceso.
2. Tras vaciar la BD operativa con `scripts/db-limpiar-operacion.mjs`, cada navegador sigue mostrando el historial de lotes y las etiquetas, porque se guardan en su localStorage (`appetiquetado:batches`, `appetiquetado:labels`, `appetiquetado:movements`).

## Criterios de aceptación
```gherkin
# CA-01 — SuperAdmin restablece la contraseña desde Usuarios
Dado un SuperAdmin en el módulo Usuarios
Cuando elige "Restablecer contraseña" en un usuario e ingresa una nueva (mín. 8 caracteres) dos veces
Entonces ve una confirmación, el usuario entra con la nueva contraseña y la anterior deja de funcionar

# CA-02 — Las sesiones abiertas del usuario se cierran
Dado un usuario con sesión iniciada
Cuando el SuperAdmin restablece su contraseña
Entonces esa sesión deja de ser válida (401); si se restablece la propia, la sesión actual se mantiene

# CA-03 — Validaciones
Contraseña < 8 caracteres → 400 password_too_short; confirmación distinta → error en pantalla; usuario inexistente → 404

# CA-04 — Solo SuperAdmin
Admin y operador reciben 403; sin sesión, 401

# CA-05 — Limpieza automática del historial local
Dado un navegador con historial de lotes y etiquetas en localStorage
Cuando la BD operativa se vacía (el script registra una nueva "época operativa")
Entonces, al abrir la app, ese navegador borra su historial de lotes, etiquetas y lecturas locales sin intervención del usuario

# CA-06 — No se borra sin motivo
Si la época operativa del servidor no cambió, el historial local se conserva
