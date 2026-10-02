# Admin gestiona los maestros del sistema (sin Usuarios)

- **ID:** 20261002-admin-maestros
- **Tipo:** funcionalidad (cambio de permisos API + UI)
- **Talla:** L (antes M; sube al incluir la auditoría por registro, P1)
- **Estado:** **aprobado (base: HU-01..HU-05, CA-01..CA-16, RN-01..RN-07)** + **aprobado (auditoría: HU-06, CA-17..CA-27, RN-08..RN-15)**. Compuerta 1 aprobada por el usuario el 2026-10-02.
- **Solicitado por:** usuario (luis.lagos@trn.cl), 2026-10-02. Texto: "Necesito que el admin pueda completar y editar los maestros del sistema, es parte de su rol, excepto de los usuarios."
- **Iteración 2 (2026-10-02):** el usuario aprobó la base y respondió P1: sí se incluye la auditoría por registro (decisiones A1, A2 y A3, en la sección 8).
- **Fase de diseño (2026-10-02):** se agregó **CA-28** para formalizar en Gherkin la decisión P4 del usuario (guardar sin cambios no audita) y **CA-29** para P3 (D2 del Lead). Se precisó CA-27 (D3). D1 (usuario): el estado desactivado se muestra como **"Inactivo"** (antes "Archivado"), así que CA-05 queda tal cual. No cambia el alcance aprobado.

## 1. Contexto y problema

Hoy solo el `superadmin` puede mantener los maestros: temporadas, empresas, especies, CSG, capataces JC (jefes de cuadrilla), variedades y relaciones Empresa → CC → {Especie, Variedad, CSG} por temporada. Tampoco puede importar el Excel de maestros sin él. El `admin` opera a diario (Resumen, Crear etiquetas, Registrar lecturas, Excel de trackeo), pero cada vez que falta un CC, un CSG o un jefe de cuadrilla tiene que pedírselo al superadmin. Según el usuario, mantener los maestros es parte del rol admin.

### Comportamiento actual (evidencia)

**Backend (`server/index.cjs`)**
- `ACCESS.MASTER_ADMIN = [ROLE.SUPERADMIN]` (`server/index.cjs:28`). `requireRoles` responde `403 { ok:false, error:'forbidden' }` cuando el rol no está permitido (`server/index.cjs:320-328`).
- Rutas protegidas por `ACCESS.MASTER_ADMIN`:
  | Ruta | Línea |
  |---|---|
  | `POST /api/master-data/import` (Excel) | `server/index.cjs:967-969` |
  | `GET /api/admin/masters` | `server/index.cjs:1040-1042` |
  | `POST /api/admin/seasons` | `server/index.cjs:1056-1058` |
  | `POST /api/admin/companies` | `server/index.cjs:1104-1106` |
  | `POST /api/admin/species` | `server/index.cjs:1138-1140` |
  | `POST /api/admin/csg` | `server/index.cjs:1172-1174` |
  | `POST /api/admin/jc-foremen` | `server/index.cjs:1206-1208` |
  | `POST /api/admin/varieties` | `server/index.cjs:1240-1242` |
  | `POST /api/admin/relations` | `server/index.cjs:1277-1279` |
- Todos los `POST /api/admin/<maestro>` crean el registro si no reciben `id` y lo actualizan si lo reciben. Cada uno acepta `isActive`, así que activar o desactivar ya es parte de "editar" (por ejemplo, `server/index.cjs:1061-1069` y `1116-1123`). No existe ninguna ruta DELETE de maestros.
- Usuarios: `GET/POST /api/admin/users` y `POST /api/admin/users/:id/password` usan `requireRoles(ROLE.SUPERADMIN)` directamente (`server/index.cjs:817`, `833`, `860`). No pasan por `MASTER_ADMIN`.
- El rol se resuelve **en cada request** desde la BD (JOIN `auth_sessions` → `users` → `roles`, `server/index.cjs:269-276`). Un cambio de permisos en el servidor se aplica a las sesiones abiertas sin volver a iniciar sesión.
- Auditoría: la importación Excel registra quién la hizo en `master_import_runs.imported_by` (`server/index.cjs:1021-1025`, `database/schema.sql:182-192`). Las ediciones individuales de maestros **no** guardan autor ni fecha de modificación.

