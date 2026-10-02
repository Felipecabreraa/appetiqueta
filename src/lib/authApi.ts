import type { AuthUser, UserRole } from '../types'
import { apiFetch } from './apiClient'
import { clearSession, getSessionToken, saveSession } from './session'

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

export function loginErrorMessage(kind: number | 'network'): string {
  if (kind === 'network') return 'Sin conexión con el servidor.'
  if (kind === 401) return 'Usuario o contraseña incorrectos.'
  if (kind === 429) return 'Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar.'
  if (kind >= 500 && kind <= 599) return 'El servidor tuvo un problema. Intente más tarde.'
  return 'No fue posible iniciar sesión.'
}

export async function login(username: string, password: string): Promise<LoginResult> {
  let res: Response
  try {
    res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return { ok: false, message: loginErrorMessage('network') }
  }
  try {
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, message: loginErrorMessage(res.status) }
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
  } catch {
    // Falla posterior a la respuesta (p. ej. storage bloqueado): no es un problema de red.
    return { ok: false, message: loginErrorMessage(0) }
  }
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getSessionToken()
  if (!token) return null
  try {
    const res = await apiFetch('/api/auth/me')
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) clearSession()
      return null
    }
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
