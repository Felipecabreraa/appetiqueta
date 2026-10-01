/**
 * Guardián de ambiente: impide que un servicio arranque contra la BD de otro ambiente.
 * Staging y producción comparten usuario MySQL, así que la única separación es MYSQL_DATABASE.
 */
const STAGING_DB = 'trn_etiquetatest'
const VALID_ENVS = ['staging', 'production']

function checkEnvironment(env) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase()
  const database = String(env.MYSQL_DATABASE || '').trim()

  if (!appEnv) {
    return {
      ok: true,
      env: null,
      warning: 'APP_ENV no definido: guardián de ambiente inactivo (defina staging o production en Render).',
    }
  }
  if (!VALID_ENVS.includes(appEnv)) {
    return { ok: false, env: appEnv, error: `APP_ENV="${appEnv}" no es válido (use: ${VALID_ENVS.join(', ')}).` }
  }
  if (appEnv === 'staging' && database !== STAGING_DB) {
    return {
      ok: false,
      env: appEnv,
      error: `APP_ENV=staging exige MYSQL_DATABASE=${STAGING_DB} (recibido: "${database}").`,
    }
  }
  if (appEnv === 'production' && (!database || /test/i.test(database))) {
    return {
      ok: false,
      env: appEnv,
      error: `APP_ENV=production no puede usar una BD de pruebas (recibido: "${database}").`,
    }
  }
  return { ok: true, env: appEnv }
}

module.exports = { checkEnvironment, STAGING_DB }
