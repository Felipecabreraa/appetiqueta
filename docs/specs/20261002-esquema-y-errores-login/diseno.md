# Diseño — Esquema autorreparable al arrancar, estado del esquema en /api/health y mensajes de login diferenciados

- **Spec:** 20261002-esquema-y-errores-login · **Requerimiento:** [requerimiento.md](requerimiento.md) (aprobado; P1..P5 con la opción recomendada)
- **Estado:** aprobado (compuerta 2, usuario, 2026-10-02)
- **Rama:** `fix/esquema-y-errores-login`

## 1. Resumen de la solución

1. **Arranque.** Un módulo nuevo, `server/schemaBootstrap.cjs`, lee `database/schema.sql`, extrae **solo** las sentencias `CREATE TABLE IF NOT EXISTS` (16 tablas) y ejecuta, una por una y en el orden del archivo (que ya respeta las FK), las de las tablas que falten. No se usa `multipleStatements` ni `FOREIGN_KEY_CHECKS` y no se ejecutan los `INSERT` de `schema.sql`. Si una tabla falla (por ejemplo, por falta de privilegio CREATE), el error se registra y el arranque sigue: el pool **no** se anula por errores de esquema.
2. **Estado del esquema.** Otro módulo nuevo, `server/schemaState.cjs`, es de solo lectura: con **una** consulta a `information_schema.COLUMNS` calcula las tablas faltantes, `mastersAuditReady`, `movementsSchemaReady` y `labelSchema`. Un "monitor" con límite de frecuencia y una sola consulta en vuelo actualiza `app.locals`. Lo usan `/api/health` (antigüedad máxima de 2 s) y las rutas que reciben `ER_NO_SUCH_TABLE`/`ER_BAD_FIELD_ERROR` (como máximo 1 re-detección cada 10 s, P2-b). En caliente nunca ejecuta DDL.
3. **Health** sigue respondiendo 200 y `ok:true` (P1) y suma 4 campos: `schemaComplete`, `missingTables`, `mastersAuditReady` y `movementsSchemaReady`. El smoke remoto falla si `dbReady !== true` o `schemaComplete !== true`, y el mensaje de falla nombra lo que falta.
4. **Frontend.** El login traduce el resultado a 5 textos fijos (401, 5xx, red, 429 y otros 4xx según P4). Las llamadas de Maestros (`/api/admin/*`) traducen un 5xx a un mensaje en español en vez del código crudo `db`.
5. **Documentación.** Se agrega a `docs/AMBIENTES.md` la guía para copiar producción a staging (P5).

## 2. Impacto por capa

| Capa | Archivos | Cambio |
|---|---|---|
| BD | `database/schema.sql` | **Sin cambios de DDL.** Solo se ajusta el comentario de encabezado (`:1-7`): motor MariaDB 10.6 / MySQL 8+, y la regla de formato que asume el parser (cada sentencia termina en `;` al final de línea y no se usa `;` dentro de `COMMENT`). Como no cambia ninguna tabla, no hay backfill. |
| API (arranque) | `server/schemaBootstrap.cjs` (nuevo) | `parseBaseTables(sqlText)`, `ensureBaseTables(pool, {log})`, y además `ensureBaseData` y `ensureMovementsSchema`, que se **mueven** desde `index.cjs` (`:133-253`). A `ensureBaseData` se le quitan los `CREATE TABLE` duplicados de `app_meta` y `jc_foremen` (`:191-199`, `:205-217`) y sus 3 escrituras quedan aisladas entre sí. Exporta `bootstrapSchema(pool, deps)`, que orquesta el arranque. |
| API (estado) | `server/schemaState.cjs` (nuevo) | `BASE_TABLES` (16, en el orden de `schema.sql`), `buildLabelSchemaState` (se mueve desde `index.cjs:667-674`), `detectSchemaState(pool)`, `isSchemaError(err)` y `createSchemaMonitor({ pool, locals, now, log })`. Sin DDL ni DML. |
| API | `server/index.cjs` | `main()` (`:740-771`) usa `bootstrapSchema` y el monitor, y ya no anula el pool por errores de esquema (`:757-765`). `/api/health` (`:794-813`) suma 4 campos. Las 3 rutas de lectura que dependen de flags reintentan una vez tras re-detectar. Los `catch` de las rutas que usan flags o tablas notifican al monitor. Se eliminan `detectLabelSchema` (`:676-685`) y las funciones movidas. |
| Frontend | `src/lib/authApi.ts` | `loginErrorMessage(kind)` (pura y exportada) y `login()` (`:24-53`) con 5 textos fijos. |
| Frontend | `src/lib/masterDataApi.ts` | `describeApiError` (`:79-85`) traduce 5xx (o los códigos `db`, `db_unavailable` y `db_not_configured`) a un texto en español en las llamadas `/api/admin/*`. `fetchJcForemen` (`:182-186`) conserva su comportamiento actual (fuera de alcance, §7 del requerimiento). |
| Frontend | `src/components/*` | **Sin cambios.** `LoginView.tsx:60-64` y `MastersAdminPanel.tsx:284/:428-432` ya pintan `message` en `role="alert"`. |
| Pruebas | `tests/e2e/smoke.spec.ts`, `tests/e2e/helpers/healthCheck.ts` (nuevo) | El smoke evalúa el esquema con un helper puro y se mantiene de solo lectura. |
| Pruebas / CI | `scripts/e2e-esquema-arranque.mjs` (nuevo), `scripts/e2e-api.mjs`, `.github/workflows/ci.yml`, `.env.test.example` | Escenarios de arranque contra la BD de pruebas, más las credenciales de administrador **opcionales** para el CA-05 (en CI: `root` del contenedor efímero). |
| Docs | `docs/AMBIENTES.md` | Guía prod → staging (P5) y una nota sobre el health con esquema. |

