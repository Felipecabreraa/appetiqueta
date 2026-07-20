/** Contador para modales anidados: no restaurar scroll hasta el último cierre. */
let lockCount = 0
let previousBodyOverflow = ''
let previousHtmlOverflow = ''
let previousPaddingRight = ''
let previousHtmlPaddingRight = ''

function scrollbarGap(): number {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth)
}

/**
 * Bloquea el scroll del documento sin desplazar el layout (nav sticky/fixed).
 * Devuelve una función de liberación.
 */
export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    const html = document.documentElement
    const body = document.body
    previousBodyOverflow = body.style.overflow
    previousHtmlOverflow = html.style.overflow
    previousPaddingRight = body.style.paddingRight
    previousHtmlPaddingRight = html.style.paddingRight

    const gapBefore = scrollbarGap()
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    const gapLost = Math.max(0, gapBefore - scrollbarGap())
    if (gapLost > 0) {
      const pad = `${gapLost}px`
      body.style.paddingRight = pad
      html.style.paddingRight = pad
      html.style.setProperty('--scroll-lock-gap', pad)
    }
    html.classList.add('scroll-lock')
  }
  lockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount > 0) return
    const html = document.documentElement
    const body = document.body
    body.style.overflow = previousBodyOverflow
    html.style.overflow = previousHtmlOverflow
    body.style.paddingRight = previousPaddingRight
    html.style.paddingRight = previousHtmlPaddingRight
    html.style.removeProperty('--scroll-lock-gap')
    html.classList.remove('scroll-lock')
  }
}