**Frontend**
- `src/lib/roleAccess.ts:4-8`: `ROLE_TABS.admin = ['dashboard','generar','trazabilidad']`. No incluye `maestros` ni `usuarios`.
- `src/App.tsx:104`: `const canManageMasters = role === 'superadmin'` es un **segundo chequeo**, independiente de `roleAccess`. Se pasa como `canManage` a `MastersWorkspace` (`src/App.tsx:499-504`) → `MastersAdminPanel` (`src/components/MastersWorkspace.tsx:50`).
- `src/components/MastersAdminPanel.tsx:288-290` solo carga datos si `canManage` es verdadero. En `:356-362`, si es falso, muestra "Sin permisos para editar maestros. Solo Super Admin puede mantener catálogos." Por lo tanto, aunque se agregue la pestaña `maestros` al admin en `roleAccess.ts`, la subpestaña "Mantenimiento en pantalla" seguiría bloqueada mientras no cambie `App.tsx:104`.
- `src/components/MasterDataView.tsx` (Carga desde Excel) no tiene chequeo de rol propio. Depende de que la pestaña sea visible y del 403 del servidor.
- El panel Usuarios exige `user.role === 'superadmin'` además de `canAccessTab` (`src/App.tsx:516`).
- La navegación lateral (`src/components/AppSidebar.tsx:20-25, 66-71`) y el Resumen (`src/components/DashboardView.tsx:11, 23, 59-64`) filtran por `allowedTabs`. Si el admin recibe `maestros`, el grupo "Administración" le mostrará solo "Maestros".
- Una URL forzada a una pestaña no permitida (`#maestros/...`, `#usuarios`) redirige al módulo por defecto con el aviso `No tiene permisos para acceder al módulo "<título>".` (`src/App.tsx:143-157`, `186-190`).
- El usuario de sesión se guarda en `localStorage` (`src/lib/session.ts:20-28`) y se revalida con `/api/auth/me` al cargar (`src/App.tsx:172-181`). No hay service worker. Las pestañas visibles se calculan desde el código del bundle (`ROLE_TABS`), no desde datos cacheados.

### Auditoría de maestros hoy (evidencia, iteración 2)
- **Nombres reales de las 7 tablas** (`database/schema.sql`): `seasons` (`:60`), `companies` (`:78`), `species` (`:90`), `varieties` (`:102`), `csg_catalog` (`:119`), `jc_foremen` (`:131`; el servidor también la crea al arrancar, `server/index.cjs:~194-203`) y `season_cost_centers` (`:145`, las "relaciones").
- **`created_at` y `updated_at` ya existen** en las 7 tablas como `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`. `updated_at` lleva además `ON UPDATE CURRENT_TIMESTAMP(3)` (`database/schema.sql:68-69, 83-84, 95-96, 108-109, 124-125, 136-137, 156-157`). Lo que falta es **`created_by` / `updated_by`**: ninguna tabla de maestros los tiene. Ya hay precedente de `created_by BIGINT UNSIGNED NULL` con FK a `users` en `labels`, `movements` y `batch_logs` (`database/schema.sql:220, 234-235, 251, 260-261, 271, 275-276`).
- **Consecuencia de `ON UPDATE CURRENT_TIMESTAMP`:** `updated_at` cambia ante **cualquier** UPDATE que modifique valores de la fila, venga de donde venga:
  - la importación Excel (`upsertByCodeAndName`, `resolveVariety`, `resolveSeason` y el upsert de `season_cost_centers`: `server/index.cjs:498-545, 997-1009`), que además fuerza `is_active = 1`;
  - el efecto lateral de marcar una temporada como actual, que hace `UPDATE seasons SET is_current = 0 WHERE code <> ?` sobre las demás (`server/index.cjs:1087-1090` y `:538-541` en la importación).
- `GET /api/admin/masters` (`fetchMastersBundle`, `server/index.cjs:551-599`) no devuelve hoy `created_at`, `updated_at` ni autor.
- La tabla de Mantenimiento en pantalla tiene hoy las columnas Código / Nombre / [Rango | Especie] / Estado / acciones (`src/components/MastersAdminPanel.tsx:868-875, 918-926, 972-980`). En móvil (`max-width: 720px`) la tabla hace scroll dentro de `.masters-table-wrap` (`src/App.css:1235-1263`).
- El usuario autenticado (`req.auth.userId`, `fullName`) sale del token (`server/index.cjs:269-285`). `users.full_name` es NOT NULL (`database/schema.sql:28`). No hay endpoint para borrar ni desactivar usuarios (no existe `DELETE FROM users` ni `UPDATE users SET is_active` en el servidor). Un usuario autor solo podría quedar inactivo por acción directa en la BD.
- Las relaciones guardan `source = 'admin'` al crearse a mano (`server/index.cjs:1304-1308`) y `source = 'excel'` al importarse (`:999-1007`). La edición manual no cambia `source`.
- El pool MySQL no fija zona horaria (`server/index.cjs:91-101`). En la UI, las fechas se formatean con `toLocaleString('es-CL')` (`src/components/BatchHistoryPanel.tsx:75`, `src/components/TrackingView.tsx:625`).

