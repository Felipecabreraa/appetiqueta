import { apiFetch } from './apiClient'

export interface UserAdminItem {
  id: number
  username: string
  full_name: string
  role: 'superadmin' | 'admin' | 'operador'
  is_active: number
  created_at: string
}

export async function fetchUsers(): Promise<UserAdminItem[]> {
  const res = await apiFetch('/api/admin/users')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { users?: UserAdminItem[] }
  return data.users || []
}

export async function createUser(payload: {
  username: string
  fullName: string
  password: string
  role: 'superadmin' | 'admin' | 'operador'
}): Promise<void> {
  const res = await apiFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}

const RESET_ERRORS: Record<string, string> = {
  password_too_short: 'La contraseña debe tener al menos 8 caracteres.',
  password_too_long: 'La contraseña es demasiado larga.',
  user_not_found: 'El usuario ya no existe.',
  forbidden: 'Solo un SuperAdmin puede restablecer contraseñas.',
}

/** SuperAdmin define una contraseña nueva para un usuario; sus sesiones abiertas se cierran. */
export async function resetUserPassword(userId: number, password: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  if (res.ok) return
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(RESET_ERRORS[data.error || ''] || `No se pudo restablecer la contraseña (HTTP ${res.status}).`)
}
