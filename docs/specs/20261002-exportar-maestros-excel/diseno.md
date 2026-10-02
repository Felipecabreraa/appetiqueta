# Diseño — Exportar Maestros a Excel en el formato de la plantilla de importación

- **Spec:** 20261002-exportar-maestros-excel · **Requerimiento:** [requerimiento.md](requerimiento.md) (aprobado: P1..P11 con la opción recomendada, talla L; P12..P16 y CA-22 decididos por el Lead en la fase 2)
- **Rama:** `feat/exportar-maestros-excel` (worktree `/Users/felipelagos/Projects/appetiquetado-export`)
- **Estado:** aprobado (compuerta 2, usuario, 2026-10-02)

## 1. Resumen de la solución

1. **La exportación se arma en el cliente** con `xlsx`, la misma librería y el mismo patrón que ya usan la plantilla (`src/components/MasterDataView.tsx:47-61`) y el Excel de trackeo (`src/lib/exportTrackingsExcel.ts:153-209`). Los datos salen de `GET /api/admin/masters`, que ya existe y ya exige `ACCESS.MASTER_ADMIN` (`server/index.cjs:1121-1135`). No hay endpoint nuevo, no cambian los permisos y no se toca el esquema.
2. **Una lógica pura nueva, `src/lib/masterExcel.ts`,** reúne en un solo lugar los encabezados, el parser de importación (que se mueve desde `MasterDataView.tsx:13-34`), la plantilla y la construcción del libro exportado. Así la plantilla, la exportación y la lectura comparten las mismas constantes y se pueden probar en unitario.
3. **La importación se corrige en un módulo nuevo del servidor, `server/masterImport.cjs`,** que se puede probar en unitario porque `index.cjs` no exporta nada:
   - **P5:** reutiliza por nombre los catálogos existentes, sin tocar su código.
   - **P3:** solo escribe `center_name` si la fila trae `ccNombre`.
   - **P4:** `source` y `updated_by` cambian solo si cambian los datos de negocio.

   La ruta `POST /api/master-data/import` solo cambia su cuerpo interno: el contrato, el `catch` y el registro en `master_import_runs` quedan igual.
4. Con estos cambios, "exportar → reimportar sin cambios" deja **0 filas modificadas** en las 7 tablas, y la única fila nueva es la de `master_import_runs` (objetivo del §2 del requerimiento). Las relaciones que reimportadas modificarían algo (inactivas o con la variedad en otra especie) van a "No importables".

## 2. Impacto por capa

| Capa | Archivos | Cambio |
|---|---|---|
| BD | — | **Sin cambios de esquema ni backfill.** `center_name`, `source` y la auditoría ya existen (`database/schema.sql:181-197`). `database/schema.sql` no se toca. |
| API (lógica nueva) | `server/masterImport.cjs` (nuevo) | `createCatalogResolver(conn, { audit, toCode })` (P5, con caché por solicitud) y `buildRelationImportUpsert({ audit, withCenterName })` (P3 + P4). |
| API (auditoría) | `server/masterAudit.cjs` | Se exporta `buildImportChangeCondition(cols)`, que es la condición "todo igual" que hoy arma `buildImportAuditClause` (`:137-141`). `buildImportAuditClause` pasa a usarla, **sin cambio de comportamiento**. |
| API (ruta) | `server/index.cjs` | 1 `require` nuevo. Se eliminan `upsertByCodeAndName` y `resolveVariety` (`:512-558`), que pasan al resolver. En la ruta de importación se reemplazan la cláusula `sccAuditClause` (`:1051-1063`) y el bucle (`:1064-1101`). **No se tocan** `resolveSeason` (`:560-591`), el `INSERT` en `master_import_runs` (`:1103-1108`), el `catch` (`:1111-1117`) ni `GET /api/admin/masters`. |
| Frontend (lógica) | `src/lib/masterExcel.ts` (nuevo) | Encabezados, parser (con rechazo de "No importables"), plantilla, exportación, nombre de archivo, motivos y aviso de límite. Solo sintaxis borrable (ya lo exige `erasableSyntaxOnly`) e imports relativos de solo tipos, para que el runner de API lo cargue con Node (§8, CA-19). |
| Frontend (UI) | `src/components/MasterDataView.tsx` | Selector de temporada, botón "Exportar maestros a Excel", avisos y estados propios de la exportación. La plantilla y el parser pasan a usar `masterExcel.ts`, y el texto de columnas se alinea con la plantilla (P11). |
| Frontend (estilos) | `src/App.css` | Clase `.master-export` (flex con wrap y columna en ≤560 px), siguiendo el patrón de `.export-excel-actions` (`:3231-3236`, `:2259-2261`). |
| Pruebas (runner de API) | `scripts/e2e-exportar-volumen.mjs` (nuevo), `scripts/e2e-api.mjs` | CA-19 con reinicio de BD (IMP-2). |
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
4. El `INSERT INTO season_cost_centers` (`:1078-1099`) recibe un bind `undefined`, y mysql2 lanza "Bind parameters must not contain undefined".
5. Se ejecuta el `catch` → `rollback` → **500 `db`** (`:1111-1114`).

Lo mismo ocurre con `Arándano` (`ARANDANO`, `seed.test.sql:6`) y con cualquier variedad cuyo código no sea `toCode(nombre)` (`:535-557`). QA debe dejar esta prueba en rojo en la fase 3, antes de corregir: E2E de API CA-07 sobre la semilla.

`createCatalogResolver(conn, { audit, toCode })` devuelve `{ company(name), species(name), csg(name), variety(speciesId, name) }`. Cada función hace lo siguiente:

1. **Caché por solicitud** (`Map`, con clave `tabla + nombre exacto`; en variedad, `speciesId + nombre`). Si el nombre ya se resolvió en esta importación, devuelve el id sin consultar. Es correcto porque la primera resolución ya dejó la fila con ese nombre y activa, así que repetir la operación no cambiaría nada. Además reduce de 9 a ~1 las consultas por fila cuando los catálogos se repiten (CA-19).
2. **Busca por nombre:** `SELECT id FROM <tabla> WHERE name = ? LIMIT 1`. En variedad: `SELECT id FROM varieties WHERE species_id = ? AND name = ? LIMIT 1`. La comparación usa la intercalación de la tabla (`utf8mb4_unicode_ci`, `schema.sql:100,118,141,159`), que es la misma que aplican `uq_*_name` (`:95,113,132,154`), así que nunca contradice a los índices únicos.
3. **Si lo encuentra:** actualiza por id con `buildAuditedUpdate(tabla, [{name:'name',text:true},{name:'is_active'}], { audit })`, con `userId = null` (`masterAudit.cjs:106-120`). Así se genera `UPDATE t SET updated_by = IF(<todo igual>, updated_by, NULL), name = ?, is_active = 1 WHERE id = ?`. **El `code` no se toca.** Si nada cambia, InnoDB no modifica la fila: `updated_by` y `updated_at` (`ON UPDATE`) quedan iguales, igual que la regla P2/CA-26 de admin-maestros. Un cambio solo de mayúsculas sí cuenta como cambio, por la comparación binaria de CA-28.
4. **Si no lo encuentra (respaldo, MEN-5):** ejecuta el mismo `INSERT … ON DUPLICATE KEY UPDATE` de hoy por `code = toCode(nombre)` (movido sin cambios desde `index.cjs:512-558`) y luego **vuelve a buscar por nombre con lectura bloqueante**: `SELECT id FROM <tabla> WHERE name = ? LIMIT 1 LOCK IN SHARE MODE`. En variedad: `… WHERE species_id = ? AND name = ? LIMIT 1 LOCK IN SHARE MODE`.
   - Buscar por nombre, y no por código, es correcto en los tres desenlaces del `INSERT`: si insertó, la fila tiene ese nombre; si chocó por código, el `ON DUP` le asignó ese nombre; y si chocó por nombre (otra transacción lo insertó entre el paso 2 y este), la fila ya lo tenía.
   - `LOCK IN SHARE MODE` lee la versión confirmada más reciente y no la instantánea de la transacción, así que ve la fila insertada por otra importación concurrente. La sintaxis la soporta MariaDB 10.6, y MySQL 8 la mantiene como sinónimo de `FOR SHARE`.
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

