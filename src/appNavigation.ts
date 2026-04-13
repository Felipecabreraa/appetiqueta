import type { AppTab } from './appTabs'

export type PageMeta = {
  title: string
  subtitle: string
}

/** Línea breve bajo el título en la barra superior (contexto ejecutivo) */
export const TOPBAR_HINT: Record<AppTab, string> = {
  dashboard: 'Vista general y accesos rápidos',
  generar: 'Lotes, códigos QR e impresión',
  trazabilidad: 'Consulta y registro de movimientos',
  maestros: 'Importación Excel y catálogos',
  usuarios: 'Cuentas, roles y permisos',
}

export const PAGE_META: Record<AppTab, PageMeta> = {
  dashboard: {
    title: 'Resumen',
    subtitle: 'Accesos rápidos al flujo diario y a la administración de datos.',
  },
  generar: {
    title: 'Crear etiquetas',
    subtitle: 'Defina el lote, genere códigos QR e imprima o exporte.',
  },
  trazabilidad: {
    title: 'Registrar lecturas',
    subtitle: 'Busque etiquetas, registre movimientos y exporte seguimiento.',
  },
  maestros: {
    title: 'Maestros',
    subtitle: 'Importación masiva y mantenimiento de temporadas, catálogos y relaciones.',
  },
  usuarios: {
    title: 'Usuarios',
    subtitle: 'Alta y permisos del personal que usa el sistema.',
  },
}

export function tabLabel(tab: AppTab): string {
  const labels: Record<AppTab, string> = {
    dashboard: 'Resumen',
    generar: 'Crear etiquetas',
    trazabilidad: 'Registrar lecturas',
    maestros: 'Maestros',
    usuarios: 'Usuarios',
  }
  return labels[tab]
}
