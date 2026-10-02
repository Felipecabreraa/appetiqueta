# Exportar Maestros a Excel en el formato de la plantilla de importación

- **ID:** 20261002-exportar-maestros-excel
- **Tipo:** funcionalidad
- **Talla:** M (provisoria). Sube a **L** si se aprueban P3, P4 y P5, porque obligan a ajustar la importación para que el ciclo de exportar y reimportar no pierda datos.
- **Estado:** aprobado (compuerta 1, usuario, 2026-10-02: todas las preguntas con la opción recomendada; talla L)
- **Solicitado por:** usuario (luis.lagos@trn.cl), 2026-10-02. La pidió como "exportar los módulos a Excel". Alcance acordado: solo Maestros, mismo formato que la plantilla de importación y ciclo aparte del de admin-maestros.

## 1. Contexto y problema

Hoy los maestros se pueden **importar** desde Excel y **mantener en pantalla**, pero no se pueden **exportar**. Para corregir muchas relaciones Empresa → CC → {Especie, Variedad, CSG} de una vez, el admin tiene que armar el Excel a mano desde cero.

### 1.1 Qué existe hoy (evidencia)

| Tema | Comportamiento actual | Evidencia |
|---|---|---|
| Plantilla descargable | Libro con **una hoja `Plantilla`**, encabezados en MAYÚSCULAS y en este orden: `EMPRESA, ESPECIE, VARIEDAD, CC, CSG`, más una fila de ejemplo. Nombre fijo: `plantilla-maestros-etiquetado.xlsx`. La generación ocurre en el cliente con `xlsx` (SheetJS ^0.18.5). | `src/components/MasterDataView.tsx:48-61`, `package.json:43` |
| Texto de ayuda | La pantalla muestra "Columnas esperadas: empresa, cc, especie, variedad, csg", que no sigue el orden de la plantilla. | `src/components/MasterDataView.tsx:118` |
| Lectura del Excel (cliente) | Lee **solo la primera hoja** y **ignora las columnas que no reconoce**. Encabezados aceptados: `empresa/Empresa/EMPRESA`, `cc/CC/centro_costo/CentroCosto/centroCosto`, `especie/Especie/ESPECIE`, `variedad/Variedad/VARIEDAD`, `csg/CSG`. Aplica `trim()` a cada valor y **descarta en silencio** las filas a las que les falta alguno de los 5 campos. | `src/components/MasterDataView.tsx:13-34, 65-87` |
| Temporada de la importación | **No viene en el archivo.** El usuario escribe código y nombre en el formulario, y el selector "Marcar como temporada actual" trae **"Sí" por defecto**. | `src/components/MasterDataView.tsx:37-39, 120-156` |
| Payload enviado | `{ season: { code, name, isCurrent }, rows: [{ empresa, cc, especie, variedad, csg }] }`. No incluye `ccNombre`. | `src/lib/masterDataApi.ts:48-55` |
| API de importación | `POST /api/master-data/import`, para admin y superadmin (`ACCESS.MASTER_ADMIN`). Exige al menos 1 fila (`rows_required`) y acepta como máximo 10000 (`rows_too_large`). El body admite hasta 8 MB. Corre todo en una transacción y registra la ejecución en `master_import_runs`. | `server/index.cjs:1033-1118`, `:39`, `:792` |
| Resolución de catálogos | Empresa, especie y CSG se insertan con `code = toCode(nombre)` (MAYÚSCULAS, espacios → `_`) y luego se busca el id **por ese código**. La variedad sigue el mismo criterio, con el código global. La temporada usa `toCode(código escrito)`. | `server/index.cjs:71-76, 512-533, 535-558, 560-591` |
| Efectos laterales de la importación | Fuerza `is_active = 1` en la temporada, la empresa, la especie, la variedad, el CSG y la relación. Fija `source = 'excel'` en la relación. **Sobrescribe `center_name` con `ccNombre`**, que el cliente nunca envía, así que queda `''`. | `server/index.cjs:1068-1096`, `:1094` |
| Auditoría en la importación | `updated_by` pasa a `NULL` **solo si** cambió alguna columna comparada (nombre, is_active, source, center_name…). Si nada cambió, la fila queda intacta. `updated_at` usa `ON UPDATE CURRENT_TIMESTAMP` y solo se mueve si la fila cambia. | `server/masterAudit.cjs` (`buildImportAuditClause`), `database/schema.sql:69,90,108,127,149,193`; decisión P2 de admin-maestros (`docs/specs/20261002-admin-maestros/requerimiento.md:366`, CA-26) |
| Alta manual de relaciones | Las relaciones creadas en "Mantenimiento en pantalla" quedan con `source = 'admin'` y pueden llevar `center_name`. | `server/index.cjs:1306-1346` (`:1345`) |
| Datos disponibles | `GET /api/admin/masters` (admin y superadmin) devuelve todas las temporadas, catálogos y relaciones, **activos e inactivos**. Cada relación trae `season_code`, `company_name`, `center_code`, `center_name`, `species_name`, `variety_name`, `csg_name`, `is_active` y la auditoría. `GET /api/master-data/catalog` devuelve solo relaciones activas y únicamente por empresa, así que no sirve para exportar. | `server/index.cjs:606-678, 1121-1135, 959-1013` |
| Permisos | Maestros es visible para superadmin y admin. El operador no lo ve. | `src/lib/roleAccess.ts:4-8`, `server/index.cjs:35-40` |
| Ubicación | Maestros tiene dos sub-pestañas: "Carga desde Excel" (`#maestros/excel`) y "Mantenimiento en pantalla" (`#maestros/admin`). | `src/components/MastersWorkspace.tsx:12-53`, `src/appTabs.ts:4` |
| Patrón de export existente | `exportTrackingsExcel` arma el libro en el cliente con encabezados en orden fijo (para que SheetJS no omita columnas) y nombra el archivo `trackeos-jc-acopio-AAAA-MM-DD.xlsx`. | `src/lib/exportTrackingsExcel.ts:14-50, 128-129` |

