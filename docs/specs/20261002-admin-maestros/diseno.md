# Diseño — Admin gestiona los maestros (sin Usuarios) + auditoría por registro

- **Spec:** 20261002-admin-maestros · **Requerimiento:** [requerimiento.md](requerimiento.md) (CA-01..CA-29, RN-01..RN-15, P1..P4 resueltas)
- **Estado:** **listo para compuerta 2** (iteración 2: incorpora la revisión de revisor-codigo, "aprobado con cambios", y las decisiones D1..D5; ver §10)
- **Rama:** `feat/admin-maestros` (desde `developer` @ d88c407)

## 1. Resumen de la solución

1. **Permisos.** Se agrega `ROLE.ADMIN` a `ACCESS.MASTER_ADMIN` (`server/index.cjs:28`). Así las 9 rutas de maestros quedan abiertas al admin sin tocar cada ruta. En la UI, `ROLE_TABS.admin` suma `'maestros'` (`src/lib/roleAccess.ts:6`) y `canManageMasters` deja de ser un segundo chequeo propio (`src/App.tsx:104`): pasa a ser `canAccessTab(role, 'maestros')`. Usuarios no cambia, porque usa `requireRoles(ROLE.SUPERADMIN)` directamente (`server/index.cjs:817, 833, 860`) y `user.role === 'superadmin'` en la UI (`src/App.tsx:516`).
2. **Auditoría.** Las 7 tablas de maestros reciben dos columnas nuevas, `created_by` y `updated_by` (`BIGINT UNSIGNED NULL`, con índice y FK a `users` `ON DELETE SET NULL`). Se reutilizan `created_at`/`updated_at`, que ya existen. La migración es idempotente: corre al arrancar, en una función nueva `ensureMastersAuditSchema`, y queda reflejada en `database/schema.sql`. Los registros históricos quedan en NULL. La función devuelve el flag `mastersAuditReady`, con el mismo patrón que `detectLabelSchema` → `app.locals.labelSchema` (`server/index.cjs:690, 704`). Si la migración no pudo crear las columnas, Maestros sigue funcionando **sin** auditoría en vez de responder 500 (§3.5).
3. **Escritura.** El autor sale siempre de `req.auth.userId`. Las altas manuales escriben `created_by = updated_by = userId`. En las ediciones manuales, la asignación `updated_by = IF(<algún valor cambió>, userId, updated_by)` va **primero** en el `SET`, así que guardar sin cambios no toca la fila: se cumple P4, y `ON UPDATE CURRENT_TIMESTAMP` tampoco mueve `updated_at`. La importación usa la misma técnica con `NULL` (P2). Al desmarcar la temporada actual anterior se atribuye el cambio a quien marcó la nueva, o NULL si fue la importación (P3).
4. **Lectura.** `GET /api/admin/masters` agrega a cada registro `createdBy`/`updatedBy` (`{ id, name } | null`, con el nombre vigente vía `LEFT JOIN users`) y `createdAt`/`updatedAt` (ISO 8601 UTC, calculado con `UNIX_TIMESTAMP` para no depender de la zona del servidor de BD). La UI muestra debajo del nombre "Modificado por X el dd-mm-aaaa" o "Modificado el dd-mm-aaaa · sin autor registrado", con la fecha en `America/Santiago`.

5. **Etiqueta de estado (D1, usuario).** El chip y la opción del estado desactivado pasan de "Archivado" a **"Inactivo"**, y el filtro pasa de "Archivados" a **"Inactivos"** (`MastersAdminPanel.tsx:518, 853, 1082`). Por coherencia también cambian los textos de ayuda que dicen "Archivar" o "Archive" (`:385, :1528`). Ninguna prueba existente busca "Archivado": revisé con `grep -rn "Archivad" tests src scripts`, que solo encuentra esas 3 líneas del componente.

La lógica pura del servidor va en un módulo CommonJS nuevo, `server/masterAudit.cjs`, como ya se hizo con `server/envGuard.cjs` y `server/rateLimit.cjs`. Eso permite probarla con Vitest (precedente: `tests/unit/rateLimit.test.ts:5-6`) sin pagar la deuda de `server/index.cjs`.

## 2. Impacto por capa

| Capa | Archivos | Cambio |
|---|---|---|
| BD | `database/schema.sql` | En los 7 `CREATE TABLE` (`:60, :78, :90, :102, :119, :131, :145`): columnas `created_by`/`updated_by`, índices y FK `ON DELETE SET NULL`. Sin backfill. |
| API (lógica pura) | `server/masterAudit.cjs` (nuevo) | Lista de tablas, `ensureMastersAuditSchema(pool)` → `boolean` (el flag), constructores de SQL para la edición auditada y la importación (con variante sin auditoría), `auditSelect(alias, ready)`, `mapAuditRow(row)` y `normalizeSeasonDate(v)`. |
| API | `server/index.cjs` | `ACCESS.MASTER_ADMIN` incluye admin (`:28`). `main()` llama a la migración y guarda `app.locals.mastersAuditReady` (`:688-690, 704`). `code`/`name` se limitan al largo de su columna con `normalizeLimitedText` (`:56-58`). Altas y ediciones auditadas en las 7 rutas (`:1055-1317`). P3 en temporadas (`:1087-1090`, `:543-546`). P2 en la importación (`:499-549`, `:997-1017`). `fetchMastersBundle` con auditoría (`:551-601`). `GET /api/admin/masters` agrega `ok: true` (`:1047`). |
| Frontend (permisos) | `src/lib/roleAccess.ts`, `src/App.tsx`, `src/components/MastersAdminPanel.tsx` | Pestaña `maestros` para admin (`roleAccess.ts:6`). `canManageMasters = canAccessTab(role,'maestros')` (`App.tsx:104`). Nuevo texto del aviso (`MastersAdminPanel.tsx:360`). "Archivado/Archivados" → "Inactivo/Inactivos" y ajuste de los textos de ayuda (`:385, :518, :853, :1082, :1528`). |
| Frontend (auditoría) | `src/types.ts`, `src/lib/masterAudit.ts` (nuevo), `src/components/MastersAdminPanel.tsx`, `src/App.css` | Tipo `MasterAudit` en los 7 `Master*` (`types.ts:52-114`). Formateo dd-mm-aaaa en Chile. Línea "Modificado…" en las 4 tablas (`MastersAdminPanel.tsx:856-1067`). Estilo `.masters-audit`. |
| Doc | `.claude/skills/contexto-appetiquetado/SKILL.md` | La tabla de roles pasa a: admin = Resumen, Crear etiquetas, Registrar lecturas, **Maestros**, Excel de trackeo. |
| Pruebas | ver §8 | Se invierten 3 pruebas existentes y se agregan unitarias, E2E UI, E2E API y el script de migración. |

**Estado dual:** no aplica. Los maestros viven solo en MySQL, la fuente de verdad, y no tienen copia ni cola en `localStorage`. La sesión cacheada (`src/lib/session.ts:20-28`) no afecta, porque las pestañas salen del bundle (`ROLE_TABS`) y el rol se resuelve en el servidor en cada request (`server/index.cjs:269-276`). Eso cubre CA-16.

**Terreno/móvil:** Maestros es una pantalla de oficina y no se agrega cola offline (requerimiento §6). Con la regla de P4, un doble envío del mismo formulario es idempotente: el segundo UPDATE no cambia valores, así que no cambia la auditoría. Un doble envío de un **alta** puede fallar con `ER_DUP_ENTRY` → `500 db` por las claves únicas de code/name. Es el comportamiento de hoy y no cambia.

## 3. Modelo de datos / migración

### 3.1 Columnas, índices y FK (iguales en las 7 tablas)

| Tabla | Prefijo de nombres | Índices | FK |
|---|---|---|---|
| `seasons` | `seasons` | `idx_seasons_created_by`, `idx_seasons_updated_by` | `fk_seasons_created_by`, `fk_seasons_updated_by` |
| `companies` | `companies` | `idx_companies_created_by`, `idx_companies_updated_by` | `fk_companies_created_by`, `fk_companies_updated_by` |
| `species` | `species` | `idx_species_…` | `fk_species_…` |
| `varieties` | `varieties` | `idx_varieties_…` | `fk_varieties_…` |
| `csg_catalog` | `csg` (como `uq_csg_code`, `schema.sql:127`) | `idx_csg_…` | `fk_csg_…` |
| `jc_foremen` | `jc_foremen` | `idx_jc_foremen_…` | `fk_jc_foremen_…` |
| `season_cost_centers` | `scc` (como `fk_scc_season`, `schema.sql:165`) | `idx_scc_…` | `fk_scc_…` |

Los nombres de las FK son únicos en la BD. No chocan con los existentes `fk_labels_created_by`, `fk_movements_created_by` ni `fk_batch_logs_created_by` (`schema.sql:234, 260, 275`).

**En `database/schema.sql`**, dentro de cada `CREATE TABLE` y después de `updated_at` (ejemplo `csg_catalog`):

```sql
  created_by BIGINT UNSIGNED NULL COMMENT 'Auditoría: usuario que creó el registro a mano (NULL = histórico o importación Excel)',
  updated_by BIGINT UNSIGNED NULL COMMENT 'Auditoría: último usuario que lo modificó a mano (NULL = histórico o importación Excel)',
  ...
  KEY idx_csg_created_by (created_by),
  KEY idx_csg_updated_by (updated_by),
  CONSTRAINT fk_csg_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_csg_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
```