- `<C>` = `buildImportChangeCondition([...])` sobre `center_name` (solo si `withCenterName`), `species_id`, `variety_id`, `csg_id` e `is_active <=> 1`. **`source` sale de la condición** (hoy está en `index.cjs:1059`): ya no es un dato de negocio, sino un efecto.
- **El orden es obligatorio:** `updated_by` y `source` van **antes** que las columnas de negocio. MariaDB y MySQL evalúan las asignaciones de izquierda a derecha, y así `<C>` compara contra la fila vigente. Es el mismo supuesto que ya documenta `masterAudit.cjs:115`. El modo `SIMULTANEOUS_ASSIGNMENT` de MariaDB está desactivado por defecto.
- **P3 / P13:** en `index.cjs`, `ccNombre = normalizeLimitedText(raw?.ccNombre, 180)` (`:67-69`, el mismo límite que la ruta manual, `:1315`). `withCenterName = ccNombre !== ''`. Se preparan los dos SQL fuera del bucle. Una relación **nueva** sin nombre se inserta con `center_name = ''` (el `DEFAULT` de la columna, `schema.sql:186`). Una existente conserva su nombre, también cuando la columna `NOMBRE CC` viene con la celda vacía (decisión P13).
- **P4:** si `<C>` es verdadero (no cambió nada), la fila queda idéntica, incluidos `source='admin'` y `updated_by`. Si cambió algo, `source='excel'` y `updated_by=NULL`, como hoy. Esto mantiene CA-26 (a y b) de admin-maestros (`tests/e2e/maestros-auditoria-api.spec.ts:181-213`).

### 3.3 Temporada (sin cambios)

`resolveSeason` (`index.cjs:560-591`) ya cumple RN-06 cuando el código, el nombre y "actual" coinciden: el upsert no cambia nada, el `UPDATE … WHERE is_current = 1` filtrado (`masterAudit.cjs:143-161`) no toca filas y el `UPDATE seasons SET is_current = 1` tampoco. Que el código del formulario coincida con el exportado se resuelve con el aviso (P1/P10, §5). Reimportar una temporada inactiva la reactiva (`:573-580`); se avisa en la UI (P14) y no se cambia la importación.

## 4. Contrato de API

No hay rutas nuevas.

| Método | Ruta | Rol | Body | Respuesta OK | Errores |
|---|---|---|---|---|---|
| GET | `/api/admin/masters` | admin, superadmin (`ACCESS.MASTER_ADMIN`) | — | **Sin cambios:** `{ ok: true, seasons, companies, species, csg, jcForemen, varieties, relations }`, con activos e inactivos (`index.cjs:606-678`). La exportación usa `relations[].{season_id, company_id, species_id, variety_id, csg_id, company_name, species_name, variety_name, csg_name, center_code, center_name, is_active}`, el `is_active` de cada catálogo y `varieties[].species_id`. | Sin cambios: 401 `missing_token`/`invalid_session` (`:308`), 403 `forbidden` (`:335`), 500 `db`, 503 `db_not_configured`. |
| POST | `/api/master-data/import` | admin, superadmin (sin cambios) | `{ season: { code, name, isCurrent }, rows: [{ empresa, cc, especie, variedad, csg, ccNombre? }] }`. **Nuevo campo opcional:** `ccNombre` (string). Si viene no vacío, se aplica a `center_name`. Si falta o viene vacío, se conserva el valor vigente. Los clientes viejos (sin `ccNombre`) quedan compatibles y ya no borran nombres. | **Sin cambios:** `{ ok: true, seasonId, received, applied }`. **Semántica nueva:** P3, P4 y P5 (§3). | Sin cambios: 400 `rows_required`, 400 `rows_too_large` (>10000), 500 `db`, 503. |

El endpoint no es público, y ninguna ruta pública cambia.

## 5. Flujo / UI

### 5.1 Libro exportado (`buildMastersExport(bundle, seasonId, now)`)

| Hoja | Contenido |
|---|---|
| 1. `Maestros` (hoja principal) | Fila 1: `EMPRESA, ESPECIE, VARIEDAD, CC, CSG, NOMBRE CC`. Una fila por relación **exportable** de la temporada, en el orden de la API (`index.cjs:654`: empresa y luego CC), que es estable. Una relación es exportable si la relación, la empresa, la especie, la variedad y el CSG tienen `is_active = 1` **y** la variedad pertenece a la especie de la relación (`bundle.varieties[variety_id].species_id === relation.species_id`). EMPRESA, ESPECIE, VARIEDAD y CSG llevan el **nombre**. CC lleva `center_code` (RN-02). |
| 2. `No importables` | Mismos 6 encabezados más `MOTIVO`. Una fila por relación de la temporada que no es exportable. MOTIVO combina, en este orden y separados por ", ", `Relación inactiva`, `Empresa inactiva`, `Especie inactiva`, `Variedad inactiva`, `Variedad de otra especie` (IMP-1, CA-22) y `CSG inactivo` (CA-06). Si no hay filas, la hoja lleva solo los encabezados (estructura estable). |
| 3. `Temporada` | `CÓDIGO, NOMBRE, ACTUAL, ACTIVA` (`Sí`/`No`), una línea en blanco y la nota "Para reimportar, use el mismo código y nombre de temporada." |