### 1.2 Brechas que hoy impiden la "ida y vuelta sin pérdida"

Las deduje leyendo el código. No ejecuté nada; QA debe confirmarlas con una prueba en la fase 3.

1. **El nombre del CC se pierde.** Una relación con `center_name = 'Cuartel 1'` (semilla: `database/seed.test.sql:13-16`) queda con `center_name = ''` al reimportarse, y su `updated_by` pasa a `NULL` (`server/index.cjs:1094`).
2. **El origen cambia.** Una relación con `source = 'admin'` pasa a `'excel'` al reimportarse. Como `source` está entre las columnas que se comparan (`server/index.cjs:1068-1078`), la fila se considera modificada y su `updated_by` pasa a `NULL`, aunque el usuario no haya cambiado nada.
3. **Se reactivan registros.** Cualquier registro inactivo que venga en el archivo vuelve a quedar activo, sea relación, empresa, especie, variedad, CSG o temporada.
4. **Fallan los catálogos cuyo código no coincide con `toCode(nombre)`.** Ejemplo de la semilla: empresa `code='ESMERALDA'`, `name='Agrícola Esmeralda'` (`database/seed.test.sql:5`). La importación intenta `INSERT (code='AGRÍCOLA_ESMERALDA', name='Agrícola Esmeralda')`, choca con `uq_companies_name`, actualiza la fila existente y luego busca `WHERE code='AGRÍCOLA_ESMERALDA'`, que no encuentra nada. El id queda `undefined`, el INSERT de la relación falla y **toda la importación hace rollback con 500 `db`** (`server/index.cjs:512-533`). Lo mismo pasa con la especie `ARANDANO`/`Arándano` (`database/seed.test.sql:6`). Cualquier catálogo creado a mano en Mantenimiento con un código propio queda expuesto a este fallo.
5. **La temporada sale del formulario, no del archivo.** Si el usuario reimporta una temporada pasada sin cambiar "Marcar como temporada actual" (que viene en "Sí"), esa temporada pasa a ser la actual y la vigente deja de serlo (`server/index.cjs:560-591`). Si escribe un nombre distinto, el nombre de la temporada cambia.
6. **Variedades homónimas.** El código de variedad es global (`uq_varieties_code`, `database/schema.sql:131`), pero el nombre es único solo por especie (`:132`). Dos variedades con el mismo nombre en especies distintas comparten `toCode(nombre)`, y la importación reasigna `species_id` (`server/index.cjs:535-558`).