Roles: **sin cambios** en `src/lib/roleAccess.ts` ni en `ACCESS` (`server/index.cjs:35-40`). `/api/health` sigue siendo público.

Estado dual: no cambia. No se persiste nada nuevo en localStorage. La única consecuencia indirecta es la de `operational_epoch`, que se documenta en la guía (P5).

## 3. Modelo de datos y migración

No hay columnas, índices ni tablas nuevas. El arranque solo ejecuta las 16 sentencias de `database/schema.sql:15-342`, y únicamente las de las tablas que falten:

```sql
-- 1) Detección (solo lectura, 1 consulta)
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
-- 2) Por cada tabla faltante, en el orden de schema.sql y en sentencias separadas (sin multipleStatements):
CREATE TABLE IF NOT EXISTS <tabla> ( ...texto literal de schema.sql... ) ENGINE=InnoDB ...;
```

### Decisiones sobre los problemas que señaló el analista

| Problema (requerimiento) | Decisión | Justificación |
|---|---|---|
| `SET FOREIGN_KEY_CHECKS=0` es de sesión y, con un pool, cada sentencia puede ir por otra conexión (`schema.sql:10`, `:354`) | **No se toca `FOREIGN_KEY_CHECKS`.** Se crea con las FK activas (valor por defecto = 1), en el orden del archivo. | El orden de `schema.sql` ya es topológico: `roles` → `users` → `auth_sessions`; `seasons`, `companies`, `species` → `varieties` (`:120`, con referencia a `species` en `:135`); `csg_catalog` (`:143`) antes que `season_cost_centers` (`:181`); `labels` (`:246`) → `movements`, `batch_logs` → `batch_log_labels`. Un test unitario lo verifica (cada `REFERENCES x` apunta a una tabla anterior en la lista). Con las FK activas, un hijo cuyo padre no se pudo crear falla con un error claro (errno 150 / `ER_FK_CANNOT_OPEN_PARENT`) en vez de quedar con una FK colgante. |
| Hace falta `multipleStatements` (`scripts/db-staging-init.mjs:30-33`) | **Una sentencia por llamada** (`pool.query(sql)`), sin `multipleStatements`. | El parser entrega las sentencias separadas, y así un error se atribuye a una tabla concreta (necesario para el log del CA-05). |
| El upsert de `roles` de `schema.sql:345-352` pisaría la descripción de `operador` (RN-03) | **El parser solo acepta `CREATE TABLE IF NOT EXISTS`**: descarta `SET`, `INSERT` y todo lo demás. El único upsert de roles sigue siendo el de `ensureBaseData` (`index.cjs:219-228`, que se mueve sin cambios). | No hay escrituras nuevas (RN-03), y la descripción no oscila entre arranques. |
| `jc_foremen` y `app_meta` se definen dos veces (`index.cjs:191-217` frente a `schema.sql:161-177` y `:337-342`) | **Se eliminan los `CREATE` de `ensureBaseData`.** `schema.sql` pasa a ser la única definición (RN-02). | Una `jc_foremen` creada desde cero ya nace con `created_by`/`updated_by` y sus FK. Una `jc_foremen` antigua no se toca: la sigue cubriendo `ensureMastersAuditSchema`. |
| Sin privilegio CREATE, hoy toda la API queda en 503 (`index.cjs:757-765`, `requireDb :265-269`) | `ensureBaseTables` captura el error **por tabla** y lo registra en el log con el nombre de la tabla, `err.code` y `err.message`. `ensureBaseData` aísla sus 3 pasos (época, roles, superadmin) con un try/catch cada uno. `main()` ya **no** anula el pool por errores de esquema: el pool solo es `null` si `createPool()` falla (sin conexión). | CA-05 y RN-04: las rutas que no dependen de la tabla faltante siguen funcionando. Las que sí dependen responden 500 `db` (o el 503 `movements_table_missing` que ya existe en `:1532-1534`), y health informa lo que falta. |
| Compatibilidad MariaDB 10.6 / MySQL 8-9 | El DDL es el mismo `schema.sql` que el CI ya aplica sobre `mariadb:10.6` (`ci.yml:21-22`, vía `resetTestDb`). Lo único nuevo son `SELECT` a `information_schema.TABLES/COLUMNS`, que existen igual en los dos motores. Los nombres de tabla se comparan en minúsculas. | `lower_case_table_names=0` en Linux (trn.cl y CI) distingue mayúsculas; los dumps usan minúsculas. |
| Una tabla existente con una definición distinta | **No se recrea ni se altera** (CA-04). Solo corren las migraciones aditivas que ya existen: `ensureMovementsSchema` (que se mueve sin cambios) y `ensureMastersAuditSchema` (`masterAudit.cjs:27-101`, sin cambios). | RN-01. |
| `schema.sql` no está disponible o no se puede leer en el arranque | Se registra `[schema] ERROR: no se pudo leer database/schema.sql (...)`, no se crea nada y el arranque sigue. Health lo refleja en `missingTables`. | Render despliega el repo completo y `database/` está versionado, pero el caso queda cubierto. |

### Parser (`parseBaseTables`)
- Quita las líneas de comentario (`^\s*--`), separa por `;` al final de línea (`/;\s*$/m`), recorta los espacios y se queda con las sentencias que cumplen `^CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(`.
- Rechaza (lanza un error al arrancar, que se registra en el log; no detiene el proceso) cualquier sentencia aceptada que contenga `\b(DROP|TRUNCATE|DELETE|RENAME|ALTER)\b` fuera de un literal. Es una red de seguridad para CA-04.
- Devuelve `[{ name, sql }]` en el orden del archivo. Un test unitario exige que los nombres sean exactamente `BASE_TABLES` (RN-08) y en ese orden.

