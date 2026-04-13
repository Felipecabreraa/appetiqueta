import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ModalSize = 'md' | 'lg'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Texto del botón que cierra (además de la X y Escape). */
  closeLabel?: string
  size?: ModalSize
}

export function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = 'Cerrar',
  size = 'md',
}: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
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
          <button type="button" className="btn secondary modal-footer-close" onClick={onClose}>
            {closeLabel}
          </button>
        </footer>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