### Pruebas actuales que afirman que el admin NO accede a maestros (habrá que actualizarlas)
| Archivo | Prueba | Qué afirma hoy |
|---|---|---|
| `tests/unit/roleAccess.test.ts:10-16` | `solo superadmin accede a maestros y usuarios` | `canAccessTab('admin','maestros') === false` (línea 13) |
| `tests/e2e/permisos-ui.spec.ts:36-54` | `CA-05: admin ve Resumen, Crear etiquetas y Lecturas, no Maestros/Usuarios, y sí exporta` | botón "Maestros" con `toHaveCount(0)` para admin (líneas 45-47) |
| `tests/e2e/permisos-api.spec.ts:28-36` | `CA-06: admin recibe 403 en maestros y usuarios pero puede exportar` | `GET /api/admin/masters` → 403 (línea 31) y `POST /api/master-data/import` → 403 (líneas 32-34) |
| `docs/specs/20261001-cobertura-e2e/requerimiento.md:9` | CA-05 de otro spec | "admin no ve Maestros/Usuarios" (documento histórico; no es prueba) |

Pruebas que **siguen siendo válidas** y no deben romperse: `permisos-ui.spec.ts:7-34` (operador), `permisos-api.spec.ts:12-26` (operador 403 en maestros/usuarios/export), `usuarios-reset.spec.ts:41-64` (admin y operador reciben 403 al restablecer contraseñas), `maestros-excel.spec.ts:6` (superadmin importa).

## 2. Objetivo

El rol `admin` crea, edita, activa y desactiva todos los maestros, y además importa maestros desde Excel, con el mismo alcance que el `superadmin`, sin depender de él. Usuarios sigue siendo exclusivo del `superadmin`. El operador queda igual. Se medirá así: las rutas de maestros responden 2xx para el admin, las de usuarios responden 403 para el admin y la UI del admin muestra Maestros y no Usuarios, en desktop y móvil.

Auditoría (iteración 2): cada registro de las 7 tablas de maestros guarda quién lo creó y cuándo, y quién lo modificó por última vez y cuándo. La tabla de Mantenimiento en pantalla lo muestra. Se medirá así: toda alta o edición manual hecha después de la migración deja `created_by` / `updated_by` iguales al id del usuario del token, y la UI muestra "Modificado por <nombre> el dd-mm-aaaa".

## 3. Historias de usuario

- **HU-01:** Como **admin**, quiero ver el módulo Maestros en el menú y en el Resumen, para mantener el catálogo sin pedírselo al superadmin.
- **HU-02:** Como **admin**, quiero crear y editar temporadas, empresas, especies, CSG, capataces JC, variedades y relaciones (incluido activarlos o desactivarlos), para que Crear etiquetas y el formulario JC muestren datos vigentes.
- **HU-03:** Como **admin**, quiero importar maestros desde un Excel (`empresa, cc, especie, variedad, csg`), para cargar una temporada completa de una vez.
- **HU-04:** Como **superadmin**, quiero que la gestión de Usuarios siga siendo exclusiva de mi rol, para controlar quién accede al sistema.
- **HU-05:** Como **responsable del sistema**, quiero que el operador siga sin acceso a Maestros ni Usuarios, para que el personal de terreno no altere el catálogo.
- **HU-06 (auditoría):** Como **admin o superadmin**, quiero ver en cada registro de maestros quién lo modificó por última vez y cuándo, para saber a quién preguntar si un CC, CSG o jefe de cuadrilla cambió, ahora que dos roles pueden editarlos.

## 4. Criterios de aceptación