## 2. Objetivo

Que admin y superadmin descarguen en un clic los maestros de una temporada en el **mismo formato de la plantilla de importación**, los editen en Excel y los vuelvan a importar. Medida de éxito: exportar una temporada y reimportar el archivo **sin cambios**, con el mismo código, nombre y estado "actual" de la temporada, deja **0 filas modificadas** en las 7 tablas de maestros (mismos valores, mismo `updated_by` y mismo `updated_at`). La única fila nueva es la de `master_import_runs`.

## 3. Historias de usuario

- **HU-01 (exportar):** Como **admin o superadmin**, quiero descargar en Excel las relaciones Empresa → CC → Especie/Variedad/CSG de una temporada con las mismas columnas de la plantilla de importación, para revisarlas o corregirlas en bloque sin armar el archivo a mano.
- **HU-02 (ida y vuelta):** Como **admin o superadmin**, quiero reimportar el archivo exportado (editado o no) y que solo cambie lo que modifiqué, para no perder datos ni ensuciar la auditoría de registros que no toqué.
- **HU-03 (permisos):** Como **responsable del sistema**, quiero que el operador no pueda exportar los maestros, para mantener el acceso a Maestros que ya existe.

## 4. Criterios de aceptación

Notación:
- **"Archivo exportado"** es el `.xlsx` que genera esta funcionalidad.
- **"Hoja principal"** es la primera hoja del libro, la única que lee la importación (`MasterDataView.tsx:71`).
- **Fixture base:** semilla de pruebas `database/seed.test.sql`, con la temporada `2025-2026` (actual), las relaciones `CC01` y `CC02` de "Agrícola Esmeralda" y los nombres de CC "Cuartel 1" y "Cuartel 2".
- Los CA marcados con (P*n*) dependen de la respuesta a esa pregunta abierta. Están escritos con la opción recomendada.

