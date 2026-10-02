# Seguridad del registro de lecturas y endurecimiento de la API

- **ID:** 20261001-seguridad-lecturas · **Tipo:** seguridad · **Talla:** M · **Estado:** aprobado por el usuario ("HAZLO TODO", 2026-10-01)

## Contexto
`POST /api/movements` y `GET /api/labels/:id` no exigen sesión porque se usan al escanear en terreno.
Esto es intencional, pero hoy no tiene protección compensatoria: no hay límite de intentos ni registro de origen.
`POST /api/auth/login` tampoco limita los intentos. CORS acepta cualquier origen, y si falta `SUPERADMIN_PASSWORD`
el superadmin se crea con una clave pública que figura en el README.

Los códigos de etiqueta tienen 12 caracteres de un alfabeto de 32 (~60 bits), así que adivinarlos es inviable.
El riesgo real es el abuso masivo, o alguien con acceso a una etiqueta física. Por eso se combinan el límite de frecuencia y la trazabilidad.

## Criterios de aceptación
```gherkin
# CA-01 — límite por IP en lecturas
Dado un cliente que supera RATE_LIMIT_MOVEMENTS_PER_MIN (por defecto 120) POST /api/movements en un minuto
Entonces recibe 429 { ok:false, error:"rate_limited" } con cabecera Retry-After

# CA-02 — límite por IP en login
Dado un cliente que supera RATE_LIMIT_LOGIN_PER_MIN (por defecto 10) intentos de login en un minuto
Entonces recibe 429 rate_limited

# CA-03 — límite en consultas de etiqueta
GET /api/labels/:id limitado por RATE_LIMIT_LABELS_PER_MIN (por defecto 300)

# CA-04 — trazabilidad
Cada movimiento guarda client_ip y user_agent (migración idempotente + schema.sql)

# CA-05 — IP real detrás del proxy de Render
Con TRUST_PROXY=1 (por defecto) la IP se toma del proxy de Render, no del socket

# CA-06 — CORS cerrado por defecto
Sin CORS_ORIGINS, una petición con Origin ajeno no recibe Access-Control-Allow-Origin.
Con CORS_ORIGINS=a,b solo esos orígenes lo reciben. La app (mismo origen) no se ve afectada.

# CA-07 — sin contraseña por defecto
Si falta SUPERADMIN_PASSWORD y el superadmin no existe, no se crea con una clave conocida (advertencia en el log)

# CA-08 — mensajes en la UI
La app muestra un mensaje claro en español ante rate_limited (lecturas y login)
```
