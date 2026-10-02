# Esquema autorreparable al arrancar, estado del esquema en /api/health y mensajes de login diferenciados

- **ID:** 20261002-esquema-y-errores-login
- **Tipo:** bug (API/arranque + UI)
- **Talla:** M
- **Estado:** aprobado (compuerta 1, usuario, 2026-10-02: "Sí, aprobado con las recomendadas")
- **Solicitado por:** usuario (luis.lagos@trn.cl), vía Lead: "puedes corregirlo para que no vuelva a pasar esta problemática" — 2026-10-02

## 1. Contexto y problema

### Incidente 1: falta `auth_sessions` en staging
Un DROP masivo en phpMyAdmin falló a medias por FK y dejó `trn_etiquetatest` sin la tabla `auth_sessions`. Nadie pudo iniciar sesión. La pantalla mostró "Credenciales inválidas o servidor no disponible.", así que se buscó el problema en la clave cuando el error real era `ER_NO_SUCH_TABLE` (500).

Comportamiento actual, con evidencia:
- **El arranque no crea tablas base.** `main()` (`server/index.cjs:740-771`) ejecuta `ensureBaseData` → `ensureMovementsSchema` → `ensureMastersAuditSchema` → `detectLabelSchema`.
  - `ensureBaseData` (`server/index.cjs:188-253`) solo crea `app_meta` (:191-199) y `jc_foremen` (:205-217) con `CREATE TABLE IF NOT EXISTS`, inserta `operational_epoch` con `INSERT IGNORE` (:200-203), hace un upsert de `roles` (:219-228) y crea el superadmin si no existe (:236-252). Ninguna otra tabla de `database/schema.sql` se crea al arrancar.
  - `ensureMovementsSchema` (`server/index.cjs:133-186`) sale en silencio si `movements` no existe (:139 y :183).
  - `ensureMastersAuditSchema` (`server/masterAudit.cjs:27-99`) marca `ready=false` y sigue si falta una tabla (:48-51).
- **Un fallo en el arranque deja toda la API sin BD.** Si `ensureBaseData` lanza un error (por ejemplo, si falta `users` o `roles`, porque consulta ambas en :232 y :235), `main()` cierra el pool y sigue con `pool = null` (`server/index.cjs:754-764`). Desde ahí todas las rutas responden 503 `db_not_configured` (`requireDb`, :265-269). En el incidente, `auth_sessions` no participa en `ensureBaseData`, así que el arranque terminó "bien" y el fallo apareció recién en el login.
- **El login falla con un 500 genérico.** `POST /api/auth/login` (`server/index.cjs:815-850`) valida la clave y luego hace `INSERT INTO auth_sessions` (:834-838). Si la tabla no existe, cae en el `catch` y responde `500 { ok:false, error:'db' }` (:846-849).
- **`/api/health` no informa el esquema.** `GET /api/health` (`server/index.cjs:794-813`) siempre responde 200 con `ok:true`, `service`, `env`, `dbReady`, `clientIp` y `operationalEpoch`. `dbReady` solo indica que existe pool (:767), no si el esquema está completo. Si `app_meta` falta, `operationalEpoch` pasa a `null` en silencio (:797-802).
- **El smoke remoto no detecta el problema.** `tests/e2e/smoke.spec.ts:4-11` solo exige `res.ok()` y la propiedad `env` (más `env` esperado si se define `E2E_EXPECTED_ENV`). No mira `dbReady` ni el esquema. `npm run test:smoke:remote` = `playwright test --grep @smoke` (`package.json:24`).
- **El login usa un mensaje único para cualquier error.** En `src/lib/authApi.ts:24-53` el 429 tiene su propio texto (:31-33), pero cualquier otro `!res.ok` (400, 401, 500, 503) devuelve "Credenciales inválidas o servidor no disponible." (:34-36). Ante un error de red se muestra `error.message` del navegador (:47-51), que llega en inglés (por ejemplo, "Failed to fetch"). El mensaje se pinta en `LoginView` (`src/components/LoginView.tsx:60-64`, `role="alert"`), conectado desde `src/App.tsx:341-363`.