- **Por qué "Variedad de otra especie" (IMP-1):** si la relación dice Cereza/X pero la variedad X ya pertenece a Arándano, reimportar esa fila no encuentra X en Cereza (§3.1, paso 2). Cae entonces en el respaldo por código, que mueve X a Cereza: modificaría `varieties` y rompería RN-06. Por eso se excluye de la hoja principal. Validar la coherencia en `POST /api/admin/relations` (`index.cjs:1306-1346`) queda **fuera de alcance** (hallazgo, P16).
- **Celdas de texto (CA-04, CA-05, RN-08):** se construye con `aoa_to_sheet` y **todo valor pasa por `String(v ?? '').trim()`**. SheetJS escribe los strings como tipo `s` (shared string) y nunca genera fórmulas si no se define `cell.f`. Así, `"001"`, `"=SUMA(1)"`, `"+56"` y `"@x"` quedan como texto literal. Se usan encabezados fijos, igual que `exportTrackingsExcel.ts:14` (con `json_to_sheet`, SheetJS omite columnas).
- **Formato texto (MEN-7):** las celdas de datos de las columnas `CC`, `CSG` y `NOMBRE CC` (en `Maestros` y en `No importables`) llevan además `z: '@'`, para que Excel mantenga como texto lo que el usuario escriba después en esas celdas (por ejemplo, un CC `001` nuevo). Solo vale para las filas exportadas: una fila que el usuario agregue debajo no hereda el formato, y eso sigue fuera de nuestro control (caso borde del §6 del requerimiento).
- **Nombre del archivo (CA-03):** `maestros-<código>-<AAAA-MM-DD>.xlsx`. En el código se reemplazan `/ \ : * ? " < > |` por `_`. La fecha es la **local** del navegador (`getFullYear/getMonth/getDate`), no `toISOString()`, porque en Chile después de las 20-21 h la fecha UTC ya es la del día siguiente. Por eso se aparta a propósito de `exportTrackingsExcel.ts:207`. `now` se inyecta para las pruebas.
- **Resultado:** `{ kind: 'empty', seasonCode }` si no hay filas exportables (CA-11), o `{ kind: 'ok', workbook, fileName, rowCount, nonImportableCount, overImportLimit: rowCount > 10000 }`.

### 5.2 Pantalla "Carga desde Excel" (`MasterDataView.tsx`)

- **Ubicación (P9):** dentro de `.form-actions`, justo después de "Descargar plantilla Excel", va un bloque `.master-export` con:
  - un `<label>` "Temporada a exportar" y un `<select>` con las opciones `"<código> - <nombre>"`, con el sufijo `" (inactiva)"` si `is_active = 0` (P14), y con la temporada actual preseleccionada o, si no hay, la primera;
  - el botón `btn secondary` "Exportar maestros a Excel".
- **Estado propio de la exportación (MEN-8).** No comparte `error`/`status` con la importación:
  - `seasonsLoad: 'loading' | 'ready' | 'error'`
  - `exportBusy` más una guardia `useRef`
  - `exportMessage: { kind: 'error' | 'info'; text } | null`
- **Carga del selector:** al montar el componente se llama a `fetchMasterAdminData()` (mismo patrón que `MastersAdminPanel.tsx:271-292`), y se vuelve a llamar después de cada importación exitosa (puede crear una temporada nueva).

  | Estado | Select | "Exportar maestros a Excel" | Mensaje |
  |---|---|---|---|
  | `loading` | deshabilitado | deshabilitado | — |
  | `error` (**falló la carga**) | deshabilitado | deshabilitado | "No se pudieron obtener los maestros. Intente nuevamente." y un botón **"Reintentar"** (`btn secondary`) que vuelve a cargar. |
  | `ready` sin temporadas (**CA-12**) | deshabilitado | **deshabilitado** | "No hay temporadas para exportar." (sin "Reintentar"). |
  | `ready` con temporadas | habilitado | habilitado | avisos fijos (abajo) |

- **Clic en Exportar:**
  1. Si ya hay una exportación en curso (guardia con `useRef`), se ignora (CA-14).
  2. El botón pasa a "Exportando..." y queda deshabilitado.
  3. Se ejecuta `fetchMasterAdminData()` para obtener datos frescos, lo que además actualiza el selector.
  4. Si falla, se muestra "No se pudieron obtener los maestros. Intente nuevamente." (CA-13). Este texto es propio y no depende de `describeApiError`.
  5. Si `kind === 'empty'`, se muestra "La temporada <código> no tiene relaciones activas para exportar." (CA-11).
  6. Si no, se ejecuta `XLSX.writeFile(workbook, fileName)`. Si `overImportLimit`, se muestra "El archivo tiene <n> filas; la importación acepta hasta 10000 por carga." (CA-20).
  7. En `finally`, el botón vuelve a quedar habilitado.
- **Dónde y cómo se muestran los mensajes de la exportación (IMP-3):** en un `<p className="alert error|info" role="status">` dentro del bloque `.master-export`, que está dentro de `#panel-maestros-excel` (`MastersWorkspace.tsx:36-43`).
  - **No se usa `role="alert"`.** `MastersAdminPanel` ya pinta su error de carga en `role="alert"` (`MastersAdminPanel.tsx:429`), y el CA-16 del otro equipo (`tests/e2e/maestros-error-servidor.spec.ts`) lo busca por ese rol en Maestros.
  - Como ambos paneles piden el mismo `GET /api/admin/masters` al montarse, un 500 forzado mostraría dos alertas y rompería su localizador (modo estricto de Playwright).
  - `role="status"` sigue anunciándose a los lectores de pantalla (región viva con cortesía) sin interferir.
- **Avisos fijos bajo el selector (P1/P10/P14, §6 del requerimiento):**
  - "Para reimportar, use el mismo código y nombre de temporada: «<código>» / «<nombre>»."
  - Si la temporada es la actual: "Es la temporada actual: al reimportar, deje «Marcar como temporada actual» en Sí."
  - Si no lo es: "No es la temporada actual: al reimportar, elija «Marcar como temporada actual» = No, o pasará a ser la actual."
  - Si está inactiva (P14): "Esta temporada está inactiva: reimportarla la reactivará."
  - Si `toCode(código) !== código` (código creado en Mantenimiento con espacios o minúsculas, `index.cjs:1144`): "La importación convierte este código en «<X>» y crearía otra temporada; corrija el código en Mantenimiento antes de reimportar."
- **Texto de columnas (P11):** "Columnas esperadas: EMPRESA, ESPECIE, VARIEDAD, CC, CSG y NOMBRE CC (opcional)."
- **Plantilla (CA-02):** `buildTemplateWorkbook()` usa los mismos 6 encabezados que la exportación y una fila de ejemplo con `NOMBRE CC = 'Cuartel ejemplo'`. La hoja se sigue llamando `Plantilla` y el archivo, `plantilla-maestros-etiquetado.xlsx`.
- **Parser (movido a `masterExcel.ts`):** lee la primera hoja con `defval: ''` (como hoy, `MasterDataView.tsx:71-72`) y acepta los mismos alias de hoy más `NOMBRE CC`, `Nombre CC`, `nombre cc`, `NOMBRE_CC` y `nombre_cc`. Agrega `ccNombre` a la fila solo si viene no vacío.
  - **Rechazo de archivos equivocados (MEN-6):** si la primera hoja se llama `No importables` (sin distinguir mayúsculas) o su fila 1 trae la columna `MOTIVO`, `parseMasterWorkbook` lanza `Error` con el mensaje: "Este archivo tiene la hoja «No importables» o la columna MOTIVO como primera hoja. Copie las filas que quiera reactivar a la hoja «Maestros», sin la columna MOTIVO, y vuelva a importar."
  - `onPickFile` ya muestra `e.message` (`MasterDataView.tsx:81-83`), así que no se importa nada.
