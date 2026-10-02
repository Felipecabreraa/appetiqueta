# Ambientes: pruebas y producción

## Modelo
```
feat/<slug> ──merge──▶ developer ──(CI ✅)──▶ Render appetiqueta-dev  (PRUEBAS · BD trn_etiquetatest)
                           │
                aprobación explícita del usuario
                           ▼
                         main ──(CI ✅)──▶ Render appetiqueta  (PRODUCCIÓN · BD producción)
```

## Puesta en marcha (una sola vez)

### 1. BD de pruebas (staging)
En su servidor MySQL (idealmente uno distinto al de producción), ejecute como administrador
`database/create-staging-db.sql`, cambiando la clave. Luego, en su equipo:
```bash
cp .env.staging.example .env.staging
```
```bash
npm run db:staging:init
```
El segundo comando aplica `schema.sql`, y el guardián exige que la BD sea exactamente `trn_etiquetatest`. Después cargue los maestros en staging con la importación Excel de la propia app.

### 2. Ramas en GitHub
La rama `developer` ya existe en local (creada desde `main`). Publíquela:
```bash
git push -u origin developer
```
Recomendado: en GitHub → Settings → Branches, proteja `main` y `developer` y exija el check **CI / calidad-y-e2e**.

### 3. Render (servicios creados desde el dashboard)
El servicio de producción `appetiqueta` se creó a mano, no desde un Blueprint. **No sincronice `render.yaml` como Blueprint**: intentaría crear otro `appetiqueta` en paralelo. `render.yaml` queda como referencia de la configuración esperada.

**Crear `appetiqueta-dev`:** New + → Web Service → mismo repo, con esta configuración:

| Campo | Valor |
|---|---|
| Name | `appetiqueta-dev` |
| Branch | `developer` |
| Region | la misma de producción |
| Runtime / Build / Start | Node · `npm install && npm run build` · `npm start` |
| Instance type | Free |
| Health Check Path | `/api/health` |
| Auto-Deploy | On Commit (pasar a *After CI Checks Pass* cuando el CI esté en verde) |

Variables de entorno: `NODE_VERSION=22.12.0`, `APP_ENV=staging` (**obligatoria**: activa el guardián), `MYSQL_HOST=trn.cl`, `MYSQL_USER` y `MYSQL_PASSWORD` (de staging), `MYSQL_DATABASE=trn_etiquetatest`, `SUPERADMIN_PASSWORD` (propio). Si producción usa `SYNC_API_KEY`, agregue también `SYNC_API_KEY` y `VITE_SYNC_API_KEY` con un valor distinto al de producción.

**Revisar `appetiqueta` (producción):** agregue `APP_ENV=production` (activa el guardián). Branch = `main`, Health Check Path = `/api/health` y `MYSQL_DATABASE` = la BD de producción. Pase Auto-Deploy a *After CI Checks Pass* cuando el CI esté en verde en `main`.

### 4. Pruebas locales
Ya está configurado en este equipo: `.env.test` apunta a la BD local `appetiquetado_test`. Para otro equipo, vea `.env.test.example`.

## Esquema al arrancar y estado en `/api/health`
Al arrancar, el servidor crea las tablas base que falten (solo `CREATE TABLE IF NOT EXISTS`, tomadas de `database/schema.sql`) y aplica las migraciones aditivas. Nunca borra ni recrea una tabla existente. Si una tabla no se puede crear (por ejemplo, por falta de privilegio CREATE), el error queda en el log con el prefijo `[schema]` y el servicio sigue vivo.

`GET /api/health` responde siempre 200 y suma cuatro campos: `schemaComplete`, `missingTables`, `mastersAuditReady` y `movementsSchemaReady` (`null` = desconocido, por ejemplo sin conexión a la BD). El smoke remoto falla si `dbReady` o `schemaComplete` no son `true` y nombra lo que falta.

Si `schemaComplete=false`: reinicie el servicio (reaplica las tablas y migraciones); si persiste, revise el log `[schema]`. Los cambios de esquema detectados en caliente solo se informan, no se corrigen sin reiniciar.

## Copiar producción a staging
1. En Render, **suspenda** `appetiqueta-dev` (Suspend) para que no escriba mientras se importa.
2. En phpMyAdmin, **confirme que la BD seleccionada es `trn_etiquetatest`** (el usuario también ve producción). Luego, dentro de **la misma** pestaña SQL: `SET FOREIGN_KEY_CHECKS=0;`, los `DROP TABLE` de las tablas, y `SET FOREIGN_KEY_CHECKS=1;`. (La casilla "Desactivar la revisión de claves foráneas" es de la pestaña Importar, no de la pestaña SQL.)
3. Importe el dump de producción (en la pestaña Importar se puede marcar esa casilla). Después, vacíe `auth_sessions` en staging (`DELETE FROM auth_sessions;` en `trn_etiquetatest`): el dump trae sesiones vigentes de producción.
4. Reanude el servicio. Al arrancar recrea las tablas que falten y reaplica las migraciones aditivas. Ante una restauración parcial, revise el log `[schema]` (una `roles` recreada vacía se rellena en el orden superadmin, admin, operador).
5. Verifique: `E2E_REMOTE_URL=<url de staging> npm run test:smoke:remote` (debe haber `schemaComplete=true`).
6. Efecto en `operational_epoch`: toma el valor de producción, así que los navegadores de staging borran su historial local de lotes y etiquetas (`src/lib/operationalEpoch.ts`).

## Reglas de seguridad
| Regla | Dónde se aplica |
|---|---|
| Pruebas con escritura solo contra una BD local `*_test` | `scripts/test-env.mjs` (guardián) |
| Init de staging solo contra la BD `trn_etiquetatest` | `scripts/db-staging-init.mjs` |
| El servidor no arranca si `APP_ENV` y `MYSQL_DATABASE` no coinciden (staging ⇒ `trn_etiquetatest`; production ⇒ nunca una BD `*test*`) | `server/envGuard.cjs` |
| Push forzado prohibido; `main` ⊆ `origin/developer`; `verify` verde antes de push | `.claude/hooks/git-push-gate.mjs` |
| Todo push y merge pide confirmación humana | `.claude/settings.json` (`ask`) |
| Deploy solo con el CI en verde | `render.yaml` + `.github/workflows/ci.yml` |
| Producción solo con aprobación explícita registrada en `cierre.md` | skills `equipo` y `desplegar` |
