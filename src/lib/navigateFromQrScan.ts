/**
 * Tras leer un QR: navega al flujo operativo (?e=) en el origen actual.
 * Acepta URL completa, query suelta o solo el código de etiqueta.
 */
export function navigateFromScannedQrPayload(text: string): void {
  const t = text.trim()
  if (!t) return

  const origin = window.location.origin
  const path = window.location.pathname || '/'

  const goE = (code: string) => {
    const e = code.trim().toUpperCase()
    if (!e) return
    window.location.assign(`${origin}${path}?e=${encodeURIComponent(e)}`)
  }

  try {
    if (t.startsWith('http://') || t.startsWith('https://')) {
      const u = new URL(t)
      const e = u.searchParams.get('e')?.trim()
      if (e) {
        goE(e)
        return
      }
      window.location.assign(t)
      return
    }
  } catch {
    /* seguir */
  }

  const q = t.indexOf('?')
  if (q >= 0) {
    const params = new URLSearchParams(t.slice(q + 1))
    const e = params.get('e')?.trim()
    if (e) {
      goE(e)
      return
    }
  }

  goE(t)
}