- **Móvil (CA-18):** `.master-export { display:flex; flex-wrap:wrap; gap; align-items:flex-end }`, con `select { min-width:0; max-width:100% }`. En `@media (max-width:560px)` pasa a `flex-direction:column` y los botones usan `width:100%`, como `.export-excel-actions .btn` (`App.css:2259`). No hay ancho fijo, así que no aparece scroll horizontal.
- **Operador (CA-15):** sin cambios. Maestros no se le muestra, ni por menú ni por `#maestros/excel` (`roleAccess.ts:4-8`, cubierto hoy por `tests/e2e/permisos-ui.spec.ts:27-33`).
- **Sesión vencida:** `apiFetch` no tiene manejo global de 401 (`src/lib/apiClient.ts:8-23`). El GET falla y se muestra el mensaje de CA-13, sin descarga. Es aceptable y coincide con el caso borde del requerimiento: no se descarga nada.

## 6. Alternativas descartadas

- **Armar el Excel en el servidor** (nuevo `GET /api/admin/masters/export?seasonId=` que devuelva el `.xlsx`): obliga a crear una ruta nueva en `index.cjs` (justo la zona que modifica el otro equipo), a usar `xlsx` en el servidor (hoy solo lo usa el front) y a repetir permisos, y además rompe con el patrón vigente de exportar en el cliente. La única ventaja es transferir menos datos, y el bundle completo pesa poco (miles de filas, <2 MB).
- **Un endpoint JSON filtrado por temporada:** la misma objeción de la ruta nueva. Se puede revisar si algún día el bundle crece mucho.
- **Columna `ESTADO` en la plantilla (P2-alternativa):** cambia el formato y la importación. Fue descartada en la compuerta 1.
- **P5 cambiando solo el `SELECT` posterior al upsert a `WHERE name = ?`:** con menos cambios se arregla el caso del seed, pero mantiene un `INSERT` que, si `toCode(nombre)` coincide con el código de **otra** fila, renombra esa fila antes de buscar. La búsqueda previa por nombre evita ese camino para todos los nombres existentes. El `SELECT` por nombre queda solo en el respaldo (MEN-5).
- **Corregir en la importación la relación con variedad de otra especie:** obligaría a decidir qué gana (la especie de la fila o la de la variedad). Excluirla al exportar es más simple y no cambia la importación (IMP-1).
- **Agregar `ccNombre` al tipo en `masterDataApi.ts`:** sería más explícito, pero cae en el archivo que modifica el otro equipo. Se puede agregar en un ciclo posterior sin riesgo.
- **Mover `toCode` a un módulo compartido:** obliga a tocar más líneas de `index.cjs`. Se inyecta como dependencia.
- **CA-19 en Playwright:** 5000 filas en la BD compartida de la suite la ensucian para los specs siguientes y alargan la corrida en dos proyectos. Va al runner de API, con su propio reinicio de BD (IMP-2).

## 7. Tareas

El contrato entre backend y frontend para paralelizar es `rows[].ccNombre?: string`: si viene no vacío, se aplica, y si no, se conserva. Ningún archivo es compartido entre dev-backend y dev-frontend.

| ID | Dueño | Descripción | Archivos | Depende de | CA | Paralelo |
|---|---|---|---|---|---|---|
| T-01 | dev-backend | `masterAudit.cjs`: exportar `buildImportChangeCondition(cols)` y reimplementar `buildImportAuditClause` sobre ella sin cambio de salida. `masterImport.cjs` nuevo: `createCatalogResolver(conn, { audit, toCode })` (búsqueda por nombre, actualización por id con `buildAuditedUpdate(..., userId=null)`, respaldo con `INSERT … ON DUP` por código y nueva búsqueda por nombre con `LOCK IN SHARE MODE`, caché por solicitud, `catalog_unresolved`) y `buildRelationImportUpsert({ audit, withCenterName })` (§3.2). Sin efectos al importarse, en CommonJS y con nombres de tabla solo desde constantes. | `server/masterImport.cjs` (nuevo), `server/masterAudit.cjs` | — | CA-07, CA-08, CA-09, CA-10, CA-19, CA-22 | sí (con T-03 y T-04) |
| T-02 | dev-backend | `index.cjs`: `require('./masterImport.cjs')`. Eliminar `upsertByCodeAndName`/`resolveVariety` (`:512-558`). En la ruta de importación, reemplazar la cláusula `sccAuditClause` (`:1051-1063`) y el bucle (`:1064-1101`) por el resolver más los 2 SQL precalculados, con `ccNombre` vía `normalizeLimitedText(…,180)`. No tocar `resolveSeason`, el `INSERT` en `master_import_runs` (`:1103-1108`), el `catch` (`:1111-1117`) ni otras rutas. | `server/index.cjs` | T-01 | CA-07, CA-08, CA-09, CA-10, CA-19 | no (después de T-01; en paralelo con T-03 y T-04) |
| T-03 | dev-frontend | `masterExcel.ts` nuevo: `MASTER_HEADERS`, `IMPORT_ROW_LIMIT = 10000`, `MasterImportRow`, `parseMasterRow`, `parseMasterWorkbook` (con el rechazo de MEN-6), `buildTemplateWorkbook`, `nonImportableReasons` (con "Variedad de otra especie"), `exportFileName(code, now)`, `importedSeasonCode(code)` (espejo de `toCode`), `buildMastersExport(bundle, seasonId, now)` (§5.1, con `z:'@'`). Sin React. Los tipos se toman de `src/types.ts:65-127` con `import type`. Solo sintaxis borrable, para que Node lo cargue en el runner de CA-19. | `src/lib/masterExcel.ts` (nuevo) | — | CA-01…CA-06, CA-11, CA-19, CA-20, CA-22 | sí |
| T-04 | dev-frontend | `MasterDataView.tsx`: usar el parser y la plantilla de T-03; estado propio de la exportación (`seasonsLoad`, `exportBusy` más `useRef`, `exportMessage`), selector con " (inactiva)", botones "Exportar maestros a Excel" y "Reintentar", mensajes en `role="status"` dentro del panel, avisos (§5.2); recarga tras importar; texto P11. `App.css`: `.master-export` y su media query. | `src/components/MasterDataView.tsx`, `src/App.css` | T-03 | CA-01, CA-03, CA-11…CA-14, CA-17, CA-18, CA-20, CA-21 | sí (con T-01 y T-02) |
| T-05 | qa-unitario (fase 3) | Pruebas unitarias del §8. | `tests/unit/masterExcel.test.ts` (nuevo), `tests/unit/masterImport.test.ts` (nuevo) | — (contra la interfaz de §3 y §5) | ver §8 | sí |
| T-06 | qa-e2e (fase 3) | Specs de Playwright de UI y API, y un helper de instantánea de BD. | `tests/e2e/maestros-exportar.spec.ts` (nuevo), `tests/e2e/maestros-exportar-api.spec.ts` (nuevo), `tests/e2e/helpers/fotoMaestros.ts` (nuevo) | — | ver §8 | sí |
| T-07 | qa-e2e (fase 3) | Runner de volumen CA-19 (IMP-2), conectado a `e2e-api.mjs` justo después de `e2e-migracion-maestros.mjs` y antes de `resetTestDb` (`scripts/e2e-api.mjs:12-21`). | `scripts/e2e-exportar-volumen.mjs` (nuevo), `scripts/e2e-api.mjs` | T-02 y T-03 para quedar en verde (se escribe antes, en rojo) | CA-19 | sí |

