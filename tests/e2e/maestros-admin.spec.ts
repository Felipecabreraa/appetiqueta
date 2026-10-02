import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { loginAs } from './helpers/auth'
import { API, abrirMenuSiHaceFalta, irAModulo, loginUsuario, sufijo } from './helpers/api'
import { conectarBd } from './helpers/db'
import { abrirMantenimiento, filaDe, irACatalogo } from './helpers/maestros-ui'
import { auth, crearLos7, leerBundle, postMaestro, RUTA } from './helpers/maestros'

test('CA-02: admin ve Maestros y no Usuarios en la sección Administración del Resumen', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  await loginAs(page, admin.username, admin.password)
  await page.goto('/')
  await irAModulo(page, 'Resumen')
  const seccion = page.getByRole('region', { name: 'Administración' })
  await expect(seccion).toBeVisible()
  await expect(seccion.getByRole('button', { name: /Maestros/ })).toBeVisible()
  await expect(seccion.getByRole('button', { name: /Usuarios/ })).toHaveCount(0)
})

test('CA-03: admin abre Mantenimiento en pantalla y ve los 7 catálogos con datos', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  await loginAs(page, admin.username, admin.password)
  await abrirMantenimiento(page)
  const esperado: Array<[Parameters<typeof irACatalogo>[1], string]> = [
    ['Relaciones', 'CC01'],
    ['Temporadas', '2025-2026'],
    ['Empresas', 'Agrícola Esmeralda'],
    ['Especies', 'Cereza'],
    ['Variedades', 'Lapins'],
    ['CSG', 'CSG001'],
    ['Jefes de cuadrilla', 'Juan Pérez'],
  ]
  for (const [catalogo, texto] of esperado) {
    await irACatalogo(page, catalogo)
    await expect(page.getByRole('row').filter({ hasText: texto }).first(), `${catalogo} lista ${texto}`).toBeVisible()
  }
})

test('CA-04: admin crea un CSG desde la UI y queda activo en el servidor', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const codigo = `CSGUI${sfx}`
  await loginAs(page, admin.username, admin.password)
  await abrirMantenimiento(page)
  await irACatalogo(page, 'CSG')
  await page.getByRole('button', { name: 'Nuevo CSG' }).first().click()
  await page.getByLabel('Código', { exact: true }).fill(codigo)
  await page.getByLabel('Nombre', { exact: true }).fill(`CSG UI ${sfx}`)
  await page.getByRole('button', { name: 'Crear CSG' }).click()
  await expect(page.getByText('CSG creado.')).toBeVisible()
  await expect(await filaDe(page, codigo)).toBeVisible()

  const csg = (await leerBundle(request, admin.token)).csg.find((r) => r.code === codigo)
  expect(csg, 'el CSG existe en GET /api/admin/masters').toBeTruthy()
  expect(csg!.is_active).toBe(1)
})

test('CA-05: admin edita y desactiva un jefe de cuadrilla; chip e filtro "Inactivo(s)"', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  const ctx = await crearLos7(request, admin.token)
  const codigo = ctx.claves.jcForemen
  const nuevoNombre = `Jefe Editado ${ctx.sfx}`

  await loginAs(page, admin.username, admin.password)
  await abrirMantenimiento(page)
  await irACatalogo(page, 'Jefes de cuadrilla')
  const fila = await filaDe(page, codigo)
  await fila.getByRole('button', { name: 'Editar' }).click()
  const editor = page.locator('#masters-panel-form')
  await editor.getByLabel('Nombre', { exact: true }).fill(nuevoNombre)
  await editor.locator('label').filter({ hasText: /^Estado/ }).locator('select').selectOption({ label: 'Inactivo' })
  await page.getByRole('button', { name: 'Guardar jefe de cuadrilla' }).click()
  await expect(page.getByText('Jefe de cuadrilla actualizado.')).toBeVisible()

  const filaNueva = await filaDe(page, codigo)
  await expect(filaNueva).toContainText(nuevoNombre)
  await expect(filaNueva).toContainText('Inactivo')
  await expect(filaNueva).not.toContainText('Archivado')

  const filtro = page.getByRole('group', { name: 'Filtrar por estado' })
  await expect(filtro.getByRole('button', { name: 'Inactivos', exact: true })).toBeVisible()
  await expect(filtro.getByRole('button', { name: 'Archivados' })).toHaveCount(0)
  await filtro.getByRole('button', { name: 'Inactivos', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: codigo })).toHaveCount(1)
  await filtro.getByRole('button', { name: 'Activos', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: codigo })).toHaveCount(0)

  const publico = await (await request.get(`${API()}/api/master-data/jc-foremen`)).json()
  expect(JSON.stringify(publico.foremen)).not.toContain(nuevoNombre)
})