`users` se crea antes que los maestros (`schema.sql:25`), y el archivo además desactiva `FOREIGN_KEY_CHECKS` (`:10`), así que el orden no es problema. **No** se agregan sentencias `ALTER … ADD COLUMN IF NOT EXISTS` en `schema.sql`. Ese archivo solo usa `CREATE TABLE IF NOT EXISTS` y lo cargan `scripts/test-env.mjs:53` y `scripts/db-staging-init.mjs:33` contra el motor local, que podría ser MySQL 8, donde esa sintaxis no existe. La migración de BD existentes es la del arranque (3.2), igual que hoy con `ensureMovementsSchema`.

### 3.2 Migración al arrancar (`ensureMastersAuditSchema`, en `server/masterAudit.cjs`)

Sigue el patrón de `ensureMovementsSchema` (`server/index.cjs:122-175`): consulta `information_schema` y aplica solo lo que falta. Pseudocódigo:

```js
const MASTER_AUDIT_TABLES = [
  { table: 'seasons', prefix: 'seasons' }, { table: 'companies', prefix: 'companies' },
  { table: 'species', prefix: 'species' }, { table: 'varieties', prefix: 'varieties' },
  { table: 'csg_catalog', prefix: 'csg' }, { table: 'jc_foremen', prefix: 'jc_foremen' },
  { table: 'season_cost_centers', prefix: 'scc' },
]
// Errores "ya existe" que se toleran (otra instancia o un arranque concurrente pudo crear el objeto
// entre la consulta y el ALTER), como hace hoy server/index.cjs:165 con ER_DUP_KEYNAME:
const ALREADY_EXISTS = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_DUP_KEY'])
const isAlreadyExists = (err) =>
  ALREADY_EXISTS.has(err?.code) || /errno:?\s*121/i.test(String(err?.message || ''))  // MariaDB: FK duplicada = errno 121

async function ensureMastersAuditSchema(pool) {  // → Promise<boolean> (mastersAuditReady)
  let ready = true
  for (const { table, prefix } of MASTER_AUDIT_TABLES) {
    try {
      // 1) columnas:  SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      //    0 filas (la tabla no existe) → ready = false; continuar sin ALTER
      //    por cada col en ['created_by','updated_by'] ausente: ALTER TABLE <t> ADD COLUMN <col> BIGINT UNSIGNED NULL
      //    (isAlreadyExists → seguir)
      // 2) índices:   SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      //    si falta idx_<p>_<col> → ALTER TABLE <t> ADD KEY idx_<p>_<col> (<col>)   (isAlreadyExists → seguir)
      // 3) FK:        SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
      //               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?
      //    si falta fk_<p>_<col> → ALTER TABLE <t> ADD CONSTRAINT fk_<p>_<col> FOREIGN KEY (<col>)
      //                            REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
      //    (isAlreadyExists → seguir; cualquier otro error, p. ej. falta REFERENCES → console.warn y seguir:
      //     la FK NO es requisito del flag)
      // 4) verificación: se vuelve a leer COLUMNS; si falta created_by o updated_by → ready = false
    } catch (err) {
      console.error(`[sync-api] ensureMastersAuditSchema ${table}:`, err.message || err)
      ready = false
    }
  }
  console.log(ready
    ? '[sync-api] Auditoría de maestros lista (7 tablas).'
    : '[sync-api] AVISO: auditoría de maestros NO disponible; Maestros funciona sin autor (mastersAuditReady=false).')
  return ready
}
```

- Los nombres de tabla y columna vienen de la constante, nunca del usuario. Los valores de las consultas a `information_schema` van con `?`.
- **Orden en `main()`:** `ensureBaseData` → `ensureMovementsSchema` → **`mastersAuditReady = await ensureMastersAuditSchema(pool)`** → `detectLabelSchema` (`server/index.cjs:688-690`). Después, `app.locals.mastersAuditReady = mastersAuditReady` junto a `app.locals.labelSchema` (`:704`). El valor inicial es `false`, así que sin pool o si la migración no corre, el modo es sin auditoría. Tiene que ir después de `ensureBaseData` porque esa función puede crear `jc_foremen` sin las columnas nuevas (`server/index.cjs:193-205`). Ese `CREATE TABLE` **no se modifica**: si crea la tabla, la migración le agrega las columnas en el mismo arranque.
- Si la migración falla, **no** se pone `pool = null`. Se captura dentro de la función, a diferencia de `ensureBaseData`, que tumbaría toda la API (`:691-698`), y etiquetas y lecturas siguen funcionando. Maestros pasa al modo sin auditoría (§3.5). Sin ese modo, el GET, las escrituras y la importación referenciarían columnas inexistentes y responderían `500 db` (riesgo 1 de §9).
- **MariaDB 10.6:** agregar al final una columna `NULL` es instantáneo (`ALGORITHM=INSTANT`). `ADD KEY` es in-place. `ADD CONSTRAINT … FOREIGN KEY` con `foreign_key_checks=1` reconstruye la tabla (COPY), pero los catálogos son chicos (cientos de filas), así que tarda milisegundos. No se fuerza `ALGORITHM`, para seguir siendo compatible con MySQL 8 local.
- **Backfill: no.** Los registros existentes quedan con `created_by = updated_by = NULL` y conservan sus `created_at`/`updated_at` (RN-11, CA-24). Ningún paso de la migración hace UPDATE de datos.
- **Idempotencia (CA-27):** una segunda ejecución encuentra todo y no hace ningún ALTER. Aplicar `schema.sql` dos veces no falla, porque todo es `CREATE TABLE IF NOT EXISTS` más el `INSERT … ON DUPLICATE KEY` de roles (`:303-310`).

### 3.3 Reglas de escritura (cómo se cumplen RN-09, RN-10, RN-13, P2, P3 y P4)

**Invariante:** `updated_by` cambia **si y solo si** cambia al menos una de las columnas que asigna la sentencia. Esas mismas columnas son las que hacen que `ON UPDATE CURRENT_TIMESTAMP(3)` mueva `updated_at` (`schema.sql:69` y siguientes). La comparación se hace en SQL, en la misma sentencia, sobre la fila vigente: es atómica y no hace falta leer antes ni tomar `FOR UPDATE`.

**a) Alta manual (las 7 rutas, rama sin `id`):** al `INSERT` se le agregan `created_by` y `updated_by`, ambos con `req.auth.userId`. `created_at` y `updated_at` toman el mismo `CURRENT_TIMESTAMP(3)` del statement, así que son iguales (CA-17). El cuerpo **no** se lee para estos campos (CA-20).

**b) Edición manual (rama con `id`):** se usa el constructor `buildAuditedUpdate(table, cols)` de `masterAudit.cjs`:

```sql
UPDATE csg_catalog
SET updated_by = IF(CAST(code AS BINARY) <=> CAST(? AS BINARY)
                    AND CAST(name AS BINARY) <=> CAST(? AS BINARY)
                    AND is_active <=> ?, updated_by, ?),
    code = ?, name = ?, is_active = ?
WHERE id = ?
-- params: [code, name, isActive, userId, code, name, isActive, id]
```

- **`updated_by` va primero.** En un UPDATE de una tabla, MariaDB y MySQL evalúan el `SET` de izquierda a derecha, y las asignaciones posteriores ven los valores nuevos. Si `updated_by` fuera al final, compararía contra la fila ya modificada y nunca detectaría cambios. Al ponerlo primero, compara contra la fila vigente, y también funciona si el servidor tiene el `sql_mode` `SIMULTANEOUS_ASSIGNMENT` de MariaDB.
- **`CAST(… AS BINARY)` en las columnas de texto.** La intercalación es `utf8mb4_unicode_ci` (`schema.sql:88`), así que `'csg norte' = 'CSG Norte'` da verdadero. Sin el CAST, un cambio de mayúsculas escribiría bytes nuevos, movería `updated_at` y dejaría el `updated_by` anterior: una atribución falsa. CA-28 lo cubre.
- **`<=>`** (igualdad segura con NULL) compara `starts_on`/`ends_on`, que admiten NULL.
- Columnas comparadas por ruta, que son exactamente las que asigna cada UPDATE de hoy:
  - `seasons`: `code`, `name` (texto); `starts_on`, `ends_on`, `is_current`, `is_active` (`server/index.cjs:1075-1078`).
  - `companies`, `species`, `csg_catalog`, `jc_foremen`: `code`, `name` (texto); `is_active` (`:1116, :1150, :1184, :1218`).
  - `varieties`: `code`, `name` (texto); `species_id`, `is_active` (`:1256-1259`).
  - `season_cost_centers`: `center_code`, `center_name` (texto); `season_id`, `company_id`, `species_id`, `variety_id`, `csg_id`, `is_active` (`:1297-1301`). `source` no se asigna en la edición manual y queda igual (requerimiento §1, `:54`).
