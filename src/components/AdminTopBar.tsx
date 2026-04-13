import type { AppTab } from '../appTabs'
import { tabLabel, TOPBAR_HINT } from '../appNavigation'

type Props = {
  activeTab: AppTab
  navOpen: boolean
  onOpenNav: () => void
  loteComplete: boolean
  showLoteStatus: boolean
  userName: string
  roleLabel: string
  onLogout: () => void
}

export function AdminTopBar({
  activeTab,
  navOpen,
  onOpenNav,
  loteComplete,
  showLoteStatus,
  userName,
  roleLabel,
  onLogout,
}: Props) {
  return (
    <header className="app-topbar">
      <div className="app-topbar-start">
        <button
          type="button"
          className="app-menu-btn"
          aria-label="Abrir menú de navegación"
          aria-expanded={navOpen}
          onClick={onOpenNav}
        >
          <span className="app-menu-icon" aria-hidden />
        </button>
        <div className="app-topbar-title-block">
          <span className="app-topbar-crumb">{tabLabel(activeTab)}</span>
          <span className="app-topbar-hint">{TOPBAR_HINT[activeTab]}</span>
        </div>
      </div>
      <div className="app-topbar-end">
        {showLoteStatus ? (
          <p
            className={`lote-status-pill app-topbar-pill${loteComplete ? ' lote-status-pill--ok' : ' lote-status-pill--pending'}`}
            role="status"
          >
            <span className="lote-status-dot" aria-hidden />
            {loteComplete ? 'Lote listo' : 'Faltan datos del lote'}
          </p>
        ) : null}
        <p className="app-topbar-user">
          <span className="app-topbar-user-name">{userName}</span>
          <span className="app-topbar-user-role">{roleLabel}</span>
        </p>
        <button type="button" className="btn secondary app-topbar-logout" onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  )
}
