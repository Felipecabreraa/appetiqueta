import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { API, crearEtiqueta, irAModulo } from './helpers/api'

test('Registrar lecturas (escritorio): el primer JC exige y guarda precio y JH; el acopio cierra el circuito', async ({ page, request }) => {
  const id = await crearEtiqueta(request, 'S-ESC')
  await loginAs(page)
  await page.goto('/')
  await irAModulo(page, 'Registrar lecturas')

  await page.getByLabel('Código de la etiqueta').fill(id)
  await page.getByLabel('Totes en salida').fill('14')
  await page.getByLabel('Jefe de cuadrilla').fill('Juan Pérez')
  await page.getByLabel('JH (personas en cuadrilla)').fill('7')
  const guardar = page.getByRole('button', { name: 'Guardar esta lectura' })

  // Sin precio no se guarda
  await guardar.click()
  await expect(page.getByText('indique el precio en CLP', { exact: false })).toBeVisible()

  await page.getByLabel('Precio (CLP)').fill('1300')
  await guardar.click()
  await expect(page.getByText(`14 totes para ${id}`, { exact: false })).toBeVisible()

  const s1 = await (await request.get(`${API()}/api/labels/${id}`)).json()
  expect(s1.label.cantidad_totes).toBe(14)
  expect(s1.label.jefe_cuadrilla).toBe('Juan Pérez')
  expect(s1.movements[0]).toMatchObject({ type: 'jc', cantidad: 14, precio_clp: 1300, jh: 7 })

  await page.getByLabel('Totes que llegaron').fill('13')
  await guardar.click()
  await expect(page.getByText(`13 totes para ${id}`, { exact: false })).toBeVisible()
  const s2 = await (await request.get(`${API()}/api/labels/${id}`)).json()
  expect(s2.movements.filter((m: { type: string }) => m.type === 'acopio')[0].cantidad).toBe(13)
})