- **Fechas de temporada.** Para que P4 funcione, lo que el cliente reenvía tiene que compararse igual que lo guardado. Hoy `starts_on`/`ends_on` salen del pool como `Date` (`dateStrings: false`, `server/index.cjs:100`), llegan al cliente como ISO con hora y el formulario los reenvía así (`MastersAdminPanel.tsx:558-559`). Comparar un `DATE` con `'2025-11-01T00:00:00.000Z'` daría "distinto". Se corrige en los dos lados:
  1. `fetchMastersBundle` devuelve `DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on` (y lo mismo con `ends_on`).
  2. `POST /api/admin/seasons` normaliza `startsOn`/`endsOn` con `normalizeSeasonDate(v)`, que devuelve `{ valid, value }`:
     - `undefined`, `null` o texto vacío o solo espacios → `{ valid: true, value: null }`;
     - texto que calza con `/^\d{4}-\d{2}-\d{2}/` → `{ valid: true, value: <esos 10 caracteres> }`, así que también sirve para un cliente con el bundle anterior (ISO con hora);
     - cualquier otro valor → `{ valid: false }`, y la ruta responde **`400 invalid_payload`** antes de tocar la BD (D5).

  Hoy un valor así llegaría a MariaDB y terminaría en `500 db` o en una fecha `0000-00-00`.

**Largo de los textos (riesgo opcional del revisor, incluido porque es barato):** las 7 rutas manuales pasan de `normalizeMasterName` a `normalizeLimitedText(value, max)` (`server/index.cjs:56-58`, ya existe), con el largo de cada columna:
- `seasons.code`: 30; `seasons.name`: 120 (`schema.sql:62-63`);
- `code`: 60 y `name`: 180 en companies, species, varieties, csg_catalog y jc_foremen;
- `center_code`: 80; `center_name`: 180 (`schema.sql:149-150`).

Como el valor recortado es el mismo que se compara y se asigna, P4 sigue funcionando. Un texto demasiado largo deja de dar `500 db` (`ER_DATA_TOO_LONG` en modo estricto) y se guarda recortado. La importación no cambia (fuera de alcance).

  Efecto lateral positivo: el `<input type="date">` del formulario de temporada vuelve a mostrar la fecha, que hoy queda vacía al editar porque recibe un ISO con hora.

**c) P3 (CA-29), temporada actual (manual):** el efecto lateral de `server/index.cjs:1088` pasa a ser

```sql
UPDATE seasons SET updated_by = ?, is_current = 0 WHERE code <> ? AND is_current = 1   -- [userId, code]
```

El filtro `AND is_current = 1` es obligatorio. Sin él, las temporadas que ya tienen `is_current = 0` y otro `updated_by` recibirían un `updated_by` nuevo, la fila cambiaría y se movería su `updated_at`, lo que viola P4. La sentencia siguiente (`:1089`, `SET is_current = 1 WHERE code = ?`) no hace nada, porque el UPDATE o INSERT anterior ya dejó `is_current = 1`. Se mantiene sin columnas de auditoría. Guardar como actual una temporada que ya lo era no cambia ninguna fila (CA-28).

**d) P2 y A3, importación Excel:** los `INSERT` de la importación no listan `created_by`/`updated_by`, así que las filas nuevas quedan en NULL (CA-25). Cada `ON DUPLICATE KEY UPDATE` recibe como **primera** asignación `updated_by = IF(<todas iguales>, updated_by, NULL)`, que compara contra lo que va a asignar:

| Función / sentencia | Comparación (todas deben ser iguales para conservar `updated_by`) |
|---|---|
| `upsertByCodeAndName` (`:499-512`), para companies, species y csg_catalog | `CAST(name AS BINARY) <=> CAST(VALUES(name) AS BINARY) AND is_active <=> 1` |
| `resolveVariety` (`:514-528`) | `name` (binario) `AND species_id <=> VALUES(species_id) AND is_active <=> 1` |
| `resolveSeason` (`:530-549`) | `name` (binario) `AND is_current <=> VALUES(is_current) AND is_active <=> 1` |
| upsert de `season_cost_centers` (`:997-1017`) | `center_name` (binario) `AND species_id <=> VALUES(species_id) AND variety_id <=> … AND csg_id <=> … AND is_active <=> 1 AND CAST(source AS BINARY) <=> CAST('excel' AS BINARY)` |

El efecto lateral de la importación sobre la temporada actual (`:544`) pasa a `UPDATE seasons SET updated_by = NULL, is_current = 0 WHERE code <> ? AND is_current = 1`. Si la fila del Excel coincide en todo, el ODKU no cambia nada y la auditoría queda intacta (CA-26, segunda parte). `master_import_runs` no cambia (`:1021-1025`, RN-07).

`buildImportAuditClause(cols)` en `masterAudit.cjs` genera el fragmento a partir de pares `{ col, expr, text }`. `expr` solo puede ser `VALUES(col)` o un literal fijo del código (`1`, `'excel'`), nunca un valor del usuario.

### 3.4 Lectura (`fetchMastersBundle`, `server/index.cjs:551-601`)

En cada uno de los 7 SELECT se agregan `auditSelect('<alias>')` y los dos LEFT JOIN:

```sql
  <a>.created_by, <a>.updated_by,
  COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.username) AS created_by_name,
  COALESCE(NULLIF(TRIM(uu.full_name), ''), uu.username) AS updated_by_name,
  ROUND(UNIX_TIMESTAMP(<a>.created_at) * 1000) AS created_at_ms,
  ROUND(UNIX_TIMESTAMP(<a>.updated_at) * 1000) AS updated_at_ms
...
LEFT JOIN users cu ON cu.id = <a>.created_by
LEFT JOIN users uu ON uu.id = <a>.updated_by
```

Las tablas sin alias hoy (seasons, companies, species, csg_catalog, jc_foremen) lo reciben (`t`). Después, `mapAuditRow(row)` quita esas 6 columnas crudas y agrega:

- `createdBy` = `created_by != null && created_by_name != null ? { id: Number(created_by), name: created_by_name } : null`, y lo mismo para `updatedBy`. Un id sin usuario (FK ausente y usuario borrado) se muestra como "sin autor registrado" y no rompe el listado (requerimiento §6).
- `createdAt` / `updatedAt` = `new Date(Number(x_at_ms)).toISOString()`.

### 3.5 Degradación sin auditoría (`mastersAuditReady = false`, D4)

Si las columnas no quedaron creadas (por ejemplo, porque el usuario MySQL no tiene `ALTER`), el servidor usa el SQL de hoy en todos los puntos que tocan la auditoría. Ninguna ruta de maestros falla por la auditoría:

| Punto | Con flag `true` | Con flag `false` |
|---|---|---|
| Alta manual (7 rutas) | `INSERT … (…, created_by, updated_by) VALUES (…, ?, ?)` | `INSERT` actual, sin esas columnas |
| Edición manual | `buildAuditedUpdate` (§3.3b) | `UPDATE … SET <cols> WHERE id = ?` actual |
| P3 manual | `SET updated_by = ?, is_current = 0 … AND is_current = 1` | `SET is_current = 0 WHERE code <> ? AND is_current = 1` |
| Importación (ODKU y P3) | con `updated_by = IF(…)` primero | ODKU actual; `SET is_current = 0 … AND is_current = 1` |
| `fetchMastersBundle` | `auditSelect` + `LEFT JOIN users` | Solo `created_at_ms`/`updated_at_ms`, que ya existen; `mapAuditRow` devuelve `createdBy = updatedBy = null` |

- Los constructores de `masterAudit.cjs` reciben `ready` como parámetro (`buildAuditedUpdate(table, cols, { audit })`, `buildImportAuditClause(cols, { audit })`, `auditSelect(alias, ready)`, `auditJoins(alias, ready)`). La rama sin auditoría también es una función pura y se prueba en unit.
- Las rutas leen `req.app.locals.mastersAuditReady`, que es el mismo `app.locals` que ya usa `authMiddleware` (`server/index.cjs:290`).
- En la UI el contrato no cambia: todas las filas se ven como "Modificado el dd-mm-aaaa · sin autor registrado". El log de arranque deja claro qué modo está activo (§3.2) y el plan de producción lo verifica (§9).
- El flag se calcula una vez por arranque. Una vez corregidos los privilegios, basta reiniciar el servicio para que la migración se complete y el flag pase a `true`.

**Por qué `UNIX_TIMESTAMP` y no la columna `DATETIME` cruda:** el pool no fija zona (`server/index.cjs:91-101`). `CURRENT_TIMESTAMP` guarda la hora de pared de la **zona de la sesión MySQL**, mientras que mysql2 interpreta los `DATETIME` en la zona del **proceso Node** (UTC en Render). Si el servidor de BD de `trn.cl` está en hora de Chile, la columna cruda llegaría desfasada 3 o 4 h. `UNIX_TIMESTAMP` convierte con la misma zona de sesión con la que se escribió, y el resultado es un instante absoluto correcto sea cual sea la zona de la BD. Eso cumple RN-14 y el caso borde de las 23:30. Única ambigüedad: la hora repetida al terminar el horario de verano, si la BD está en hora de Chile. Su impacto sobre una fecha dd-mm-aaaa es despreciable.

## 4. Contrato de API

Errores comunes (sin cambios, RN-06): `401 missing_token | invalid_session` (`server/index.cjs:297`), `403 forbidden` (`:324`), `503 db_not_configured | db_unavailable`, `500 db`.

