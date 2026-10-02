import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { loginAs } from './helpers/auth'
import { adminToken, API, irAModulo, sufijo } from './helpers/api'

test('CA-03: superadmin importa maestros desde Excel y el nuevo CC aparece en el catálogo', async ({
  page,
  request,
}, testInfo) => {
  const sfx = sufijo()
  const temporada = `E2E-${sfx}`
  const empresa = `Empresa Excel ${sfx}`
  const cc = `CCX-${sfx}`

  // Excel generado en el test (columnas esperadas por la importación)
  const ws = XLSX.utils.json_to_sheet([
    { empresa, cc, especie: 'Ciruela', variedad: 'Angeleno', csg: `CSGX-${sfx}` },
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Maestros')
  const archivo = testInfo.outputPath(`maestros-${sfx}.xlsx`)
  XLSX.writeFile(wb, archivo)

  await loginAs(page)
  await page.goto('/')
  await irAModulo(page, 'Maestros')
  await expect(page.getByRole('heading', { name: 'Carga maestra desde Excel' })).toBeVisible()

  await page.getByLabel('Código temporada').fill(temporada)
  await page.getByLabel('Nombre temporada').fill(`Temporada ${temporada}`)
  // No marcar como actual: evita alterar la temporada vigente que usan los demás tests.
  await page.getByLabel('Marcar como temporada actual').selectOption('0')
  await page.getByLabel('Archivo Excel').setInputFiles(archivo)
  await expect(page.getByText('Filas válidas detectadas:')).toBeVisible()

  await page.getByRole('button', { name: 'Importar maestros' }).click()
  await expect(page.getByText('Carga completada: 1 filas aplicadas de 1.')).toBeVisible()

  // Verificación en el servidor: catálogo de la nueva temporada
  const headers = { Authorization: `Bearer ${await adminToken(request)}` }
  const base = await (await request.get(`${API()}/api/master-data/catalog`, { headers })).json()
  const season = base.seasons.find((s: { code: string }) => s.code === temporada.toUpperCase().replace(/\s+/g, '_'))
  expect(season, 'la temporada importada debe existir').toBeTruthy()
  expect(season.is_current).toBeFalsy()

  const porTemporada = await (
    await request.get(`${API()}/api/master-data/catalog?seasonId=${season.id}`, { headers })
  ).json()
  const company = porTemporada.companies.find((c: { name: string }) => c.name === empresa)
  expect(company, 'la empresa importada debe existir').toBeTruthy()

  const conCc = await (
    await request.get(`${API()}/api/master-data/catalog?seasonId=${season.id}&companyId=${company.id}`, { headers })
  ).json()
  expect(conCc.costCenters).toEqual([
    expect.objectContaining({
      center_code: cc,
      especie: 'Ciruela',
      variedad: 'Angeleno',
      csg: `CSGX-${sfx}`,
    }),
  ])
})