```gherkin
# CA-01 — Camino feliz: exportar la temporada seleccionada  [HU-01]
Dado un usuario admin con sesión iniciada en Maestros → "Carga desde Excel"
  Y la temporada "2025-2026" seleccionada en el selector de exportación
Cuando pulsa "Exportar maestros a Excel"
Entonces el navegador descarga un archivo .xlsx
  Y la hoja principal tiene exactamente los encabezados EMPRESA, ESPECIE, VARIEDAD, CC, CSG, en ese orden y en la fila 1
  Y la hoja principal tiene una fila por cada relación activa de esa temporada (2 filas en el fixture base)
  Y la fila de CC01 contiene EMPRESA="Agrícola Esmeralda", ESPECIE="Cereza", VARIEDAD="Lapins", CC="CC01", CSG="CSG001"
  Y no contiene relaciones de otras temporadas

# CA-02 — Mismo formato que la plantilla  [HU-01]
Dado el archivo de "Descargar plantilla Excel" y un archivo exportado
Cuando se comparan las filas 1 de sus hojas principales
Entonces los encabezados son idénticos en texto y orden
  Y el archivo exportado no contiene la fila de ejemplo "EMPRESA EJEMPLO SPA"

# CA-03 — Nombre del archivo  [HU-01] (P1)
Dado que hoy es 2026-10-02 y se exporta la temporada de código "2025-2026"
Cuando termina la descarga
Entonces el archivo se llama "maestros-2025-2026-2026-10-02.xlsx"
  Y los caracteres no válidos para nombres de archivo del código de temporada (/ \ : * ? " < > |) se reemplazan por "_"

# CA-04 — Valores como texto (sin perder ceros a la izquierda)  [HU-01, HU-02]
Dada una relación activa con CC="001" y CSG="00123"
Cuando se exporta y se abre la hoja principal
Entonces las celdas CC y CSG son de tipo texto con los valores "001" y "00123"
  Y al leer el archivo con el parser de importación se obtienen cc="001" y csg="00123"

# CA-05 — Tildes, ñ y caracteres especiales  [HU-01, HU-02]
Dada una empresa llamada "Agrícola Ñuble & Cía. 'Sur'" con una relación activa
Cuando se exporta y el archivo se lee con el parser de importación
Entonces EMPRESA vale exactamente "Agrícola Ñuble & Cía. 'Sur'"
  Y un valor que empieza con "=", "+", "-" o "@" se guarda como texto literal y no como fórmula

# CA-06 — Registros inactivos  [HU-01, HU-02] (P2)
Dada la temporada "2025-2026" con la relación CC02 inactiva
  Y la relación CC01 activa, pero con la variedad "Lapins" inactiva
Cuando se exporta la temporada
Entonces la hoja principal contiene solo las relaciones cuyos registros están todos activos (relación, empresa, especie, variedad y CSG)
  Y CC01 y CC02 no aparecen en la hoja principal
  Y una segunda hoja "No importables" lista CC01 y CC02 con las mismas 5 columnas más la columna "MOTIVO" ("Relación inactiva" / "Variedad inactiva")
  Y reimportar el archivo no reactiva ningún registro

# CA-07 — Reimportar sin cambios no altera nada  [HU-02] (P3, P4, P5)
Dada la temporada "2025-2026" exportada, con relaciones creadas por importación y en Mantenimiento (source "excel" y "admin"), con nombre de CC y con catálogos cuyo código difiere de su nombre en mayúsculas (empresa ESMERALDA/"Agrícola Esmeralda", especie ARANDANO/"Arándano")
  Y se guarda una instantánea de las 7 tablas de maestros (todas las columnas, incluidos updated_by y updated_at)
Cuando se importa el archivo exportado sin editarlo, con código "2025-2026", nombre "Temporada 2025-2026" y "Marcar como temporada actual" = Sí
Entonces la respuesta es { ok: true, received: 2, applied: 2 }
  Y las 7 tablas son idénticas a la instantánea, columna por columna
  Y solo se agrega 1 fila en master_import_runs

# CA-08 — Reimportar con una edición cambia solo esa fila  [HU-02]
Dado el archivo exportado de "2025-2026"
Cuando el usuario cambia el CSG de CC01 a "CSG002" y lo importa
Entonces la relación CC01 queda con CSG "CSG002" y updated_by = NULL (regla P2 de admin-maestros)
  Y la relación CC02 queda idéntica a la instantánea, incluidos updated_by y updated_at
  Y center_name de CC01 sigue siendo "Cuartel 1" (P3)

# CA-09 — Agregar una fila en el archivo crea la relación  [HU-02]
Dado el archivo exportado
Cuando el usuario agrega la fila EMPRESA="Agrícola Esmeralda", ESPECIE="Cereza", VARIEDAD="Lapins", CC="CC09", CSG="CSG001" y lo importa
Entonces existe una relación activa CC09 en la temporada indicada y asociada a la empresa existente ESMERALDA (no se crea una empresa nueva) (P5)

# CA-10 — Borrar una fila del archivo no borra ni desactiva  [HU-02]
Dado el archivo exportado
Cuando el usuario elimina la fila de CC02 y lo importa
Entonces la relación CC02 sigue existiendo, con el mismo estado y la misma auditoría que tenía

# CA-11 — Temporada sin relaciones exportables  [HU-01]
Dada una temporada sin relaciones exportables (sin relaciones, o con todas inactivas)
Cuando el usuario pulsa "Exportar maestros a Excel"
Entonces no se descarga ningún archivo
  Y se muestra el mensaje "La temporada <código> no tiene relaciones activas para exportar."

# CA-12 — Sin temporadas  [HU-01]
Dado que no existe ninguna temporada
Cuando el usuario entra a "Carga desde Excel"
Entonces el botón "Exportar maestros a Excel" está deshabilitado
  Y se muestra el texto "No hay temporadas para exportar."

# CA-13 — Error al obtener los datos  [HU-01]
Dado que GET /api/admin/masters responde 500 o no hay conexión
Cuando el usuario pulsa "Exportar maestros a Excel"
Entonces no se descarga ningún archivo
  Y se muestra el mensaje "No se pudieron obtener los maestros. Intente nuevamente."
  Y el botón vuelve a quedar habilitado

# CA-14 — Estado ocupado  [HU-01]
Dado que la exportación está en curso
Entonces el botón muestra "Exportando..." y está deshabilitado
  Y un segundo clic no genera una segunda descarga

# CA-15 — Operador no puede exportar (UI)  [HU-03]
Dado un usuario operador con sesión iniciada
Entonces no ve el módulo Maestros ni el botón "Exportar maestros a Excel"
  Y al navegar a "#maestros/excel" no se muestra el panel de Maestros

# CA-16 — Operador no puede exportar (API)  [HU-03]
Dado un token de operador
Cuando llama a la(s) ruta(s) que usa la exportación (hoy GET /api/admin/masters)
Entonces recibe 403 { ok: false, error: "forbidden" }
  Y sin token recibe 401 { ok: false, error: "missing_token" } (server/index.cjs:308, :335)

# CA-17 — Superadmin puede exportar  [HU-01]
Dado un usuario superadmin
Cuando repite CA-01
Entonces obtiene el mismo archivo que el admin

# CA-18 — Desktop y móvil  [HU-01]
Dado el viewport de escritorio (1280x800) y el móvil (390x844) de la suite E2E
Cuando el admin abre "Carga desde Excel"
Entonces el selector de temporada y el botón "Exportar maestros a Excel" son visibles sin scroll horizontal
  Y el botón es operable y dispara la descarga en ambos viewports

# CA-19 — Volumen grande  [HU-01, HU-02]
Dada una temporada con 5000 relaciones activas
Cuando el admin exporta
Entonces la hoja principal tiene 5000 filas de datos más 1 de encabezados
  Y reimportar ese archivo sin cambios cumple CA-07

# CA-20 — Más relaciones que el límite de importación  [HU-02] (P8)
Dada una temporada con más de 10000 relaciones exportables
Cuando el admin exporta
Entonces el archivo se descarga completo
  Y se muestra el aviso "El archivo tiene <n> filas; la importación acepta hasta 10000 por carga."

# CA-21 — La exportación no escribe en la BD  [HU-01]
Dada una instantánea de las 7 tablas de maestros y de master_import_runs
Cuando el admin exporta cualquier temporada
Entonces todas las tablas quedan idénticas a la instantánea
```