```gherkin
# CA-01 — Admin ve Maestros y no Usuarios en el menú (desktop y móvil)  [HU-01, HU-04]
Dado un usuario activo con rol "admin" que inició sesión
Cuando abre la aplicación en "/" (viewport desktop y viewport móvil, abriendo el menú si hace falta)
Entonces la navegación "Módulos" muestra los botones "Resumen", "Crear etiquetas", "Registrar lecturas" y "Maestros"
Y la navegación "Módulos" no muestra el botón "Usuarios"

# CA-02 — Admin ve Maestros en el Resumen sin Usuarios  [HU-01, HU-04]
Dado un admin con sesión iniciada en el módulo "Resumen"
Cuando se muestra la sección "Administración"
Entonces contiene un acceso a "Maestros"
Y no contiene un acceso a "Usuarios"

# CA-03 — Admin entra a Mantenimiento en pantalla y ve los catálogos  [HU-02]
Dado un admin con sesión iniciada
Cuando navega a "Maestros" y elige la subpestaña "Mantenimiento en pantalla" (o abre "/#maestros/admin")
Entonces no se muestra el texto "Sin permisos para editar maestros"
Y se listan los registros de los catálogos (temporadas, empresas, especies, CSG, capataces JC, variedades, relaciones)

# CA-04 — Admin crea un registro de maestro desde la UI  [HU-02]
Dado un admin en "Maestros > Mantenimiento en pantalla"
Cuando crea un CSG nuevo con código y nombre únicos (sufijo aleatorio)
Entonces ve un mensaje de éxito
Y el CSG aparece en la lista
Y GET /api/admin/masters con su token lo incluye con is_active = 1

# CA-05 — Admin edita y desactiva un registro desde la UI  [HU-02]
Dado un admin y un capataz JC activo creado en la prueba
Cuando edita su nombre y lo marca como "Inactivo" y guarda
Entonces la lista muestra el nuevo nombre con estado "Inactivo"
Y GET /api/master-data/jc-foremen ya no lo devuelve

# CA-06 — Admin importa maestros desde Excel por UI  [HU-03]
Dado un admin en "Maestros > Carga desde Excel"
Cuando sube un .xlsx con columnas empresa, cc, especie, variedad, csg (valores con sufijo único) y pulsa "Importar maestros"
Entonces la importación termina con éxito
Y el nuevo CC aparece en GET /api/master-data/catalog para esa temporada y empresa
Y master_import_runs registra imported_by = id del admin

# CA-07 — API de maestros permitida al admin  [HU-02, HU-03]
Dado un token Bearer válido de un usuario "admin"
Cuando llama a cada ruta:
  | GET  /api/admin/masters        |
  | POST /api/admin/seasons        |
  | POST /api/admin/companies      |
  | POST /api/admin/species        |
  | POST /api/admin/csg            |
  | POST /api/admin/jc-foremen     |
  | POST /api/admin/varieties      |
  | POST /api/admin/relations      |
  | POST /api/master-data/import   |
  con un payload válido (alta sin id y edición con id, incluyendo isActive = 0 en al menos una)
Entonces cada respuesta tiene status 200 y cuerpo { ok: true, ... } (GET /api/admin/masters devuelve el bundle de catálogos)
Y ninguna responde 403

# CA-08 — Validaciones iguales para admin y superadmin  [HU-02, HU-03]
Dado un token de admin
Cuando envía POST /api/admin/companies sin code ni name
Entonces responde 400 con error "invalid_payload"
Cuando envía POST /api/master-data/import con rows = []
Entonces responde 400 con error "rows_required"

# CA-09 — Admin no accede a Usuarios por API  [HU-04]
Dado un token Bearer válido de un usuario "admin"
Cuando llama a GET /api/admin/users, a POST /api/admin/users y a POST /api/admin/users/:id/password
Entonces cada respuesta tiene status 403 y error "forbidden"
Y no se crea ningún usuario ni cambia ninguna contraseña

# CA-10 — Admin que fuerza la URL de Usuarios es redirigido  [HU-04]
Dado un admin con sesión iniciada (desktop y móvil)
Cuando abre "/#usuarios"
Entonces ve el módulo "Resumen"
Y ve el aviso 'No tiene permisos para acceder al módulo "Usuarios".'
Y no se renderiza la vista de Usuarios

# CA-11 — Operador sigue sin Maestros ni Usuarios (UI)  [HU-05]
Dado un operador con sesión iniciada (desktop y móvil)
Cuando abre "/" y luego "/#maestros/excel"
Entonces el menú no muestra "Resumen", "Maestros" ni "Usuarios"
Y al forzar la URL se ve "Crear etiquetas" con el aviso 'No tiene permisos para acceder al módulo "Maestros".'

# CA-12 — Operador sigue sin Maestros ni Usuarios (API)  [HU-05]
Dado un token Bearer válido de un usuario "operador"
Cuando llama a cualquiera de las 9 rutas de CA-07 o a las rutas de Usuarios de CA-09
Entonces cada respuesta tiene status 403 y error "forbidden"

# CA-13 — Sin sesión: 401  [HU-02, HU-04]
Dado que no se envía token
Cuando se llama a GET /api/admin/masters, POST /api/admin/csg o POST /api/master-data/import
Entonces la respuesta tiene status 401

# CA-14 — Superadmin conserva todo su acceso  [HU-04]
Dado un superadmin con sesión iniciada
Cuando abre el menú
Entonces ve "Resumen", "Crear etiquetas", "Registrar lecturas", "Maestros" y "Usuarios"
Y las rutas de CA-07 y de CA-09 le responden 200

# CA-15 — Reglas de permisos de la UI (unitaria)  [HU-01, HU-04, HU-05]
Dado el módulo src/lib/roleAccess.ts
Entonces canAccessTab('admin','maestros') es true
Y canAccessTab('admin','usuarios') es false
Y canAccessTab('operador','maestros') y canAccessTab('operador','usuarios') son false
Y getAllowedTabs('operador') es ['generar','trazabilidad']

# CA-16 — Sesión de admin abierta antes del despliegue  [HU-01, HU-02]
Dado un admin con sesión iniciada antes de publicar el cambio (token vigente)
Cuando, después del despliegue, recarga la página
Entonces ve "Maestros" sin volver a iniciar sesión
Y sus llamadas a las rutas de CA-07 responden 200 con el mismo token
```

### Auditoría por registro (iteración 2, borrador)

Notación: "las 7 tablas" = `seasons`, `companies`, `species`, `csg_catalog`, `jc_foremen`, `varieties`, `season_cost_centers`. Los CA se verifican con `GET /api/admin/masters`, que debe exponer los cuatro campos de auditoría y el nombre del autor de cada registro. El nombre exacto de los campos lo define el diseño.

