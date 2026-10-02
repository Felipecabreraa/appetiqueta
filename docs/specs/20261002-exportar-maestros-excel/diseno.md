# Diseño — Exportar Maestros a Excel en el formato de la plantilla de importación

- **Spec:** 20261002-exportar-maestros-excel · **Requerimiento:** [requerimiento.md](requerimiento.md) (aprobado: P1..P11 con la opción recomendada, talla L)
- **Rama:** `feat/exportar-maestros-excel` (worktree `/Users/felipelagos/Projects/appetiquetado-export`)
- **Estado:** borrador (pendiente de la revisión de revisor-codigo y de la compuerta 2)

## 1. Resumen de la solución

1. **La exportación se arma en el cliente** con `xlsx`, la misma librería y el mismo patrón que ya usan la plantilla (`src/components/MasterDataView.tsx:47-61`) y el Excel de trackeo (`src/lib/exportTrackingsExcel.ts:153-209`). Los datos salen de `GET /api/admin/masters`, que ya existe y ya exige `ACCESS.MASTER_ADMIN` (`server/index.cjs:1121-1135`). No hay endpoint nuevo, no cambian los permisos y no se toca el esquema.
2. **Una lógica pura nueva, `src/lib/masterExcel.ts`,** reúne en un solo lugar los encabezados, el parser de importación (que se mueve desde `MasterDataView.tsx:13-34`), la plantilla y la construcción del libro exportado. Así la plantilla, la exportación y la lectura comparten las mismas constantes y se pueden probar en unitario.
3. **La importación se corrige en un módulo nuevo del servidor, `server/masterImport.cjs`,** que se puede probar en unitario porque `index.cjs` no exporta nada:
   - **P5:** reutiliza por nombre los catálogos existentes, sin tocar su código.
   - **P3:** solo escribe `center_name` si la fila trae `ccNombre`.
   - **P4:** `source` y `updated_by` cambian solo si cambian los datos de negocio.

   La ruta `POST /api/master-data/import` solo cambia su cuerpo interno: el contrato, el `catch` y el registro en `master_import_runs` quedan igual.
4. Con estos cambios, "exportar → reimportar sin cambios" deja **0 filas modificadas** en las 7 tablas, y la única fila nueva es la de `master_import_runs` (objetivo del §2 del requerimiento).

## 2. Impacto por capa

| Capa | Archivos | Cambio |
|---|---|---|
| BD | — | **Sin cambios de esquema ni backfill.** `center_name`, `source` y la auditoría ya existen (`database/schema.sql:181-197`). `database/schema.sql` no se toca. |
| API (lógica nueva) | `server/masterImport.cjs` (nuevo) | `createCatalogResolver(conn, { audit, toCode })` (P5, con caché por solicitud) y `buildRelationImportUpsert({ audit, withCenterName })` (P3 + P4). |
| API (auditoría) | `server/masterAudit.cjs` | Se exporta `buildImportChangeCondition(cols)`, que es la condición "todo igual" que hoy arma `buildImportAuditClause` (`:137-141`). `buildImportAuditClause` pasa a usarla, **sin cambio de comportamiento**. |
| API (ruta) | `server/index.cjs` | 1 `require` nuevo. Se eliminan `upsertByCodeAndName` y `resolveVariety` (`:512-558`), que pasan al resolver. En la ruta de importación se reemplaza `sccAuditClause` y el cuerpo del bucle (`:1051-1106`). **No se tocan** `resolveSeason` (`:560-591`), el `INSERT` en `master_import_runs` (`:1108-1113`), el `catch` (`:1114-1118`) ni `GET /api/admin/masters`. |
| Frontend (lógica) | `src/lib/masterExcel.ts` (nuevo) | Encabezados, parser, plantilla, exportación, nombre de archivo, motivos y aviso de límite. |
| Frontend (UI) | `src/components/MasterDataView.tsx` | Selector de temporada, botón "Exportar maestros a Excel", avisos y estados. La plantilla y el parser pasan a usar `masterExcel.ts`, y el texto de columnas se alinea con la plantilla (P11). |
| Frontend (estilos) | `src/App.css` | Clase `.master-export` (flex con wrap y columna en ≤560 px), siguiendo el patrón de `.export-excel-actions` (`:3231-3236`, `:2259-2261`). |
| Permisos | — | **Sin cambios** en `src/lib/roleAccess.ts:4-8` ni en `ACCESS` (`server/index.cjs:35-40`). |
| No se toca | `src/lib/masterDataApi.ts` | El campo opcional `ccNombre` viaja sin modificar el tipo de `importMasterRows` (`:48-50`), porque `rows` se pasa como variable y TypeScript no aplica el chequeo de propiedades sobrantes. Se deja así a propósito para no chocar con `describeApiError`, que modifica el otro equipo (ver §9). |

## 3. Modelo de datos / migración

No hay DDL. Lo que cambia es **cómo escribe** la importación sobre las tablas que ya existen:

```sql
-- No aplica: sin cambios de esquema. Todas las tablas ya tienen las columnas usadas
-- (season_cost_centers.center_name / source / updated_by, catálogos con uq por name).
```

**Estado dual:** no aplica. Maestros vive solo en MySQL (fuente de verdad), y la exportación lee el estado vigente con un GET en cada clic. No se guarda nada en `localStorage`.

### 3.1 P5: resolución de catálogos por nombre (`server/masterImport.cjs`)

