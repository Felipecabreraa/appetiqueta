import { getSessionToken } from './session'

function baseUrl(): string {
  const raw = import.meta.env.VITE_SYNC_API_BASE?.trim()
  return raw ? raw.replace(/\/$/, '') : ''
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')
  const token = getSessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${baseUrl()}${path}`, {
    ...options,
    headers,
  })
}