```gherkin
# CA-17 — Alta manual registra creador y fecha  [HU-06]
Dado un admin con token válido (user id = A)
Cuando crea por API un registro nuevo en cada uno de los 7 maestros (POST /api/admin/<maestro> sin id)
Entonces cada registro devuelto por GET /api/admin/masters tiene created_by = A y updated_by = A
Y created_at y updated_at no son nulos, son iguales entre sí y están dentro de ±60 s de la hora del servidor al crear

# CA-18 — Edición manual registra al editor sin tocar la creación  [HU-06]
Dado un CSG creado por el superadmin (user id = S) en el instante T0
Cuando un admin (user id = A) edita su nombre en el instante T1 > T0
Entonces el registro tiene updated_by = A y updated_at >= T1
Y created_by sigue siendo S y created_at sigue siendo T0
(se repite para un registro de cada una de las 7 tablas)

# CA-19 — Activar o desactivar cuenta como edición  [HU-06, RN-05]
Dado un capataz JC activo creado por S
Cuando un admin A envía POST /api/admin/jc-foremen con su id e isActive = 0 (sin otros cambios)
Entonces updated_by = A y updated_at cambió
Y created_by sigue siendo S
Cuando luego el superadmin S lo reactiva (isActive = 1)
Entonces updated_by = S

# CA-20 — El autor sale del token, nunca del cuerpo  [HU-06, RN-09]
Dado un admin A
Cuando envía POST /api/admin/companies con un cuerpo que incluye createdBy, updatedBy, created_by o updated_by con el id de otro usuario, o fechas arbitrarias
Entonces la respuesta es 200 y el registro queda con created_by/updated_by = A y fechas del servidor
Y los valores enviados en el cuerpo se ignoran

# CA-21 — Visualización en la tabla de Mantenimiento en pantalla (desktop)  [HU-06]
Dado un admin con sesión en "Maestros > Mantenimiento en pantalla" (viewport desktop)
Y un CSG editado por última vez por el usuario de nombre completo "<N>" el día D
Cuando abre el catálogo CSG y busca ese registro
Entonces la fila muestra el texto "Modificado por <N> el <D en formato dd-mm-aaaa>"
Y lo mismo se cumple en los 7 catálogos para un registro editado en la prueba

# CA-22 — Visualización en móvil  [HU-06]
Dado el mismo escenario de CA-21 en viewport móvil
Cuando abre la lista del catálogo
Entonces el texto "Modificado por <N> el <dd-mm-aaaa>" de esa fila está presente y es visible (se puede llegar a él con el desplazamiento de la tabla, si hace falta)
Y los botones de acción de la fila siguen visibles y operables

# CA-23 — Visualización para superadmin y no para operador  [HU-06, HU-05]
Dado un superadmin en "Mantenimiento en pantalla"
Entonces ve la misma información de auditoría que el admin (CA-21)
Dado un operador
Entonces no puede ver la información de auditoría: no tiene el módulo (CA-11) y GET /api/admin/masters le responde 403 (CA-12)

# CA-24 — Registros existentes antes de la migración  [HU-06, RN-11]
Dado un registro creado antes de aplicar la migración (created_by y updated_by en NULL, created_at y updated_at con sus valores históricos)
Cuando se lista en "Mantenimiento en pantalla"
Entonces la fila muestra "Modificado el <updated_at en dd-mm-aaaa> · sin autor registrado"
Y no muestra "Modificado por" con un nombre vacío, "null" ni "undefined"
Y la migración no pone valores en created_by/updated_by de los registros existentes

# CA-25 — La importación Excel no marca autor en las filas  [HU-03, HU-06, A3]
Dado un admin A que importa un Excel con una empresa, un CC, una especie, una variedad y un CSG nuevos (sufijo único)
Cuando la importación termina
Entonces los registros nuevos que creó la importación en companies, species, varieties, csg_catalog y season_cost_centers tienen created_by = NULL y updated_by = NULL
Y la UI los muestra como "Modificado el <dd-mm-aaaa> · sin autor registrado"
Y master_import_runs tiene una corrida nueva con imported_by = A (sin cambios respecto de hoy, RN-07)

# CA-26 — Importación sobre una fila editada a mano  [HU-06, A3, P2]
Dado un CSG que el admin A editó a mano (updated_by = A)
Cuando el superadmin importa un Excel que cambia algún dato de esa fila (por ejemplo, la reactiva o le cambia el nombre)
Entonces la fila queda con updated_by = NULL, updated_at = hora de la importación y created_by intacto
Y la UI muestra "Modificado el <dd-mm-aaaa> · sin autor registrado"
Cuando se importa un Excel que no cambia ningún dato de esa fila
Entonces updated_by sigue siendo A y updated_at no cambia
(confirmado por el usuario en P2)

# CA-27 — Migración idempotente  [RN-12]
Dado una BD con el esquema anterior (sin created_by/updated_by), con datos
Cuando el servidor arranca dos veces seguidas (la migración del arranque es la que agrega las columnas)
Entonces ambos arranques terminan sin error en MariaDB 10.6
Y las columnas created_by y updated_by existen una sola vez en cada una de las 7 tablas
Y los datos existentes (incluidos created_at/updated_at) no cambian
Cuando se aplica database/schema.sql dos veces seguidas
Entonces ambas aplicaciones terminan sin error (schema.sql crea el esquema nuevo en una BD vacía; no migra BD existentes)
Y npm run db:test:reset deja la BD de pruebas con el esquema nuevo
# (precisado en diseño, decisión D3 del Lead, 2026-10-02)

# CA-28 — Guardar sin cambios no cuenta como modificación  [HU-06, RN-10, P4]
# (agregado en la fase de diseño, 2026-10-02, para formalizar la decisión P4 del usuario)
Dado un CSG con updated_by = S y updated_at = T0
Cuando un admin A envía POST /api/admin/csg con su id y exactamente los mismos code, name e isActive
Entonces la respuesta es 200
Y el registro sigue con updated_by = S y updated_at = T0
Y created_by y created_at no cambian
(se repite para una temporada, con las mismas fechas e is_current, y para una relación, con los mismos ids, CC e isActive)
Cuando una temporada ya marcada como actual se guarda de nuevo como actual sin otros cambios
Entonces ninguna temporada cambia su updated_by ni su updated_at
Cuando A cambia solo mayúsculas o minúsculas del nombre (por ejemplo "csg norte" → "CSG Norte")
Entonces sí cuenta como modificación: updated_by = A y updated_at > T0

# CA-29 — Desmarcar la temporada actual anterior se atribuye a quien marcó la nueva  [HU-06, RN-10, P3]
# (agregado en diseño, decisión D2 del Lead, 2026-10-02, para formalizar P3)
Dado una temporada Y marcada como actual y una temporada X no actual, ambas con updated_by distinto de A
Cuando un admin A guarda X como actual (POST /api/admin/seasons con isCurrent = 1)
Entonces Y queda con is_current = 0, updated_by = A y updated_at nuevo, y su created_by no cambia
Y las demás temporadas que ya no eran actuales conservan su updated_by y su updated_at
Cuando la temporada actual la cambia una importación Excel (season.isCurrent = true)
Entonces la temporada que deja de ser actual queda con updated_by = NULL (regla P2)
```