**Confirmación del fallo actual (por lectura de código).** La importación de la fila `Agrícola Esmeralda` hace lo siguiente:
1. `upsertByCodeAndName` ejecuta `INSERT (code='AGRÍCOLA_ESMERALDA', name='Agrícola Esmeralda')`.
2. El INSERT choca con `uq_companies_name` (`schema.sql:95`) y el `ON DUPLICATE KEY UPDATE` actualiza la fila `ESMERALDA`.
3. Luego `SELECT id ... WHERE code='AGRÍCOLA_ESMERALDA'` (`index.cjs:531`) devuelve 0 filas, así que `companyId` queda `undefined`.
4. El `INSERT INTO season_cost_centers` (`:1080-1104`) recibe un bind `undefined`, y mysql2 lanza "Bind parameters must not contain undefined".
5. Se ejecuta el `catch` → `rollback` → **500 `db`** (`:1114-1117`).

Lo mismo ocurre con `Arándano` (`ARANDANO`, `seed.test.sql:6`) y con cualquier variedad cuyo código no sea `toCode(nombre)` (`:535-557`). QA debe dejar esta prueba en rojo en la fase 3, antes de corregir: E2E de API CA-07 sobre la semilla.

`createCatalogResolver(conn, { audit, toCode })` devuelve `{ company(name), species(name), csg(name), variety(speciesId, name) }`. Cada función hace lo siguiente:

1. **Caché por solicitud** (`Map`, con clave `tabla + nombre exacto`; en variedad, `speciesId + nombre`). Si el nombre ya se resolvió en esta importación, devuelve el id sin consultar. Es correcto porque la primera resolución ya dejó la fila con ese nombre y activa, así que repetir la operación no cambiaría nada. Además reduce de 9 a ~1 las consultas por fila cuando los catálogos se repiten (CA-19).
2. **Busca por nombre:** `SELECT id FROM <tabla> WHERE name = ? LIMIT 1`. En variedad: `SELECT id FROM varieties WHERE species_id = ? AND name = ? LIMIT 1`. La comparación usa la intercalación de la tabla (`utf8mb4_unicode_ci`, `schema.sql:100,118,141,159`), que es la misma que aplican `uq_*_name` (`:95,113,132,154`), así que nunca contradice a los índices únicos.
3. **Si lo encuentra:** actualiza por id con `buildAuditedUpdate(tabla, [{name:'name',text:true},{name:'is_active'}], { audit })`, con `userId = null` (`masterAudit.cjs:106-120`). Así se genera `UPDATE t SET updated_by = IF(<todo igual>, updated_by, NULL), name = ?, is_active = 1 WHERE id = ?`. **El `code` no se toca.** Si nada cambia, InnoDB no modifica la fila: `updated_by` y `updated_at` (`ON UPDATE`) quedan iguales, igual que la regla P2/CA-26 de admin-maestros. Un cambio solo de mayúsculas sí cuenta como cambio, por la comparación binaria de CA-28.
4. **Si no lo encuentra:** usa el mismo código de hoy (`INSERT … ON DUPLICATE KEY UPDATE` por `code = toCode(nombre)` y luego `SELECT id … WHERE code = ?`), movido sin cambios desde `index.cjs:512-558`.
5. Si el id resultante no existe, lanza `Error('catalog_unresolved')`. Esa excepción cae en el mismo `catch` → 500 `db`, pero deja un mensaje claro en el log y nunca usa `undefined` como bind.

`toCode` se **inyecta** desde `index.cjs` (`:71-76`) en lugar de duplicarse o moverse, para no tocar más líneas de `index.cjs`.

Efecto colateral favorable sobre P7: como la variedad se busca primero dentro de su especie, reimportar variedades homónimas **ya existentes** (con códigos distintos) deja de moverlas de especie. La deuda queda solo al **crear** por importación una homónima nueva cuyo `toCode` choca con otra.

### 3.2 P3 y P4: upsert de la relación (`buildRelationImportUpsert`)

`buildRelationImportUpsert({ audit, withCenterName })` devuelve `{ sql, params(v) }`:

```sql
INSERT INTO season_cost_centers
  (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source)
VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'excel')
ON DUPLICATE KEY UPDATE
  updated_by = IF(<C>, updated_by, NULL),          -- solo si audit
  source     = IF(<C>, source, 'excel'),           -- siempre (P4)
  center_name = VALUES(center_name),               -- solo si withCenterName (P3)
  species_id = VALUES(species_id),
  variety_id = VALUES(variety_id),
  csg_id     = VALUES(csg_id),
  is_active  = 1
```

- `<C>` = `buildImportChangeCondition([...])` sobre `center_name` (solo si `withCenterName`), `species_id`, `variety_id`, `csg_id` e `is_active <=> 1`. **`source` sale de la condición** (hoy está en `index.cjs:1062`): ya no es un dato de negocio, sino un efecto.
- **El orden es obligatorio:** `updated_by` y `source` van **antes** que las columnas de negocio. MariaDB y MySQL evalúan las asignaciones de izquierda a derecha, y así `<C>` compara contra la fila vigente. Es el mismo supuesto que ya documenta `masterAudit.cjs:115`. El modo `SIMULTANEOUS_ASSIGNMENT` de MariaDB está desactivado por defecto.
- **P3:** en `index.cjs`, `ccNombre = normalizeLimitedText(raw?.ccNombre, 180)` (`:67-69`, el mismo límite que la ruta manual, `:1315`). `withCenterName = ccNombre !== ''`. Se preparan los dos SQL fuera del bucle. Una relación **nueva** sin nombre se inserta con `center_name = ''` (el `DEFAULT` de la columna, `schema.sql:186`). Una existente conserva su nombre.
- **P4:** si `<C>` es verdadero (no cambió nada), la fila queda idéntica, incluidos `source='admin'` y `updated_by`. Si cambió algo, `source='excel'` y `updated_by=NULL`, como hoy. Esto mantiene CA-26 (a y b) de admin-maestros (`tests/e2e/maestros-auditoria-api.spec.ts:181-213`).

