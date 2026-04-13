export interface TrackingSeed {
  code: string
  nonce: number
}

export function readTrackingFromUrl(): {
  tab: 'generar' | 'trazabilidad'
  seed: TrackingSeed | null
  /** true cuando la URL traía ?e= — interfaz cerrada solo para escaneo en terreno */
  operational: boolean
} {
  if (typeof window === 'undefined') {
    return { tab: 'generar', seed: null, operational: false }
  }
  const params = new URLSearchParams(window.location.search)
  const e = params.get('e')?.trim()
  if (!e) {
    return { tab: 'generar', seed: null, operational: false }
  }
  const code = e.toUpperCase()
  // No limpiar ?e= del historial: si el operario recarga, debe seguir el mismo flujo cerrado.
  return {
    tab: 'trazabilidad',
    seed: { code, nonce: Date.now() },
    operational: true,
  }
}
