import type { ReactNode } from 'react'
import { BrandLogo } from './BrandLogo'

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
          <BrandLogo size="sm" />
          <div>
            <span className="operator-topbar-title">Etiquetado</span>
            <span className="operator-topbar-sub">Agrícola Esmeralda</span>
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
