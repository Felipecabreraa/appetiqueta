export interface LabelRecord {
  /** Identificador único de la etiqueta y del QR (no se repite entre etiquetas). */
  id: string
  createdAt: string
  fecha: string
  exportacion: string
  empresa: string
  csg: string
  especie: string
  variedad: string
  centroCosto: string
  sector: string
  /** Se completa en el primer trackeo JC (lectura QR), no al generar la etiqueta. */
  cantidadTotes: number | null
  /** Se completa en el primer trackeo JC. */
  jefeCuadrilla: string
}

/** Trackeo JC = primera validación (totes en salida). Trackeo Acopio = segunda lectura QR (totes que llegaron al acopio). */
export type MovementType = 'jc' | 'acopio'

export interface Movement {
  labelId: string
  type: MovementType
  cantidad: number
  at: string
  /** Nombre u operador opcional (flujo por QR); persiste en este dispositivo. */
  registeredBy?: string
}