### Incidente 2: el esquema cambia con el servidor encendido (aporte del Lead)
El usuario importó un dump de producción en `trn_etiquetatest` con el servicio encendido. El servidor había arrancado con `mastersAuditReady=true`, y el dump reemplazó las 7 tablas de maestros por versiones sin `created_by`/`updated_by`. Resultado:
- `GET /api/admin/masters` (`server/index.cjs:1121-1134`) usa el flag calculado al arrancar (`app.locals.mastersAuditReady`, :771). `fetchMastersBundle` (:606) arma columnas y joins de auditoría con `auditSelect`/`auditJoins` (`server/masterAudit.cjs:163-180`). La consulta falla con columna inexistente y la ruta responde `500 { error:'db' }`.
- En la UI, `parseOrThrow`/`describeApiError` (`src/lib/masterDataApi.ts:71-85`) devuelven el código crudo como mensaje (`"db"`). `MastersAdminPanel` lo muestra en una alerta (`src/components/MastersAdminPanel.tsx:284`, :428-432), pero las listas quedan vacías. El usuario percibe "Maestros vacío" y no un error. Se arregla recién reiniciando el servicio.
- El estado de esquema que guarda el servidor (`labelSchema`, `mastersAuditReady`) solo se calcula una vez, al arrancar (`server/index.cjs:748-771`).

### Restricciones que el arquitecto debe considerar (no son diseño)
- **`/api/health` es el health check de Render** (`render.yaml:21` y `:53`, `healthCheckPath: /api/health`). Si responde distinto de 2xx, Render puede marcar el servicio como no sano y reiniciarlo o rechazar el deploy. El cliente de terreno también lo consulta con timeout (`src/lib/operationalEpoch.ts:14`), así que debe seguir siendo liviano.
- **`schema.sql` no se puede ejecutar tal cual en el arranque:**
  - Depende de `SET FOREIGN_KEY_CHECKS = 0` (`database/schema.sql:10` y `:354`), que es de sesión: con un pool cada sentencia puede ir por otra conexión.
  - Necesita `multipleStatements` (así lo aplica `scripts/db-staging-init.mjs:30-33`).
  - Su upsert de `roles` (`database/schema.sql:345-352`) escribe en `operador` una `description` distinta de la de `ensureBaseData` (`server/index.cjs:224`). Si se ejecutan ambos, la descripción cambia en cada arranque.
- **Hay dos definiciones de `jc_foremen` y `app_meta`:** `server/index.cjs:191-217` frente a `database/schema.sql:161-178` y `:337-342`. La de `index.cjs` no tiene `created_by`/`updated_by`, que `ensureMastersAuditSchema` agrega después.
- **El orden por FK importa** si se crean tablas con `FOREIGN_KEY_CHECKS=1`: `roles` → `users` → `auth_sessions`; `users` → maestros (`seasons`, `companies`, `species`, `csg_catalog`, `jc_foremen`) → `varieties` → `season_cost_centers` → `master_import_runs`; luego `labels` → `movements`; `batch_logs` → `batch_log_labels`; y `app_meta` sin dependencias (`database/schema.sql:15-342`).
- **Compatibilidad:** staging y producción corren en MariaDB 10.6, y el CI usa `mariadb:10.6` (`.github/workflows/ci.yml:21-22`). Localmente se usa MySQL 8/9. El encabezado de `schema.sql` dice "MySQL 8.0+" (:2), pero todo DDL nuevo debe pasar en MariaDB 10.6. Ojo: MariaDB informa una FK duplicada como errno 121 (`server/masterAudit.cjs:22-25`).
- **Privilegios:** el arranque ya ejecuta `CREATE TABLE IF NOT EXISTS app_meta` en cada inicio (`server/index.cjs:191`), así que el usuario `trn_felipe` hoy tiene CREATE en staging y producción. Aun así, el caso sin privilegios debe quedar cubierto.
- **Dónde corre el DDL:** staging y producción comparten el usuario MySQL y el guardián `server/envGuard.cjs` decide sobre qué BD corre el DDL del arranque. No se debilita.

## 2. Objetivo
- Si falta una o más tablas base, un reinicio del servicio las recrea sin tocar datos existentes y el login vuelve a funcionar sin intervención manual en la BD.
- Un esquema incompleto, sea al arrancar o porque cambió en caliente, se diagnostica en menos de 1 minuto: aparece en `/api/health`, hace fallar el smoke remoto y deja una línea de log que nombra las tablas o columnas faltantes.
- En la pantalla de login, la persona distingue entre "clave incorrecta", "problema del servidor", "sin conexión" y "demasiados intentos" con 4 textos distintos en español.

