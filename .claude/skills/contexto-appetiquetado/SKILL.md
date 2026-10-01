---
name: contexto-appetiquetado
description: Conocimiento de dominio y convenciones de App Etiquetado (QR, JC/acopio, maestros por temporada, roles, stack). Cargar antes de analizar, diseñar, implementar o probar cualquier cambio en este repo.
user-invocable: false
---

# Contexto de App Etiquetado

## Negocio
Etiquetas QR para lotes de cosecha de **Agrícola Esmeralda**. Cada etiqueta tiene un **código único de 12 caracteres** (alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, sin O/0/I/1), siempre en MAYÚSCULAS. El QR codifica `https://<origen>/?e=<CODIGO>`.

Flujo de dos lecturas sobre el **mismo QR**, con este orden obligatorio:
1. **JC (Jefe de Cuadrilla)**, salida de campo. La primera lectura registra los totes (≥1), el jefe de cuadrilla (del maestro `jc_foremen`), el precio en CLP y el JH (personas en la cuadrilla). Además graba `labels.cantidad_totes` y `labels.jefe_cuadrilla`.
2. **Acopio**, llegada. La segunda lectura registra los totes recibidos.
3. Después la etiqueta queda en estado **completa**: no admite más lecturas.

El servidor impone el orden en `POST /api/movements` con una transacción y `FOR UPDATE`, y responde 409 con `jc_required`, `jc_already_registered`, `acopio_required` o `already_complete`.

Maestros por temporada: `Empresa → CC (centro de costo) → {Especie, Variedad, CSG}` en `season_cost_centers`. El sector se ingresa a mano. El Excel de importación tiene las columnas `empresa, cc, especie, variedad, csg`.

## Roles
| Rol | Acceso |
|---|---|
| superadmin | todo, incluidos Maestros y Usuarios |
| admin | Resumen, Crear etiquetas, Registrar lecturas, exportar el Excel de trackeo |
| operador | Crear etiquetas, Registrar lecturas |

Los roles se validan **en ambos lados**: `src/lib/roleAccess.ts` (UI) y `ACCESS` + `requireRoles` en `server/index.cjs` (API). Un cambio de permisos debe tocar los dos.

## Stack y mapa del código
- Frontend: React 19 + TypeScript (estricto, `verbatimModuleSyntax`, `erasableSyntaxOnly`) + Vite. CSS propio, sin librería de UI.
- Backend: Express 4 en **un solo archivo** `server/index.cjs` (CommonJS) con mysql2/promise. Auth propia: scrypt y token Bearer guardado como hash SHA-256 en `auth_sessions`.
- BD: **MariaDB 10.6** en `trn.cl` (staging `trn_etiquetatest`). El esquema está en `database/schema.sql` y debe ser compatible con MariaDB 10.6: el CI prueba sobre `mariadb:10.6`. Evita sintaxis exclusiva de MySQL 8 (por ejemplo `ADD COLUMN IF NOT EXISTS` sí funciona en MariaDB, pero valida cada DDL nuevo en el CI). El servidor parchea columnas faltantes al arrancar (`ensureMovementsSchema`, `detectLabelSchema`).
- `src/lib/` contiene la lógica sin UI (API, sync, storage, exportaciones). `src/components/` contiene las vistas. Los componentes `Operational*` forman la interfaz cerrada que se abre al escanear `?e=`.
- Estado dual: `localStorage` (`appetiquetado:labels`, `appetiquetado:movements`) más MySQL. **MySQL es la fuente de verdad** para los reportes.
- Ambientes: **pruebas/staging** (rama `developer` → Render `appetiqueta-dev` → BD `trn_etiquetatest`) y **producción** (rama `main` → Render `appetiqueta`). Render despliega solo si el CI (`.github/workflows/ci.yml`) pasa. Las ramas de trabajo son `feat/<slug>` y `fix/<slug>`, creadas desde `developer`.
- Pruebas locales: BD `appetiquetado_test` en el MySQL local, vía `.env.test`. Nunca `.env`.

## Convenciones
- La UI, los comentarios y los mensajes de error para el usuario van **en español**. Los códigos de error de la API van en `snake_case` en inglés (`label_not_found`).
- Las respuestas de la API siguen la forma `{ ok: true, ... }` / `{ ok: false, error: '<code>' }`.
- Toda consulta SQL usa placeholders `?`; nunca se interpolan valores del usuario.
- Los IDs se normalizan con `trim().toUpperCase()` en cada frontera (lectura de QR, API, storage).
- Columnas de BD en `snake_case`; campos de TS en `camelCase`. El mapeo se hace en el servidor.
- Respeta el estilo vecino: funciones pequeñas en `src/lib`, componentes funcionales con hooks, sin librerías nuevas sin justificarlas en el diseño.

## Comandos
| Comando | Uso |
|---|---|
| `npm run dev` / `npm run server:test` | front :5173 / API :3101 con la BD de pruebas. **No uses `npm run server` ni `npm start`**: cargan `.env`, que puede ser producción |
| `npm run verify` | lint + typecheck + unit |
| `npm run test:all` | verify + E2E UI + E2E API (lo mismo que corre el CI) |
| `npm run db:test:reset` | recrea la BD local de pruebas con la semilla |
| `npm test` / `npm run test:coverage` | Vitest (`tests/unit/`, jsdom) |
| `npm run test:e2e` | Playwright (`tests/e2e/`, desktop + móvil; levanta los servidores) |
| `npm run test:e2e:api` | E2E de API (levanta su propia API + Vite contra la BD de pruebas) |
| `npm run build` | build de producción |

## Deuda conocida (no arreglar de paso)
- `server/index.cjs` ejecuta `main()` al importarse y no exporta sus helpers, así que no se puede probar unitariamente. Para habilitarlo hay que refactorizar con `if (require.main === module)` + `module.exports`.
- `GET /api/labels/:id`, `GET /api/master-data/jc-foremen` y `POST /api/movements` no exigen sesión (flujo de terreno).
- CORS abierto y una contraseña por defecto del superadmin si falta `SUPERADMIN_PASSWORD`.
- **Bug conocido (detectado por el E2E de API):** `POST /api/movements` lanza `ER_LOCK_DEADLOCK` → 500 cuando llegan varios JC simultáneos sobre etiquetas distintas (alrededor de 3/120 con concurrencia 4). Causa probable: `SELECT … FROM movements … FOR UPDATE` toma gap locks sobre rangos vacíos. Mientras no se corrija, el CI queda en rojo.
- Cuando el servidor arranca, ejecuta DDL/DML sobre la BD a la que apunta (`ensureMovementsSchema`, `ensureBaseData`).
