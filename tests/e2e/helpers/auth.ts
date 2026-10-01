import type { Page } from '@playwright/test'

/** Inicia sesión por API y siembra la sesión en localStorage (más rápido y estable que la UI de login). */
export async function loginAs(page: Page, username = process.env.E2E_USER!, password = process.env.E2E_PASS!) {
  const res = await page.request.post(`${process.env.E2E_API_BASE}/api/auth/login`, {
    data: { username, password },
  })
  const body = await res.json()
  if (!body.ok) throw new Error(`Login E2E falló: ${body.error}`)
  await page.addInitScript(
    ([token, user]) => {
      localStorage.setItem('appetiquetado:auth:token', token)
      localStorage.setItem('appetiquetado:auth:user', JSON.stringify(user))
    },
    [body.token, body.user] as const,
  )
}