## 3. Historias de usuario
- **HU-01:** Como responsable de la plataforma (superadmin), quiero que el servidor recree al arrancar las tablas base que falten sin borrar ni alterar datos, para que un incidente en la BD (DROP parcial, restauración incompleta) se resuelva con un reinicio.
- **HU-02:** Como responsable de la plataforma, quiero que `/api/health` y el smoke remoto informen si el esquema está incompleto, para detectar el problema al publicar y no cuando un usuario no puede entrar.
- **HU-03:** Como usuario de cualquier rol (superadmin, admin, operador) en la pantalla de login, en escritorio o móvil, quiero un mensaje que distinga clave incorrecta, falla del servidor, falta de conexión y exceso de intentos, para saber si debo corregir mi clave, esperar o revisar mi red.
- **HU-04:** Como superadmin o admin en Maestros, quiero que, si el esquema de la BD cambió con el servidor encendido (importación o restauración), la pantalla muestre un error comprensible en vez de listas vacías y que el problema sea diagnosticable, para no creer que se perdieron los maestros.

## 4. Criterios de aceptación

```gherkin
# CA-01 — Falta una tabla base: el arranque la crea y el login funciona (HU-01)
Dado una BD de pruebas con el esquema completo y un usuario activo "operador1" con clave conocida
  Y se eliminó la tabla auth_sessions
Cuando el servidor arranca
Entonces la tabla auth_sessions existe con las columnas, índices y FK definidos en database/schema.sql
  Y el log del arranque contiene una línea que nombra "auth_sessions" como tabla creada
  Y POST /api/auth/login con las credenciales de "operador1" responde 200 con { ok: true, token, user }
  Y GET /api/auth/me con ese token responde 200

# CA-02 — Faltan varias tablas con dependencias por FK (HU-01)
Dado una BD de pruebas a la que le faltan auth_sessions, movements y batch_log_labels
Cuando el servidor arranca
Entonces las tres tablas existen al terminar el arranque
  Y sus FK apuntan a users, labels y batch_logs según database/schema.sql
  Y el arranque termina en MariaDB 10.6 (CI) y en MySQL 8 (local) sin errores de FK

# CA-03 — Esquema completo: el arranque es idempotente y no pierde datos (HU-01)
Dado una BD de pruebas con el esquema completo y datos en users, labels, movements, seasons y season_cost_centers
  Y se registró el conteo de filas y el CHECKSUM TABLE de cada tabla de database/schema.sql
Cuando el servidor arranca dos veces seguidas
Entonces ninguna tabla se crea, elimina ni renombra
  Y el conteo de filas de cada tabla es el mismo que antes
  Y el CHECKSUM TABLE de cada tabla, salvo roles y app_meta, es el mismo que antes
  Y en roles y app_meta solo cambian los datos que el arranque ya escribe hoy (upsert de roles e INSERT IGNORE de operational_epoch)
  Y el log no informa tablas creadas

# CA-04 — El arranque nunca ejecuta DDL destructivo (HU-01)
Dado cualquier estado de la BD de pruebas (completa, con tablas faltantes o con columnas faltantes)
Cuando el servidor arranca
Entonces ninguna sentencia ejecutada contiene DROP, TRUNCATE, DELETE, RENAME ni ALTER ... DROP/MODIFY/CHANGE
  Y una tabla existente con una definición distinta de la de schema.sql no se recrea ni se altera, salvo las migraciones aditivas que ya existen (columnas de movements y de auditoría de maestros)

# CA-05 — Sin privilegio para crear: el servidor arranca, lo registra y lo informa (HU-01, HU-02)
Dado una BD de pruebas a la que le falta auth_sessions
  Y el usuario MySQL del servidor no tiene privilegio CREATE sobre la BD
Cuando el servidor arranca
Entonces el proceso sigue vivo y GET /api/health responde HTTP 200
  Y el log contiene una línea de error que nombra "auth_sessions" y el código del error de MySQL (por ejemplo ER_TABLEACCESS_DENIED_ERROR)
  Y GET /api/health indica esquema incompleto y lista "auth_sessions" como faltante
  Y las rutas que no dependen de la tabla faltante siguen respondiendo (por ejemplo GET /api/labels/:id responde 200 o 404, no 503)

# CA-06 — /api/health expone el estado del esquema sin datos sensibles (HU-02)
Dado el servidor arrancado contra la BD de pruebas
Cuando se llama GET /api/health sin sesión
Entonces responde HTTP 200 con los campos actuales (ok, service, env, dbReady, clientIp, operationalEpoch) sin cambios de nombre ni de tipo
  Y además informa si el esquema está completo (booleano) y la lista de tablas base faltantes (solo nombres; vacía si está completo)
  Y además informa si la auditoría de maestros está disponible (equivalente a mastersAuditReady)
  Y la respuesta no contiene host, usuario, contraseña, nombre de la BD, mensajes de error de MySQL ni stack traces

# CA-07 — /api/health refleja el esquema incompleto (HU-02)
Dado el servidor arrancado con el esquema completo
  Y luego se eliminó auth_sessions sin reiniciar el servidor
Cuando se llama GET /api/health
Entonces responde HTTP 200 e indica esquema incompleto con "auth_sessions" en la lista de faltantes
  Y la respuesta llega en menos de 2 segundos contra la BD de pruebas local

# CA-08 — Sin BD: health lo distingue de un esquema incompleto (HU-02)
Dado el servidor arrancado sin conexión a MySQL (pool nulo)
Cuando se llama GET /api/health
Entonces responde HTTP 200 con dbReady=false
  Y el estado del esquema aparece como desconocido, no como completo

# CA-09 — El smoke remoto falla si el esquema está incompleto (HU-02)
Dado un ambiente cuyo /api/health indica esquema incompleto o dbReady=false
Cuando se ejecuta E2E_REMOTE_URL=<url> npm run test:smoke:remote
Entonces la prueba "API responde health @smoke" falla
  Y el mensaje de falla nombra las tablas faltantes, o que la BD no está lista
  Y la prueba sigue siendo de solo lectura: no hace POST, PUT ni DELETE

# CA-10 — El smoke remoto pasa con el esquema completo (HU-02)
Dado un ambiente con dbReady=true y esquema completo
Cuando se ejecuta el smoke remoto
Entonces la prueba "API responde health @smoke" pasa

# CA-11 — Login: credenciales incorrectas (401) (HU-03), en escritorio y móvil
Dado la pantalla de login
Cuando el usuario envía un usuario existente con una clave incorrecta y la API responde 401 invalid_credentials
Entonces se muestra en role="alert" el texto exacto "Usuario o contraseña incorrectos."
  Y no se guarda sesión
  Y el botón "Entrar" vuelve a estar habilitado

# CA-12 — Login: error del servidor (5xx) (HU-03), en escritorio y móvil
Dado la pantalla de login
Cuando la API responde 500 (por ejemplo, falta auth_sessions), 502 o 503 (db_not_configured, db_unavailable)
Entonces se muestra en role="alert" el texto exacto "El servidor tuvo un problema. Intente más tarde."
  Y el texto no contiene "Credenciales" ni "contraseña"

# CA-13 — Login: sin conexión (HU-03), en escritorio y móvil
Dado la pantalla de login
Cuando la petición a /api/auth/login falla por red (fetch rechazado, sin respuesta HTTP)
Entonces se muestra en role="alert" el texto exacto "Sin conexión con el servidor."
  Y no se muestra el mensaje técnico del navegador (por ejemplo "Failed to fetch")

# CA-14 — Login: demasiados intentos (429) se mantiene (HU-03), en escritorio y móvil
Dado la pantalla de login
Cuando la API responde 429
Entonces se muestra el texto exacto "Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar."

# CA-15 — Login: un 500 no consume el cupo de intentos fallidos (HU-03)
Dado el límite de login por IP (RATE_LIMIT_LOGIN_PER_MIN, que hoy solo cuenta respuestas 401)
Cuando se producen 11 respuestas 500 seguidas desde la misma IP en menos de 1 minuto
Entonces el siguiente intento con credenciales válidas (con el esquema reparado) no recibe 429

# CA-16 — El esquema cambia en caliente: Maestros muestra un error y no listas vacías (HU-04)
Dado el servidor arrancado con mastersAuditReady=true
  Y un admin con sesión abierta
  Y luego, sin reiniciar el servidor, se quitan created_by/updated_by de las 7 tablas de maestros (simulando la importación de un dump)
Cuando el admin abre Maestros
Entonces se cumple el resultado acordado en P2
  Y en ningún caso la pantalla muestra solo el código crudo "db" junto a listas vacías: o carga los maestros, o muestra un mensaje en español que indica un problema del servidor o de la BD
  Y el log contiene una línea que nombra la tabla y la columna faltantes (o el código ER_BAD_FIELD_ERROR)
  Y GET /api/health refleja que la auditoría de maestros ya no está disponible

# CA-17 — Permisos: health no abre datos y no cambian los accesos (HU-02)
Dado un cliente sin sesión
Cuando llama GET /api/health
Entonces no recibe nombres de usuarios, conteos de filas ni contenido de tablas
  Y las rutas /api/admin/* siguen respondiendo 401 sin sesión y 403 para operador, como hoy
```