| Método | Ruta | Rol (`requireRoles`) | Body | Respuesta OK | Errores |
|---|---|---|---|---|---|
| GET | `/api/admin/masters` | `ACCESS.MASTER_ADMIN` = superadmin, **admin** | — | `200 { ok: true, seasons, companies, species, csg, jcForemen, varieties, relations }`. Cada registro trae sus campos actuales más `createdBy`, `updatedBy`, `createdAt`, `updatedAt` (ver abajo). En `seasons`, `starts_on`/`ends_on` pasan a `'YYYY-MM-DD' \| null` | 401, 403 (operador), 500 `db` |
| POST | `/api/admin/seasons` | MASTER_ADMIN | `{ id?, code, name, startsOn?, endsOn?, isCurrent?, isActive? }` (`startsOn`/`endsOn`: `'YYYY-MM-DD'`, ISO que empiece así, vacío o null) | `200 { ok: true }` | 400 `invalid_payload` (también si una fecha no calza con `YYYY-MM-DD`, D5), 401, 403, 500 `db` |
| POST | `/api/admin/companies` · `/species` · `/csg` · `/jc-foremen` | MASTER_ADMIN | `{ id?, code, name, isActive? }` | `200 { ok: true }` | 400 `invalid_payload`, 401, 403, 500 |
| POST | `/api/admin/varieties` | MASTER_ADMIN | `{ id?, code, name, speciesId, isActive? }` | `200 { ok: true }` | 400 `invalid_payload`, 401, 403, 500 |
| POST | `/api/admin/relations` | MASTER_ADMIN | `{ id?, seasonId, companyId, centerCode, centerName, speciesId, varietyId, csgId, isActive? }` | `200 { ok: true }` | 400 `invalid_payload`, 401, 403, 500 |
| POST | `/api/master-data/import` | MASTER_ADMIN | `{ season: { code, name, isCurrent }, rows: [{ empresa, cc, especie, variedad, csg }] }` | `200 { ok: true, seasonId, received, applied }` | 400 `rows_required` / `rows_too_large`, 401, 403, 500 |
| GET/POST | `/api/admin/users`, `/api/admin/users/:id/password` | **solo superadmin**, sin cambios (`:817, :833, :860`) | — | — | 403 `forbidden` para admin y operador (CA-09) |

- Los campos `createdBy`, `updatedBy`, `created_by`, `updated_by`, `createdAt` y `updatedAt` del body **se ignoran** (CA-20). No hace falta código extra: las rutas leen solo campos con nombre explícito.
- Agregar `ok: true` al GET es aditivo. `parseOrThrow` (`src/lib/masterDataApi.ts:71-77`) lo ignora, y así se cumple la forma `{ ok, ... }` de CA-07.
- Las rutas `GET /api/master-data/catalog` y `GET /api/master-data/jc-foremen` **no** cambian ni exponen auditoría (RN-15).

Forma de los campos nuevos en cada registro (camelCase, mapeados en el servidor según la convención; los campos existentes siguen en snake_case para no romper `src/types.ts`):

```json
{
  "id": 12, "code": "CSG-N", "name": "CSG Norte", "is_active": 1,
  "createdBy": { "id": 1, "name": "Super Administrador" },
  "updatedBy": { "id": 7, "name": "María Admin" },
  "createdAt": "2026-10-02T13:05:11.120Z",
  "updatedAt": "2026-10-03T02:30:00.000Z"
}
```

`createdBy`/`updatedBy` valen `null` en los registros históricos, en los creados o cambiados por la importación y en los de autor eliminado.

### Cambios de permisos (RN-04)

| Lugar | Antes | Después |
|---|---|---|
| `server/index.cjs:28` `ACCESS.MASTER_ADMIN` | `[ROLE.SUPERADMIN]` | `[ROLE.SUPERADMIN, ROLE.ADMIN]` |
| `src/lib/roleAccess.ts:6` `ROLE_TABS.admin` | `['dashboard','generar','trazabilidad']` | `['dashboard','generar','trazabilidad','maestros']` |
| `src/App.tsx:104` | `role === 'superadmin'` | `role ? canAccessTab(role, 'maestros') : false` (una sola fuente de verdad en la UI) |
| `src/components/MastersAdminPanel.tsx:360` | "…Solo Super Admin puede mantener catálogos." | "Sin permisos para editar maestros. Solo Admin y Super Admin pueden mantener catálogos." |
| Usuarios (`server/index.cjs:817, 833, 860`; `src/App.tsx:516`; `ROLE_TABS`) | solo superadmin | **sin cambios** |

## 5. Flujo / UI

- **Menú y Resumen (CA-01, CA-02):** no requieren código adicional. `AppSidebar` y `DashboardView` filtran por `allowedTabs` (`src/components/AppSidebar.tsx:20-25, 66-71`; `src/components/DashboardView.tsx:11, 59-64`). Con `maestros` en `ROLE_TABS.admin`, el grupo "Administración" muestra solo "Maestros".
- **Maestros > Carga desde Excel (CA-06):** `MasterDataView` no tiene chequeo propio, así que basta con la pestaña y el 200 del servidor.
- **Maestros > Mantenimiento en pantalla (CA-03..05):** al cambiar `canManageMasters`, `MastersAdminPanel` carga datos (`:288-290`) y no muestra el aviso (`:356-362`). El hash `#maestros/admin` abre directamente la subpestaña (requerimiento §6).
- **Estado desactivado (D1, CA-05):** `StatusChip` muestra **"Inactivo"** (`:853`), `ActiveSelect` ofrece "Activo" / **"Inactivo"** (`:1082`) y el filtro de estado ofrece "Todos" / "Activos" / **"Inactivos"** (`:518`). Los textos de ayuda dejan de hablar de archivar:
  - `:385` → "Alta y corrección puntual. La carga masiva sigue en Excel. Marcar un registro como inactivo lo oculta en operación; no se elimina."
  - `:1528` → "Código y nombre deben ser únicos. Si ya se usó en operación, márquelo como inactivo en lugar de borrarlo."

  La clase CSS `masters-chip` y el valor `'inactive'` del filtro no cambian.
- **Usuarios forzado por URL (CA-10):** sin cambios, porque se mantiene la redirección con aviso (`src/App.tsx:143-157, 186-190`).
- **Línea de auditoría (CA-21..24):**
  - `src/lib/masterAudit.ts` (nuevo, sin UI):
    - `formatAuditDate(iso: string): string` arma `dd-mm-aaaa` con `Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(...)`, ensamblando las partes con `-` para no depender del separador del locale. Devuelve `''` si la fecha es inválida.
    - `formatLastModified({ updatedBy, updatedAt }): string` devuelve `Modificado por ${name} el ${fecha}` si `updatedBy?.name.trim()` no está vacío, o `Modificado el ${fecha} · sin autor registrado` en otro caso. Si la fecha es inválida devuelve `''`, que no se pinta. Nunca produce "null" ni "undefined".
  - `MastersAdminPanel.tsx`: un componente interno `AuditNote` renderiza `<span className="masters-audit">{texto}</span>` como segunda línea dentro de la celda **Nombre** de `CodeNameTable`, `SeasonTable` y `VarietyTable` (`:882, :933, :987`) y de la celda **Empresa** de `RelationTable` (`:1042`; la celda CC lleva `nowrap`). No agrega columnas, así que la tabla no se ensancha en móvil y el botón Editar queda donde está (CA-22).
  - `src/App.css`: `.masters-audit { display: block; margin-top: 0.15rem; font-size: 0.78rem; color: var(--muted); white-space: normal; }`.
  - La búsqueda (`matchesQuery`) no cambia: filtrar por autor está fuera de alcance.
- **Estados:** "Cargando registros…", el error de carga y el vacío no cambian (`MastersAdminPanel.tsx:282, 375-377`). Después de guardar, `runSave` recarga el bundle (`:341-348`), así que la línea "Modificado por <usuario actual> el <hoy>" aparece en cuanto se guarda.
- **Móvil (≤720px):** la tabla sigue con scroll dentro de `.masters-table-wrap` (`src/App.css:1235-1263`). La línea de auditoría es texto que se ajusta dentro de la celda.

## 6. Alternativas descartadas

- **Abrir cada ruta con `requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN)`:** dispersa la regla en 9 lugares. Basta con `ACCESS.MASTER_ADMIN`, que ya existe para esto.
- **P4 leyendo antes la fila (`SELECT … FOR UPDATE`) y comparando en Node:** suma un round-trip y una transacción en 6 rutas que hoy no la usan, y duplica en JS la semántica de igualdad de la BD (fechas, NULL, intercalación). La versión en SQL es atómica y usa la misma comparación que el motor.
- **P4 con `changedRows` de mysql2 más un segundo UPDATE de `updated_by`:** son dos sentencias, `updated_at` se mueve dos veces, depende del parseo del texto `info` del protocolo y necesita transacción.
- **Triggers `BEFORE UPDATE`:** no tienen acceso a `req.auth.userId` sin variables de sesión, quedan escondidos de `server/index.cjs` y exigen el privilegio `TRIGGER`.
- **Sin FK, solo columna e índice (como `ensureMovementsSchema` con `movements.created_by`, `:136-139`):** es más simple, pero un usuario borrado dejaría ids colgantes. Se elige la FK `ON DELETE SET NULL`, igual que `labels`/`movements`/`batch_logs` en `schema.sql`. Como fallback, si el `ADD CONSTRAINT` falla en producción, se avisa y se sigue, y `mapAuditRow` tolera ids sin usuario.
- **`ALTER TABLE … ADD COLUMN IF NOT EXISTS` en `schema.sql`:** no es sintaxis de MySQL 8, que puede ser el motor local (`scripts/test-env.mjs:53`).
- **Fijar `timezone` en el pool de mysql2:** afectaría a todas las fechas existentes (labels, movements, Excel de trackeo). `UNIX_TIMESTAMP` resuelve solo lo nuevo.
- **Columna nueva "Última modificación":** ensancha las 4 tablas y en móvil aleja el botón Editar, que ahí no es sticky (`src/App.css:1257-1263`). Se prefiere una segunda línea dentro de la celda.
- **Guardar una copia del nombre del autor:** contradice RN-14 (nombre vigente).

