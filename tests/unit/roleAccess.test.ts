import { describe, expect, it } from 'vitest'
import {
  canAccessTab,
  canExportTrackingExcel,
  getAllowedTabs,
  getDefaultTabForRole,
} from '../../src/lib/roleAccess'

describe('roleAccess', () => {
  it('solo superadmin accede a maestros y usuarios', () => {
    expect(canAccessTab('superadmin', 'maestros')).toBe(true)
    expect(canAccessTab('superadmin', 'usuarios')).toBe(true)
    expect(canAccessTab('admin', 'maestros')).toBe(false)
    expect(canAccessTab('admin', 'usuarios')).toBe(false)
    expect(canAccessTab('operador', 'maestros')).toBe(false)
  })

  it('operador solo genera y registra lecturas', () => {
    expect(getAllowedTabs('operador')).toEqual(['generar', 'trazabilidad'])
    expect(getDefaultTabForRole('operador')).toBe('generar')
  })

  it('exportar Excel de trackeo es solo admin/superadmin', () => {
    expect(canExportTrackingExcel('superadmin')).toBe(true)
    expect(canExportTrackingExcel('admin')).toBe(true)
    expect(canExportTrackingExcel('operador')).toBe(false)
  })
})
