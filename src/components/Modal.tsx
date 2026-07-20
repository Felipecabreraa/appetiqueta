import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../lib/scrollLock'

export type ModalSize = 'md' | 'lg'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Texto del botón secundario que cierra. */
  closeLabel?: string
  size?: ModalSize
  /** Acción primaria en el pie (p. ej. Guardar). */
  primaryAction?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
}

export function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = 'Cerrar',
  size = 'md',
  primaryAction,
}: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    return lockBodyScroll()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      ;(focusable ?? panel).focus()
    })
    return () => {
      window.cancelAnimationFrame(id)
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  const content = (
    <div className="modal-root" role="presentation">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Cerrar ventana"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`modal-panel modal-panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-footer">
          <button type="button" className="btn secondary modal-footer-btn" onClick={onClose}>
            {closeLabel}
          </button>
          {primaryAction ? (
            <button
              type="button"
              className="btn primary modal-footer-btn modal-footer-btn--primary"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
