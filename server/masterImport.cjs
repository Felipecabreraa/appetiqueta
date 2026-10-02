// Importación de maestros desde Excel: resolución de catálogos por nombre y upsert de la relación.
// Sin efectos al importarse. Los nombres de tabla salen solo de constantes.
const { buildAuditedUpdate, buildImportAuditClause, buildImportChangeCondition } = require('./masterAudit.cjs')

const withClause = (clause) => (clause ? `${clause},` : '')

function createCatalogResolver(conn, { audit, toCode }) {
  const cache = new Map()

  const catalogUpdate = (table) =>
    buildAuditedUpdate(table, [{ name: 'name', text: true }, { name: 'is_active' }], { audit })

  async function resolve(key, { table, name, selectSql, selectParams, insertSql, insertParams }) {
    if (cache.has(key)) return cache.get(key)
    const [found] = await conn.execute(selectSql, selectParams)
    let id = found[0]?.id
    if (id != null) {
      const upd = catalogUpdate(table)
      await conn.execute(upd.sql, upd.params([name, 1], null, id))
    } else {
      await conn.execute(insertSql, insertParams)
      const [again] = await conn.execute(`${selectSql} LOCK IN SHARE MODE`, selectParams)
      id = again[0]?.id
      if (id == null) throw new Error('catalog_unresolved')
    }
    cache.set(key, id)
    return id
  }

  function byName(table) {
    return (rawName) => {
      const name = String(rawName ?? '').trim()
      const clause = buildImportAuditClause(
        [
          { col: 'name', expr: 'VALUES(name)', text: true },
          { col: 'is_active', expr: '1' },
        ],
        { audit },
      )
      return resolve(`${table}\u0000${name}`, {
        table,
        name,
        selectSql: `SELECT id FROM ${table} WHERE name = ? LIMIT 1`,
        selectParams: [name],
        insertSql: `INSERT INTO ${table} (code, name, is_active)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE
            ${withClause(clause)}
            name = VALUES(name),
            is_active = 1`,
        insertParams: [toCode(name), name],
      })
    }
  }

  function variety(speciesId, rawName) {
    const name = String(rawName ?? '').trim()
    const clause = buildImportAuditClause(
      [
        { col: 'name', expr: 'VALUES(name)', text: true },
        { col: 'species_id', expr: 'VALUES(species_id)' },
        { col: 'is_active', expr: '1' },
      ],
      { audit },
    )
    return resolve(`varieties\u0000${speciesId}\u0000${name}`, {
      table: 'varieties',
      name,
      selectSql: 'SELECT id FROM varieties WHERE species_id = ? AND name = ? LIMIT 1',
      selectParams: [speciesId, name],
      insertSql: `INSERT INTO varieties (code, name, species_id, is_active)
        VALUES (?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          ${withClause(clause)}
          name = VALUES(name),
          species_id = VALUES(species_id),
          is_active = 1`,
      insertParams: [toCode(name), name, speciesId],
    })
  }

  return {
    company: byName('companies'),
    species: byName('species'),
    csg: byName('csg_catalog'),
    variety,
  }
}

function buildRelationImportUpsert({ audit, withCenterName }) {
  // source queda fuera de la condición: es un efecto, no un dato de negocio (P4).
  const cols = [
    ...(withCenterName ? [{ col: 'center_name', expr: 'VALUES(center_name)', text: true }] : []),
    { col: 'species_id', expr: 'VALUES(species_id)' },
    { col: 'variety_id', expr: 'VALUES(variety_id)' },
    { col: 'csg_id', expr: 'VALUES(csg_id)' },
    { col: 'is_active', expr: '1' },
  ]
  const cond = buildImportChangeCondition(cols)
  // updated_by y source van antes que las columnas de negocio: el SET se evalúa de izquierda a derecha.
  const sql = `INSERT INTO season_cost_centers
       (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'excel')
     ON DUPLICATE KEY UPDATE
       ${withClause(buildImportAuditClause(cols, { audit }))}
       source = IF(${cond}, source, 'excel'),
       ${withCenterName ? 'center_name = VALUES(center_name),' : ''}
       species_id = VALUES(species_id),
       variety_id = VALUES(variety_id),
       csg_id = VALUES(csg_id),
       is_active = 1`
  return {
    sql,
    params: (v) => [v.seasonId, v.companyId, v.centerCode, v.centerName, v.speciesId, v.varietyId, v.csgId],
  }
}

module.exports = { createCatalogResolver, buildRelationImportUpsert }