### `bootstrapSchema(pool, deps)` (lo que ejecuta el arranque, en este orden)
1. `ensureBaseTables` → `{ created: string[], failed: [{ table, code }] }`. Log: `[schema] Tabla creada: auth_sessions` por cada tabla creada y `[schema] ERROR al crear la tabla auth_sessions (ER_TABLEACCESS_DENIED_ERROR): <message>` por cada fallo.
2. `ensureBaseData` con 3 pasos aislados: `INSERT IGNORE` de `operational_epoch` · upsert de los 3 roles · superadmin solo si no existe (sin cambios de lógica respecto de `index.cjs:200-252`).
3. `ensureMovementsSchema` (sin cambios).
4. `ensureMastersAuditSchema` (sin cambios).

El guardián `checkEnvironment` sigue corriendo antes (`index.cjs:741-746`, RN-07) y no se modifica.

## 4. Contrato de API

| Método | Ruta | Rol | Body | Respuesta OK | Errores |
|---|---|---|---|---|---|
| GET | `/api/health` | **público** (health check de Render, `render.yaml:21`, `:53`; también lo usa `operationalEpoch.ts:14`) | — | **Siempre 200** mientras el proceso esté vivo (P1, RN-04). Ver la forma abajo | ninguno |
| POST | `/api/auth/login` | público | `{ username, password }` | sin cambios (`index.cjs:815-859`) | sin cambios: 400 `credentials_required`, 401 `invalid_credentials`, 429, 500 `db`, 503 `db_not_configured`. El limitador sigue contando **solo los 401** (`index.cjs:787-791`), lo que ya cumple CA-15 |
| GET | `/api/admin/masters` | superadmin, admin (sin cambios) | — | 200 `{ ok, seasons, ... }`. Ante un error de esquema, re-detecta y, si cambiaron los flags, **reintenta una vez** (se ve sin autor) | 500 `db` si sigue fallando |
| GET | `/api/labels/:id`, `/api/reports/tracking-export` | sin cambios | — | igual, con el mismo reintento único ante un error de esquema (`labelSchema`) | sin cambios |

### Forma de `/api/health`
```jsonc
{
  "operationalEpoch": "2026-…" | null,   // sin cambios
  "ok": true,                             // sin cambios: siempre true
  "service": "appetiquetado-sync",        // sin cambios
  "env": "staging" | "production" | null, // sin cambios
  "dbReady": true | false,                // sin cambios (Boolean(pool))
  "clientIp": "…",                        // sin cambios
  // nuevos (P3):
  "schemaComplete": true | false | null,  // null = desconocido (sin pool o detección fallida/timeout)
  "missingTables": ["auth_sessions"] | [] | null, // solo nombres de BASE_TABLES, en su orden
  "mastersAuditReady": true | false | null,       // created_by/updated_by en las 7 tablas de maestros
  "movementsSchemaReady": true | false | null     // las 6 columnas que agrega ensureMovementsSchema
}
```
- `schemaComplete = missingTables.length === 0 && mastersAuditReady && movementsSchemaReady`, según P3 ("esquema incompleto" = tablas faltantes **o** flags de las migraciones en falso). Si `schemaComplete` es true, `missingTables` es `[]` (CA-06).
- Si `dbReady=false`, o si la detección lanza un error o supera su timeout, los 4 campos nuevos valen `null` (CA-08: "desconocido", no completo).
- **Sin datos sensibles (RN-05, CA-06, CA-17).** Los nombres de tabla salen de la constante `BASE_TABLES` y nunca de la BD, así que no se filtra ninguna tabla ajena. No hay host, usuario, nombre de BD, mensajes de MySQL, conteos ni filas. Los errores de la detección solo van al log.
- **Liviano.** La detección es **una** consulta, `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?…16)`, con `timeout: 1500` ms de mysql2. Se reutiliza el resultado si tiene menos de 2 s y las llamadas simultáneas comparten la misma promesa. El peor caso queda por debajo de 2 s (CA-07).

### Monitor de esquema (P2-b) — `createSchemaMonitor`
- `refresh({ maxAgeMs })`: si el último resultado tiene menos de `maxAgeMs`, lo devuelve. Si no, ejecuta `detectSchemaState` (solo lectura), actualiza `locals.labelSchema`, `locals.mastersAuditReady` y `locals.schemaStatus` **en ambas direcciones** (recalcula, no solo degrada) y registra el cambio en el log si lo hubo: `[schema] Cambio de esquema detectado en caliente: faltan tablas [auth_sessions]; auditoría de maestros: disponible → NO disponible (faltan seasons.created_by, …). Reinicie el servicio para reaplicar las migraciones.`
- Hay dos usos con distinto límite de frecuencia: health llama a `refresh({ maxAgeMs: 2_000 })`, y el aviso de error de las rutas llama a `refresh({ maxAgeMs: 10_000 })`. **N = 10 s**: como máximo 1 re-detección cada 10 s por errores, con su resultado compartido.
- `onRouteError(err, routeName)`: si `isSchemaError(err)` (`ER_NO_SUCH_TABLE` o `ER_BAD_FIELD_ERROR`), registra `[schema] <route>: <err.code> <err.sqlMessage>` (el mensaje de MySQL nombra la tabla o la columna, como pide CA-16) y llama a `refresh({ maxAgeMs: 10_000 })`. Devuelve `true` si cambió algún flag.
- **Reintento en las lecturas.** `GET /api/admin/masters`, `GET /api/labels/:id` y `GET /api/reports/tracking-export` hacen esto: `catch (e) → if (await monitor.onRouteError(e, ruta)) reintenta una vez con los flags nuevos; si no, 500 db`. En las escrituras (altas y ediciones de maestros, importación, lote de etiquetas, login, movimientos) **solo se notifica** al monitor, sin reintento: así se evita duplicar efectos, y el siguiente intento ya usa los flags nuevos.
- **Nunca ejecuta DDL** (P2-b). La auditoría se recupera reiniciando el servicio, como indica la guía de P5.

