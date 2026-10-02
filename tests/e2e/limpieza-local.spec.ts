import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { irAModulo } from './helpers/api'

const LOTE_VIEJO = [
  { id: 'lote-viejo', createdAt: '2026-01-01T10:00:00.000Z', count: 1, labelIds: ['VIEJO2345678'], empresa: 'Vieja SA', especie: 'Cereza' },
]

async function sembrarHistorialLocal(page: Page, epoca: string | null) {
  await page.addInitScript(
    ([lotes, ep]) => {
      if (sessionStorage.getItem('e2e-sembrado')) return
      sessionStorage.setItem('e2e-sembrado', '1')
      localStorage.setItem('appetiquetado:batches', JSON.stringify(lotes))
      localStorage.setItem(
        'appetiquetado:labels',
        JSON.stringify([{ id: 'VIEJO2345678', createdAt: '2026-01-01T10:00:00.000Z', fecha: 'x', exportacion: '', empresa: 'Vieja SA', csg: 'x', especie: 'Cereza', variedad: 'x', centroCosto: 'x', sector: 'x', cantidadTotes: null, jefeCuadrilla: '' }]),
      )
      if (ep) localStorage.setItem('appetiquetado:operationalEpoch', ep)
      else localStorage.removeItem('appetiquetado:operationalEpoch')
    },
    [LOTE_VIEJO, epoca] as const,
  )
}

async function epocaServidor(page: Page): Promise<string> {
  return (await (await page.request.get(`${process.env.E2E_API_BASE}/api/health`)).json()).operationalEpoch
}

test('CA-05: tras vaciar la BD, el navegador borra solo su historial de lotes y etiquetas locales', async ({ page }) => {
  const epocaAnterior = await epocaServidor(page)
  await loginAs(page)
  await sembrarHistorialLocal(page, epocaAnterior)

  // El script de limpieza registra una nueva época operativa (BD local de pruebas).
  execFileSync(process.execPath, ['scripts/db-limpiar-operacion.mjs', '--env', '.env.test', '--confirmar', 'appetiquetado_test'], { stdio: 'ignore' })
  const epocaNueva = await epocaServidor(page)
  expect(epocaNueva).not.toBe(epocaAnterior)

  await page.goto('/')
  await irAModulo(page, 'Crear etiquetas')
  await expect(page.getByText('Sin lotes aún')).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('appetiquetado:operationalEpoch'))).toBe(epocaNueva)
  expect(await page.evaluate(() => localStorage.getItem('appetiquetado:labels'))).toBe('[]')
})

test('CA-06: si la época no cambió, el historial local se conserva', async ({ page }) => {
  await loginAs(page)
  await sembrarHistorialLocal(page, await epocaServidor(page))
  await page.goto('/')
  await irAModulo(page, 'Crear etiquetas')
  await expect(page.getByRole('cell', { name: /Vieja SA/ }).first()).toBeVisible()
})
