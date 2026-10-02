import { expect, test } from '@playwright/test'
import { loginUsuario } from './helpers/api'

const TEXTO_5XX =
  'Problema del servidor o de la base de datos al cargar o guardar Maestros. Intente de nuevo en unos segundos; si continúa, avise al administrador.'

for (const [status, error] of [
  [500, 'db'],
  [503, 'db_unavailable'],
] as const) {
  test(`CA-16: Maestros ante ${status} ${error} muestra un mensaje en español y no el código crudo`, async ({ page, request }) => {
    const admin = await loginUsuario(request, 'admin')
    await page.addInitScript(
      ([token, user]) => {
        localStorage.setItem('appetiquetado:auth:token', token)
        localStorage.setItem('appetiquetado:auth:user', JSON.stringify(user))
      },
      [admin.token, admin.user] as const,
    )
    await page.route('**/api/admin/masters', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error }) }),
    )
    // Subpestaña "Mantenimiento en pantalla" (#maestros/admin); localizadores acotados a su panel.
    await page.goto('/#maestros/admin')
    const panel = page.locator('#panel-maestros-admin')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('alert')).toHaveText(TEXTO_5XX)
    await expect(panel.getByText('db', { exact: true })).toHaveCount(0)
    await expect(panel.getByText(error, { exact: true })).toHaveCount(0)
  })
}