## 5. Flujo / UI

### Login (`src/lib/authApi.ts`)
Función pura exportada `loginErrorMessage(kind: number | 'network'): string`:

| Situación | Texto exacto |
|---|---|
| 401 | `Usuario o contraseña incorrectos.` |
| 429 | `Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar.` (sin cambios, `:31-33`) |
| 500–599 (500, 502 de Render, 503 `db_not_configured`/`db_unavailable`) | `El servidor tuvo un problema. Intente más tarde.` |
| Error de red (fetch rechazado, sin respuesta HTTP) | `Sin conexión con el servidor.` |
| Otros 4xx (400, 403, 404…) | `No fue posible iniciar sesión.` (P4) |

- `login()` aísla el `apiFetch` en su propio try/catch: si se rechaza, devuelve `network`. Ya no expone `error.message` del navegador (hoy en `:47-51`), lo que cumple CA-13.
- Se mantienen los casos de un 200 con cuerpo inválido (`Respuesta inválida del servidor.`, `:37-39`) y de un 200 sin token o usuario (`No fue posible iniciar sesión.`, `:42-44`).
- `App.tsx:341-363` y `LoginView.tsx` no cambian: el `finally` ya libera `busy` (CA-11 exige el botón "Entrar" habilitado) y la sesión solo se guarda con `ok` (`saveSession`, `:45`).
- En móvil, la alerta ya está dentro de la tarjeta, entre la ayuda y el botón (`LoginView.tsx:59-69`). El E2E en Pixel 7 comprueba que queda dentro del viewport.

### Maestros (`src/lib/masterDataApi.ts`)
- En `describeApiError(code, status)`: si `status >= 500` o `code ∈ {db, db_unavailable, db_not_configured}`, se muestra **`Problema del servidor o de la base de datos al cargar o guardar Maestros. Intente de nuevo en unos segundos; si continúa, avise al administrador.`** Los casos `invalid_payload` y `forbidden` siguen igual.
- `fetchJcForemen` (vista operativa) **no** usa esta traducción: queda como hoy, porque cambiar otras pantallas está fuera de alcance. Se resuelve con un parámetro de `parseOrThrow` (por ejemplo `parseOrThrow(res, { serverText: false })`), cuyo valor por defecto activa la traducción para `/api/admin/*`.
- `MastersAdminPanel.reload()` (`:271-289`) ya muestra `e.message` en el `role="alert"` (`:428-432`) por encima de las pestañas. No requiere cambios.
- El caso más frecuente del CA-16 se resuelve en el servidor: tras la re-detección, la ruta reintenta y **los maestros se cargan sin autor**. Si el error persiste (por ejemplo, porque la re-detección quedó frenada por el límite de 10 s), se ve el mensaje en español y no el código `db`.

## 6. Alternativas descartadas

- **Ejecutar `schema.sql` completo al arrancar (con `multipleStatements`).** Pisaría la descripción de `operador` (RN-03), dependería de un `FOREIGN_KEY_CHECKS` de sesión sobre un pool y obligaría a habilitar `multipleStatements` en el pool de la API (lo que agranda la superficie de inyección).
- **Copiar el DDL de las 16 tablas en JS.** Volvería a duplicar las definiciones (hoy ya hay drift en `jc_foremen`) e iría contra RN-02.
- **Crear las tablas con `FOREIGN_KEY_CHECKS=0` en una conexión dedicada.** Funciona, pero puede dejar FK colgantes sin aviso si el padre falla. El orden topológico más las FK activas da errores explícitos por tabla.
- **Responder 503 en health con el esquema incompleto.** Descartado por P1: Render reiniciaría el servicio en bucle sin arreglar la BD.
- **Re-detectar en cada error, sin límite.** Una ráfaga de errores generaría una ráfaga de consultas a `information_schema`. P2-b exige un límite.
- **Reaplicar migraciones en caliente (P2-c).** Descartado por el usuario: podría chocar con el `DROP`/`CREATE` de un dump que todavía se está importando.
- **Comparar columna por columna contra `schema.sql`.** Descartado por P3 (sería costoso y frágil). Basta con las tablas más los flags de las migraciones conocidas.
- **Mostrar el texto de 5xx también en la vista operativa (jefes de cuadrilla).** Fuera de alcance (§7 del requerimiento). Queda como hallazgo.
- **Una dependencia para las migraciones (knex, umzug, etc.).** Las migraciones versionadas están fuera de alcance, y lo nativo (mysql2 más `information_schema`) alcanza.

## 7. Tareas

Las tareas de dev-backend y dev-frontend **no comparten archivos**. Las pruebas (fase 3) se escriben antes y fallan en rojo.

