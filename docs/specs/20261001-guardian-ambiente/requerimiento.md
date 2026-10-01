# Guardián de ambiente al arrancar el servidor

- **ID:** 20261001-guardian-ambiente · **Tipo:** técnica (seguridad) · **Talla:** S · **Estado:** aprobado (usuario, 2026-10-01)

## Contexto
Staging y producción usan el mismo usuario MySQL (`trn_felipe`), que tiene permisos sobre `trn_etiquetatest` (pruebas)
y `trn_etiqueta` (producción). La única separación es la variable `MYSQL_DATABASE` de cada servicio en Render.
Un error al configurarla haría que un ambiente escriba en la base del otro.

## Historia
- **HU-01:** Como administrador, quiero que el servidor se niegue a arrancar si su ambiente (`APP_ENV`) no coincide con su base de datos, para que un error de configuración termine en un deploy fallido y no en escrituras en la base equivocada.

## Criterios de aceptación
```gherkin
# CA-01 — staging solo con la BD de pruebas
Dado APP_ENV=staging y MYSQL_DATABASE distinta de trn_etiquetatest
Cuando el servidor arranca
Entonces termina con código 1, sin conectarse a la BD, y registra el motivo

# CA-02 — producción nunca con una BD de pruebas
Dado APP_ENV=production y una MYSQL_DATABASE que contiene "test"
Cuando el servidor arranca
Entonces termina con código 1, sin conectarse a la BD

# CA-03 — combinaciones válidas
Dado APP_ENV=staging con trn_etiquetatest, o APP_ENV=production con una BD que no es de pruebas
Entonces el guardián lo permite

# CA-04 — valor desconocido
Dado APP_ENV con un valor distinto de staging/production (p. ej. "produccion")
Entonces el servidor no arranca

# CA-05 — compatibilidad
Dado que APP_ENV no está definido (local, pruebas, o producción antes de configurar la variable)
Entonces el servidor arranca como hoy y registra una advertencia

# CA-06 — trazabilidad
GET /api/health informa el ambiente activo (campo "env"), para verificarlo en el smoke remoto
```

## Fuera de alcance
Usuarios MySQL distintos por ambiente (decisión del usuario: mantener el mismo).
