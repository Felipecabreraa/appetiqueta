# App Etiquetado (QR + Maestros + Roles)

Sistema de etiquetado con QR orientado a operación real de campo/acopio.

## Módulos implementados

- Autenticación y sesiones (`SuperAdmin`, `Admin`, `Operador`).
- Gestión de usuarios (solo `SuperAdmin`).
- Carga maestra desde Excel por temporada.
- Mantenimiento administrativo interno de:
  - temporadas
  - empresas
  - especies
  - variedades
  - CSG
  - relaciones válidas por temporada (`temporada + empresa + CC + CSG + especie + variedad`)
- Modelo relacional dinámico:
  - `Empresa` filtra `CC`.
  - `CC` determina `Especie`, `Variedad` y `CSG`.
  - `Sector` se mantiene manual.
- Generación de etiquetas QR con trazabilidad JC/acopio.

## Estructura de datos maestra

El backend espera una carga Excel con columnas:

- `empresa`
- `cc` (centro de costo)
- `especie`
- `variedad`
- `csg`

Los nombres pueden venir en mayúsculas/minúsculas.

La UI incluye botón para descargar una plantilla base:

- `plantilla-maestros-etiquetado.xlsx`

## SQL base

Aplicar `database/schema.sql` sobre MySQL 8+.

Incluye:

- tablas de seguridad (`roles`, `users`, `auth_sessions`)
- catálogo maestro (`seasons`, `companies`, `species`, `varieties`, `csg_catalog`, `season_cost_centers`)
- operación (`labels`, `movements`, `batch_logs`)

## Variables de entorno

- `MYSQL_HOST`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `PORT` o `SYNC_API_PORT`
- `SYNC_API_KEY` (opcional para endpoint de batch)
- `SUPERADMIN_USERNAME` (opcional, por defecto `superadmin`)
- `SUPERADMIN_PASSWORD` (opcional, por defecto `ChangeMe123!`)
- `SUPERADMIN_NAME` (opcional)
- `SESSION_TTL_HOURS` (opcional, por defecto `12`)

## Scripts

- `npm run dev` -> frontend
- `npm run server` -> API Node + MySQL
- `npm run build` -> build producción
- `npm start` -> servir `dist` + API
