import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const API = () => process.env.E2E_API_BASE!

/** Token del superadmin de pruebas. */
export async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API()}/api/auth/login`, {
    data: { username: process.env.E2E_USER, password: process.env.E2E_PASS },
  })
  return (await res.json()).token
}

export function sufijo(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase()
}

/** Crea una etiqueta (CC01 / Cereza / Lapins / CSG001) por API y devuelve su id. */
export async function crearEtiqueta(request: APIRequestContext, sector = 'S-E2E'): Promise<string> {
  const id = `E2E${sufijo()}`.padEnd(12, 'X').slice(0, 12)
  const res = await request.post(`${API()}/api/labels/batch`, {
    headers: { Authorization: `Bearer ${await adminToken(request)}` },
    data: {
      labels: [
        {
          id,
          fecha: '2026-01-15T08:00',
          empresa: 'Agrícola Esmeralda',
          csg: 'CSG001',
          especie: 'Cereza',
          variedad: 'Lapins',
          centroCosto: 'CC01',
          sector,
          cantidadTotes: null,
        },
      ],
    },
  })
  expect((await res.json()).ok).toBe(true)
  return id
}

/** Registra JC y acopio por API (misma regla del servidor que el flujo QR). */
export async function cicloJcAcopio(
  request: APIRequestContext,
  id: string,
  totesJc: number,
  totesAcopio: number,
): Promise<void> {
  const jc = await request.post(`${API()}/api/movements`, {
    data: {
      labelId: id,
      type: 'jc',
      cantidad: totesJc,
      at: new Date().toISOString(),
      jefeCuadrilla: 'Juan Pérez',
      precioClp: 1500,
      jh: 8,
    },
  })
  expect((await jc.json()).ok).toBe(true)
  const ac = await request.post(`${API()}/api/movements`, {
    data: { labelId: id, type: 'acopio', cantidad: totesAcopio, at: new Date().toISOString() },
  })
  expect((await ac.json()).ok).toBe(true)
}

/** Crea un usuario por API (requiere token superadmin) y devuelve sus credenciales. */
export async function crearUsuario(
  request: APIRequestContext,
  role: 'admin' | 'operador',
): Promise<{ username: string; password: string }> {
  const username = `e2e_${role}_${sufijo().toLowerCase()}`
  const password = `Pw-${sufijo()}`
  const res = await request.post(`${API()}/api/admin/users`, {
    headers: { Authorization: `Bearer ${await adminToken(request)}` },
    data: { username, fullName: `E2E ${role}`, password, role },
  })
  expect((await res.json()).ok).toBe(true)
  return { username, password }
}

/** En móvil el menú está colapsado: abre el menú hamburguesa si es visible (en desktop no lo es). */
export async function abrirMenuSiHaceFalta(page: Page): Promise<void> {
  await expect(page.getByRole('banner')).toBeVisible()
  const hamburguesa = page.getByRole('button', { name: 'Abrir menú de navegación' })
  if ((await hamburguesa.isVisible()) && (await hamburguesa.getAttribute('aria-expanded')) !== 'true') {
    await hamburguesa.click()
  }
  await expect(page.getByRole('navigation', { name: 'Módulos' })).toBeVisible()
}

/** Navega a un módulo desde el menú lateral. */
export async function irAModulo(page: Page, nombre: string): Promise<void> {
  await abrirMenuSiHaceFalta(page)
  await page
    .getByRole('navigation', { name: 'Módulos' })
    .getByRole('button', { name: nombre, exact: true })
    .click()
}