| ID | Dueño | Descripción | Archivos | Depende de | CA | Paralelo |
|---|---|---|---|---|---|---|
| T-01 | dev-backend | `schemaState.cjs`: `BASE_TABLES`, `buildLabelSchemaState` (se mueve), `detectSchemaState` (1 consulta, timeout de 1,5 s), `isSchemaError` y `createSchemaMonitor` (con `now` inyectable, una sola consulta en vuelo, `maxAgeMs`, log de cambios). Sin DDL ni DML. | `server/schemaState.cjs` | — | CA-06, CA-07, CA-08, CA-16 | sí (con T-02, T-05, T-06, T-07) |
| T-02 | dev-backend | `schemaBootstrap.cjs`: `parseBaseTables`, `ensureBaseTables` (solo las faltantes, en orden, una sentencia por llamada, error por tabla), `ensureBaseData` (se mueve, sin los CREATE y con 3 pasos aislados), `ensureMovementsSchema` (se mueve sin cambios) y `bootstrapSchema`. Ajuste del comentario de encabezado de `schema.sql`. | `server/schemaBootstrap.cjs`, `database/schema.sql` (solo comentario) | — (usa `BASE_TABLES` de T-01 para validar) | CA-01, CA-02, CA-03, CA-04, CA-05 | sí, con T-01 (el import de `BASE_TABLES` se acuerda por nombre) |
| T-03 | dev-backend | `index.cjs`: `main()` con `bootstrapSchema` más `monitor.refresh` inicial y sin anular el pool por errores de esquema; health con los 4 campos; reintento único en las 3 lecturas; `onRouteError` en los `catch` de login, logout, maestros, importación, lote de etiquetas y movimientos; se eliminan `detectLabelSchema` y las funciones movidas. | `server/index.cjs` | T-01, T-02 | CA-01…CA-08, CA-15, CA-16, CA-17 | no |
| T-04 | dev-frontend | `loginErrorMessage` y `login()` con los 5 textos; red aislada del resto. | `src/lib/authApi.ts` | — | CA-11, CA-12, CA-13, CA-14 | sí |
| T-05 | dev-frontend | `describeApiError`: texto en español para 5xx y `db*` en `/api/admin/*`; `fetchJcForemen` sin cambios. | `src/lib/masterDataApi.ts` | — | CA-16 | sí |
| T-06 | doc (Lead o dev-backend) | Guía "Copiar producción → staging" en `docs/AMBIENTES.md`: 1) suspender `appetiqueta-dev` en Render (Suspend), 2) en phpMyAdmin, dentro de **la misma** pestaña SQL: `SET FOREIGN_KEY_CHECKS=0;` + DROP de las tablas + `SET FOREIGN_KEY_CHECKS=1;` (o marcar "Desactivar la revisión de claves foráneas"), 3) importar el dump de producción, 4) reanudar el servicio, que al arrancar recrea las tablas faltantes y reaplica las migraciones aditivas, 5) verificar con `E2E_REMOTE_URL=<staging> npm run test:smoke:remote` (`schemaComplete=true`), 6) efecto sobre `operational_epoch`: toma el valor de producción, y los navegadores de staging borran su historial local (`operationalEpoch.ts:12-24`). Más una nota sobre los campos nuevos de health y qué hacer si `schemaComplete=false` (reiniciar; si persiste, revisar el log `[schema]`). | `docs/AMBIENTES.md` | — | (P5; sin CA) | sí |
| T-07 | qa-unitario (fase 3) | Pruebas unitarias del §8. | `tests/unit/schemaState.test.ts`, `tests/unit/schemaBootstrap.test.ts`, `tests/unit/authApi.test.ts`, `tests/unit/masterDataApi.test.ts`, `tests/unit/healthCheck.test.ts` | — (se escriben contra la interfaz de §3-§5) | CA-03, CA-04, CA-05, CA-06, CA-08, CA-09, CA-10, CA-11…CA-16 | sí |
| T-08 | qa-e2e (fase 3) | Script de escenarios de arranque, conectado a `e2e-api.mjs` (después de `e2e-migracion-maestros`, antes del E2E de carga); credenciales de administrador opcionales en `.env.test.example` y `ci.yml`. | `scripts/e2e-esquema-arranque.mjs`, `scripts/e2e-api.mjs`, `.env.test.example`, `.github/workflows/ci.yml` | — | CA-01…CA-05, CA-07, CA-08, CA-15, CA-16 | sí |
| T-09 | qa-e2e (fase 3) | Specs de Playwright de UI y API más el smoke con su helper. | `tests/e2e/login-errores.spec.ts`, `tests/e2e/maestros-error-servidor.spec.ts`, `tests/e2e/health-esquema-api.spec.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/helpers/healthCheck.ts` | — | CA-06, CA-09…CA-14, CA-16, CA-17 | sí |

Contrato entre T-01 y T-02 (para paralelizarlas): `schemaState.cjs` exporta `BASE_TABLES: readonly string[]`, `buildLabelSchemaState`, `detectSchemaState`, `isSchemaError` y `createSchemaMonitor`. `schemaBootstrap.cjs` exporta `parseBaseTables`, `ensureBaseTables`, `ensureBaseData`, `ensureMovementsSchema` y `bootstrapSchema`.

### Contrato de pruebas (fijado por qa-unitario en la fase 3; el dev debe respetarlo)
- `parseBaseTables(sqlText) -> [{ name, sql }]`. Lanza si una sentencia aceptada contiene `DROP|TRUNCATE|DELETE|RENAME|ALTER` fuera de un literal (`'...'`). Descarta (sin lanzar) `SET`, `INSERT`, `DROP` sueltos y `CREATE TABLE` sin `IF NOT EXISTS`. `sql` no incluye comentarios `--` ni `SET`/`INSERT`.
- `ensureBaseTables(pool, { log, schemaPath? }) -> { created: string[], failed: [{ table, code }] }`. `log` es `(line: string) => void`; sin `schemaPath` lee `database/schema.sql`. Detecta lo existente con una consulta a `information_schema.TABLES` (nombres comparados en minúsculas), ejecuta un `CREATE` por tabla faltante vía `pool.query(sql)` (también se acepta `execute`), en el orden del archivo. Nunca lanza: un archivo ilegible deja `created=[]` y una línea `[schema] ERROR ... schema.sql ...` en `log`. Formato del log: `[schema] Tabla creada: <t>` y `[schema] ERROR al crear la tabla <t> (<code>): <message>`.
- `bootstrapSchema(pool, { log }) -> { created, failed }`; nunca lanza. Orden: tablas, `INSERT IGNORE` de la época, upsert de roles, superadmin, `ensureMovementsSchema`, `ensureMastersAuditSchema`; cada paso de `ensureBaseData` está aislado.
- `detectSchemaState(pool) -> { missingTables, mastersAuditReady, movementsSchemaReady, labelSchema, schemaComplete }` con una sola consulta (`pool.query` o `execute`) a `information_schema.COLUMNS` que devuelve filas `{ TABLE_NAME, COLUMN_NAME }`. Rechaza si la consulta falla.
- `createSchemaMonitor({ pool, locals, now, log })` -> `{ refresh({ maxAgeMs }), onRouteError(err, routeName) }`. `refresh` devuelve `{ schemaComplete, missingTables, mastersAuditReady, movementsSchemaReady }` (los 4 en `null` si no hay pool o la detección falla; nunca lanza) y escribe `locals.schemaStatus`, `locals.mastersAuditReady` y `locals.labelSchema`. `onRouteError` devuelve `Promise<boolean>` (true si cambió `mastersAuditReady`). La antigüedad se compara con `age < maxAgeMs` (refresca si `age >= maxAgeMs`).
- `isSchemaError(err) -> boolean`.
- `tests/e2e/helpers/healthCheck.ts` exporta `evaluateHealth(body: unknown) -> { ok: boolean, motivo?: string }`. El motivo nombra las tablas, "la BD no está lista", la auditoría de maestros o "no informa el estado del esquema" según el caso.
- `src/lib/authApi.ts` exporta `loginErrorMessage(kind: number | 'network')`.