## 7. Tareas

Fase 3 (pruebas primero): T-07..T-09 se escriben contra el contrato de §3-§4 y fallan hasta que existan T-01..T-06. Entre devs, backend y frontend no comparten archivos: dev-backend toca `server/*`, `database/schema.sql` y `SKILL.md`, y dev-frontend toca `src/*`.

| ID | Dueño | Descripción | Archivos | Depende de | CA | Paralelo |
|---|---|---|---|---|---|---|
| T-01 | dev-backend | Módulo puro de auditoría: `MASTER_AUDIT_TABLES`; `ensureMastersAuditSchema(pool)` → `boolean`, con tolerancia a errores "ya existe" y verificación final (§3.2); `buildAuditedUpdate(table, cols, { audit })` → `{ sql, params(values, userId, id) }`, con `updated_by` primero y CAST binario en el texto (§3.3b), más su variante sin auditoría (§3.5); `buildImportAuditClause(cols, { audit })` (§3.3d); `auditSelect(alias, ready)` y `auditJoins(alias, ready)` (§3.4); `mapAuditRow(row)`, que tolera filas sin columnas de autor; `normalizeSeasonDate(v)` → `{ valid, value }` (D5). Exportados con `module.exports`, sin efectos al importarse | `server/masterAudit.cjs` (nuevo) | — | CA-17..20, 24..29 | sí (con T-02, T-05, T-06) |
| T-02 | dev-backend | Columnas, índices y FK en los 7 `CREATE TABLE` (§3.1) | `database/schema.sql` | — | CA-24, CA-27 | sí |
| T-03 | dev-backend | (1) `ACCESS.MASTER_ADMIN` += admin (`:28`). (2) En `main()`, `mastersAuditReady = await ensureMastersAuditSchema(pool)` después de `ensureMovementsSchema` (`:689`) y `app.locals.mastersAuditReady` (`:704`). (3) Altas auditadas en las 7 rutas. (4) Ediciones con `buildAuditedUpdate`. (5) P3 en temporadas (`:1088`) y en la importación (`:544`), con `AND is_current = 1`. (6) P2 en `upsertByCodeAndName`, `resolveVariety`, `resolveSeason` y el ODKU de scc. (7) `normalizeSeasonDate` en `POST /api/admin/seasons`, con 400 `invalid_payload` si es inválida. (8) `normalizeLimitedText` con el largo de cada columna en las 7 rutas (§3.3). (9) `fetchMastersBundle(pool, ready)` con auditoría + `DATE_FORMAT` en las fechas de temporada + `mapAuditRow`. (10) `GET /api/admin/masters` responde `{ ok: true, ...data }`. (11) Puntos (3), (4), (5), (6) y (9) pasan `{ audit: req.app.locals.mastersAuditReady }` a los constructores (§3.5) | `server/index.cjs` | T-01 | CA-06..09, 12..14, 16..20, 25, 26, 28, 29 | no (después de T-01) |
| T-04 | dev-backend | Actualizar la tabla de roles: admin = Resumen, Crear etiquetas, Registrar lecturas, **Maestros (incluida la importación Excel)**, Excel de trackeo. superadmin = todo, incluido Usuarios. Agregar una línea sobre la auditoría de maestros (`created_by`/`updated_by`) | `.claude/skills/contexto-appetiquetado/SKILL.md` | T-03 | — (doc) | sí |
| T-05 | dev-frontend | Permisos de la UI: `ROLE_TABS.admin` += `'maestros'`. `canManageMasters = role ? canAccessTab(role,'maestros') : false`. Nuevo texto del aviso (`:360`). **D1:** "Archivado" → "Inactivo" (`:853, :1082`), "Archivados" → "Inactivos" (`:518`) y los textos de ayuda `:385, :1528` (§5) | `src/lib/roleAccess.ts`, `src/App.tsx`, `src/components/MastersAdminPanel.tsx` | — | CA-01..05, 10, 11, 14..16 | sí (con T-01..T-03) |
| T-06 | dev-frontend | Auditoría en la UI: tipos `MasterAuditUser` y `MasterAudit` en `src/types.ts`, sumados a los 7 `Master*`. `src/lib/masterAudit.ts` (`formatAuditDate`, `formatLastModified`). `AuditNote` en las 4 tablas (§5). Estilo `.masters-audit` | `src/types.ts`, `src/lib/masterAudit.ts` (nuevo), `src/components/MastersAdminPanel.tsx`, `src/App.css` | T-05 (mismo archivo `MastersAdminPanel.tsx`, mismo dueño; solo contra el contrato de §4, no contra el código de T-03) | CA-21..24 | sí con backend |
| T-07 | qa-unitario | (a) **Invertir** `tests/unit/roleAccess.test.ts:10-16`: admin accede a maestros y no a usuarios (CA-15). (b) `tests/unit/masterAudit.test.ts`: formato y zona horaria. (c) `tests/unit/masterAuditServer.test.ts`: SQL generado (con y sin auditoría), `normalizeSeasonDate`, idempotencia de `ensureMastersAuditSchema`, el flag y la tolerancia a errores con un pool falso (precedente `require` de `.cjs` en `tests/unit/rateLimit.test.ts:5-6`). Casos listados al final de §8 | `tests/unit/roleAccess.test.ts`, `tests/unit/masterAudit.test.ts` (nuevo), `tests/unit/masterAuditServer.test.ts` (nuevo) | contrato §3-§4 (se escriben antes; T-01/T-05/T-06 los ponen en verde) | CA-15, 17, 21, 24, 27, 28 | sí |
| T-08 | qa-e2e | (a) **Invertir** `tests/e2e/permisos-ui.spec.ts:36-54` y `tests/e2e/permisos-api.spec.ts:28-36` y ampliar el test del operador (`:12-26`) a las 9 + 3 rutas. (b) Nuevo `tests/e2e/maestros-admin.spec.ts` (UI de permisos y CRUD del admin). (c) Nuevo `tests/e2e/maestros-auditoria-api.spec.ts` (reglas del servidor, consultas directas a la BD como en `tests/e2e/auditoria.spec.ts:29-36`). (d) Nuevo `tests/e2e/maestros-auditoria-ui.spec.ts`. (e) En `tests/e2e/helpers/api.ts`: `loginUsuario(request, role)` → `{ token, user }` y `crearUsuario` con `fullName` opcional para fijar nombres únicos | `tests/e2e/*` (listados) | contrato §3-§5 | CA-01..14, 16..26, 28, 29 | sí |
| T-09 | qa-e2e | Prueba de migración (CA-27): `scripts/e2e-migracion-maestros.mjs`, que usa `loadTestEnv` y su guardián. (1) Simula el esquema anterior en la BD de pruebas reseteada: `DROP FOREIGN KEY` + `DROP COLUMN` de `created_by`/`updated_by` en las 7 tablas. (2) Guarda `id, created_at, updated_at` de cada fila. (3) Arranca `server/index.cjs` dos veces seguidas con `env: { ...process.env, ...loadTestEnv() }`, igual que `scripts/e2e-api.mjs:12-14`. En cada arranque: espera `/api/health`, verifica en el stdout la línea `Auditoría de maestros lista`, mata el proceso, espera su evento `exit` y después espera a que el puerto `PORT` (3101) se libere, sondeando con `net.connect` hasta recibir `ECONNREFUSED`, con un tope de 10 s. Recién entonces lanza el siguiente arranque. (4) Comprueba con `information_schema` 1 columna de cada tipo, índices y FK por tabla, datos idénticos y autores NULL. (5) Aplica `schema.sql` dos veces más sin error. Se invoca desde `scripts/e2e-api.mjs` antes de levantar la API del E2E y vuelve a resetear la BD al terminar | `scripts/e2e-migracion-maestros.mjs` (nuevo), `scripts/e2e-api.mjs` | T-01..T-03 para quedar en verde | CA-27 | sí |

