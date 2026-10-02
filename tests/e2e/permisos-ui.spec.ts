import { expect, test, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { abrirMenuSiHaceFalta, crearUsuario, irAModulo } from './helpers/api'

const modulos = (page: Page) => page.getByRole('navigation', { name: 'Módulos' })

test('CA-05: operador no ve Resumen, Maestros ni Usuarios ni puede exportar el Excel', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  await loginAs(page, u.username, u.password)
  await page.goto('/')
  await abrirMenuSiHaceFalta(page)

  await expect(modulos(page).getByRole('button', { name: 'Crear etiquetas', exact: true })).toBeVisible()
  await expect(modulos(page).getByRole('button', { name: 'Registrar lecturas', exact: true })).toBeVisible()
  for (const nombre of ['Resumen', 'Maestros', 'Usuarios']) {
    await expect(modulos(page).getByRole('button', { name: nombre, exact: true })).toHaveCount(0)
  }

  await modulos(page).getByRole('button', { name: 'Registrar lecturas', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Descargar Excel (.xlsx)' })).toBeDisabled()
  await expect(page.getByText('Solo perfiles con acceso administrativo', { exact: false })).toBeVisible()
})

test('CA-05: operador que fuerza la URL de Maestros es redirigido a su módulo por defecto', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  await loginAs(page, u.username, u.password)
  await page.goto('/#maestros/excel')
  await expect(page.getByRole('heading', { name: 'Nueva generación' })).toBeVisible()
  // El aviso debe permanecer aunque llegue la sesión validada del servidor (fix/aviso-permisos).
  await expect(page.getByText('No tiene permisos para acceder al módulo "Maestros".')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('No tiene permisos para acceder al módulo "Maestros".')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Carga maestra desde Excel' })).toHaveCount(0)
})

test('CA-01: admin ve Resumen, Crear etiquetas, Lecturas y Maestros, no Usuarios, y sí exporta', async ({ page, request }) => {
  const u = await crearUsuario(request, 'admin')
  await loginAs(page, u.username, u.password)
  await page.goto('/')
  await abrirMenuSiHaceFalta(page)

  for (const nombre of ['Resumen', 'Crear etiquetas', 'Registrar lecturas', 'Maestros']) {
    await expect(modulos(page).getByRole('button', { name: nombre, exact: true })).toBeVisible()
  }
  await expect(modulos(page).getByRole('button', { name: 'Usuarios', exact: true })).toHaveCount(0)

  await modulos(page).getByRole('button', { name: 'Registrar lecturas', exact: true }).click()
  const boton = page.getByRole('button', { name: 'Descargar Excel (.xlsx)' })
  await expect(boton).toBeEnabled()
  const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()])
  expect(descarga.suggestedFilename()).toMatch(/\.xlsx$/)
})

test('CA-05: superadmin ve todos los módulos y puede exportar', async ({ page }) => {
  await loginAs(page)
  await page.goto('/')
  await abrirMenuSiHaceFalta(page)

  for (const nombre of ['Resumen', 'Crear etiquetas', 'Registrar lecturas', 'Maestros', 'Usuarios']) {
    await expect(modulos(page).getByRole('button', { name: nombre, exact: true })).toBeVisible()
  }
  await irAModulo(page, 'Registrar lecturas')
  await expect(page.getByRole('button', { name: 'Descargar Excel (.xlsx)' })).toBeEnabled()
})