## 8. Plan de pruebas

Los E2E de API de arranque usan `scripts/e2e-esquema-arranque.mjs`, que sigue el patrón probado de `scripts/e2e-migracion-maestros.mjs`: guardián `loadTestEnv`, reset, `spawn` del servidor con stdout capturado, espera de health, apagado y espera del puerto libre, y reset al terminar. La referencia de la "definición de schema.sql" es el `SHOW CREATE TABLE` de cada tabla tomado justo después de `resetTestDb` (normalizando `AUTO_INCREMENT=n`). Corre en MariaDB 10.6 en CI y en MySQL 8/9 en local.

| CA | Nivel | Archivo | Caso |
|---|---|---|---|
| CA-01 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Reset; crear `operador1` (hash scrypt, como `test-env.mjs:55-62`); `DROP TABLE auth_sessions`; arrancar. Se verifica: `SHOW CREATE TABLE auth_sessions` igual a la referencia; stdout con `Tabla creada: auth_sessions`; login de `operador1` → 200 `{ok, token, user}`; `/api/auth/me` → 200. |
| CA-01 | unit | `tests/unit/schemaBootstrap.test.ts` | Con un pool falso al que le falta `auth_sessions`: se ejecuta solo su `CREATE TABLE IF NOT EXISTS`, se registra `Tabla creada: auth_sessions` y `created=['auth_sessions']`. |
| CA-02 | E2E API | `scripts/e2e-esquema-arranque.mjs` | DROP de `auth_sessions`, `movements` y `batch_log_labels`; arrancar. Las 3 existen, su `SHOW CREATE` es igual a la referencia (FK a `users`, `labels` y `batch_logs`) y no hay errores `[schema] ERROR`. Corre en CI (MariaDB 10.6) y en local (MySQL 8). |
| CA-02 | unit | `tests/unit/schemaBootstrap.test.ts` | `parseBaseTables(schema.sql real)` devuelve exactamente `BASE_TABLES`, en orden; cada `REFERENCES x` apunta a una tabla anterior (orden topológico); y no se emiten `SET`, `INSERT` ni `FOREIGN_KEY_CHECKS`. |
| CA-02 (borde) | E2E API | `scripts/e2e-esquema-arranque.mjs` | Hijo sin padre: `SET FOREIGN_KEY_CHECKS=0; DROP TABLE users` (con la conexión de la prueba); arrancar. `users` se recrea igual a la referencia; si `SUPERADMIN_PASSWORD` está definido, el superadmin inicia sesión. |
| CA-03 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Reset; insertar datos en `labels`, `movements`, `seasons` y `season_cost_centers`; arranque 0 (de calentamiento, para normalizar roles y superadmin). Luego, conteos más `CHECKSUM TABLE` de las 16 tablas; arranques 1 y 2. Conteos y checksums iguales (se toleran `roles` y `app_meta`), mismas 16 tablas en `information_schema` y ningún `Tabla creada` en el stdout. |
| CA-03 | unit | `tests/unit/schemaBootstrap.test.ts` | Con un pool completo, `ensureBaseTables` no ejecuta ningún `CREATE` y `created=[]`. |
| CA-04 | unit | `tests/unit/schemaBootstrap.test.ts` | `bootstrapSchema` con un pool falso que **registra todo el SQL**, en 3 estados (completo, sin tablas, sin columnas de movements y de auditoría). Cada sentencia cumple la lista permitida (`SELECT … information_schema`, `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE x ADD (COLUMN\|KEY\|CONSTRAINT)`, `INSERT IGNORE INTO app_meta`, `INSERT INTO roles … ON DUPLICATE KEY UPDATE`, `SELECT/INSERT users`) y ninguna contiene `DROP`, `TRUNCATE`, `DELETE`, `RENAME` ni `ALTER … DROP/MODIFY/CHANGE`. `parseBaseTables` rechaza un SQL con `DROP TABLE`. |
| CA-04 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Definición distinta: `ALTER TABLE labels DROP FOREIGN KEY fk_labels_created_by`; arrancar. `SHOW CREATE TABLE labels` queda **igual que antes del arranque** (no se recrea ni se re-agrega la FK) y su checksum no cambia. |
| CA-04 | unit | `tests/unit/schemaState.test.ts` | El monitor (`refresh`, `onRouteError`) solo emite `SELECT` (P2-b, sin DDL en caliente). |
| CA-05 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Con `MYSQL_ADMIN_USER`: `CREATE USER appetiq_sin_ddl@'%'` y `@'localhost'` con `GRANT SELECT, INSERT, UPDATE, DELETE` sobre la BD de pruebas; DROP de `auth_sessions`; arrancar con ese usuario. El proceso sigue vivo; health 200 con `schemaComplete=false` y `missingTables=['auth_sessions']`; el stdout contiene `auth_sessions` y `ER_TABLEACCESS_DENIED_ERROR`; `GET /api/labels/ZZZZ2222ZZZZ` → 404 (no 503). Al final se ejecuta `DROP USER`. Sin las variables de administrador: se omite con un aviso en local y **falla en CI** (`process.env.CI`). |
| CA-05 | unit | `tests/unit/schemaBootstrap.test.ts` | Un pool falso lanza `ER_TABLEACCESS_DENIED_ERROR` en `CREATE auth_sessions`: se registra el nombre y el código, las demás tablas faltantes se intentan igual, `bootstrapSchema` no lanza y `failed=[{table:'auth_sessions', code}]`. Si falla el upsert de roles, no se omite el `INSERT IGNORE` de la época. |
| CA-06 | E2E API | `tests/e2e/health-esquema-api.spec.ts` | Sin sesión: 200; claves **exactamente** `{ok, service, env, dbReady, clientIp, operationalEpoch, schemaComplete, missingTables, mastersAuditReady, movementsSchemaReady}`, con los tipos originales; `schemaComplete=true`, `missingTables=[]`, `mastersAuditReady=true`. El JSON (sin `clientIp`) no contiene `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `ER_`, `Error` ni `at `. Se ejecuta en desktop y móvil, como todos los specs. |
| CA-06 | unit | `tests/unit/schemaState.test.ts` | `detectSchemaState` sobre filas falsas calcula `missingTables` (solo de `BASE_TABLES`, aunque la BD tenga tablas ajenas), `mastersAuditReady` (14 columnas), `movementsSchemaReady` (6 columnas) y `schemaComplete`. |
| CA-07 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Arrancar con el esquema completo; DROP de `auth_sessions` sin reiniciar; sondear health (cada respuesta en <2 s) hasta que `missingTables` incluya `auth_sessions` (tope de 5 s, por la antigüedad máxima de 2 s); `schemaComplete=false`, HTTP 200. |
| CA-07 | unit | `tests/unit/schemaState.test.ts` | El monitor con reloj falso: con `maxAgeMs=2000` no vuelve a consultar antes de 2 s y sí después; las llamadas simultáneas comparten 1 consulta; un timeout de la consulta deja el estado en desconocido. |
| CA-08 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Arrancar con `MYSQL_PASSWORD` incorrecto (`createPool` → null): health 200, `dbReady=false`, `schemaComplete=null` y `missingTables=null`. |
| CA-08 | unit | `tests/unit/schemaState.test.ts` | El monitor sin pool, o con una detección que lanza un error, devuelve los 4 campos en `null`. |
| CA-09 | unit | `tests/unit/healthCheck.test.ts` | `evaluateHealth(body)` → `{ ok:false, motivo }` para: `schemaComplete=false` (el motivo nombra `auth_sessions`), `dbReady=false` ("la BD no está lista"), `mastersAuditReady=false` y un cuerpo sin campos de esquema (versión anterior). Además, el texto de `smoke.spec.ts` no contiene `request.post/put/delete/patch` (solo lectura). |
| CA-09 | E2E (smoke) | `tests/e2e/smoke.spec.ts` | "API responde health @smoke" usa `evaluateHealth` y `expect(res.ok, motivo).toBe(true)`, solo con GET. |
| CA-10 | unit + smoke | `tests/unit/healthCheck.test.ts`, `tests/e2e/smoke.spec.ts` | Un cuerpo completo → `ok:true`. El smoke pasa en el E2E local (desktop y móvil, BD recién reseteada) y en staging tras el deploy. |
| CA-11 | unit | `tests/unit/authApi.test.ts` | Con fetch simulado en 401: `message === 'Usuario o contraseña incorrectos.'` y `saveSession` no se llama (localStorage vacío). |
| CA-11 | E2E UI | `tests/e2e/login-errores.spec.ts` | Real: usuario E2E con clave errónea → alerta con el texto exacto; `appetiquetado:auth:token` ausente; "Entrar" habilitado. En desktop y móvil. |
| CA-12 | unit | `tests/unit/authApi.test.ts` | 500, 502 y 503 (`db_not_configured`, `db_unavailable`) → `El servidor tuvo un problema. Intente más tarde.`, sin "Credenciales" ni "contraseña". 400, 403 y 404 → `No fue posible iniciar sesión.` (P4). |
| CA-12 | E2E UI | `tests/e2e/login-errores.spec.ts` | `page.route('**/api/auth/login')` responde 500 `{error:'db'}` y luego 503 → texto exacto en `role="alert"`, sin "Credenciales" ni "contraseña". En desktop y móvil. |
| CA-13 | unit | `tests/unit/authApi.test.ts` | fetch rechaza con `TypeError('Failed to fetch')` → `Sin conexión con el servidor.`, sin "Failed to fetch". |
| CA-13 | E2E UI | `tests/e2e/login-errores.spec.ts` | `route.abort('failed')` → texto exacto; "Failed to fetch" no aparece; en móvil, la alerta queda `toBeInViewport()`. |
| CA-14 | unit + E2E UI | `tests/unit/authApi.test.ts`, `tests/e2e/login-errores.spec.ts` | 429 → `Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar.` (simulado con route), en desktop y móvil. |
| CA-15 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Servidor con `RATE_LIMIT_LOGIN_PER_MIN=10`; DROP de `auth_sessions` en caliente; 11 logins válidos → 11 × 500; recrear `auth_sessions` con su `CREATE` de `schema.sql` desde la conexión de la prueba (sin reiniciar); el siguiente login → 200, no 429. |
| CA-15 | unit (regresión) | `tests/unit/rateLimit.test.ts` (existente, `:66`) | Con `countIf` (401), los otros estados no consumen el cupo. Ya existe; no se modifica. |
| CA-16 | E2E API | `scripts/e2e-esquema-arranque.mjs` | Arrancar con `mastersAuditReady=true`; login de admin; `GET /api/admin/masters` → 200 con autores. Quitar las FK y las columnas de auditoría de las 7 tablas en caliente (como `simularEsquemaAnterior` de `e2e-migracion-maestros.mjs:104-122`). Sondear `GET /api/admin/masters` (tope de 15 s, por el límite de 10 s): llega a 200 con listas no vacías y `createdBy=null`; cualquier 500 intermedio es `{ok:false,error:'db'}`. El stdout contiene `ER_BAD_FIELD_ERROR` o `created_by`. Health → `mastersAuditReady=false` y `schemaComplete=false`. |
| CA-16 | unit | `tests/unit/schemaState.test.ts` | `onRouteError(ER_BAD_FIELD_ERROR)` re-detecta como máximo 1 vez cada 10 s, devuelve `true` si cambió `mastersAuditReady` y registra la línea `[schema] …`. Con `ER_DUP_ENTRY` no re-detecta. |
| CA-16 | unit | `tests/unit/masterDataApi.test.ts` | `fetchMasterAdminData` con 500 `{error:'db'}` lanza el texto en español (no `"db"`); 503 `db_unavailable` → igual; `forbidden` e `invalid_payload` sin cambios; `fetchJcForemen` con 500 conserva su comportamiento actual. |
| CA-16 | E2E UI | `tests/e2e/maestros-error-servidor.spec.ts` | Admin; `page.route('**/api/admin/masters')` responde 500 `{ok:false,error:'db'}`; abrir Maestros → `role="alert"` con el texto en español; no hay ningún elemento con el texto exacto `db`. En desktop y móvil. |
| CA-17 | E2E API | `tests/e2e/health-esquema-api.spec.ts` | Health sin sesión: no aparecen `username`, `full_name` ni valores numéricos fuera de los campos conocidos (no hay conteos). |
| CA-17 | E2E API (regresión) | `tests/e2e/permisos-api.spec.ts` (existente) | `/api/admin/*`: 401 sin sesión y 403 para operador. Se ejecuta sin cambios. |

Regresión obligatoria: `scripts/e2e-migracion-maestros.mjs`. Ningún log nuevo puede contener el texto `ensureMastersAuditSchema`, porque ese script lo busca (`:86`). Los logs nuevos usan el prefijo `[schema]`.

## 9. Riesgos y rollback

| Riesgo | Mitigación |
|---|---|
| El parser de `schema.sql` falla ante un cambio futuro de formato (por ejemplo, un `;` dentro de un `COMMENT`). | El test unitario exige 16 tablas = `BASE_TABLES` y corre en el CI. El comentario de encabezado de `schema.sql` documenta la regla. Si falla en producción: log `[schema] ERROR`, no se crea nada y el servicio sigue como hoy. |
| Un `ensureBaseData` que ya no anula el pool deja la API viva con `roles` o `users` ausentes (antes, todo 503). | Es lo pedido (RN-04, CA-05). Health lo expone y el smoke falla. Las rutas afectadas responden 500 `db`, que en la UI se ve como "El servidor tuvo un problema". |
| `roles` recreada vacía obtiene ids distintos de los que guarda `users.role_id`. | El upsert inserta superadmin, admin y operador en ese orden, así que con AUTO_INCREMENT desde 1 coinciden con la semilla. Se documenta en la guía (P5): ante una restauración parcial, revisar el log `[schema]`. |
| El health consulta `information_schema` en cada chequeo de Render y de los clientes. | 1 consulta con `TABLE_NAME IN (16)`, antigüedad máxima de 2 s, una sola consulta en vuelo y timeout de 1,5 s. Hoy health ya hace 1 consulta (`app_meta`). |
| La re-detección en caliente sube `mastersAuditReady` a true si las columnas reaparecen sin FK. | Coincide con la regla de arranque (`masterAudit.cjs:88-89`: el flag exige columnas, no FK). |
| CA-05 en CI necesita credenciales de administrador. | Solo en `.env.test` del CI (`root`/`ci_root` del contenedor efímero) y como opcional en `.env.test.example`. `assertSafeTestEnv` sigue exigiendo un host local y una BD `*_test`. |
| Un smoke contra una versión anterior (sin los campos nuevos) falla. | Es intencional, y `evaluateHealth` lo explica ("el servidor no informa el estado del esquema"). El smoke siempre se corre después del deploy. |
| `trn_felipe` comparte usuario entre staging y producción. | El arranque solo crea tablas de la BD que valida el guardián (RN-07, sin cambios). Solo usa `CREATE TABLE IF NOT EXISTS`, que nunca es destructivo. |

**Rollback.** El cambio no modifica el esquema ni hace backfill: las tablas que crea son las mismas de `schema.sql`, y quedan válidas aunque se revierta. Para volver atrás se hace `git revert` del merge en `developer` (y en `main`, con aprobación) o, en Render, un redeploy del commit anterior. Nada que deshacer en la BD.

## Hallazgos fuera de alcance (para estado.md)
- La vista operativa (`OperationalJcForm.tsx:41-46`, `TrackingView.tsx:145-151`) muestra el código crudo `db` si falla `/api/master-data/jc-foremen`.
- La importación Excel de Maestros (`masterDataApi.ts:63`) también lanza el código crudo y no pasa por `describeApiError`.
- La semilla de pruebas aplica la descripción de `operador` que viene de `schema.sql`, y el arranque la reemplaza por la de `ensureBaseData` (no se unifica: §7 del requerimiento).
