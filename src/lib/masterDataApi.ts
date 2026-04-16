import type {
  CompanyOption,
  CostCenterOption,
  MasterCompany,
  MasterCsg,
  MasterJcForeman,
  MasterRelation,
  MasterSeason,
  MasterSpecies,
  MasterVariety,
  JcForemanOption,
  SeasonOption,
} from '../types'
import { apiFetch } from './apiClient'

export interface CatalogResponse {
  seasonId: number | null
  seasons: SeasonOption[]
  companies: CompanyOption[]
  costCenters: CostCenterOption[]
}

export async function fetchCatalog(
  seasonId?: number | null,
  companyId?: number | null,
): Promise<CatalogResponse> {
  const params = new URLSearchParams()
  if (seasonId) params.set('seasonId', String(seasonId))
  if (companyId) params.set('companyId', String(companyId))
  const suffix = params.toString()
  const res = await apiFetch(`/api/master-data/catalog${suffix ? `?${suffix}` : ''}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as {
    seasonId?: number | null
    seasons?: SeasonOption[]
    companies?: CompanyOption[]
    costCenters?: CostCenterOption[]
  }
  return {
    seasonId: data.seasonId ?? null,
    seasons: data.seasons || [],
    companies: data.companies || [],
    costCenters: data.costCenters || [],
  }
}

export async function importMasterRows(payload: {
  season: { code: string; name: string; isCurrent: boolean }
  rows: Array<{ empresa: string; cc: string; especie: string; variedad: string; csg: string }>
}): Promise<{ received: number; applied: number }> {
  const res = await apiFetch('/api/master-data/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    received?: number
    applied?: number
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return {
    received: Number(data.received || 0),
    applied: Number(data.applied || 0),
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  }
  return data
}

export async function fetchMasterAdminData(): Promise<{
  seasons: MasterSeason[]
  companies: MasterCompany[]
  species: MasterSpecies[]
  csg: MasterCsg[]
  jcForemen: MasterJcForeman[]
  varieties: MasterVariety[]
  relations: MasterRelation[]
}> {
  const res = await apiFetch('/api/admin/masters')
  return parseOrThrow(res)
}

export async function upsertSeason(payload: {
  id?: number
  code: string
  name: string
  startsOn?: string | null
  endsOn?: string | null
  isCurrent?: boolean
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/seasons', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function upsertCompany(payload: {
  id?: number
  code: string
  name: string
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function upsertSpecies(payload: {
  id?: number
  code: string
  name: string
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/species', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function upsertCsg(payload: {
  id?: number
  code: string
  name: string
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/csg', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function upsertJcForeman(payload: {
  id?: number
  code: string
  name: string
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/jc-foremen', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function upsertVariety(payload: {
  id?: number
  code: string
  name: string
  speciesId: number
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/varieties', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}

export async function fetchJcForemen(): Promise<JcForemanOption[]> {
  const res = await apiFetch('/api/master-data/jc-foremen')
  const data = await parseOrThrow<{ foremen?: JcForemanOption[] }>(res)
  return data.foremen || []
}

export async function upsertRelation(payload: {
  id?: number
  seasonId: number
  companyId: number
  centerCode: string
  centerName: string
  speciesId: number
  varietyId: number
  csgId: number
  isActive?: boolean
}): Promise<void> {
  const res = await apiFetch('/api/admin/relations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  await parseOrThrow(res)
}