**Contrato de pruebas (qa-unitario, fase 3).** Nombres y firmas que el diseño no fijaba y que las pruebas de `tests/unit/masterAuditServer.test.ts` exigen a `server/masterAudit.cjs` (si dev-backend prefiere otros, se ajustan las pruebas, no el diseño en silencio):
- `cols` de `buildAuditedUpdate`/`buildAuditedInsert`: arreglo de `{ name, text? }` (`text: true` -> `CAST(.. AS BINARY)` en la comparación). Comparadas y asignadas salen de esta misma lista y en el mismo orden.
- `buildAuditedInsert(table, cols, { audit })` -> `{ sql, params(values, userId) }`. Con auditoría: `INSERT INTO <t> (<cols>, created_by, updated_by) VALUES (?, ..., ?, ?)` y `params = [...values, userId, userId]`. Sin auditoría: sin esas columnas y `params = values`. `buildAuditedUpdate` sin auditoría: `UPDATE <t> SET c = ?, ... WHERE id = ?` y `params(values, userId, id) = [...values, id]`.
- `buildImportAuditClause(cols, { audit })` -> **string** con solo la asignación `updated_by = IF(<cmp> AND <cmp>, updated_by, NULL)` (sin coma final; la ruta la antepone al ODKU), o `''` si `audit` es false. `cols` = `[{ col, expr, text? }]`. Sin placeholders.
- `buildUnsetCurrentSeason({ audit, actor: 'user' | 'import' })` -> `{ sql, params(code, userId?) }`. `user`+audit: `UPDATE seasons SET updated_by = ?, is_current = 0 WHERE code <> ? AND is_current = 1`, params `[userId, code]`. `import`+audit: `SET updated_by = NULL, is_current = 0 ...`, params `[code]`. Sin audit: `SET is_current = 0 WHERE code <> ? AND is_current = 1`, params `[code]`.
- `auditSelect(alias, ready)` y `auditJoins(alias, ready)` devuelven strings (con `ready = false`, `auditJoins` devuelve `''` y `auditSelect` solo `created_at_ms`/`updated_at_ms`). Alias de los JOIN: `cu` (creador) y `uu` (editor).
- `ensureMastersAuditSchema(pool)` usa `pool.query(sql, params)` y lee `[rows]` con `COLUMN_NAME`, `INDEX_NAME` y `CONSTRAINT_NAME`; los `ALTER` son `ALTER TABLE <t> ADD COLUMN|ADD KEY|ADD CONSTRAINT <nombre> ...`. Un error "ya existe" se tolera aunque la verificación final vea el objeto creado por otro.
- `mapAuditRow(row)` acepta `created_by`/`updated_by` numéricos o texto y `*_at_ms` numérico o texto.

Orden sugerido para el Lead: {T-07, T-08, T-09} en fase 3 → {T-01, T-02, T-05} en paralelo → T-03 (backend) ∥ T-06 (frontend) → T-04.

## 8. Plan de pruebas

Convenciones: las specs de `tests/e2e/` corren en los proyectos `desktop` y `movil` (`playwright.config.ts`). Las de API (`request`) también, y usan `sufijo()` para no chocar. El "E2E API" se hace con specs de Playwright `request`, igual que el `permisos-api.spec.ts` existente: necesitan crear usuarios por rol y leer la BD de pruebas, cosas que `scripts/e2e-carga-trackeo.mjs` no hace. La migración (CA-27) va en el runner `scripts/e2e-api.mjs`. Ninguna prueba marca una temporada como actual sin restaurar la anterior en `finally`, porque `maestros-excel.spec.ts:31` evita alterar la temporada vigente.

| CA | Nivel | Archivo | Caso |
|---|---|---|---|
| CA-01 | E2E UI (desktop + móvil) | `tests/e2e/permisos-ui.spec.ts` (test invertido, `:36-54`) | Admin ve Resumen, Crear etiquetas, Registrar lecturas y **Maestros**; "Usuarios" con `toHaveCount(0)`; sigue exportando el Excel |
| CA-02 | E2E UI | `tests/e2e/maestros-admin.spec.ts` | En Resumen, la sección "Administración" contiene "Maestros" y no "Usuarios" |
| CA-03 | E2E UI | `tests/e2e/maestros-admin.spec.ts` | Admin abre `/#maestros/admin`: no aparece "Sin permisos para editar maestros" y se listan registros de los 7 catálogos (p. ej. `CSG001`, `Juan Pérez` de la semilla) |
| CA-04 | E2E UI + API | `tests/e2e/maestros-admin.spec.ts` | Admin crea un CSG con sufijo, ve el mensaje de éxito y la fila; `GET /api/admin/masters` con su token lo trae con `is_active = 1` |
| CA-05 | E2E UI + API | `tests/e2e/maestros-admin.spec.ts` | Admin edita el nombre de un JC y lo pasa a inactivo; la fila muestra el nombre nuevo con el chip **"Inactivo"** (D1); el filtro "Inactivos" lo muestra y "Activos" no; `GET /api/master-data/jc-foremen` ya no lo devuelve |
| CA-06 | E2E UI + BD | `tests/e2e/maestros-admin.spec.ts` | Admin importa un .xlsx (mismo armado que `maestros-excel.spec.ts:16-22`, `isCurrent = 0`); el CC aparece en `/api/master-data/catalog`; la consulta a `master_import_runs` da `imported_by = id del admin` |
| CA-07 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | Con token de admin, las 9 rutas responden 200 `{ ok: true }`: altas sin id, ediciones con id y al menos una con `isActive = 0`; el GET devuelve los 7 arreglos |
| CA-08 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | Admin: `POST /api/admin/companies {}` → 400 `invalid_payload`; `POST /api/master-data/import { rows: [] }` → 400 `rows_required` |
| CA-09 | E2E API | `tests/e2e/permisos-api.spec.ts` (test invertido, `:28-36`) | Admin: `GET/POST /api/admin/users` y `POST /api/admin/users/:id/password` → 403 `forbidden`; el username intentado no aparece en el listado del superadmin y el operador objetivo sigue entrando con su clave original |
| CA-10 | E2E UI | `tests/e2e/maestros-admin.spec.ts` | Admin abre `/#usuarios` y ve Resumen con el aviso `No tiene permisos para acceder al módulo "Usuarios".`, sin la vista Usuarios |
| CA-11 | E2E UI | `tests/e2e/permisos-ui.spec.ts:7-34` (se mantienen) | Operador sin Resumen, Maestros ni Usuarios; `#maestros/excel` redirige con aviso |
| CA-12 | E2E API | `tests/e2e/permisos-api.spec.ts` (test del operador ampliado, `:12-26`) | Operador: 403 `forbidden` en las 9 rutas de CA-07 y en las 3 de Usuarios |
| CA-13 | E2E API | `tests/e2e/permisos-api.spec.ts` | Sin token: `GET /api/admin/masters`, `POST /api/admin/csg` y `POST /api/master-data/import` → 401 |
| CA-14 | E2E UI + API | `tests/e2e/permisos-ui.spec.ts` (test superadmin existente) + `permisos-api.spec.ts:38-44` ampliado | Superadmin ve los 5 módulos; las rutas de CA-07 y CA-09 le responden 200 |
| CA-15 | Unit | `tests/unit/roleAccess.test.ts` (test invertido, `:10-16`) | `canAccessTab('admin','maestros') === true`, `('admin','usuarios') === false`, operador sin ambos, `getAllowedTabs('operador')` = `['generar','trazabilidad']`, `getAllowedTabs('admin')` contiene `'maestros'` y no `'usuarios'` |
| CA-16 | E2E UI + API | `tests/e2e/maestros-admin.spec.ts` | Se obtiene el token del admin **antes** de navegar; con `loginAs` se siembra `localStorage` con la sesión, se recarga y aparece "Maestros"; el mismo token responde 200 en `GET /api/admin/masters`. (No se simula el despliegue: el servidor resuelve el rol en cada request, `server/index.cjs:269-276`, y la UI lo toma del bundle) |
| CA-17 | E2E API + unit | `tests/e2e/maestros-auditoria-api.spec.ts`; `tests/unit/masterAuditServer.test.ts` | Admin A crea un registro en cada uno de los 7 maestros: `createdBy.id = updatedBy.id = A`, `createdAt === updatedAt`, a ±60 s de `Date.now()`. Unit: el INSERT generado incluye `created_by` y `updated_by` |
| CA-18 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | En cada una de las 7 tablas: el superadmin S crea; tras esperar ≥ 20 ms, A edita el nombre (o el CC en relaciones). Queda `updatedBy.id = A`, `updatedAt >= T1 − 1 s` y `createdBy`/`createdAt` intactos |
| CA-19 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | JC creado por S; A envía solo `isActive = 0` → `updatedBy = A` y `updatedAt` cambió; S lo reactiva → `updatedBy = S`; `createdBy = S` siempre |
| CA-20 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | A envía a `POST /api/admin/companies` el body con `createdBy`, `updatedBy`, `created_by` y `updated_by` = id de S y `createdAt`/`updatedAt` = `2000-01-01`: 200, autores = A y fechas de hoy |
| CA-21 | E2E UI (desktop) + unit | `tests/e2e/maestros-auditoria-ui.spec.ts`; `tests/unit/masterAudit.test.ts` | Un admin con `fullName` único edita por API un registro de cada catálogo. En la UI, la fila (filtrada por código) contiene `Modificado por <N> el <dd-mm-aaaa>`. La fecha esperada se calcula en la prueba desde `updatedAt` con `Intl` en `America/Santiago`. Unit: `formatLastModified` con autor |
| CA-22 | E2E UI (móvil) | `tests/e2e/maestros-auditoria-ui.spec.ts` (proyecto `movil`) | El mismo texto es visible tras `scrollIntoViewIfNeeded`; el botón "Editar" de esa fila es visible y abre el formulario |
| CA-23 | E2E UI + API | `tests/e2e/maestros-auditoria-ui.spec.ts`; `permisos-api.spec.ts` | El superadmin ve la misma línea que el admin; el operador recibe 403 en `GET /api/admin/masters` (CA-12) y no tiene el módulo (CA-11) |
| CA-24 | E2E UI + BD + unit | `tests/e2e/maestros-auditoria-ui.spec.ts`; `tests/unit/masterAudit.test.ts` | Se inserta por SQL un CSG con `created_by/updated_by` NULL y `updated_at` histórico (p. ej. `2025-03-10 15:00:00`). La UI muestra `Modificado el <fecha> · sin autor registrado` y la fila no contiene "Modificado por", "null" ni "undefined". Unit: `updatedBy: null` y `{ name: '  ' }` → formato sin autor. La parte "la migración no rellena" se cubre en CA-27 |
| CA-25 | E2E API + BD + E2E UI | `tests/e2e/maestros-auditoria-api.spec.ts`; `tests/e2e/maestros-auditoria-ui.spec.ts` | API: admin importa una empresa, un CC, una especie, una variedad y un CSG nuevos (sufijo único, `isCurrent = 0`); los registros quedan con `createdBy = updatedBy = null` en el GET; `master_import_runs` trae una corrida nueva con `imported_by = A`. **UI (MEN-7):** después de importar por API un CSG nuevo, el admin abre el catálogo CSG, busca su código y la fila contiene `Modificado el <dd-mm-aaaa> · sin autor registrado` (la fecha se calcula desde el `updatedAt` del GET en `America/Santiago`) y no contiene "Modificado por" |
| CA-26 | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | CSG con `code = name = CSGIMP_<sufijo>` (mayúsculas, sin espacios, para que coincida con `toCode`, `server/index.cjs:60-65`). (a) **IMP-1:** S lo crea en un estado **distinto** del que deja la importación (`isActive = 0`). A lo cambia exactamente a ese resultado (`isActive = 1`, mismo code y name) → `updatedBy = A`. Se importa un Excel con ese CSG (la importación asigna `name = CSGIMP_<sufijo>` e `is_active = 1`, ya iguales) → no cambia nada: `updatedBy = A` y `updatedAt` idéntico. (b) A lo desactiva (`isActive = 0`) → se importa el mismo Excel → se reactiva → `updatedBy = null`, `updatedAt` mayor y `createdBy = S` intacto |
| CA-27 | E2E API (runner) + unit | `scripts/e2e-migracion-maestros.mjs` (llamado por `scripts/e2e-api.mjs`); `tests/unit/masterAuditServer.test.ts` | Ver T-09: dos arranques sobre el esquema anterior con datos; 1 columna de cada tipo, índices y FK; `created_at/updated_at` idénticos; autores NULL; `schema.sql` dos veces sin error; `db:test:reset` deja el esquema nuevo (lo prueba todo el resto de la suite). Unit (MEN-4), con pool falso: (1) las 7 tablas con columnas base y **sin** `created_by`/`updated_by` → por tabla 2 `ADD COLUMN` + 2 `ADD KEY` + 2 `ADD CONSTRAINT`, **42 `ALTER` en total**, y devuelve `true`; (2) todo existente → **0 `ALTER`** y `true`; (3) `information_schema.COLUMNS` devuelve **0 filas** para todas las tablas → **0 `ALTER`** y `false` |
| CA-28 | E2E API + unit | `tests/e2e/maestros-auditoria-api.spec.ts`; `tests/unit/masterAuditServer.test.ts` | S crea un CSG, una temporada (con fechas, `isCurrent = 0`) y una relación. A reenvía cada uno **idéntico**, la temporada con `startsOn`/`endsOn` tal como los devuelve el GET (`YYYY-MM-DD`): `updatedBy = S` y `updatedAt` igual. Al cambiar solo mayúsculas del nombre del CSG: `updatedBy = A`. Unit: ver la lista al final de §8 |
| CA-29 (P3) | E2E API | `tests/e2e/maestros-auditoria-api.spec.ts` | Antes de nada, se lee del GET la temporada actual Y y se guarda su fila completa. A crea X (no actual) y la guarda como actual → Y queda con `is_current = 0`, `updatedBy = A`, `updatedAt` mayor y `createdBy` intacto; las otras temporadas no actuales conservan `updatedBy`/`updatedAt`. Se guarda de nuevo X como actual → ninguna temporada cambia (CA-28). **`finally` (MEN-8):** S reenvía el payload completo de Y leído al inicio (`id, code, name, startsOn, endsOn` en `YYYY-MM-DD`, `isCurrent: true`, `isActive`), para que la restauración no cambie sus fechas ni su nombre. La rama "importación → NULL" se cubre en unit (SQL del efecto lateral de la importación) para no cambiar la temporada vigente con una importación en E2E |
| Regresión | E2E | `usuarios-reset.spec.ts:41-64`, `maestros-excel.spec.ts:6`, `permisos-ui.spec.ts:7-34` | Siguen verdes sin cambios. Ninguna prueba existente busca "Archivado"/"Archivados" (`grep -rn "Archivad" tests` sin resultados), así que D1 no rompe pruebas |