**Contrato de pruebas (fijado por qa-unitario, fase 3; los dev deben respetarlo).** Lo no fijado arriba se eligió así:
- `src/lib/masterExcel.ts` (exports con nombre, imports `../../src/lib/masterExcel`): `MASTER_HEADERS` (6 textos, `as const`), `IMPORT_ROW_LIMIT`, `parseMasterRow(row: Record<string, unknown>): MasterImportRow | null` (la clave `ccNombre` solo existe si viene no vacía), `parseMasterWorkbook(wb: XLSX.WorkBook): MasterImportRow[]` (recibe el libro ya leído, no el buffer; solo lanza por MEN-6, no por "sin filas"), `buildTemplateWorkbook(): XLSX.WorkBook` (hoja `Plantilla`, fila de ejemplo `EMPRESA EJEMPLO SPA … Cuartel ejemplo`), `exportFileName(code: string, now: Date): string`, `importedSeasonCode(code: string): string` (como `toCode`: trim, mayúsculas, espacios a `_`, vacío a `N/A`), `nonImportableReasons(bundle, relation): string[]` (motivos en el orden de §5.1; `[]` si es exportable) y `buildMastersExport(bundle, seasonId, now: Date)`. `bundle` es el valor de `fetchMasterAdminData()`. Los nombres de las relaciones salen de `relation.*_name`; el estado activo, de los catálogos del bundle.
- Hojas: `Maestros`, `No importables`, `Temporada` (en ese orden); `Temporada` no se genera en `kind: 'empty'`.
- `server/masterImport.cjs`: `createCatalogResolver(conn, { audit, toCode })` usa `conn.execute(sql, params)` y devuelve `{ company, species, csg, variety }` (`variety(speciesId, name)`); tablas `companies`, `species`, `csg_catalog`, `varieties`. `buildRelationImportUpsert({ audit, withCenterName })` devuelve `{ sql, params(v) }` con `v = { seasonId, companyId, centerCode, centerName, speciesId, varietyId, csgId }` y `params` = esos 7 valores en ese orden (el `ON DUPLICATE KEY UPDATE` solo usa `VALUES()`, sin placeholders).
- `server/masterAudit.cjs`: `buildImportChangeCondition(cols)` recibe las mismas columnas que `buildImportAuditClause` (`{ col, expr, text? }`) y devuelve la condición unida con ` AND `.
- Las pruebas de `masterImport.test.ts` ya cubren `buildImportChangeCondition`/`buildImportAuditClause`; `masterAuditServer.test.ts` no se modificó.

Los archivos de prueba son **nuevos** a propósito: no se tocan `masterAudit.test.ts`, `permisos-*.spec.ts` ni `maestros-*.spec.ts` existentes, para no chocar con otros ciclos. La única excepción es `scripts/e2e-api.mjs` (ver §9).

## 8. Plan de pruebas

Niveles:
- **unit:** Vitest.
- **E2E-UI:** Playwright, proyectos `desktop` y `movil` (`playwright.config.ts`).
- **E2E-API:** spec de Playwright con `request` más instantánea directa de la BD (`tests/e2e/helpers/db.ts`). Es el patrón que ya usan los maestros (`maestros-auditoria-api.spec.ts`). `scripts/e2e-carga-trackeo.mjs` es para trackeo y no aplica.
- **Runner-API:** script Node con reinicio de BD, invocado desde `scripts/e2e-api.mjs`, con el mismo patrón que `scripts/e2e-migracion-maestros.mjs`. Lo usa solo CA-19.

Helper `fotoMaestros(conn)`: `SELECT * FROM <tabla> ORDER BY id` para las 7 tablas de maestros más `COUNT(*)` de `master_import_runs`. Compara todas las columnas, incluidas `updated_by` y `updated_at` (`DATETIME(3)`, `schema.sql:193`). Antes de reimportar se espera ≥100 ms (`pausa`) para que una escritura espuria se note en `updated_at`.

**Fixtures:** las pruebas que **editan** usan una temporada propia `E2E-EXP-<sfx>` (`isCurrent=false`) con relaciones creadas por API que apuntan a los catálogos de la semilla (ESMERALDA/"Agrícola Esmeralda", ARANDANO/"Arándano"), para no ensuciar `2025-2026`, que usan otros specs. CA-01 y CA-07 usan `2025-2026` tal como los escribe el requerimiento.

**Runner de volumen (`scripts/e2e-exportar-volumen.mjs`, IMP-2):**
1. `loadTestEnv` (guardián) → `resetTestDb` → arranca `server/index.cjs` en un puerto propio (como `e2e-migracion-maestros.mjs`).
2. Login de superadmin y alta de un admin por API. Como admin, `POST /api/master-data/import` de 5000 filas (CC `VOL-0001…5000`, catálogos de la semilla, `ccNombre` en la mitad) en la temporada `E2E-VOL` (`isCurrent=false`).
3. `GET /api/admin/masters` → `buildMastersExport` (cargado con `await import('../src/lib/masterExcel.ts')`; e2e-api lo invoca con `node --experimental-strip-types`, disponible en Node 22.6+, que es la versión del CI, `.github/workflows/ci.yml:36`) → `XLSX.write` a buffer → comprobar 5001 filas en `Maestros`.
4. Instantánea → `parseMasterWorkbook` del buffer → reimportar → `{ ok, received: 5000, applied: 5000 }` → instantánea idéntica y `master_import_runs` +1.
5. Apaga la API y ejecuta `resetTestDb`. Sale con un código ≠ 0 si algo falla.

