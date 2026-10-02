# Levantar la app en local

Cada modo usa **dos terminales**: una para la API y otra para la web. Abra la URL de la web en el navegador.

| Modo | Base de datos | Terminal 1 (API) | Terminal 2 (web) | Abrir |
|---|---|---|---|---|
| **Test** (recomendado) | `appetiquetado_test` en su Mac | `npm run server:test` | `npm run dev:test` | http://localhost:5175 |
| **Staging** | `trn_etiquetatest` en trn.cl | `npm run server:staging` | `npm run dev:staging` | http://localhost:5176 |
| **Producción** ⚠️ | la de `.env` (producción) | `npm run server:prod` | `npm run dev` | http://localhost:5173 |

## Test — para desarrollar y probar sin riesgo
- Base local, desechable. `npm run db:test:reset` la deja limpia, con los datos semilla.
- Las pruebas E2E también la recrean.
- Login: `superadmin` + la clave `SUPERADMIN_PASSWORD` de `.env.test`.

## Staging — para ver los mismos datos que appetiqueta-dev
- Lo que haga aquí **queda en la base compartida de staging**.
- `APP_ENV=staging` va fijo: el guardián solo permite `trn_etiquetatest`.
- Login: el mismo usuario y clave que en la URL de Render de staging.

## Producción — solo para consultar o diagnosticar
- **Todo lo que guarde va a producción** (etiquetas, lecturas JC/acopio, maestros).
- `APP_ENV=production` va fijo: el guardián impide arrancar si `.env` apunta a una base de pruebas.
- Claude nunca levanta este modo.
- Login: su usuario real de producción.

## Variables por archivo (no versionados)
| Archivo | Lo usa |
|---|---|
| `.env.test` | `server:test` y todas las pruebas automáticas |
| `.env.staging` | `server:staging` y `npm run db:staging:init` |
| `.env` | `server:prod` (y el antiguo `npm run server`) |

Los puertos no chocan entre sí: API en 3101 / 3201 / 3001 y web en 5175 / 5176 / 5173. Puede tener los tres modos abiertos a la vez.
