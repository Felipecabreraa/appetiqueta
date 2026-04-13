import type { ReactNode } from 'react'

type Props = {
  userName: string
  onLogout: () => void
  children: ReactNode
}

export function OperatorShell({ userName, onLogout, children }: Props) {
  return (
    <div className="app app--operator">
      <header className="operator-topbar no-print">
        <div className="operator-topbar-brand">
          <div className="operator-topbar-mark" aria-hidden>
            <span>A</span>
          </div>
          <div>
            <span className="operator-topbar-title">App etiquetado</span>
            <span className="operator-topbar-sub">Captura en campo</span>
          </div>
        </div>
        <div className="operator-topbar-end">
          <span className="operator-topbar-user">{userName}</span>
          <button type="button" className="btn secondary" onClick={onLogout}>
            Salir
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}