| CA | Nivel | Archivo | Caso |
|---|---|---|---|
| CA-01 | unit | `tests/unit/masterExcel.test.ts` | Bundle de 2 temporadas: la hoja 1 tiene la fila 1 = `MASTER_HEADERS` (6 columnas), solo las relaciones de la temporada elegida y la fila CC01 con los valores esperados, incluido `NOMBRE CC`. |
| CA-01 | E2E-UI | `tests/e2e/maestros-exportar.spec.ts` | Admin → Carga desde Excel → `2025-2026` preseleccionada → descarga. Se lee con `xlsx`: los 6 encabezados, CC01 = (Agrícola Esmeralda, Cereza, Lapins, CC01, CSG001, Cuartel 1) y cantidad de filas = relaciones exportables de esa temporada según `GET /api/admin/masters` (2 en una BD recién creada), sin filas de otras temporadas. |
| CA-02 | unit | `masterExcel.test.ts` | La fila 1 de `buildTemplateWorkbook()` es igual a la fila 1 de la exportación. Ninguna celda de la exportación contiene "EMPRESA EJEMPLO SPA". |
| CA-02 | E2E-UI | `maestros-exportar.spec.ts` | Descargar la plantilla y la exportación, y comparar la fila 1 de ambas. |
| CA-03 | unit | `masterExcel.test.ts` | `exportFileName('2025-2026', new Date(2026,9,2,23,30))` → `maestros-2025-2026-2026-10-02.xlsx` (fecha local, a las 23:30). Con `a/b\c:d*e?f"g<h>i\|j` todos los caracteres se reemplazan por `_`. |
| CA-03 | E2E-UI | `maestros-exportar.spec.ts` | `download.suggestedFilename()` coincide con `^maestros-2025-2026-\d{4}-\d{2}-\d{2}\.xlsx$` y la fecha es la local del test. |
| CA-04 | unit | `masterExcel.test.ts` | Relación con CC `001` y CSG `00123`: `XLSX.write` → `XLSX.read` (con `cellNF: true`) → celdas con `t === 's'`, valor `"001"`/`"00123"` y `z === '@'` en CC, CSG y NOMBRE CC (MEN-7). `parseMasterWorkbook` devuelve `cc='001'` y `csg='00123'`. |
| CA-04 | E2E-UI | `maestros-exportar.spec.ts` | Temporada propia con CC `001` y CSG `00123` creada por API. En el archivo descargado, las celdas son tipo `s` y el parser de `src/lib/masterExcel.ts` devuelve los mismos valores. |
| CA-05 | unit | `masterExcel.test.ts` | Empresa `Agrícola Ñuble & Cía. 'Sur'` y valores que empiezan con `=`, `+`, `-` y `@`: tras escribir y leer, son idénticos, de tipo `s` y **sin** `cell.f`. |
| CA-06 | unit | `masterExcel.test.ts` | CC02 con relación inactiva y CC01 con variedad inactiva → ninguno en `Maestros`. En `No importables` aparecen con MOTIVO `Relación inactiva` / `Variedad inactiva` y los 6 encabezados más `MOTIVO`, y una combinación de 2 motivos queda unida por ", ". Sin no importables, la hoja trae solo los encabezados. |
| CA-06 | unit | `masterExcel.test.ts` | **MEN-6:** `parseMasterWorkbook` de un libro cuya primera hoja es `No importables`, o cuya fila 1 trae `MOTIVO`, lanza un error con el mensaje de §5.2. Un libro exportado normal (con `No importables` como hoja 2) se lee sin error y solo con las filas de `Maestros`. |
| CA-06 | E2E-API | `tests/e2e/maestros-exportar-api.spec.ts` | Temporada propia: inactivar por API una relación y la variedad de otra → exportar en la UI (descarga) → reimportar la hoja 1 → `fotoMaestros` idéntica: no se reactiva nada. |
| CA-07 | unit | `tests/unit/masterImport.test.ts` | Resolver con una conexión falsa: un nombre existente con código distinto (`ESMERALDA`) → `SELECT … WHERE name = ?` y luego `UPDATE … WHERE id = ?`, **sin** `INSERT` y sin `code` en el `SET`. Un nombre nuevo → `INSERT … ON DUP` y luego `SELECT … WHERE name = ? … LOCK IN SHARE MODE` (MEN-5; **no** por `code`). Si se repite el nombre, 0 consultas (caché). Variedad → búsqueda por `species_id` y `name` en ambos pasos. Un id inexistente → lanza `catalog_unresolved`. |
| CA-07 | unit | `masterImport.test.ts` | `buildRelationImportUpsert`: el `updated_by` aparece antes que `source`, y ambos antes que las columnas de negocio. `<C>` no menciona `source`. Con `withCenterName=false`, el UPDATE no asigna `center_name` y `<C>` no lo incluye. Con `audit=false`, no hay `updated_by` pero sí `source = IF(...)`. Los placeholders coinciden con `params`. También `buildImportChangeCondition` y que `buildImportAuditClause` mantiene la salida actual. |
| CA-07 | E2E-API | `maestros-exportar-api.spec.ts` | **Ida y vuelta por API (rojo hoy, con 500):** en `2025-2026` se agrega por API, como admin, una relación con `source='admin'` y `center_name`. Luego: `fotoMaestros` → exportar desde la UI → parsear la descarga con `parseMasterWorkbook` → `POST /api/master-data/import` con `{code:'2025-2026', name:'Temporada 2025-2026', isCurrent:true}` → `{ ok:true, received:n, applied:n }`. Las 7 tablas son idénticas y `master_import_runs` suma +1. |
| CA-07 | E2E-UI | `maestros-exportar.spec.ts` | **Ida y vuelta completa por UI:** exportar `2025-2026` → `setInputFiles` con el archivo descargado → código y nombre de la hoja `Temporada`, "actual" = Sí → "Importar maestros" → "Carga completada: n filas aplicadas de n." → `fotoMaestros` idéntica, con +1 en `master_import_runs`. |
| CA-08 | E2E-API | `maestros-exportar-api.spec.ts` | Temporada propia: exportar, cambiar con `xlsx` el CSG de CC01 a `CSG002` y reimportar. CC01 queda con `csg_id` de CSG002, `updated_by=NULL`, `source='excel'` y `center_name='Cuartel 1'`. CC02 queda idéntica a la instantánea. **Variantes P3/P13:** (a) se borra la columna NOMBRE CC y se reimporta, y (b) se dejan vacías las celdas de NOMBRE CC y se reimporta → en ambos casos `center_name` se conserva en todas las filas. |
| CA-09 | E2E-API | `maestros-exportar-api.spec.ts` | Agregar la fila (Agrícola Esmeralda, Cereza, Lapins, CC09, CSG001) y reimportar. Existe CC09 activa con `company_id` = id de ESMERALDA y el número de filas de `companies` no cambia. |
| CA-10 | E2E-API | `maestros-exportar-api.spec.ts` | Quitar la fila CC02 y reimportar: CC02 queda idéntica a la instantánea (estado, `updated_by` y `updated_at`). |
| CA-11 | unit | `masterExcel.test.ts` | Temporada sin relaciones y temporada con todas no exportables → `{ kind: 'empty', seasonCode }`. |
| CA-11 | E2E-UI | `maestros-exportar.spec.ts` | Temporada propia sin relaciones: al pulsar no hay evento `download` (espera acotada) y aparece "La temporada <código> no tiene relaciones activas para exportar." en `role="status"`. |
| CA-12 | E2E-UI | `maestros-exportar.spec.ts` | Con `page.route('**/api/admin/masters')` que responde arreglos vacíos: el botón queda deshabilitado, se muestra "No hay temporadas para exportar." y **no** aparece "Reintentar". |
| CA-13 | E2E-UI | `maestros-exportar.spec.ts` | (a) Con la pantalla cargada, `page.route` responde 500 (y en otra variante, `route.abort()`). Al pulsar no hay descarga, aparece "No se pudieron obtener los maestros. Intente nuevamente." en `role="status"` dentro de `#panel-maestros-excel` y el botón vuelve a estar habilitado. (b) Si la carga inicial falla: Exportar queda deshabilitado y aparece "Reintentar"; al quitar la ruta y pulsar "Reintentar", el selector se llena. |
| CA-14 | E2E-UI | `maestros-exportar.spec.ts` | `page.route` con una demora de 1 s: el botón muestra "Exportando..." y queda deshabilitado. Un doble clic produce **1** evento `download`. |
| CA-15 | E2E-UI | `maestros-exportar.spec.ts` | Operador: no ve "Maestros" en el menú y en `/#maestros/excel` no aparece el botón "Exportar maestros a Excel" ni el encabezado "Carga maestra desde Excel". Ya está cubierto también por `permisos-ui.spec.ts:27-33`. |
| CA-16 | E2E-API | `maestros-exportar-api.spec.ts` | `GET /api/admin/masters` con token de operador → 403 `forbidden`, y sin token → 401 `missing_token`. Ya está cubierto también por `permisos-api.spec.ts:9,34-39`. |
| CA-17 | E2E-UI | `maestros-exportar.spec.ts` | El superadmin repite CA-01 y el contenido de la hoja 1 es igual al del admin. |
| CA-18 | E2E-UI | `maestros-exportar.spec.ts` | En los proyectos `desktop` y `movil` (Pixel 7, P15), el selector y el botón son visibles (`toBeInViewport` después de `scrollIntoViewIfNeeded`), `scrollWidth <= clientWidth` en `documentElement` y la descarga funciona. |
| CA-19 | unit | `masterExcel.test.ts` | Bundle con 5000 relaciones activas → `rowCount=5000`, hoja con 5001 filas y `overImportLimit=false`. |
| CA-19 | Runner-API | `scripts/e2e-exportar-volumen.mjs` | Flujo de 5 pasos de arriba: 5000 filas → exportar con `buildMastersExport` → 5001 filas → reimportar → instantánea idéntica y +1 en `master_import_runs`. Con reinicio de BD antes y después. |
| CA-20 | unit | `masterExcel.test.ts` | 10001 relaciones → `overImportLimit=true`, `rowCount=10001`. 10000 → `false`. |
| CA-20 | E2E-UI | `maestros-exportar.spec.ts` | `page.route` con un bundle de 10001 relaciones activas: la descarga ocurre y aparece "El archivo tiene 10001 filas; la importación acepta hasta 10000 por carga.". |
| CA-21 | E2E-API | `maestros-exportar-api.spec.ts` | `fotoMaestros` (incluido `master_import_runs`) → exportar desde la UI `2025-2026` y una temporada propia → `fotoMaestros` idéntica. |
| CA-22 | unit | `masterExcel.test.ts` | Relación activa con `species_id` = Cereza y una variedad cuyo `species_id` en `bundle.varieties` es Arándano → no aparece en `Maestros` y sí en `No importables`, con MOTIVO `Variedad de otra especie`. Si además la variedad está inactiva, el MOTIVO queda `Variedad inactiva, Variedad de otra especie`. |
| CA-22 | E2E-API | `maestros-exportar-api.spec.ts` | Temporada propia: crear por API una variedad `VX-<sfx>` en Cereza y una relación Cereza/`VX-<sfx>`. Después, cambiar por API (`POST /api/admin/varieties` con `id` y `speciesId` = Arándano) la especie de la variedad. Exportar en la UI → la relación está en `No importables` con ese MOTIVO → reimportar la hoja 1 → `fotoMaestros` idéntica, y `VX-<sfx>` sigue en Arándano. |