## 5. Reglas de negocio

- **RN-01:** La hoja principal del archivo exportado tiene el formato de la plantilla de importación: encabezados `EMPRESA, ESPECIE, VARIEDAD, CC, CSG` en ese orden y una fila por relación (`season_cost_centers`). Cualquier columna u hoja adicional debe ser ignorable por la importación actual (solo lee la primera hoja y descarta los encabezados que no conoce).
- **RN-02:** Las columnas EMPRESA, ESPECIE, VARIEDAD y CSG llevan el **nombre** (`name`) del catálogo, no su código, porque la importación resuelve por nombre. CC lleva `center_code`.
- **RN-03:** Un archivo exportado corresponde a **una sola temporada** (P1). La importación aplica todas las filas a la temporada del formulario, así que mezclar temporadas en la hoja principal las fusionaría en una sola.
- **RN-04:** Exportar es solo lectura: no escribe en ninguna tabla.
- **RN-05:** Solo admin y superadmin pueden exportar (los mismos roles de `ACCESS.MASTER_ADMIN` y de la pestaña `maestros` en `roleAccess.ts`). El permiso se valida en la UI y en la API.
- **RN-06:** Reimportar sin cambios el archivo exportado, con los mismos datos de temporada, no modifica ninguna fila de maestros (valores, `updated_by`, `updated_at`). Esta regla extiende a la importación la decisión P4 de admin-maestros ("guardar sin cambios no audita").
- **RN-07:** La importación sigue sin borrar ni desactivar nada. Si una fila no viene en el archivo, el registro queda como está.
- **RN-08:** Los valores se escriben como celdas de texto, sin espacios al inicio ni al final y sin interpretarse como número, fecha o fórmula.
- **RN-09:** La auditoría (`created_by`, `updated_by`, fechas) no va en la hoja principal (P6).

## 6. Casos borde