test('CA-06: admin importa maestros desde Excel por UI y queda como imported_by', async ({ page, request }, testInfo) => {
  const admin = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const temporada = `E2E-ADM-${sfx}`
  const empresa = `Empresa Admin ${sfx}`
  const cc = `CCA-${sfx}`
  const ws = XLSX.utils.json_to_sheet([{ empresa, cc, especie: 'Ciruela', variedad: 'Angeleno', csg: `CSGA-${sfx}` }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Maestros')
  const archivo = testInfo.outputPath(`maestros-admin-${sfx}.xlsx`)
  XLSX.writeFile(wb, archivo)

  await loginAs(page, admin.username, admin.password)
  await page.goto('/')
  await irAModulo(page, 'Maestros')
  await expect(page.getByRole('heading', { name: 'Carga maestra desde Excel' })).toBeVisible()
  await page.getByLabel('Código temporada').fill(temporada)
  await page.getByLabel('Nombre temporada').fill(`Temporada ${temporada}`)
  await page.getByLabel('Marcar como temporada actual').selectOption('0')
  await page.getByLabel('Archivo Excel').setInputFiles(archivo)
  await expect(page.getByText('Filas válidas detectadas:')).toBeVisible()
  await page.getByRole('button', { name: 'Importar maestros' }).click()
  await expect(page.getByText('Carga completada: 1 filas aplicadas de 1.')).toBeVisible()

  const headers = auth(admin.token)
  const base = await (await request.get(`${API()}/api/master-data/catalog`, { headers })).json()
  const season = base.seasons.find((s: { code: string }) => s.code === temporada.toUpperCase())
  expect(season, 'la temporada importada debe existir').toBeTruthy()
  const porTemporada = await (await request.get(`${API()}/api/master-data/catalog?seasonId=${season.id}`, { headers })).json()
  const company = porTemporada.companies.find((c: { name: string }) => c.name === empresa)
  expect(company).toBeTruthy()
  const conCc = await (
    await request.get(`${API()}/api/master-data/catalog?seasonId=${season.id}&companyId=${company.id}`, { headers })
  ).json()
  expect(conCc.costCenters).toEqual([expect.objectContaining({ center_code: cc })])

  const conn = await conectarBd()
  try {
    const [rows] = await conn.execute('SELECT imported_by FROM master_import_runs WHERE season_id = ?', [season.id])
    expect((rows as Array<{ imported_by: number }>).map((r) => r.imported_by)).toEqual([admin.user.id])
  } finally {
    await conn.end()
  }
})

test('CA-10: admin que fuerza /#usuarios es redirigido al Resumen con aviso', async ({ page, request }) => {
  const admin = await loginUsuario(request, 'admin')
  await loginAs(page, admin.username, admin.password)
  await page.goto('/#usuarios')
  await expect(page.getByRole('heading', { name: /^Hola,/ })).toBeVisible()
  await expect(page.getByText('No tiene permisos para acceder al módulo "Usuarios".')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('No tiene permisos para acceder al módulo "Usuarios".')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Usuarios y roles' })).toHaveCount(0)
})

test('CA-16: sesión de admin abierta (token previo) ve Maestros al recargar y el mismo token responde 200', async ({ page, request }) => {
  // El token se obtiene ANTES de navegar y se siembra tal cual (sin volver a iniciar sesión).
  const admin = await loginUsuario(request, 'admin')
  await page.addInitScript(
    ([token, user]) => {
      localStorage.setItem('appetiquetado:auth:token', token)
      localStorage.setItem('appetiquetado:auth:user', JSON.stringify(user))
    },
    [admin.token, admin.user] as const,
  )
  await page.goto('/')
  await page.reload()
  await abrirMenuSiHaceFalta(page)
  await expect(
    page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: 'Maestros', exact: true }),
  ).toBeVisible()
  const res = await request.get(`${API()}/api/admin/masters`, { headers: auth(admin.token) })
  expect(res.status()).toBe(200)
  const alta = await postMaestro(request, admin.token, RUTA.csg, { code: `CSG16${sufijo()}`, name: `CSG sesión previa ${sufijo()}` })
  expect(alta.status).toBe(200)
})