Regresión: `maestros-auditoria-api.spec.ts` (CA-25, CA-26 y CA-28 de admin-maestros) y `maestros-excel.spec.ts` deben seguir en verde sin cambios.

## 9. Riesgos y rollback

**Conflictos de merge con `fix/esquema-y-errores-login`** (según su `diseno.md`, T-03, T-05, T-08 y T-09):
- **Bloque de `require` al inicio de `server/index.cjs`** (`:1-22`). Si ambos agregan un `require` en líneas contiguas, el conflicto es trivial: hay que conservar los dos.
- **Ruta de importación (MEN-4).**
  - Este diseño cambia `:1051-1101`: la cláusula `:1051-1063` y el bucle `:1064-1101`.
  - Ellos agregan `onRouteError` en el `catch` (`:1111-1117`).
  - Entre ambos hunks quedan **9 líneas sin cambios** (`:1102-1110`: línea en blanco, `INSERT` en `master_import_runs` `:1103-1108`, `commit` y `return`). Eso supera las 3 líneas de contexto que usa git, así que el merge de 3 vías los aplica por separado **siempre que ellos no editen esas 9 líneas**.
  - Si las editan (por ejemplo, para envolver el `commit`), el conflicto es local: hay que conservar nuestro bucle y su `catch`.
- **Funciones eliminadas.** Ellos quitan `:133-253` y `:676-685`, y nosotros `:512-558`. Son hunks separados (más de 250 líneas de distancia).
- **`scripts/e2e-api.mjs` (nuevo con IMP-2).** Su T-08 también agrega una llamada a un script justo después de `e2e-migracion-maestros.mjs` (`:12-19`). Es probable un conflicto trivial en ese bloque: hay que conservar las dos llamadas, una después de la otra, cada una con su `process.exit` si falla. Ambos scripts reinician la BD por su cuenta, así que el orden entre ellos no importa.
- **Rol ARIA en Maestros (IMP-3).** Su CA-16 (`tests/e2e/maestros-error-servidor.spec.ts`) busca `role="alert"` en Maestros. La exportación usa `role="status"` justamente para no duplicar alertas cuando el `GET` falla (§5.2). **Después del merge hay que correr `npx playwright test tests/e2e/maestros-error-servidor.spec.ts` (desktop y móvil)** además de `npm run test:all`.
- **Rutas sin conflicto:** `GET /api/admin/masters` (ellos agregan un reintento) no se toca aquí. Su reintento solo mejora la exportación.
- **Archivos sin conflicto:** `src/lib/masterDataApi.ts` y `database/schema.sql` no se tocan aquí.
- **Mensajes:** su nuevo `describeApiError` no cambia CA-13, porque la exportación usa un texto propio.
- **Recomendación:** quien integre segundo debe correr `npm run test:all` completo después del merge, más el spec anterior.

**Otros riesgos:**
- **Incoherencia especie/variedad ya existente en producción (IMP-1).** Las relaciones afectadas saldrán en "No importables" y no se podrán editar por Excel hasta corregirlas en Mantenimiento.
  - **En el plan de `/desplegar produccion`, antes de desplegar,** hay que correr esta consulta de solo lectura en producción e informar el resultado al usuario:
    ```sql
    SELECT COUNT(*) AS relaciones_incoherentes
    FROM season_cost_centers scc
    INNER JOIN varieties v ON v.id = scc.variety_id
    WHERE v.species_id <> scc.species_id;
    ```
    Lo mismo, con `GROUP BY scc.season_id`, da el detalle por temporada.
  - No bloquea el despliegue; solo sirve para anticipar cuántas filas irán a "No importables".
  - Validar la coherencia en `POST /api/admin/relations` es un hallazgo fuera de alcance (P16).