### 3.3 Temporada (sin cambios)

`resolveSeason` (`index.cjs:560-591`) ya cumple RN-06 cuando el código, el nombre y "actual" coinciden: el upsert no cambia nada, el `UPDATE … WHERE is_current = 1` filtrado (`masterAudit.cjs:143-161`) no toca filas y el `UPDATE seasons SET is_current = 1` tampoco. Que el código del formulario coincida con el exportado se resuelve con el aviso (P1/P10, §5).

## 4. Contrato de API

No hay rutas nuevas.

| Método | Ruta | Rol | Body | Respuesta OK | Errores |
|---|---|---|---|---|---|
| GET | `/api/admin/masters` | admin, superadmin (`ACCESS.MASTER_ADMIN`) | — | **Sin cambios:** `{ ok: true, seasons, companies, species, csg, jcForemen, varieties, relations }`, con activos e inactivos (`index.cjs:606-678`). La exportación usa `relations[].{season_id, company_id, species_id, variety_id, csg_id, company_name, species_name, variety_name, csg_name, center_code, center_name, is_active}` y el `is_active` de cada catálogo. | Sin cambios: 401 `missing_token`/`invalid_session` (`:308`), 403 `forbidden` (`:335`), 500 `db`, 503 `db_not_configured`. |
| POST | `/api/master-data/import` | admin, superadmin (sin cambios) | `{ season: { code, name, isCurrent }, rows: [{ empresa, cc, especie, variedad, csg, ccNombre? }] }`. **Nuevo campo opcional:** `ccNombre` (string). Si viene no vacío, se aplica a `center_name`. Si falta o viene vacío, se conserva el valor vigente. Los clientes viejos (sin `ccNombre`) quedan compatibles y ya no borran nombres. | **Sin cambios:** `{ ok: true, seasonId, received, applied }`. **Semántica nueva:** P3, P4 y P5 (§3). | Sin cambios: 400 `rows_required`, 400 `rows_too_large` (>10000), 500 `db`, 503. |

El endpoint no es público, y ninguna ruta pública cambia.

## 5. Flujo / UI

### 5.1 Libro exportado (`buildMastersExport(bundle, seasonId, now)`)

| Hoja | Contenido |
|---|---|
| 1. `Maestros` (hoja principal) | Fila 1: `EMPRESA, ESPECIE, VARIEDAD, CC, CSG, NOMBRE CC`. Una fila por relación **totalmente activa** de la temporada (relación, empresa, especie, variedad y CSG con `is_active = 1`), en el orden de la API (`index.cjs:654`: empresa y luego CC), que es estable. EMPRESA, ESPECIE, VARIEDAD y CSG llevan el **nombre**. CC lleva `center_code` (RN-02). |
| 2. `No importables` | Mismos 6 encabezados más `MOTIVO`. Una fila por relación de la temporada que no es totalmente activa. MOTIVO combina, en este orden y separados por ", ", `Relación inactiva`, `Empresa inactiva`, `Especie inactiva`, `Variedad inactiva` y `CSG inactivo` (CA-06). Si no hay filas, la hoja lleva solo los encabezados (estructura estable). |
| 3. `Temporada` | `CÓDIGO, NOMBRE, ACTUAL, ACTIVA` (`Sí`/`No`), una línea en blanco y la nota "Para reimportar, use el mismo código y nombre de temporada." |

- **Celdas de texto (CA-04, CA-05, RN-08):** se construye con `aoa_to_sheet` y **todo valor pasa por `String(v ?? '').trim()`**. SheetJS escribe los strings como tipo `s` (shared string) y nunca genera fórmulas si no se define `cell.f`. Así, `"001"`, `"=SUMA(1)"`, `"+56"` y `"@x"` quedan como texto literal. Se usan encabezados fijos, igual que `exportTrackingsExcel.ts:14` (con `json_to_sheet`, SheetJS omite columnas).
- **Nombre del archivo (CA-03):** `maestros-<código>-<AAAA-MM-DD>.xlsx`. En el código se reemplazan `/ \ : * ? " < > |` por `_`. La fecha es la **local** del navegador (`getFullYear/getMonth/getDate`), no `toISOString()`, porque en Chile después de las 20-21 h la fecha UTC ya es la del día siguiente. Por eso se aparta a propósito de `exportTrackingsExcel.ts:207`. `now` se inyecta para las pruebas.
- **Resultado:** `{ kind: 'empty', seasonCode }` si no hay filas exportables (CA-11), o `{ kind: 'ok', workbook, fileName, rowCount, nonImportableCount, overImportLimit: rowCount > 10000 }`.

### 5.2 Pantalla "Carga desde Excel" (`MasterDataView.tsx`)

