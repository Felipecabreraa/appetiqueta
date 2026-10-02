import type { Connection } from 'mysql2/promise'

/** Las 7 tablas de maestros (todas las columnas, incluidos updated_by y updated_at). */
export const TABLAS_MAESTROS = [
  'seasons',
  'companies',
  'species',
  'varieties',
  'csg_catalog',
  'jc_foremen',
  'season_cost_centers',
] as const

export type FotoMaestros = {
  tablas: Record<(typeof TABLAS_MAESTROS)[number], unknown[]>
  importRuns: number
}

/**
 * Instantánea de las 7 tablas de maestros (SELECT * ORDER BY id) y del conteo de master_import_runs.
 * Se serializa a JSON para comparar fechas (DATETIME(3)) y NULL columna por columna.
 */
export async function fotoMaestros(conn: Connection): Promise<FotoMaestros> {
  const tablas = {} as FotoMaestros['tablas']
  for (const t of TABLAS_MAESTROS) {
    const [rows] = await conn.query(`SELECT * FROM \`${t}\` ORDER BY id`)
    tablas[t] = JSON.parse(JSON.stringify(rows))
  }
  const [[runs]] = (await conn.query('SELECT COUNT(*) AS n FROM master_import_runs')) as unknown as [[{ n: number }]]
  return { tablas, importRuns: Number(runs.n) }
}

/** Fila de una tabla de la instantánea, por id. */
export function filaPorId(foto: FotoMaestros, tabla: (typeof TABLAS_MAESTROS)[number], id: number) {
  return (foto.tablas[tabla] as Array<Record<string, unknown>>).find((r) => r.id === id)
}
