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
