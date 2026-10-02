import { expect, type APIRequestContext } from '@playwright/test'
import { API, sufijo } from './api'

export type Autor = { id: number; name: string } | null
export type Registro = {
  id: number
  code?: string
  name?: string
  is_active: number
  is_current?: number
  starts_on?: string | null
  ends_on?: string | null
  center_code?: string
  center_name?: string | null
  season_id?: number
  company_id?: number
  species_id?: number
  variety_id?: number
  csg_id?: number
  season_code?: string
  createdBy?: Autor
  updatedBy?: Autor
  createdAt?: string
  updatedAt?: string
}
export type Bundle = Record<'seasons' | 'companies' | 'species' | 'varieties' | 'csg' | 'jcForemen' | 'relations', Registro[]>
export type Tabla = keyof Bundle

export const TABLAS: Tabla[] = ['seasons', 'companies', 'species', 'varieties', 'csg', 'jcForemen', 'relations']

export const RUTA: Record<Tabla, string> = {
  seasons: '/api/admin/seasons',
  companies: '/api/admin/companies',
  species: '/api/admin/species',
  varieties: '/api/admin/varieties',
  csg: '/api/admin/csg',
  jcForemen: '/api/admin/jc-foremen',
  relations: '/api/admin/relations',
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function leerBundle(request: APIRequestContext, token: string): Promise<Bundle> {
  const res = await request.get(`${API()}/api/admin/masters`, { headers: auth(token) })
  expect(res.status(), 'GET /api/admin/masters').toBe(200)
  return (await res.json()) as Bundle
}

export async function postMaestro(request: APIRequestContext, token: string, ruta: string, data: object) {
  const res = await request.post(`${API()}${ruta}`, { headers: auth(token), data })
  return { status: res.status(), body: await res.json() }
}

export const pausa = (ms = 60) => new Promise((r) => setTimeout(r, ms))

/** Identificador de cada registro dentro de su tabla (código, o CC en relaciones). */
export const claveDe = (t: Tabla, r: Registro) => (t === 'relations' ? r.center_code : r.code)

export async function buscar(request: APIRequestContext, token: string, t: Tabla, clave: string): Promise<Registro> {
  const reg = (await leerBundle(request, token))[t].find((r) => claveDe(t, r) === clave)
  expect(reg, `${t} ${clave} debe existir`).toBeTruthy()
  return reg!
}

export type Contexto = { sfx: string; claves: Record<Tabla, string>; ids: Record<Tabla, number> }

/** Crea (con `token`) un registro nuevo en cada uno de los 7 maestros, con sufijo único. */
export async function crearLos7(request: APIRequestContext, token: string): Promise<Contexto> {
  const sfx = sufijo()
  const claves: Record<Tabla, string> = {
    seasons: `T${sfx}`,
    companies: `EMP${sfx}`,
    species: `ESP${sfx}`,
    varieties: `VAR${sfx}`,
    csg: `CSG${sfx}`,
    jcForemen: `JC${sfx}`,
    relations: `CC${sfx}`,
  }
  const ids = {} as Record<Tabla, number>
  const crear = async (t: Tabla, data: object) => {
    const r = await postMaestro(request, token, RUTA[t], data)
    expect(r.status, `alta ${t}`).toBe(200)
    expect(r.body.ok).toBe(true)
    ids[t] = (await buscar(request, token, t, claves[t])).id
  }
  await crear('seasons', { code: claves.seasons, name: `Temporada ${sfx}`, startsOn: '2030-01-01', endsOn: '2030-12-31', isCurrent: false })
  await crear('companies', { code: claves.companies, name: `Empresa ${sfx}` })
  await crear('species', { code: claves.species, name: `Especie ${sfx}` })
  await crear('varieties', { code: claves.varieties, name: `Variedad ${sfx}`, speciesId: ids.species })
  await crear('csg', { code: claves.csg, name: `CSG ${sfx}` })
  await crear('jcForemen', { code: claves.jcForemen, name: `Jefe ${sfx}` })
  await crear('relations', {
    seasonId: ids.seasons,
    companyId: ids.companies,
    centerCode: claves.relations,
    centerName: `Cuartel ${sfx}`,
    speciesId: ids.species,
    varietyId: ids.varieties,
    csgId: ids.csg,
  })
  return { sfx, claves, ids }
}

/** Payload que reenvía un formulario sin tocar nada (idéntico a lo guardado). */
export function payloadIdentico(t: Tabla, r: Registro): object {
  const isActive = r.is_active
  switch (t) {
    case 'seasons':
      return { id: r.id, code: r.code, name: r.name, startsOn: r.starts_on ?? '', endsOn: r.ends_on ?? '', isCurrent: Boolean(r.is_current), isActive }
    case 'varieties':
      return { id: r.id, code: r.code, name: r.name, speciesId: r.species_id, isActive }
    case 'relations':
      return {
        id: r.id,
        seasonId: r.season_id,
        companyId: r.company_id,
        centerCode: r.center_code,
        centerName: r.center_name ?? '',
        speciesId: r.species_id,
        varietyId: r.variety_id,
        csgId: r.csg_id,
        isActive,
      }
    default:
      return { id: r.id, code: r.code, name: r.name, isActive }
  }
}

/** Payload de edición: cambia el nombre (o el CC en relaciones). */
export function payloadEditado(t: Tabla, r: Registro, sufijoNuevo: string): object {
  const base = payloadIdentico(t, r) as Record<string, unknown>
  if (t === 'relations') return { ...base, centerName: `Editado ${sufijoNuevo}` }
  return { ...base, name: `Editado ${sufijoNuevo}` }
}

/** dd-mm-aaaa en hora de Chile, igual que RN-14. */
export function fechaChile(iso: string): string {
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(iso))
  const g = (t: string) => partes.find((p) => p.type === t)!.value
  return `${g('day')}-${g('month')}-${g('year')}`
}