- **Catálogos sin relación:** las empresas, especies, variedades o CSG que no participan en ninguna relación de la temporada no se pueden expresar en el formato de la plantilla, porque cada fila exige los 5 campos (`MasterDataView.tsx:30`). No aparecen en el archivo.
- **Jefes de cuadrilla (`jc_foremen`):** no forman parte de la plantilla ni de la importación. No se exportan (ver Fuera de alcance).
- **Nombre de CC (`center_name`):** no tiene columna en la plantilla. Ver P3.
- **Relación activa con un padre inactivo:** por ejemplo, una relación activa con la empresa inactiva. Reimportarla reactivaría el padre. Ver P2.
- **Variedades homónimas en especies distintas:** reimportar puede reasignar la especie de la variedad (brecha 6). Es un comportamiento previo de la importación. Ver P7.
- **Código de temporada con espacios o minúsculas** (creado en Mantenimiento, `server/index.cjs:1144`): la importación aplica `toCode`. Si el usuario escribe ese código en el formulario, se crea otra temporada (`2026 sur` pasa a `2026_SUR`). Queda documentado en el aviso de P1.
- **Edición posterior en Excel:** si el usuario escribe a mano "001" en una celda con formato General, Excel la convierte en 1. Escapa a nuestro control. El archivo exportado solo garantiza texto en las celdas que genera (CA-04).
- **Filas duplicadas que agrega el usuario:** si dos filas comparten empresa y CC, la importación aplica la última (comportamiento actual, upsert por `uq_season_company_center`).
- **Textos largos:** los nombres llegan hasta 180 caracteres y `center_code` hasta 80. Están muy por debajo del límite de celda de Excel (32767).
- **Valores con `=`, `+`, `-` o `@` al inicio:** se escriben como texto literal (CA-05).
- **Orden de filas:** el mismo de `GET /api/admin/masters` (empresa y luego CC), estable entre exportaciones para que se puedan comparar con un diff.
- **Sesión vencida durante la exportación:** aplica el manejo actual de 401 de `apiFetch`. No se descarga nada.

## 7. Fuera de alcance

- Exportar Dashboard, Generar, Trazabilidad (ya tiene su propio export) y Usuarios.
- Exportar jefes de cuadrilla o catálogos sueltos (sin relación) a Excel, e importarlos.
- Que la importación borre o desactive los registros que no vienen en el archivo (sincronización completa).
- Exportar varias temporadas en un mismo archivo reimportable.
- Formatos distintos de `.xlsx` (CSV, PDF).
- Cambiar el límite de 10000 filas por importación.
- Corregir la deuda de variedades homónimas (brecha 6), salvo que P7 diga lo contrario.

## 8. Preguntas abiertas