## 5. Reglas de negocio
- **RN-01:** El arranque solo puede agregar estructura (crear tablas que falten, agregar columnas, índices o FK que falten). Nunca ejecuta DROP, TRUNCATE, DELETE, RENAME ni cambios de tipo sobre tablas existentes.
- **RN-02:** `database/schema.sql` es la definición de referencia de las tablas base. Toda tabla que cree el arranque debe ser equivalente a su definición en `schema.sql` (columnas, índices y FK), y `schema.sql` sigue siendo idempotente al aplicarlo dos veces (lo verifica `scripts/e2e-migracion-maestros.mjs:186`).
- **RN-03:** Los datos que el arranque escribe hoy se mantienen y no se agregan escrituras nuevas sobre datos: upsert de los 3 roles, `INSERT IGNORE` de `operational_epoch` y creación del superadmin solo si no existe.
- **RN-04:** Un esquema incompleto no detiene el proceso: el servidor arranca, registra el problema y lo expone en `/api/health`. `/api/health` responde HTTP 200 mientras el proceso esté vivo, porque es el health check de Render.
- **RN-05:** `/api/health` es público. Solo expone nombres de tablas del esquema conocido y flags booleanos, nunca credenciales, host, nombre de la BD, mensajes de MySQL ni datos.
- **RN-06:** El login distingue 4 situaciones con estos textos exactos: 401 → "Usuario o contraseña incorrectos." · 5xx → "El servidor tuvo un problema. Intente más tarde." · error de red → "Sin conexión con el servidor." · 429 → "Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar." (sin cambios).
- **RN-07:** El guardián de ambiente (`server/envGuard.cjs`) se ejecuta antes de cualquier DDL del arranque y no se debilita.
- **RN-08:** Las tablas base son las de `database/schema.sql`: `roles`, `users`, `auth_sessions`, `seasons`, `companies`, `species`, `varieties`, `csg_catalog`, `jc_foremen`, `season_cost_centers`, `master_import_runs`, `labels`, `movements`, `batch_logs`, `batch_log_labels` y `app_meta` (16 tablas).

