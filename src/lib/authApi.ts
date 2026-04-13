import type { AuthUser, UserRole } from '../types'
import { apiFetch } from './apiClient'
import { clearSession, saveSession } from './session'

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; message: string }

function parseUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const role = String(o.role || '') as UserRole
  if (!['superadmin', 'admin', 'operador'].includes(role)) return null
  const id = Number(o.id)
  if (!Number.isFinite(id)) return null
  return {
    id,
    username: String(o.username || ''),
    fullName: String(o.fullName || o.full_name || ''),
    role,
  }
}

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, message: 'Credenciales inválidas o servidor no disponible.' }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, message: 'Respuesta inválida del servidor.' }
    }
    const token = String((data as { token?: string }).token || '')
    const user = parseUser((data as { user?: unknown }).user)
    if (!token || !user) {
      return { ok: false, message: 'No fue posible iniciar sesión.' }
    }
    saveSession(token, user)
    return { ok: true, user }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Error de red',
    }
  }
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await apiFetch('/api/auth/me')
    if (!res.ok) return null
    const data: unknown = await res.json().catch(() => ({}))
    if (!data || typeof data !== 'object') return null
    return parseUser((data as { user?: unknown }).user)
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // no-op
  } finally {
    clearSession()
  }
}
