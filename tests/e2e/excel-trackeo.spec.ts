import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { loginAs } from './helpers/auth'
import { cicloJcAcopio, crearEtiqueta, irAModulo } from './helpers/api'

type Fila = Record<string, string | number>

function filasDeHoja(wb: XLSX.WorkBook, nombre: string): Fila[] {
  const hoja = wb.Sheets[nombre]
  expect(hoja, `debe existir la hoja "${nombre}"`).toBeTruthy()
  return XLSX.utils.sheet_to_json<Fila>(hoja, { defval: '' })
}

test('CA-04: el Excel de trackeo incluye la etiqueta en las hojas JC y Acopio con sus cantidades', async ({
  page,
  request,
}) => {
  const id = await crearEtiqueta(request, 'S-XLSX')
  await cicloJcAcopio(request, id, 7, 6)

  await loginAs(page)
  await page.goto('/')
  await irAModulo(page, 'Registrar lecturas')
  const boton = page.getByRole('button', { name: 'Descargar Excel (.xlsx)' })
  await expect(boton).toBeEnabled()

  const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()])
  expect(descarga.suggestedFilename()).toMatch(/\.xlsx$/)
  const ruta = await descarga.path()
  const wb = XLSX.read(readFileSync(ruta), { type: 'buffer' })
  expect(wb.SheetNames).toEqual(expect.arrayContaining(['JC - Primera lectura QR', 'Acopio - Segunda lectura QR']))

  const jc = filasDeHoja(wb, 'JC - Primera lectura QR').filter((f) => f['Codigo etiqueta (QR)'] === id)
  expect(jc).toHaveLength(1)
  expect(jc[0]['Cantidad totes (salida JC)']).toBe(7)
  expect(jc[0]['Precio (CLP)']).toBe(1500)
  expect(jc[0]['JH (personas en cuadrilla)']).toBe(8)
  expect(jc[0]['Sector']).toBe('S-XLSX')
  expect(jc[0]['Jefe cuadrilla (etiqueta)']).toBe('Juan Pérez')

  const acopio = filasDeHoja(wb, 'Acopio - Segunda lectura QR').filter((f) => f['Codigo etiqueta (QR)'] === id)
  expect(acopio).toHaveLength(1)
  expect(acopio[0]['Cantidad totes (llegada al acopio)']).toBe(6)
  expect(acopio[0]['Centro costo']).toBe('CC01')
})