## 6. Casos borde
- **Falta `users` o `roles`.** Hoy `ensureBaseData` falla y deja toda la API en 503 (`server/index.cjs:232-235`, :754-764). Con el cambio, la tabla se crea antes de consultarla. Si `roles` se recrea vacía, el upsert existente la repuebla. Si `users` se recrea vacía, solo se crea el superadmin cuando `SUPERADMIN_PASSWORD` está definido (:238-243).
- **Una tabla hija existe y su padre no** (por ejemplo, existe `auth_sessions` y falta `users`). Crear el padre después del hijo no rompe la FK existente si las definiciones coinciden. Debe cubrirse en MariaDB 10.6, donde las FK incompatibles fallan con errno 150.
- **Una tabla existe con una definición vieja o distinta** (por ejemplo, `jc_foremen` creada por `ensureBaseData` sin columnas de auditoría). No es "faltante": la cubren las migraciones aditivas que ya existen. No se recrea.
- **DROP a medias** (el incidente 1): unas tablas sí y otras no, y con FK colgantes desde tablas que quedaron.
- **El esquema cambia con el servidor encendido** (incidente 2: importación o restauración de un dump en phpMyAdmin):
  - Desaparecen tablas o columnas que el servidor daba por presentes (`mastersAuditReady`, `labelSchema`).
  - Respuestas esperadas: `ER_NO_SUCH_TABLE` o `ER_BAD_FIELD_ERROR` en rutas que antes funcionaban.
  - Si el servidor recreara tablas en caliente mientras el dump todavía se importa, podría chocar con su `DROP TABLE` / `CREATE TABLE` (ver P2).
- **El dump de producción reemplaza `app_meta`.** `operational_epoch` toma el valor de producción, y los navegadores de staging borran su historial local al compararlo (`src/lib/operationalEpoch.ts:12-24`). Es el comportamiento esperado de la época, pero conviene saberlo al copiar producción → staging.
- **Login sin respuesta (petición colgada).** `apiFetch` no aplica timeout en el login (`src/lib/apiClient.ts:8-23`, `src/lib/authApi.ts:26`), así que "Entrando…" puede quedar indefinidamente. Ver fuera de alcance.
- **Login con 400 `credentials_required`.** El formulario exige ambos campos (`LoginView.tsx:41` y `:53`, `required`), así que solo pasa si se llama a la API directamente. La UI no debe mostrar el texto de 5xx para un 4xx (ver P4).
- **Pruebas en móvil (conectividad de terreno):** el error de red debe verse completo en el viewport móvil del proyecto Playwright, sin quedar oculto bajo el teclado ni recortado.

