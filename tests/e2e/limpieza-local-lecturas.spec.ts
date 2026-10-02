import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/auth'

test('CA-05: al abrir directamente en Registrar lecturas, el acceso rápido también se limpia', async ({ page }) => {
  await loginAs(page)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-sembrado')) return
    sessionStorage.setItem('e2e-sembrado', '1')
    localStorage.setItem(
      'appetiquetado:labels',
      JSON.stringify([{ id: 'VIEJO2345678', createdAt: '2026-01-01T10:00:00.000Z', fecha: 'x', exportacion: '', empresa: 'Vieja SA', csg: 'x', especie: 'CIRUELA', variedad: 'x', centroCosto: 'x', sector: 'x', cantidadTotes: null, jefeCuadrilla: '' }]),
    )
    localStorage.setItem('appetiquetado:batches', JSON.stringify([{ id: 'l', createdAt: '2026-01-01T10:00:00.000Z', count: 1, labelIds: ['VIEJO2345678'], empresa: 'Vieja SA', especie: 'CIRUELA' }]))
    localStorage.setItem('appetiquetado:operationalEpoch', 'epoca-vieja')
  })
  await page.goto('/#trazabilidad')
  await expect(page.getByRole('heading', { name: 'Registrar lecturas' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('appetiquetado:operationalEpoch'))).not.toBe('epoca-vieja')
  // Ya limpiado el almacenamiento: la pantalla abierta no debe seguir mostrando la etiqueta vieja.
  await expect(page.getByText('VIEJO2345678')).toHaveCount(0)
  await page.goto('/#generar')
  await expect(page.getByText('Sin lotes aún')).toBeVisible()
  await expect(page.getByText('VIEJO2345678')).toHaveCount(0)
})

test('control: con la misma época, el acceso rápido muestra las etiquetas locales', async ({ page }) => {
  const epoca = (await (await page.request.get(`${process.env.E2E_API_BASE}/api/health`)).json()).operationalEpoch
  await loginAs(page)
  await page.addInitScript((ep) => {
    if (sessionStorage.getItem('e2e-sembrado')) return
    sessionStorage.setItem('e2e-sembrado', '1')
    localStorage.setItem(
      'appetiquetado:labels',
      JSON.stringify([{ id: 'VIEJO2345678', createdAt: '2026-01-01T10:00:00.000Z', fecha: 'x', exportacion: '', empresa: 'Vieja SA', csg: 'x', especie: 'CIRUELA', variedad: 'x', centroCosto: 'x', sector: 'x', cantidadTotes: null, jefeCuadrilla: '' }]),
    )
    localStorage.setItem('appetiquetado:operationalEpoch', ep)
  }, epoca)
  await page.goto('/#trazabilidad')
  await expect(page.getByText('VIEJO2345678').first()).toBeVisible()
})
