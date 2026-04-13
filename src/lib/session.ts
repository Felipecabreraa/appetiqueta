import type { AuthUser } from '../types'

const TOKEN_KEY = 'appetiquetado:auth:token'
const USER_KEY = 'appetiquetado:auth:user'

export function getSessionToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function saveSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}