- **Ubicación (P9):** dentro de `.form-actions`, justo después de "Descargar plantilla Excel", va un bloque `.master-export` con:
  - un `<label>` "Temporada a exportar" y un `<select>` con las opciones `"<código> - <nombre>"` (más " (inactiva)" según la PREGUNTA 3), con la temporada actual preseleccionada o, si no hay, la primera;
  - el botón `btn secondary` "Exportar maestros a Excel".
- **Carga del selector:** al montar el componente se llama a `fetchMasterAdminData()` (mismo patrón que `MastersAdminPanel.tsx:271-292`), y se vuelve a llamar después de cada importación exitosa (puede crear una temporada nueva). Mientras carga, el select y el botón quedan deshabilitados. Si la carga falla, se muestra el texto de CA-13 y el botón queda habilitado: el clic reintenta la carga y, si funciona, llena el selector sin descargar.
- **Clic en Exportar:**
  1. Si ya hay una exportación en curso (guardia con `useRef`), se ignora (CA-14).
  2. El botón pasa a "Exportando..." y queda deshabilitado.
  3. Se ejecuta `fetchMasterAdminData()` para obtener datos frescos, lo que además actualiza el selector.
  4. Si falla, se muestra "No se pudieron obtener los maestros. Intente nuevamente." (CA-13). Este texto es propio y no depende de `describeApiError`.
  5. Si `kind === 'empty'`, se muestra "La temporada <código> no tiene relaciones activas para exportar." (CA-11).
  6. Si no, se ejecuta `XLSX.writeFile(workbook, fileName)`. Si `overImportLimit`, se muestra "El archivo tiene <n> filas; la importación acepta hasta 10000 por carga." (CA-20).
  7. En `finally`, el botón vuelve a quedar habilitado.
- **Sin temporadas (CA-12):** el botón queda deshabilitado y se muestra "No hay temporadas para exportar.".
- **Avisos fijos bajo el selector (P1/P10, §6):**
  - "Para reimportar, use el mismo código y nombre de temporada: «<código>» / «<nombre>»."
  - Si la temporada es la actual: "Es la temporada actual: al reimportar, deje «Marcar como temporada actual» en Sí."
  - Si no lo es: "No es la temporada actual: al reimportar, elija «Marcar como temporada actual» = No, o pasará a ser la actual."
  - Si `toCode(código) !== código` (código creado en Mantenimiento con espacios o minúsculas, `index.cjs:1144`): "La importación convierte este código en «<X>» y crearía otra temporada; corrija el código en Mantenimiento antes de reimportar."
- **Texto de columnas (P11):** "Columnas esperadas: EMPRESA, ESPECIE, VARIEDAD, CC, CSG y NOMBRE CC (opcional)."
- **Plantilla (CA-02):** `buildTemplateWorkbook()` usa los mismos 6 encabezados que la exportación y una fila de ejemplo con `NOMBRE CC = 'Cuartel ejemplo'`. La hoja se sigue llamando `Plantilla` y el archivo, `plantilla-maestros-etiquetado.xlsx`.
- **Parser (movido a `masterExcel.ts`):** lee la primera hoja con `defval: ''` (como hoy, `MasterDataView.tsx:71-72`) y acepta los mismos alias de hoy más `NOMBRE CC`, `Nombre CC`, `nombre cc`, `NOMBRE_CC` y `nombre_cc`. Agrega `ccNombre` a la fila solo si viene no vacío.
- **Móvil (CA-18):** `.master-export { display:flex; flex-wrap:wrap; gap; align-items:flex-end }`, con `select { min-width:0; max-width:100% }`. En `@media (max-width:560px)` pasa a `flex-direction:column` y el botón usa `width:100%`, como `.export-excel-actions .btn` (`App.css:2259`). No hay ancho fijo, así que no aparece scroll horizontal.
- **Operador (CA-15):** sin cambios. Maestros no se le muestra, ni por menú ni por `#maestros/excel` (`roleAccess.ts:4-8`, cubierto hoy por `tests/e2e/permisos-ui.spec.ts:27-33`).
- **Sesión vencida:** `apiFetch` no tiene manejo global de 401 (`src/lib/apiClient.ts:8-23`). El GET falla y se muestra el mensaje de CA-13, sin descarga. Es aceptable y coincide con el caso borde del requerimiento: no se descarga nada.

## 6. Alternativas descartadas

- **Armar el Excel en el servidor** (nuevo `GET /api/admin/masters/export?seasonId=` que devuelva el `.xlsx`): obliga a crear una ruta nueva en `index.cjs` (justo la zona que modifica el otro equipo), a usar `xlsx` en el servidor (hoy solo lo usa el front) y a repetir permisos, y además rompe con el patrón vigente de exportar en el cliente. La única ventaja es transferir menos datos, y el bundle completo pesa poco (miles de filas, <2 MB).
- **Un endpoint JSON filtrado por temporada:** la misma objeción de la ruta nueva. Se puede revisar si algún día el bundle crece mucho.
- **Columna `ESTADO` en la plantilla (P2-alternativa):** cambia el formato y la importación. Fue descartada en la compuerta 1.
- **P5 cambiando el `SELECT` posterior al upsert a `WHERE name = ?`:** con menos cambios se arregla el caso del seed, pero mantiene un `INSERT` que, si `toCode(nombre)` coincide con el código de **otra** fila, renombra esa fila antes de buscar. La búsqueda previa por nombre evita ese camino para todos los nombres existentes.
- **Agregar `ccNombre` al tipo en `masterDataApi.ts`:** sería más explícito, pero cae en el archivo que modifica el otro equipo. Se puede agregar en un ciclo posterior sin riesgo.
- **Mover `toCode` a un módulo compartido:** obliga a tocar más líneas de `index.cjs`. Se inyecta como dependencia.

