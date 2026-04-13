export interface LabelRecord {
  /** Identificador único de la etiqueta y del QR (no se repite entre etiquetas). */
  id: string
  createdAt: string
  fecha: string
  exportacion: string
  empresa: string
  csg: string
  especie: string
  variedad: string
  centroCosto: string
  seasonId?: number | null
  companyId?: number | null
  seasonCostCenterId?: number | null
  sector: string
  /** Se completa en el primer trackeo JC (lectura QR), no al generar la etiqueta. */
  cantidadTotes: number | null
  /** Se completa en el primer trackeo JC. */
  jefeCuadrilla: string
}

export type UserRole = 'superadmin' | 'admin' | 'operador'

export interface AuthUser {
  id: number
  username: string
  fullName: string
  role: UserRole
}

export interface SeasonOption {
  id: number
  code: string
  name: string
  is_current: number
}

export interface CompanyOption {
  id: number
  name: string
}

export interface CostCenterOption {
  id: number
  center_code: string
  center_name: string
  especie: string
  variedad: string
  csg: string
}

export interface MasterSeason {
  id: number
  code: string
  name: string
  starts_on: string | null
  ends_on: string | null
  is_current: number
  is_active: number
}

export interface MasterCompany {
  id: number
  code: string
  name: string
  is_active: number
}

export interface MasterSpecies {
  id: number
  code: string
  name: string
  is_active: number
}

export interface MasterCsg {
  id: number
  code: string
  name: string
  is_active: number
}

export interface MasterVariety {
  id: number
  code: string
  name: string
  species_id: number
  species_name?: string
  is_active: number
}

export interface MasterRelation {
  id: number
  season_id: number
  season_code?: string
  company_id: number
  company_name?: string
  center_code: string
  center_name: string
  species_id: number
  species_name?: string
  variety_id: number
  variety_name?: string
  csg_id: number
  csg_name?: string
  is_active: number
}

/** Trackeo JC = primera validación (totes en salida). Trackeo Acopio = segunda lectura QR (totes que llegaron al acopio). */
export type MovementType = 'jc' | 'acopio'

export interface Movement {
  labelId: string
  type: MovementType
  cantidad: number
  at: string
  /** Nombre u operador opcional (flujo por QR); persiste en este dispositivo. */
  registeredBy?: string
}
