import type { ReactNode } from 'react'

type Props = {
  navOpen: boolean
  onCloseNav: () => void
  sidebar: ReactNode
  topBar: ReactNode
  children: ReactNode
}

export function AppShell({ navOpen, onCloseNav, sidebar, topBar, children }: Props) {
  return (
    <div className={`app-shell${navOpen ? ' app-shell--nav-open' : ''}`}>
      <button
        type="button"
        className="app-nav-backdrop no-print"
        aria-label="Cerrar menú de navegación"
        tabIndex={navOpen ? 0 : -1}
        onClick={onCloseNav}
      />
      {sidebar}
      <div className="app-shell-main">
        <div className="app-topbar-wrap no-print">{topBar}</div>
        <div className="app-content">{children}</div>
      </div>
    </div>
  )
}