## 7. Tareas

El contrato entre backend y frontend para paralelizar es `rows[].ccNombre?: string`: si viene no vacío, se aplica, y si no, se conserva. Ningún archivo es compartido entre dev-backend y dev-frontend.

| ID | Dueño | Descripción | Archivos | Depende de | CA | Paralelo |
|---|---|---|---|---|---|---|
| T-01 | dev-backend | `masterAudit.cjs`: exportar `buildImportChangeCondition(cols)` y reimplementar `buildImportAuditClause` sobre ella sin cambio de salida. `masterImport.cjs` nuevo: `createCatalogResolver(conn, { audit, toCode })` (búsqueda por nombre, actualización por id con `buildAuditedUpdate(..., userId=null)`, respaldo con `INSERT … ON DUP` por código, caché por solicitud, `catalog_unresolved`) y `buildRelationImportUpsert({ audit, withCenterName })` (§3.2). Sin efectos al importarse, en CommonJS y con nombres de tabla solo desde constantes. | `server/masterImport.cjs` (nuevo), `server/masterAudit.cjs` | — | CA-07, CA-08, CA-09, CA-10, CA-19 | sí (con T-03 y T-04) |
| T-02 | dev-backend | `index.cjs`: `require('./masterImport.cjs')`. Eliminar `upsertByCodeAndName`/`resolveVariety` (`:512-558`). En la ruta de importación, reemplazar `sccAuditClause` (`:1051-1065`) y el cuerpo del bucle (`:1067-1106`) por el resolver más los 2 SQL precalculados, con `ccNombre` vía `normalizeLimitedText(…,180)`. No tocar `resolveSeason`, `master_import_runs`, el `catch` ni otras rutas. | `server/index.cjs` | T-01 | CA-07, CA-08, CA-09, CA-10, CA-19 | no (después de T-01; en paralelo con T-03 y T-04) |
| T-03 | dev-frontend | `masterExcel.ts` nuevo: `MASTER_HEADERS`, `IMPORT_ROW_LIMIT = 10000`, `MasterImportRow`, `parseMasterRow`, `parseMasterWorkbook`, `buildTemplateWorkbook`, `nonImportableReasons`, `exportFileName(code, now)`, `importedSeasonCode(code)` (espejo de `toCode`), `buildMastersExport(bundle, seasonId, now)` (§5.1). Sin React. Los tipos se toman de `src/types.ts:65-127`. | `src/lib/masterExcel.ts` (nuevo) | — | CA-01…CA-06, CA-11, CA-19, CA-20 | sí |
| T-04 | dev-frontend | `MasterDataView.tsx`: usar el parser y la plantilla de T-03; carga de temporadas, selector, botón, guardia `useRef`, estados y mensajes (§5.2); recarga tras importar; texto P11. `App.css`: `.master-export` y su media query. | `src/components/MasterDataView.tsx`, `src/App.css` | T-03 | CA-01, CA-03, CA-11…CA-14, CA-17, CA-18, CA-20, CA-21 | sí (con T-01 y T-02) |
| T-05 | qa-unitario (fase 3) | Pruebas unitarias del §8. | `tests/unit/masterExcel.test.ts` (nuevo), `tests/unit/masterImport.test.ts` (nuevo) | — (contra la interfaz de §3 y §5) | ver §8 | sí |
| T-06 | qa-e2e (fase 3) | Specs de Playwright de UI y API, y un helper de instantánea de BD. | `tests/e2e/maestros-exportar.spec.ts` (nuevo), `tests/e2e/maestros-exportar-api.spec.ts` (nuevo), `tests/e2e/helpers/fotoMaestros.ts` (nuevo) | — | ver §8 | sí |

Los archivos de prueba son **nuevos** a propósito: no se tocan `masterAudit.test.ts`, `permisos-*.spec.ts` ni `maestros-*.spec.ts` existentes, para no chocar con otros ciclos.

## 8. Plan de pruebas

Niveles:
- **unit:** Vitest.
- **E2E-UI:** Playwright, proyectos `desktop` y `movil` (`playwright.config.ts`).
- **E2E-API:** spec de Playwright con `request` más instantánea directa de la BD (`tests/e2e/helpers/db.ts`). Es el patrón que ya usan los maestros (`maestros-auditoria-api.spec.ts`). `scripts/e2e-carga-trackeo.mjs` es para trackeo y no aplica.

Helper `fotoMaestros(conn)`: `SELECT * FROM <tabla> ORDER BY id` para las 7 tablas de maestros más `COUNT(*)` de `master_import_runs`. Compara todas las columnas, incluidas `updated_by` y `updated_at` (`DATETIME(3)`, `schema.sql:193`). Antes de reimportar se espera ≥100 ms (`pausa`) para que una escritura espuria se note en `updated_at`.

**Fixtures:** las pruebas que **editan** usan una temporada propia `E2E-EXP-<sfx>` (`isCurrent=false`) con relaciones creadas por API que apuntan a los catálogos de la semilla (ESMERALDA/"Agrícola Esmeralda", ARANDANO/"Arándano"), para no ensuciar `2025-2026`, que usan otros specs. CA-01 y CA-07 usan `2025-2026` tal como los escribe el requerimiento.

