import { expect, type Locator, type Page } from '@playwright/test'

export type Catalogo = 'Relaciones' | 'Temporadas' | 'Empresas' | 'Especies' | 'Variedades' | 'CSG' | 'Jefes de cuadrilla'

export const CATALOGOS: Catalogo[] = ['Relaciones', 'Temporadas', 'Empresas', 'Especies', 'Variedades', 'CSG', 'Jefes de cuadrilla']

/** Abre directamente Maestros > Mantenimiento en pantalla por hash y espera a que cargue. */
export async function abrirMantenimiento(page: Page): Promise<void> {
  await page.goto('/#maestros/admin')
  await expect(page.getByRole('heading', { name: 'Mantenimiento en pantalla' })).toBeVisible()
  await expect(page.getByText('Sin permisos para editar maestros')).toHaveCount(0)
  await expect(page.getByText('Cargando registros…')).toHaveCount(0)
}

/** Selecciona un catálogo del maestro (los botones llevan el contador al final). */
export async function irACatalogo(page: Page, catalogo: Catalogo): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Módulos del maestro' })
    .getByRole('button', { name: new RegExp(`^${catalogo}`) })
    .click()
  await expect(page.getByRole('heading', { level: 3, name: catalogo })).toBeVisible()
}

/** Filtra el listado con el buscador y devuelve la(s) fila(s) que contienen el texto. */
export async function filaDe(page: Page, texto: string): Promise<Locator> {
  const buscador = page.getByPlaceholder('Buscar código, nombre o dato…')
  await buscador.fill(texto)
  const fila = page.getByRole('row').filter({ hasText: texto })
  await expect(fila).toHaveCount(1)
  return fila
}