## 5. Reglas de negocio

- **RN-01:** "Maestros" incluye temporadas, empresas, especies, CSG, capataces JC, variedades y relaciones (`season_cost_centers`). Los roles `admin` y `superadmin` tienen permisos **idénticos** sobre ellos: ver, crear, editar, activar/desactivar e importar desde Excel.
- **RN-02:** La gestión de usuarios (listar, crear, restablecer contraseñas) es exclusiva de `superadmin`, tanto en la UI como en la API.
- **RN-03:** El operador no tiene acceso a Maestros ni a Usuarios.
- **RN-04:** Los permisos se validan en ambos lados y deben coincidir: `src/lib/roleAccess.ts` (más cualquier chequeo adicional de rol en la UI, como `App.tsx:104`) y `ACCESS`/`requireRoles` en `server/index.cjs`. La API es la barrera real. La UI solo oculta.
- **RN-05:** "Editar" incluye activar y desactivar (`is_active`). Los maestros no se borran físicamente.
- **RN-06:** Las validaciones y los códigos de error de las rutas de maestros no cambian según el rol (`invalid_payload`, `rows_required`, `rows_too_large`, `forbidden`, `db`).
- **RN-07:** Toda importación Excel queda registrada en `master_import_runs` con el usuario que la ejecutó, sea admin o superadmin.