| CA | Nivel | Archivo | Caso |
|---|---|---|---|
| CA-01 | unit | `tests/unit/masterExcel.test.ts` | Bundle de 2 temporadas: la hoja 1 tiene la fila 1 = `MASTER_HEADERS`, solo las relaciones de la temporada elegida y la fila CC01 con los valores esperados. |
| CA-01 | E2E-UI | `tests/e2e/maestros-exportar.spec.ts` | Admin → Carga desde Excel → `2025-2026` preseleccionada → descarga. Se lee con `xlsx`: encabezados, CC01 = (Agrícola Esmeralda, Cereza, Lapins, CC01, CSG001, Cuartel 1) y cantidad de filas = relaciones totalmente activas de esa temporada según `GET /api/admin/masters` (2 en una BD recién creada), sin filas de otras temporadas. |
| CA-02 | unit | `masterExcel.test.ts` | La fila 1 de `buildTemplateWorkbook()` es igual a la fila 1 de la exportación. Ninguna celda de la exportación contiene "EMPRESA EJEMPLO SPA". |
| CA-02 | E2E-UI | `maestros-exportar.spec.ts` | Descargar la plantilla y la exportación, y comparar la fila 1 de ambas. |
| CA-03 | unit | `masterExcel.test.ts` | `exportFileName('2025-2026', new Date(2026,9,2,23,30))` → `maestros-2025-2026-2026-10-02.xlsx` (fecha local, a las 23:30). Con `a/b\c:d*e?f"g<h>i\|j` todos los caracteres se reemplazan por `_`. |
| CA-03 | E2E-UI | `maestros-exportar.spec.ts` | `download.suggestedFilename()` coincide con `^maestros-2025-2026-\d{4}-\d{2}-\d{2}\.xlsx$` y la fecha es la local del test. |
| CA-04 | unit | `masterExcel.test.ts` | Relación con CC `001` y CSG `00123`: `XLSX.write` → `XLSX.read` → celdas con `t === 's'` y valor `"001"`/`"00123"`. `parseMasterWorkbook` devuelve `cc='001'` y `csg='00123'`. |
| CA-04 | E2E-UI | `maestros-exportar.spec.ts` | Temporada propia con CC `001` y CSG `00123` creada por API. En el archivo descargado, las celdas son tipo `s` y el parser de `src/lib/masterExcel.ts` devuelve los mismos valores. |
| CA-05 | unit | `masterExcel.test.ts` | Empresa `Agrícola Ñuble & Cía. 'Sur'` y valores que empiezan con `=`, `+`, `-` y `@`: tras escribir y leer, son idénticos, de tipo `s` y **sin** `cell.f`. |
| CA-06 | unit | `masterExcel.test.ts` | CC02 con relación inactiva y CC01 con variedad inactiva → ninguno en `Maestros`. En `No importables` aparecen con MOTIVO `Relación inactiva` / `Variedad inactiva`, y una combinación de 2 motivos queda unida por ", ". Sin no importables, la hoja trae solo los encabezados. |
| CA-06 | E2E-API | `tests/e2e/maestros-exportar-api.spec.ts` | Temporada propia: inactivar por API una relación y la variedad de otra → exportar en la UI (descarga) → reimportar la hoja 1 → `fotoMaestros` idéntica: no se reactiva nada. |
| CA-07 | unit | `tests/unit/masterImport.test.ts` | Resolver con una conexión falsa: un nombre existente con código distinto (`ESMERALDA`) → `SELECT … WHERE name = ?` y luego `UPDATE … WHERE id = ?`, **sin** `INSERT` y sin `code` en el `SET`. Un nombre nuevo → `INSERT … ON DUP` y luego `SELECT … WHERE code = ?`. Si se repite el nombre, 0 consultas (caché). Variedad → búsqueda por `species_id` y `name`. Un id inexistente → lanza `catalog_unresolved`. |
| CA-07 | unit | `masterImport.test.ts` | `buildRelationImportUpsert`: el `updated_by` aparece antes que `source`, y ambos antes que las columnas de negocio. `<C>` no menciona `source`. Con `withCenterName=false`, el UPDATE no asigna `center_name` y `<C>` no lo incluye. Con `audit=false`, no hay `updated_by` pero sí `source = IF(...)`. Los placeholders coinciden con `params`. También `buildImportChangeCondition` y que `buildImportAuditClause` mantiene la salida actual. |
| CA-07 | E2E-API | `maestros-exportar-api.spec.ts` | **Ida y vuelta por API (rojo hoy, con 500):** en `2025-2026` se agrega por API, como admin, una relación con `source='admin'` y `center_name`. Luego: `fotoMaestros` → exportar desde la UI → parsear la descarga con `parseMasterWorkbook` → `POST /api/master-data/import` con `{code:'2025-2026', name:'Temporada 2025-2026', isCurrent:true}` → `{ ok:true, received:n, applied:n }`. Las 7 tablas son idénticas y `master_import_runs` suma +1. |
| CA-07 | E2E-UI | `maestros-exportar.spec.ts` | **Ida y vuelta completa por UI:** exportar `2025-2026` → `setInputFiles` con el archivo descargado → código y nombre de la hoja `Temporada`, "actual" = Sí → "Importar maestros" → "Carga completada: n filas aplicadas de n." → `fotoMaestros` idéntica, con +1 en `master_import_runs`. |
| CA-08 | E2E-API | `maestros-exportar-api.spec.ts` | Temporada propia: exportar, cambiar con `xlsx` el CSG de CC01 a `CSG002` y reimportar. CC01 queda con `csg_id` de CSG002, `updated_by=NULL`, `source='excel'` y `center_name='Cuartel 1'`. CC02 queda idéntica a la instantánea. **Variante P3:** se borra la columna NOMBRE CC y se reimporta → `center_name` se conserva en todas las filas. |
| CA-09 | E2E-API | `maestros-exportar-api.spec.ts` | Agregar la fila (Agrícola Esmeralda, Cereza, Lapins, CC09, CSG001) y reimportar. Existe CC09 activa con `company_id` = id de ESMERALDA y el número de filas de `companies` no cambia. |
| CA-10 | E2E-API | `maestros-exportar-api.spec.ts` | Quitar la fila CC02 y reimportar: CC02 queda idéntica a la instantánea (estado, `updated_by` y `updated_at`). |
| CA-11 | unit | `masterExcel.test.ts` | Temporada sin relaciones y temporada con todas inactivas → `{ kind: 'empty', seasonCode }`. |
| CA-11 | E2E-UI | `maestros-exportar.spec.ts` | Temporada propia sin relaciones: al pulsar no hay evento `download` (espera acotada) y aparece "La temporada <código> no tiene relaciones activas para exportar.". |
| CA-12 | E2E-UI | `maestros-exportar.spec.ts` | Con `page.route('**/api/admin/masters')` que responde arreglos vacíos, el botón queda deshabilitado y se muestra "No hay temporadas para exportar.". |
| CA-13 | E2E-UI | `maestros-exportar.spec.ts` | Con la pantalla cargada, `page.route` responde 500 (y en otra variante, `route.abort()`). Al pulsar no hay descarga, aparece "No se pudieron obtener los maestros. Intente nuevamente." y el botón vuelve a estar habilitado. |
| CA-14 | E2E-UI | `maestros-exportar.spec.ts` | `page.route` con una demora de 1 s: el botón muestra "Exportando..." y queda deshabilitado. Un doble clic produce **1** evento `download`. |
| CA-15 | E2E-UI | `maestros-exportar.spec.ts` | Operador: no ve "Maestros" en el menú y en `/#maestros/excel` no aparece el botón "Exportar maestros a Excel" ni el encabezado "Carga maestra desde Excel". Ya está cubierto también por `permisos-ui.spec.ts:27-33`. |
| CA-16 | E2E-API | `maestros-exportar-api.spec.ts` | `GET /api/admin/masters` con token de operador → 403 `forbidden`, y sin token → 401 `missing_token`. Ya está cubierto también por `permisos-api.spec.ts:9,34-39`. |
| CA-17 | E2E-UI | `maestros-exportar.spec.ts` | El superadmin repite CA-01 y el contenido de la hoja 1 es igual al del admin. |
| CA-18 | E2E-UI | `maestros-exportar.spec.ts` | En los proyectos `desktop` y `movil`, el selector y el botón son visibles (`toBeInViewport` después de `scrollIntoViewIfNeeded`), `scrollWidth <= clientWidth` en `documentElement` y la descarga funciona. |
| CA-19 | unit | `masterExcel.test.ts` | Bundle con 5000 relaciones activas → `rowCount=5000`, hoja con 5001 filas y `overImportLimit=false`. |
| CA-19 | E2E-API | `maestros-exportar-api.spec.ts` | Temporada propia con 5000 filas importadas por API → exportar desde la UI → 5001 filas → reimportar la hoja 1 → `fotoMaestros` idéntica. Usa `test.setTimeout(180_000)` y corre solo en el proyecto `desktop` (`test.skip` en `movil`), porque no depende del viewport. |
| CA-20 | unit | `masterExcel.test.ts` | 10001 relaciones → `overImportLimit=true`, `rowCount=10001`. 10000 → `false`. |
| CA-20 | E2E-UI | `maestros-exportar.spec.ts` | `page.route` con un bundle de 10001 relaciones activas: la descarga ocurre y aparece "El archivo tiene 10001 filas; la importación acepta hasta 10000 por carga.". |
| CA-21 | E2E-API | `maestros-exportar-api.spec.ts` | `fotoMaestros` (incluido `master_import_runs`) → exportar desde la UI `2025-2026` y una temporada propia → `fotoMaestros` idéntica. |