- **Otro renombrado por colisión de código (anterior al ciclo, P16).** Si un nombre **no existe** y `toCode(nombre)` coincide con el código de otra fila, el `INSERT … ON DUP` renombra esa fila (`index.cjs:520-529`, que se mueve sin cambios). La reimportación de un archivo exportado no pasa por ese camino, porque todos sus nombres existen y sus relaciones son coherentes.
- **P7 (homónimos):** queda mitigado para los que ya existen (§3.1). La deuda sigue solo al crear uno nuevo.
- **Reimportar sobre datos que cambiaron después de exportar:** gana la última escritura (especie, variedad o CSG). Es el comportamiento normal del upsert y se puede mitigar con el aviso de reimportar pronto. No se agrega bloqueo optimista porque ningún CA lo pide.
- **Doble GET al entrar a Maestros:** `MasterDataView` y `MastersAdminPanel` piden el mismo bundle. El costo es bajo, y compartirlo obligaría a tocar `MastersWorkspace`. Se acepta.
- **Rendimiento con 5000 a 10000 filas:** la caché del resolver deja ~1 sentencia por fila (el upsert de la relación) cuando los catálogos se repiten. Cuando no se repiten, quedan ≤9 por fila, igual que hoy. El body (≤8 MB, `index.cjs:792`) alcanza de sobra.
- **`LOCK IN SHARE MODE` en el respaldo:** toma bloqueos compartidos sobre las filas leídas hasta el `commit`. Solo ocurre en catálogos **nuevos** (pocos por carga) y dentro de la transacción que ya existe, así que el riesgo extra de esperas o deadlock entre importaciones simultáneas es bajo. Si hay deadlock, la importación hace rollback y responde 500 `db`, como hoy.
- **`z:'@'` en SheetJS 0.18.5 (edición comunitaria):** si el escritor no conservara el formato numérico, el unitario de CA-04 lo detectará. Igual las celdas siguen siendo tipo `s`, así que CA-04 no depende de `z`. En ese caso, MEN-7 se documenta como no aplicable y no se cambia de librería.
- **Runner con `--experimental-strip-types`:** depende de Node ≥22.6 (el CI usa la 22.x vigente). Si `masterExcel.ts` incorporara sintaxis no borrable, el runner fallaría. `erasableSyntaxOnly` en `tsconfig` ya lo impide en el typecheck.
- **Autoincremento:** `INSERT … ON DUP` sobre relaciones existentes consume ids de `AUTO_INCREMENT` sin modificar filas. No afecta a CA-07 (que compara filas) y ya ocurre hoy.
- **SheetJS 0.18.5:** tiene avisos de seguridad conocidos en la **lectura** de archivos no confiables. La exportación no agrega superficie de lectura nueva: el parser es el mismo que hoy, solo cambia de lugar.

**Rollback:**
- Basta revertir el merge de `feat/exportar-maestros-excel`, porque no hay DDL ni backfill.
- Los datos escritos con la importación nueva son válidos para la vieja. Después del revert, la importación vuelve a borrar `center_name`, a forzar `source='excel'` y a fallar con catálogos de código ≠ `toCode(nombre)`.
- El archivo exportado con `NOMBRE CC` sigue siendo importable con la versión vieja: la columna se ignora, pero `center_name` se pierde, como hoy.

## 10. Decisiones de la fase 2 (antes "Preguntas")

Todas quedaron resueltas por el Lead y están registradas en `requerimiento.md` §8:

| # | Tema | Decisión | Dónde |
|---|---|---|---|
| P12 | Columna `NOMBRE CC` | 6 columnas en la plantilla, la hoja principal y "No importables"; CA-01 y CA-06 actualizados. | §5.1, §8 |
| P13 | Celda `NOMBRE CC` vacía | Conserva el nombre vigente. | §3.2, §4, §5.2 |
| P14 | Temporadas inactivas | Se listan con " (inactiva)" y el aviso de reactivación. | §5.2 |
| P15 | Viewport móvil | Proyecto `movil` (Pixel 7) de la suite; CA-18 actualizado. | §8 |
| P16 | Hallazgos | El renombrado por colisión de código y la validación especie/variedad en `POST /api/admin/relations` quedan fuera de alcance. El Lead debe registrarlos en `estado.md`. | §9 |

## 11. Iteración 2: hallazgos de la revisión → resolución

| Hallazgo | Resolución | Secciones |
|---|---|---|
| IMP-1: relación con variedad de otra especie | Va a "No importables" con MOTIVO `Variedad de otra especie`. CA-22 nuevo en el requerimiento. Unitario y E2E-API (crear la relación y luego mover la variedad por API). La validación en `POST /api/admin/relations` queda fuera de alcance (hallazgo). Se agrega a §9 la consulta de conteo previa a producción. | §5.1, §6, §7 (T-01, T-03), §8 (CA-22), §9, req. CA-22 y P16 |
| IMP-2: CA-19 fuera de Playwright | Runner `scripts/e2e-exportar-volumen.mjs` con reinicio de BD, invocado desde `scripts/e2e-api.mjs` después de `e2e-migracion-maestros.mjs`. Se quita CA-19 del spec de Playwright. | §2, §6, §7 (T-07), §8, §9 |
| IMP-3: error de exportación y rol ARIA | Mensajes en `role="status"` dentro de `.master-export` (en `#panel-maestros-excel`), nunca `role="alert"`. Hay que correr `maestros-error-servidor.spec.ts` después del merge. | §5.2, §8 (CA-11, CA-13), §9 |
| MEN-4: líneas de T-02 y separación de hunks | Cláusula `:1051-1063`, bucle `:1064-1101`, `master_import_runs` `:1103-1108`, `catch` `:1111-1117`. Se reescribió el argumento: 9 líneas sin cambios contra 3 de contexto. | §2, §3.1, §7, §9 |
| MEN-5: respaldo del resolver | Después del `INSERT … ON DUP`, la búsqueda es por nombre con `LOCK IN SHARE MODE`, no por código. | §3.1, §7, §8 (CA-07 unit), §9 |
| MEN-6: archivo equivocado | `parseMasterWorkbook` rechaza, con un mensaje claro, una primera hoja `No importables` o con la columna `MOTIVO`. Prueba unitaria agregada. | §5.2, §7 (T-03), §8 (CA-06 unit) |
| MEN-7: formato texto | `z:'@'` en `CC`, `CSG` y `NOMBRE CC`. El unitario CA-04 lo verifica. | §5.1, §8 (CA-04), §9 |
| MEN-8: requerimiento y estados de la UI | Requerimiento: CA-01 y CA-06 a 6 columnas, CA-18 con el proyecto `movil`, la columna "Respuesta" completa (P1..P11 y P12..P16). Diseño: " (inactiva)" más el aviso, en lugar de "según la PREGUNTA 3"; estado propio de la exportación; "falló la carga" (con Reintentar) distinto de "sin temporadas" (CA-12, botón deshabilitado). | §5.2, §8 (CA-12, CA-13), §10, requerimiento |
| Riesgo: incoherencia ya existente en producción | Consulta de solo lectura con `COUNT` en el plan de producción, antes de desplegar. | §9 |