## 7. Fuera de alcance
- Copiar producción → staging de forma automatizada. Basta con documentar en `docs/AMBIENTES.md` el procedimiento seguro: detener o suspender el servicio de staging, hacer el DROP con `SET FOREIGN_KEY_CHECKS=0`, importar y reiniciar el servicio para que el arranque reaplique las migraciones idempotentes. Hoy `docs/AMBIENTES.md` no tiene esa guía (búsqueda sin resultados). Se recomienda incluirla como tarea de documentación de este mismo spec (ver P5).
- Migraciones versionadas (tabla de versiones o una herramienta de migraciones).
- Eliminar o recrear tablas con una definición distinta de `schema.sql`, o corregir tipos de columnas existentes.
- Timeout de la petición de login y reintentos automáticos.
- Refactorizar `server/index.cjs` para exportar helpers (deuda conocida).
- El bug conocido `ER_LOCK_DEADLOCK` en `POST /api/movements`.
- Cambiar los mensajes de error de otras pantallas, salvo el de Maestros en el caso del CA-16.
- Unificar la descripción del rol `operador` entre `schema.sql` e `index.cjs`. Si el diseño decide reutilizar `schema.sql` en el arranque, el arquitecto debe resolverlo para no cambiar el dato en cada arranque (RN-03).

## 8. Preguntas abiertas
| # | Pregunta | Opción recomendada | Respuesta |
|---|---|---|---|
| P1 | Con el esquema incompleto, ¿`/api/health` debe responder un HTTP distinto de 200 o un `ok:false`? | **Mantener HTTP 200 y `ok:true`** (proceso vivo) y agregar el estado del esquema en campos nuevos. El smoke lee esos campos. Un 503 haría que Render marque el servicio como no sano o lo reinicie en bucle (`render.yaml:21`, `:53`) sin arreglar la BD. | _pendiente_ — **Resuelta: opción recomendada (usuario).** |
| P2 | Si el esquema cambia con el servidor encendido (CA-16), ¿qué hace el servidor? (a) Solo diagnóstico: log claro, health actualizado y mensaje en la UI; la reparación exige reiniciar. (b) Al detectar `ER_BAD_FIELD_ERROR`/`ER_NO_SUCH_TABLE`, vuelve a leer el esquema (solo lectura), recalcula `mastersAuditReady`/`labelSchema`, degrada con elegancia (Maestros carga sin autor) y no ejecuta DDL hasta el siguiente arranque. (c) Igual que (b), pero además reaplica en caliente las migraciones idempotentes. | **(b).** Cumple el mínimo de (a), devuelve Maestros sin reiniciar y evita correr DDL mientras un dump todavía se importa (riesgo de chocar con su DROP/CREATE). Para recuperar la auditoría basta reiniciar, como indicará la guía de P5. La revalidación debe limitarse a, como máximo, 1 vez cada N segundos; N lo define el arquitecto. | _pendiente_ — **Resuelta: opción recomendada (usuario).** |
| P3 | ¿"Esquema incompleto" en health incluye columnas faltantes o solo tablas faltantes? | **Tablas faltantes (lista) más los flags de las migraciones conocidas** (`mastersAuditReady` y si `movements` tiene sus columnas). No se compara columna por columna contra `schema.sql`. | _pendiente_ — **Resuelta: opción recomendada (usuario).** |
| P4 | ¿Qué texto muestra el login para otros 4xx (400 `credentials_required`, 403, 404)? | **"No fue posible iniciar sesión."** (texto que ya existe en `authApi.ts:43`). Así no se confunde con 5xx ni con credenciales. | _pendiente_ — **Resuelta: opción recomendada (usuario).** |
| P5 | ¿La guía "copiar producción → staging" en `docs/AMBIENTES.md` entra en este spec? | **Sí, como tarea de documentación** (sin código): pasos para suspender staging, DROP con `FOREIGN_KEY_CHECKS=0`, importar y reiniciar, más el efecto sobre `operational_epoch`. | _pendiente_ — **Resuelta: opción recomendada (usuario).** |
