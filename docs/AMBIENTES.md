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