Regresión: `maestros-auditoria-api.spec.ts` (CA-25, CA-26 y CA-28 de admin-maestros) y `maestros-excel.spec.ts` deben seguir en verde sin cambios.

## 9. Riesgos y rollback

**Conflictos de merge con `fix/esquema-y-errores-login`** (según su `diseno.md`, T-03 y T-05):
- **Bloque de `require` al inicio de `server/index.cjs`** (`:1-22`). Si ambos agregan un `require` en líneas contiguas, el conflicto es trivial: hay que conservar los dos.
- **Ruta de importación.** Ellos agregan `onRouteError` en el `catch` (`:1114-1117`). Este diseño **no toca** el `catch` ni el `INSERT` en `master_import_runs` (`:1108-1113`), y quedan ≥6 líneas sin cambios entre los hunks, así que lo más probable es que no haya conflicto. Si aparece uno, hay que conservar el cuerpo de este ciclo y su `catch`.
- **Funciones eliminadas.** Ellos quitan `:133-253` y `:676-685`, y nosotros `:512-558`. Son hunks separados.
- **Rutas sin conflicto:** `GET /api/admin/masters` (ellos agregan un reintento) no se toca aquí. Su reintento solo mejora la exportación.
- **Archivos sin conflicto:** `src/lib/masterDataApi.ts` y `database/schema.sql` no se tocan aquí.
- **Mensajes:** su nuevo `describeApiError` no cambia CA-13, porque la exportación usa un texto propio.
- **Recomendación:** quien integre segundo debe correr `npm run test:all` completo después del merge.