### Auditoría (iteración 2, borrador)
- **RN-08:** Las 7 tablas de maestros (`seasons`, `companies`, `species`, `csg_catalog`, `jc_foremen`, `varieties`, `season_cost_centers`) guardan `created_by`, `created_at`, `updated_by` y `updated_at`. `created_at` y `updated_at` ya existen y se reutilizan; solo faltan `created_by` y `updated_by`, que referencian a `users.id` y aceptan NULL. Es solo el **último estado**: no hay historial de cambios (A1).
- **RN-09:** El autor (`created_by` / `updated_by`) se toma **siempre** del usuario autenticado por el token (`req.auth.userId`), nunca del cuerpo de la petición. Las fechas las pone el servidor/BD, nunca el cliente.
- **RN-10:** En un alta manual, `created_by = updated_by = usuario del token` y `created_at = updated_at`. En una edición manual (incluido activar o desactivar) cambian solo `updated_by` y `updated_at`. `created_by` y `created_at` no se modifican nunca después del alta.
- **RN-11:** Los registros anteriores a la migración quedan con `created_by` y `updated_by` en NULL. **No** se rellenan con un usuario supuesto, como el superadmin, porque sería una atribución falsa. Sus `created_at`/`updated_at` históricos se conservan.
- **RN-12:** La migración es idempotente y compatible con MariaDB 10.6. Se refleja en `database/schema.sql` y se aplica al arrancar el servidor, como las demás (`ensureMovementsSchema`). Ejecutarla de nuevo no falla ni altera los datos.
- **RN-13:** La importación Excel **no** registra autor en las filas que crea o modifica (A3). Su trazabilidad queda solo en `master_import_runs` (RN-07). Si la importación cambia datos de una fila, esa fila deja de atribuirse al último editor manual (ver P2).
- **RN-14:** La UI muestra la **última modificación** con dos formatos. Si hay autor: "Modificado por <nombre completo del usuario> el <dd-mm-aaaa>". Si no hay autor: "Modificado el <dd-mm-aaaa> · sin autor registrado". La fecha se muestra en hora de Chile (America/Santiago). El nombre es `users.full_name` vigente al momento de mostrar, no una copia guardada al editar.
- **RN-15:** La información de auditoría solo la ven los roles con acceso a Maestros (admin y superadmin), por la misma ruta protegida `GET /api/admin/masters`. No se expone en `GET /api/master-data/catalog` ni en `GET /api/master-data/jc-foremen`, que son públicas o del operador.

## 6. Casos borde

- **Sesión de admin ya abierta:** el servidor resuelve el rol en cada request (`server/index.cjs:269-276`), así que el token vigente sirve sin volver a iniciar sesión. La UI necesita recargar para tomar el nuevo bundle (CA-16). Hasta entonces, el bundle antiguo no muestra Maestros y, si el admin fuerza `#maestros`, lo redirige con el aviso.
- **Sesión offline / cache local:** el usuario se cachea en `localStorage` (`appetiquetado` session, `src/lib/session.ts`) y no hay service worker. Las pestañas salen del código, no del cache, así que no hace falta limpiar el almacenamiento local. Sin red, Maestros puede mostrarse pero cargar o guardar fallará con el mensaje de error existente ("No se pudo cargar el módulo de maestros." / "No se pudo guardar."). No se agrega cola offline para maestros.
- **Hash `#maestros/admin` guardado por un admin:** antes redirigía con aviso; ahora debe abrir directamente la subpestaña "Mantenimiento en pantalla".
- **Admin desactiva un capataz JC o una relación en uso:** el registro deja de aparecer en el formulario JC (`GET /api/master-data/jc-foremen` filtra `is_active = 1`, `server/index.cjs:956`) y en el catálogo de Crear etiquetas (`server/index.cjs:900-927`). Las etiquetas y lecturas ya registradas no cambian. Esto ya pasa hoy con el superadmin; el admin solo hereda el comportamiento.
- **Admin marca una temporada como actual:** desmarca las demás (`server/index.cjs:1087-1090`), igual que con el superadmin.
- **Admin y superadmin editan el mismo registro a la vez:** se queda la última escritura (comportamiento actual, sin control de concurrencia).
- **Auditoría:** solo la importación Excel registra autor (`master_import_runs.imported_by`). Las altas y ediciones individuales no dejan rastro de quién las hizo. Ver P1.
- **Admin intenta crear un usuario con rol superadmin por API:** recibe 403 antes de cualquier validación (CA-09).

### Auditoría (iteración 2)
- **Usuario autor desactivado:** hoy no se puede desactivar usuarios desde la app, solo por la BD. Si pasa, la UI sigue mostrando su nombre completo. La auditoría no depende de que el autor esté activo.
- **Usuario autor eliminado:** no hay endpoint de borrado. Si alguien lo borra en la BD, la referencia no debe impedir el borrado ni romper el listado de maestros. En ese caso la fila se muestra como "sin autor registrado". La restricción de FK concreta (`ON DELETE SET NULL` u otra) la decide el diseño.
- **Nombre a mostrar:** `users.full_name` (NOT NULL). Si cambia el nombre del usuario, la auditoría muestra el nombre vigente (RN-14). Un `full_name` vacío o con solo espacios se reemplaza por `username`.
- **Efecto lateral de "temporada actual":** al marcar la temporada X como actual, el servidor desmarca las demás con un UPDATE. Por `ON UPDATE CURRENT_TIMESTAMP`, eso mueve el `updated_at` de la temporada que antes era actual. Ver P3 para su `updated_by`.
- **Edición sin cambios reales:** guardar un formulario sin cambiar ningún valor. **Decisión del usuario (P4): NO cuenta como modificación.** Si ningún valor cambia, `updated_by` y `updated_at` quedan intactos. El diseño debe comparar valores o usar las filas afectadas por el UPDATE.
- **La importación reactiva registros:** hoy la importación fuerza `is_active = 1` en empresas, especies, variedades, CSG, temporada y relaciones que vengan en el Excel (`server/index.cjs:503-507, 518-523, 535-540, 1006`). Un registro que un admin desactivó a mano vuelve a quedar activo y, según CA-26/P2, sin autor. Es el comportamiento actual de la importación y no se cambia aquí. Se documenta porque ahora se ve en la auditoría.
- **Importación de una fila idéntica:** si la fila del Excel no cambia ningún dato, la auditoría queda intacta (CA-26).
- **Ediciones concurrentes:** se queda la última escritura, y su autor y su fecha.
- **Zona horaria:** un cambio hecho a las 23:30 en Chile debe mostrarse con esa fecha, no con la del día siguiente en UTC (RN-14). El pool MySQL no fija zona (`server/index.cjs:91-101`); el diseño debe asegurar la conversión.
- **Usuario que no existe en el token:** las rutas de maestros exigen sesión (`authMiddleware`), así que no puede haber alta o edición manual sin `req.auth.userId`.