| # | Pregunta | Opción recomendada | Respuesta |
|---|---|---|---|
| P1 | ¿Qué temporada(s) se exportan? La importación no lee la temporada del archivo: la toma del formulario (`MasterDataView.tsx:120-156`). | **Una temporada por archivo**, elegida en un selector junto al botón y con la temporada actual preseleccionada. El código de la temporada va en el nombre del archivo (`maestros-<código>-<AAAA-MM-DD>.xlsx`) y en una hoja informativa "Temporada" (código, nombre y si es actual), que la importación ignora. Junto al botón se muestra el aviso: "Para reimportar, use el mismo código y nombre de temporada". Alternativa descartada: todas las temporadas en un archivo, que al reimportarse se fusionarían en una sola (RN-03). | _pendiente_ |
| P2 | La plantilla no tiene columna de estado. ¿Se exportan las relaciones inactivas y las que tienen un padre inactivo? Hoy la importación reactiva todo lo que recibe (`server/index.cjs:1088`). | **La hoja principal lleva solo las relaciones "totalmente activas"** (relación, empresa, especie, variedad y CSG activos), para que reimportar no reactive nada. Las demás van en una segunda hoja "No importables" con una columna `MOTIVO`. La importación la ignora porque solo lee la primera hoja. Para reactivar algo, el usuario copia la fila a la hoja principal o usa Mantenimiento. Alternativa: agregar una columna `ESTADO` a la plantilla, lo que cambia el formato y obliga a tocar la importación. | _pendiente_ |
| P3 | El nombre del CC (`center_name`) no está en la plantilla, y la importación lo **sobrescribe con vacío** (`server/index.cjs:1094`). Reimportar borraría "Cuartel 1". ¿Cómo lo resolvemos? | **Que la importación no toque `center_name` cuando el archivo no trae esa columna.** Es un ajuste en la importación, y su forma la define el arquitecto. Opcionalmente se puede agregar una columna `NOMBRE CC` al final de la hoja principal: si la columna viene, se aplica, y si no viene, se conserva el valor. Recomiendo agregar la columna, porque es un dato que el usuario ve y edita en Mantenimiento. Sin este ajuste, CA-07 no se puede cumplir. | _pendiente_ |
| P4 | La importación fija `source = 'excel'`. Una relación creada en Mantenimiento (`source = 'admin'`) se considera "modificada" al reimportarse y pierde su `updated_by` aunque nada haya cambiado. ¿Se acepta? | **No se acepta.** Si los datos de negocio (CC, nombre de CC, especie, variedad, CSG, estado) no cambian, la importación no debe modificar `source` ni la auditoría. Si sí cambian, `source` pasa a `'excel'` y `updated_by` a NULL, como hoy (P2 de admin-maestros). Requiere ajustar la importación. | _pendiente_ |
| P5 | Si el código de un catálogo no coincide con `toCode(nombre)` (por ejemplo, empresa ESMERALDA/"Agrícola Esmeralda", especie ARANDANO/"Arándano"), la importación **falla con 500 y rollback** (brecha 4). Por eso hoy el archivo exportado no siempre se podría reimportar. ¿Se corrige en este ciclo? | **Sí, es prerrequisito.** La importación debe reutilizar el registro existente que tenga el mismo nombre (sin distinguir mayúsculas, según la intercalación de la BD) antes de crear uno nuevo, y nunca cambiar su código. El arquitecto define cómo. Sin esto, CA-07 y CA-09 fallan con los datos de la semilla y quizás con los de producción. | _pendiente_ |
| P6 | ¿Incluimos la auditoría (quién creó o modificó y cuándo) en el archivo? | **No en este ciclo.** Ya se ve en Mantenimiento y agregarla obliga a definir el formato de nombres y fechas. Si el usuario la quiere, debe ir en una hoja aparte "Auditoría" y nunca en la hoja principal (RN-09). | _pendiente_ |
| P7 | Las variedades con el mismo nombre en especies distintas comparten código, y la importación puede moverlas de especie (brecha 6). ¿Se corrige aquí? | **No.** Es un comportamiento previo, no lo provoca la exportación. Se registra como hallazgo fuera de alcance en `estado.md`, y CA-07 se prueba sin homónimos. Si en producción existen homónimos, hay que priorizarlo aparte. | _pendiente_ |
| P8 | Si una temporada tiene más de 10000 relaciones exportables, el archivo no se puede reimportar en una sola carga (`rows_too_large`). ¿Qué hacemos? | **Exportar igual y mostrar un aviso** (CA-20). Hoy no hay temporadas de ese tamaño. Dividir el archivo agrega complejidad sin un caso real. | _pendiente_ |
| P9 | ¿Dónde va el botón? | **En "Carga desde Excel"**, junto a "Descargar plantilla Excel", como "Exportar maestros a Excel" con su selector de temporada. Así quedan agrupadas la plantilla, la exportación y la importación. No se duplica en Mantenimiento. | _pendiente_ |
| P10 | La importación pone "Marcar como temporada actual = Sí" por defecto. Al reimportar una temporada pasada, puede volverla actual sin que el usuario lo note (brecha 5). ¿Se cambia en este ciclo? | **Mínimo: el aviso de P1** también indica si la temporada exportada era la actual. Cambiar el valor por defecto del formulario o completarlo desde la hoja "Temporada" es una mejora de la importación que dejaría fuera, salvo que el usuario la pida. | _pendiente_ |
| P11 | El texto "Columnas esperadas: empresa, cc, especie, variedad, csg" (`MasterDataView.tsx:118`) no sigue el orden de la plantilla (`EMPRESA, ESPECIE, VARIEDAD, CC, CSG`). ¿Lo alineamos? | **Sí**: cambiar el texto al orden de la plantilla (y agregar `NOMBRE CC` si se aprueba P3). Es un cambio de una línea y evita confusiones al editar el archivo exportado. | _pendiente_ |