**Otros riesgos:**
- **Otro renombrado por colisión de código (anterior al ciclo).** Si un nombre **no existe** y `toCode(nombre)` coincide con el código de otra fila, el `INSERT … ON DUP` renombra esa fila (`index.cjs:520-529`, que se mueve sin cambios). La reimportación de un archivo exportado no pasa por ese camino, porque todos sus nombres existen. Ver PREGUNTA 5.
- **P7 (homónimos):** queda mitigado para los que ya existen (§3.1). La deuda sigue solo al crear uno nuevo.
- **Reimportar sobre datos que cambiaron después de exportar:** gana la última escritura (especie, variedad o CSG). Es el comportamiento normal del upsert y se puede mitigar con el aviso de reimportar pronto. No se agrega bloqueo optimista porque ningún CA lo pide.
- **Doble GET al entrar a Maestros:** `MasterDataView` y `MastersAdminPanel` piden el mismo bundle. El costo es bajo, y compartirlo obligaría a tocar `MastersWorkspace`. Se acepta.
- **Rendimiento con 5000 a 10000 filas:** la caché del resolver deja ~1 sentencia por fila (el upsert de la relación) cuando los catálogos se repiten. Cuando no se repiten, quedan ≤9 por fila, igual que hoy. El body (≤8 MB, `index.cjs:792`) alcanza de sobra.
- **Autoincremento:** `INSERT … ON DUP` sobre relaciones existentes consume ids de `AUTO_INCREMENT` sin modificar filas. No afecta a CA-07 (que compara filas) y ya ocurre hoy.
- **SheetJS 0.18.5:** tiene avisos de seguridad conocidos en la **lectura** de archivos no confiables. La exportación no agrega superficie de lectura nueva: el parser es el mismo que hoy, solo cambia de lugar.

**Rollback:**
- Basta revertir el merge de `feat/exportar-maestros-excel`, porque no hay DDL ni backfill.
- Los datos escritos con la importación nueva son válidos para la vieja. Después del revert, la importación vuelve a borrar `center_name`, a forzar `source='excel'` y a fallar con catálogos de código ≠ `toCode(nombre)`.
- El archivo exportado con `NOMBRE CC` sigue siendo importable con la versión vieja: la columna se ignora, pero `center_name` se pierde, como hoy.

## 10. Preguntas para la compuerta 2

El diseño ya aplica la opción recomendada de cada una. Si alguna respuesta cambia, se ajustan las secciones indicadas.

| # | Pregunta | Recomendación (aplicada en el diseño) | Afecta |
|---|---|---|---|
| 1 | P3 se aprobó **con** la columna `NOMBRE CC`, pero CA-01 dice "**exactamente** los encabezados EMPRESA, ESPECIE, VARIEDAD, CC, CSG" y CA-06 habla de "las mismas 5 columnas más MOTIVO". | La hoja principal, la plantilla y "No importables" llevan 6 columnas (`… CSG, NOMBRE CC`), así que CA-02 se cumple porque la plantilla también se actualiza. Hay que corregir el texto de CA-01 y CA-06 a 6 columnas. | §5.1, §8 (CA-01, CA-02, CA-06) |
| 2 | Con la columna `NOMBRE CC` presente, ¿una **celda vacía** borra el nombre o lo conserva? Leído al pie de la letra, P3 ("si la columna viene, se aplica") lo borraría. | **Celda vacía = conservar.** Es el criterio más seguro, porque la plantilla trae la columna y quien la llena sin nombres no debe borrar los existentes. Contra: un nombre no se puede vaciar desde Excel; se vacía en Mantenimiento. | §3.2, §4, parser (§5.2) |
| 3 | Las **temporadas inactivas** aparecen en el selector. Reimportar una las reactiva (`resolveSeason`, `index.cjs:573-580`), y P2 solo cubre relaciones y catálogos. | Listarlas con el sufijo " (inactiva)" y mostrar el aviso "Esta temporada está inactiva: reimportarla la reactivará.". No se cambia la importación. Alternativa: excluirlas del selector. | §5.2 |
| 4 | CA-18 cita el viewport móvil 390x844, pero la suite usa `devices['Pixel 7']` (412 px de ancho, `playwright.config.ts`). | Usar el proyecto `movil` de la suite y ajustar el texto de CA-18. | §8 (CA-18) |
| 5 | Hallazgo anterior al ciclo: si un nombre **no existe** y `toCode(nombre)` coincide con el código de **otra** fila, la importación renombra esa fila. | Fuera de alcance, como P7: registrarlo en "Hallazgos fuera de alcance" de `estado.md`. No afecta la ida y vuelta. | §9 |
