import { describe, expect, it } from 'vitest'
import {
  canAccessTab,
  canExportTrackingExcel,
  getAllowedTabs,
  getDefaultTabForRole,
} from '../../src/lib/roleAccess'

describe('roleAccess', () => {
  it('CA-15: admin accede a maestros pero no a usuarios; superadmin a ambos; operador a ninguno', () => {
    expect(canAccessTab('superadmin', 'maestros')).toBe(true)
    expect(canAccessTab('superadmin', 'usuarios')).toBe(true)
    expect(canAccessTab('admin', 'maestros')).toBe(true)
    expect(canAccessTab('admin', 'usuarios')).toBe(false)
    expect(canAccessTab('operador', 'maestros')).toBe(false)
    expect(canAccessTab('operador', 'usuarios')).toBe(false)
  })

  it('CA-15: getAllowedTabs de admin contiene maestros y no usuarios', () => {
    expect(getAllowedTabs('admin')).toContain('maestros')
    expect(getAllowedTabs('admin')).not.toContain('usuarios')
  })

  it('CA-15: operador solo genera y registra lecturas', () => {
    expect(getAllowedTabs('operador')).toEqual(['generar', 'trazabilidad'])
    expect(getDefaultTabForRole('operador')).toBe('generar')
  })

  it('exportar Excel de trackeo es solo admin/superadmin', () => {
    expect(canExportTrackingExcel('superadmin')).toBe(true)
    expect(canExportTrackingExcel('admin')).toBe(true)
    expect(canExportTrackingExcel('operador')).toBe(false)
  })
})
