import type { AppTab } from '../appTabs'
import type { UserRole } from '../types'

const ROLE_TABS: Record<UserRole, AppTab[]> = {
  superadmin: ['dashboard', 'generar', 'trazabilidad', 'maestros', 'usuarios'],
  admin: ['dashboard', 'generar', 'trazabilidad'],
  operador: ['generar', 'trazabilidad'],
}

const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  operador: 'Operador',
}

export function getAllowedTabs(role: UserRole): AppTab[] {
  return ROLE_TABS[role]
}

export function canAccessTab(role: UserRole, tab: AppTab): boolean {
  return ROLE_TABS[role].includes(tab)
}

export function getDefaultTabForRole(role: UserRole): AppTab {
  return role === 'operador' ? 'generar' : 'dashboard'
}

export function getRoleLabel(role: UserRole): string {
  return ROLE_LABEL[role]
}
