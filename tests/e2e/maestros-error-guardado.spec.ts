import { expect, test } from '@playwright/test'
import { loginUsuario } from './helpers/api'
import { irACatalogo } from './helpers/maestros-ui'

const TEXTO_5XX =
  'Problema del servidor o de la base de datos al cargar o guardar Maestros. Intente de nuevo en unos segundos; si continúa, avise al administrador.'

test('CA-16: un error al guardar en un catálogo vacío no dice "No se pudieron cargar los registros."', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  await page.addInitScript(
    ([token, user]) => {
      localStorage.setItem('appetiquetado:auth:token', token)
      localStorage.setItem('appetiquetado:auth:user', JSON.stringify(user))
    },
    [admin.token, admin.user] as const,
  )
  await page.route('**/api/admin/masters', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        seasons: [],
        companies: [],
        species: [],
        csg: [],
        jcForemen: [],
        varieties: [],
        relations: [],
      }),
    }),
  )
  await page.route('**/api/admin/csg', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'db' }) }),
  )
  await page.goto('/#maestros/admin')
  const panel = page.locator('#panel-maestros-admin')
  await expect(panel).toBeVisible()
  await irACatalogo(page, 'CSG')
  await page.getByRole('button', { name: 'Nuevo CSG' }).first().click()
  await page.getByLabel('Código', { exact: true }).fill('CSGERR')
  await page.getByLabel('Nombre', { exact: true }).fill('CSG error de guardado')
  await page.getByRole('button', { name: 'Crear CSG' }).click()
  await expect(panel.getByRole('alert')).toHaveText(TEXTO_5XX)
  const lista = (await page.locator('#masters-panel-list').textContent()) ?? ''
  expect(lista).not.toContain('No se pudieron cargar los registros.')
})
