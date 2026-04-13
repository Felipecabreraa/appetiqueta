import type { LabelRecord } from '../types'

/** Campos que el usuario completa al generar la etiqueta (sin totes ni jefe). */
export type LabelFormValues = Omit<
  LabelRecord,
  'id' | 'createdAt' | 'cantidadTotes' | 'jefeCuadrilla'
>

const empty: LabelFormValues = {
  fecha: '',
  exportacion: '',
  empresa: '',
  csg: '',
  especie: '',
  variedad: '',
  centroCosto: '',
  sector: '',
}

export function defaultFormValues(): LabelFormValues {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const local =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return { ...empty, fecha: local }
}

/** Campos obligatorios alineados con el formulario (exportación es opcional). */
export function isLabelFormComplete(v: LabelFormValues): boolean {
  return (
    v.fecha.trim() !== '' &&
    v.empresa.trim() !== '' &&
    v.csg.trim() !== '' &&
    v.especie.trim() !== '' &&
    v.variedad.trim() !== '' &&
    v.centroCosto.trim() !== '' &&
    v.sector.trim() !== ''
  )
}