Casos unitarios de `tests/unit/masterAudit.test.ts` (zona horaria, RN-14):
- `formatAuditDate('2026-10-03T02:30:00.000Z') === '02-10-2026'`: en octubre Chile está en UTC−3, así que son las 23:30 del día anterior.
- `formatAuditDate('2026-07-15T03:30:00.000Z') === '14-07-2026'`: en invierno Chile está en UTC−4.
- `formatAuditDate('basura') === ''`.
- `formatLastModified({ updatedBy: { id: 1, name: 'Ana' }, updatedAt })` → `'Modificado por Ana el 02-10-2026'`.
- `updatedBy: null` → `'Modificado el 02-10-2026 · sin autor registrado'`.

Casos unitarios de `tests/unit/masterAuditServer.test.ts` (servidor, `require('../../server/masterAudit.cjs')`):
- **CA-28, edición auditada:** `buildAuditedUpdate('csg_catalog', cols, { audit: true })`:
  - el SQL empieza con `UPDATE csg_catalog SET updated_by = IF(`, es decir, `updated_by` es la **primera** asignación;
  - `code` y `name` se comparan con `CAST(… AS BINARY) <=> CAST(? AS BINARY)` e `is_active` con `<=>`;
  - `params(['A','B',1], 7, 12)` devuelve `['A','B',1,7,'A','B',1,12]`;
  - la lista de columnas comparadas es igual a la lista de columnas asignadas.
- **CA-17, alta:** el INSERT auditado incluye `created_by` y `updated_by` con dos placeholders.
- **D4, sin auditoría:** con `{ audit: false }`, el UPDATE y el INSERT **no** contienen `updated_by` ni `created_by`. `buildImportAuditClause(cols, { audit: false })` devuelve el ODKU sin `updated_by`. `auditSelect('t', false)` y `auditJoins('t', false)` no referencian `created_by`, `updated_by` ni `users`.
- **D4, mapeo:** `mapAuditRow` sobre una fila sin columnas de autor (modo degradado) devuelve `createdBy = updatedBy = null` y fechas ISO válidas. Con id presente y nombre `null` (usuario borrado sin FK) devuelve `null`.
- **D4, flag:** pool falso en el que `ALTER TABLE … ADD COLUMN` lanza `ER_TABLEACCESS_DENIED_ERROR` → `ensureMastersAuditSchema` **no lanza** y devuelve `false`. Pool falso en el que solo `ADD CONSTRAINT` falla con un error de permisos → devuelve `true`, porque la FK no es requisito del flag.
- **MEN-6, tolerancia:** pool falso en el que `ADD COLUMN` lanza `ER_DUP_FIELDNAME`, `ADD KEY` lanza `ER_DUP_KEYNAME` y `ADD CONSTRAINT` lanza `ER_FK_DUP_NAME`, y otro en el que `ADD CONSTRAINT` lanza `ER_DUP_KEY` o un mensaje con `errno: 121`. En todos: no lanza, sigue con las demás tablas y devuelve `true` si la verificación final encuentra las columnas.
- **P2/CA-29, importación:** `buildImportAuditClause` pone `updated_by = IF(…, updated_by, NULL)` como primera asignación. El SQL del efecto lateral de la importación sobre la temporada actual es `SET updated_by = NULL, is_current = 0 … AND is_current = 1`.
- **D5, fechas:** `normalizeSeasonDate`:
  - `'2025-11-01'` → `{ valid: true, value: '2025-11-01' }`;
  - `'2025-11-01T03:00:00.000Z'` → `'2025-11-01'`;
  - `''`, `'  '`, `null` y `undefined` → `{ valid: true, value: null }`;
  - `'01-11-2025'`, `'mañana'` y `'2025/11/01'` → `{ valid: false }`.

  Y en E2E API (`maestros-auditoria-api.spec.ts`): `POST /api/admin/seasons` con `startsOn: '01-11-2025'` → `400 invalid_payload`.

## 9. Riesgos y rollback

### Riesgos
1. **Privilegios `ALTER`/`REFERENCES` del usuario MySQL `trn_felipe`.**
   - Sin `REFERENCES`: el `ADD CONSTRAINT` falla, la migración avisa y sigue. Columnas e índices quedan creados, el flag queda en `true` y `mapAuditRow` tolera ids colgantes.
   - Sin `ALTER`: no se crean las columnas. **Sin el flag** fallarían con `500 db` **el GET `/api/admin/masters`** (su SELECT referencia `created_by`/`updated_by`), **las 7 escrituras manuales y la importación Excel**: todo Maestros, no solo las escrituras como decía la iteración 1. **Con el flag** (D4, §3.5), `mastersAuditReady = false` y Maestros funciona igual que hoy, sin autor: la UI muestra "sin autor registrado" en todas las filas y el log de arranque deja el aviso.
   - El riesgo que queda es funcional, no de disponibilidad: no se registra auditoría hasta corregir los privilegios y reiniciar.
   - Mitigación: `SHOW GRANTS` en producción antes de aprobar y verificación del log en staging (plan de producción, pasos 1 y 2). Staging y producción comparten `trn_felipe`, pero los privilegios pueden estar dados por base de datos, así que se revisan explícitamente sobre la BD de producción.