## 7. Fuera de alcance

- Cambios en la gestión de usuarios o en sus permisos.
- Borrado físico de maestros (no existe DELETE hoy).
- Bitácora con historial completo de cambios (quién cambió qué campo, valor anterior y nuevo). Solo se guarda el último estado (A1).
- Marcar con el usuario las filas creadas o modificadas por la importación Excel (A3).
- Mostrar en la UI el creador (`created_by`/`created_at`). Se guarda y se expone por API, pero la tabla muestra solo la última modificación (A2). Se puede agregar después sin cambiar el esquema.
- Filtrar u ordenar la lista de maestros por autor o fecha de modificación.
- Rellenar el autor de los registros históricos (RN-11).
- Nuevos roles o permisos configurables desde la UI.
- Cambios en el flujo JC → acopio, en el Excel de trackeo o en los reportes.
- Corregir la deuda conocida (`GET /api/master-data/jc-foremen` sin sesión, deadlock de `POST /api/movements`).
- Actualizar la documentación de roles fuera de `docs/specs/` (`.claude/skills/contexto-appetiquetado/SKILL.md`, tabla de roles). Queda como tarea para quien implemente y se señala en los riesgos.

## 8. Preguntas abiertas

| # | Pregunta | Opción recomendada | Respuesta |
|---|---|---|---|
| P1 | Ahora que dos roles pueden editar maestros, ¿hay que registrar quién creó o modificó cada registro individual (no solo las importaciones Excel)? | No en este cambio. | **Resuelta (usuario, 2026-10-02): SÍ se incluye.** A1: `created_by`, `created_at`, `updated_by`, `updated_at` en las 7 tablas, solo el último estado, sin bitácora. A2: visible en la tabla de Mantenimiento en pantalla ("Modificado por X el dd-mm-aaaa") para admin y superadmin, en desktop y móvil. A3: la importación Excel no marca las filas con el usuario; solo queda la corrida en `master_import_runs`. La talla pasa a L. Se incorporó como HU-06, CA-17..CA-27 y RN-08..RN-15. |
| P2 | Una fila tiene `updated_by = A` por una edición manual y luego una importación Excel cambia sus datos (nombre, reactivación, etc.). Como `updated_at` se mueve solo (`ON UPDATE CURRENT_TIMESTAMP`), ¿qué pasa con `updated_by`? | **Limpiarlo a NULL solo si la importación cambió algún dato de la fila.** La UI mostraría "Modificado el <fecha de la importación> · sin autor registrado" y quien importó se consulta en `master_import_runs`. Si la fila no cambió, la auditoría queda intacta. Así se respeta A3 (no se marca al importador en la fila) sin atribuirle a A un cambio que no hizo. Alternativas descartadas: (b) dejar `updated_by = A` con la fecha de la importación, que atribuye falsamente a A; (c) congelar `updated_at` en la importación, que oculta que la fila cambió. Está reflejada en CA-26. | **Usuario: opción recomendada** (NULL solo si la importación cambió datos). |
| P3 | Cuando un usuario marca la temporada X como actual, el servidor desmarca la que era actual (Y), lo que mueve el `updated_at` de Y. ¿`updated_by` de Y debe ser ese usuario? | **Sí**: el cambio en Y es consecuencia directa de su acción, así que `updated_by` de Y = usuario del token, con el mismo `updated_at`. Si el efecto lateral viene de una importación, aplica P2 (NULL). No bloquea el diseño. | **Usuario: opción recomendada** (autor = usuario que marcó X). |
| P4 | Si un usuario abre un registro y pulsa Guardar sin cambiar nada, ¿cuenta como modificación? | **Sí**: `updated_by` = usuario y `updated_at` = ahora. Es predecible para el usuario ("lo guardé yo") y fácil de probar. La alternativa es no registrar nada si la fila no cambió, que es lo que hace hoy `ON UPDATE CURRENT_TIMESTAMP` por sí solo. No bloquea el diseño. | **Usuario: NO cuenta como modificación**; solo se audita si cambió algún valor (contrario a la recomendación). |
