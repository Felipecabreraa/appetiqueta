import { expect, test, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { API, irAModulo } from './helpers/api'

async function abrirCrearEtiquetas(page: Page) {
  await loginAs(page)
  await page.goto('/')
  await irAModulo(page, 'Crear etiquetas')
  await expect(page.getByRole('heading', { name: 'Nueva generación' })).toBeVisible()
}

test('CA-01: superadmin genera un lote de 3 etiquetas con QR y quedan en el servidor', async ({ page, request }) => {
  await abrirCrearEtiquetas(page)

  await page.getByLabel('Cantidad de etiquetas').fill('3')
  await page.getByRole('button', { name: 'Completar datos del lote' }).click()

  const dialogo = page.getByRole('dialog', { name: 'Datos del lote' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Temporada').selectOption({ label: '2025-2026 - Temporada 2025-2026' })
  await dialogo.getByLabel('Empresa').selectOption({ label: 'Agrícola Esmeralda' })
  await dialogo.getByLabel('Centro de costo (CC)').selectOption({ label: 'CC01 - Cuartel 1' })

  // Autocompletado desde el maestro
  await expect(dialogo.getByLabel('Especie (automático)')).toHaveValue('Cereza')
  await expect(dialogo.getByLabel('Variedad (automático)')).toHaveValue('Lapins')
  await expect(dialogo.getByLabel('CSG (automático)')).toHaveValue('CSG001')

  await dialogo.getByLabel('Sector').fill('S-UI-E2E')
  await dialogo.getByRole('button', { name: 'Guardar y continuar' }).click()
  await expect(dialogo).toBeHidden()

  await page.getByRole('button', { name: 'Generar 3 etiquetas (mismo lote)' }).click()

  await expect(page.getByText('3 etiquetas con los mismos datos', { exact: false })).toBeVisible()
  await expect(page.locator('.label-preview-wrap .label-sheet svg').first()).toBeVisible()

  await page.getByText('Códigos del lote (3)').click()
  const items = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Abrir en lecturas' }) })
  await expect(items).toHaveCount(3)
  const ids = (await items.locator('code').allTextContents()).map((s) => s.trim())
  expect(new Set(ids).size).toBe(3)
  for (const id of ids) expect(id).toMatch(/^[A-Z2-9]{12}$/)

  // El push al servidor es asíncrono: se espera hasta que existan las 3.
  for (const id of ids) {
    await expect
      .poll(async () => (await request.get(`${API()}/api/labels/${id}`)).status(), { timeout: 15_000 })
      .toBe(200)
    const body = await (await request.get(`${API()}/api/labels/${id}`)).json()
    expect(body.label).toMatchObject({
      id,
      empresa: 'Agrícola Esmeralda',
      centro_costo: 'CC01',
      especie: 'Cereza',
      variedad: 'Lapins',
      csg: 'CSG001',
      sector: 'S-UI-E2E',
    })
  }
})

test('CA-02: no se puede generar con campos obligatorios vacíos', async ({ page }) => {
  await abrirCrearEtiquetas(page)

  const generar = page.getByRole('button', { name: 'Generar 1 etiqueta' })
  await expect(generar).toBeDisabled()
  await expect(page.getByText('El botón se habilita cuando el formulario del lote esté completo.')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Pendiente' })).toBeVisible()

  // Datos parciales (solo sector, sin empresa/CC): sigue deshabilitado
  await page.getByRole('button', { name: 'Completar datos del lote' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Datos del lote' })
  await dialogo.getByLabel('Sector').fill('S-PARCIAL')
  await dialogo.getByRole('button', { name: 'Seguir más tarde' }).click()
  await expect(dialogo).toBeHidden()
  await expect(generar).toBeDisabled()

  // Completa todo menos el sector: sigue deshabilitado
  await page.getByRole('button', { name: 'Completar datos del lote' }).click()
  await dialogo.getByLabel('Sector').fill('')
  await dialogo.getByLabel('Temporada').selectOption({ label: '2025-2026 - Temporada 2025-2026' })
  await dialogo.getByLabel('Empresa').selectOption({ label: 'Agrícola Esmeralda' })
  await dialogo.getByLabel('Centro de costo (CC)').selectOption({ label: 'CC01 - Cuartel 1' })
  await expect(dialogo.getByLabel('Especie (automático)')).toHaveValue('Cereza')
  await dialogo.getByRole('button', { name: 'Seguir más tarde' }).click()
  await expect(generar).toBeDisabled()
})