2. **Orden de evaluación del `SET`.** Si alguien reordena las asignaciones y pone `updated_by` al final, P4 deja de funcionar sin que nada falle a la vista. Mitigación: comentario en `buildAuditedUpdate`, prueba unitaria del orden (CA-28) y E2E de CA-28/CA-26.
3. **Nuevas columnas editables en el futuro.** Una columna que se asigne en el UPDATE pero no entre en la comparación volvería a producir atribuciones falsas. Mitigación: `buildAuditedUpdate` recibe una sola lista de columnas que usa tanto para comparar como para asignar, así que no pueden divergir.
4. **Cambio visible en el GET de temporadas:** `starts_on`/`ends_on` pasan de ISO con hora a `YYYY-MM-DD`. El único consumidor es `MastersAdminPanel` (`:198, :558-559, :935`), y mejora: el `<input type="date">` vuelve a mostrar la fecha.
5. **Zona horaria de la BD.** Depende de que todas las conexiones usen la misma zona de sesión (el pool no la fija). `UNIX_TIMESTAMP` lo resuelve mientras nadie cambie `time_zone` global de la BD entre la escritura y la lectura.
6. **Ventana de despliegue en Render:** la instancia vieja puede atender requests mientras arranca la nueva. Su código no escribe `updated_by`: un INSERT deja NULL (correcto) y una edición mueve `updated_at` pero conserva el `updated_by` anterior, que en la práctica sigue siendo NULL porque nadie tiene autor antes del despliegue. El impacto es nulo.
7. **Pruebas que tocan la temporada actual (P3):** si el `finally` falla, otros tests podrían ver otra temporada vigente. Mitigación: `workers: 1` y restauración explícita, y la BD se resetea en cada corrida (`playwright.config.ts`, `webServer`).
8. **Deadlock conocido de `POST /api/movements`:** puede dejar el CI en rojo por algo ajeno a este cambio. No se corrige aquí (fuera de alcance).

### Plan de migración en producción
1. **Antes de aprobar `main` (lo ejecuta el usuario; Claude no tiene acceso a producción):**
   - **Privilegios:** conectado como el usuario de la app a la BD de producción, ejecutar `SHOW GRANTS FOR CURRENT_USER();`. El resultado debe incluir `ALTER`, `INDEX` y `REFERENCES` (o `ALL PRIVILEGES`) sobre la BD de producción (`` `<bd_prod>`.* ``) o sobre `*.*`. Si falta `ALTER`, **no se aprueba** hasta otorgarlo, salvo que el usuario acepte publicar en modo degradado (permisos sí, auditoría no). Si solo falta `REFERENCES`, se puede publicar: la auditoría funciona sin FK.
   - **Respaldo** lógico de las 7 tablas y de `users`: `mysqldump --single-transaction <bd_prod> seasons companies species varieties csg_catalog jc_foremen season_cost_centers users`.
2. **Staging (`developer` → `appetiqueta-dev`, BD `trn_etiquetatest`):** el arranque aplica la migración. Hay que verificar:
   - **el log de arranque de Render contiene `[sync-api] Auditoría de maestros lista (7 tablas).`** y **no** contiene `ensureMastersAuditSchema` ni `auditoría de maestros NO disponible`. Si aparece el aviso, se detiene la promoción a producción;
   - `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('created_by','updated_by') AND TABLE_NAME IN (…7…)` → 14 filas;
   - `REFERENTIAL_CONSTRAINTS` → 14 FK;
   - `E2E_REMOTE_URL=<staging> npm run test:smoke:remote`;
   - una prueba manual con un usuario admin real: crear y editar un CSG de prueba y ver "Modificado por…".
3. **Producción (con aprobación explícita del usuario):** merge a `main` → CI → Render despliega y la migración corre al arrancar. Cada `ALTER` dura milisegundos con estos volúmenes. Si una consulta larga retiene el metadata lock de una tabla de maestros, el `ALTER` espera; en la práctica son consultas cortas. Después se repiten las verificaciones del paso 2 con el smoke remoto de solo lectura, empezando por la línea `Auditoría de maestros lista` en el log de producción.
4. **Sin backfill ni pasos manuales de datos.**

### Rollback
- **Código (preferido):** revertir el merge en `main` (y en `developer`) y redesplegar. El código anterior es **compatible** con el esquema nuevo: las columnas son `NULL` sin default obligatorio, los INSERT viejos no las listan y las FK `ON DELETE SET NULL` no restringen nada. **No hace falta tocar la BD.** El admin pierde Maestros en la UI y la API (vuelve el 403).
- **Efecto residual del rollback:** mientras corre el código anterior, una edición mueve `updated_at` y conserva el `updated_by` previo. Si después se vuelve a desplegar este cambio, esas filas podrían atribuirse a quien las editó antes. Corrección opcional al redesplegar: `UPDATE <tabla> SET updated_by = NULL WHERE updated_at > '<instante del rollback>' AND updated_at < '<instante del redespliegue>'`, que deja esas filas como "sin autor registrado".
- **Esquema (solo si se exige volver al esquema anterior; manual, no automatizado):** por tabla, `ALTER TABLE <t> DROP FOREIGN KEY fk_<p>_created_by, DROP FOREIGN KEY fk_<p>_updated_by;` y después `ALTER TABLE <t> DROP COLUMN created_by, DROP COLUMN updated_by;` (los índices caen con la columna). Hay que hacerlo **después** de revertir el código, porque si no el siguiente arranque las vuelve a crear. Se pierde la auditoría acumulada. No se recomienda.

## 10. Cambios de la iteración 2 (revisión de revisor-codigo + decisiones)

| Hallazgo / decisión | Cómo quedó resuelto | Dónde |
|---|---|---|
| D1 (usuario): "Archivado" → "Inactivo" | Chip, opción del select y filtro ("Inactivos"), y textos de ayuda `:385, :1528`, dentro de T-05. Ninguna prueba existente busca "Archivado". Se quitó la referencia "ver PREGUNTA 1" | §1.5, §2, §5, T-05, CA-05 en §8 |
| D2 (Lead): P3 → CA-29 | Gherkin CA-29 en `requerimiento.md`; la fila "P3 / RN-10" pasa a "CA-29 (P3)" | requerimiento §4, §3.3c, §8 |
| D3 (Lead): alcance de CA-27 | Texto de CA-27 precisado: la migración del arranque es idempotente y `schema.sql` dos veces no da error. Sin `ADD COLUMN IF NOT EXISTS` en `schema.sql` | requerimiento CA-27, §3.1, §3.2 |
| D4a (Lead): degradación elegante | `ensureMastersAuditSchema` → `mastersAuditReady` en `app.locals`; con `false`, GET, escrituras, P3 e importación usan el SQL sin auditoría y el GET devuelve autores `null`. Pruebas unitarias del flag y de los constructores sin auditoría | §1.2, §3.2, §3.5, T-01, T-03, §8 |
| D4b (Lead): texto del riesgo y verificación | Riesgo 1 corregido: sin flag también fallarían el GET y la importación. `SHOW GRANTS FOR CURRENT_USER()` sobre la BD de producción antes de aprobar `main`, y verificación de la línea `Auditoría de maestros lista` en el log de staging y de producción | §9 riesgo 1, plan de producción pasos 1-3 |
| D5 (Lead): fecha inválida | `normalizeSeasonDate` → `{ valid: false }` ⇒ `400 invalid_payload`. Casos unitarios y un E2E API | §3.3b, §4, §8 |
| IMP-1: CA-26 (a) contradecía P4 | Rehecho: S crea el CSG inactivo, A lo deja exactamente como lo dejará la importación (`updatedBy = A`), y la importación idéntica no cambia nada | §8 CA-26 |
| MEN-4: prueba unitaria de CA-27 | "Columnas base sin `created_by`/`updated_by` → 2 + 2 + 2 por tabla = 42 ALTER", "todo existente → 0" y "0 filas → 0 ALTER (flag `false`)" | §8 CA-27 |
| MEN-6: errores "ya existe" | Se toleran `ER_DUP_FIELDNAME`, `ER_DUP_KEYNAME`, `ER_FK_DUP_NAME`, `ER_DUP_KEY` y errno 121 (MariaDB), como `server/index.cjs:165`. Prueba unitaria | §3.2, §8 |
| MEN-7: UI de CA-25 | Aserción explícita en `maestros-auditoria-ui.spec.ts`: CSG importado → "Modificado el … · sin autor registrado" | §8 CA-25 |
| MEN-8: `finally` de CA-29 | Lee Y del GET antes de empezar y reenvía el payload completo (name, startsOn y endsOn en `YYYY-MM-DD`, isCurrent, isActive) | §8 CA-29 |
| MEN-9: arranques de T-09 | `env: { ...process.env, ...loadTestEnv() }`, como `scripts/e2e-api.mjs:12-14`; espera el `exit` y que el puerto 3101 se libere entre arranques | T-09 |
| Riesgo opcional: largo de code/name | Incluido: `normalizeLimitedText` con el largo de cada columna en las 7 rutas manuales. Mantiene P4 porque compara y asigna el mismo valor recortado | §3.3, T-03 |
