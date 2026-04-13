import type { AppTab } from '../appTabs'
import type { UserRole } from '../types'

type Props = {
  activeTab: AppTab
  onNavigate: (tab: AppTab) => void
  /** Estado del formulario de lote (solo se muestra en «Crear etiquetas»). */
  loteComplete: boolean
  role: UserRole
  userName: string
  onLogout: () => void
}

export function AppHeader({ activeTab, onNavigate, loteComplete, role, userName, onLogout }: Props) {
  const canAdmin = role === 'admin' || role === 'superadmin'
  const canUsers = role === 'superadmin'
  return (
    <header className="app-header no-print">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <span className="brand-mark-inner">A</span>
        </div>
        <div className="brand-text">
          <h1>App etiquetado</h1>
          <p className="tagline">
            Etiquetas con QR y registro de lecturas: salida (JC) y llegada al acopio.
          </p>
        </div>
      </div>
      <div className="header-nav-wrap">
        <p className="lote-status-pill">
          {userName} ({role})
        </p>
        {activeTab === 'generar' && (
          <p
            className={`lote-status-pill${loteComplete ? ' lote-status-pill--ok' : ' lote-status-pill--pending'}`}
            role="status"
          >
            <span className="lote-status-dot" aria-hidden />
            {loteComplete ? 'Datos del lote listos' : 'Faltan datos del lote'}
          </p>
        )}
        <nav className="tabs" role="tablist" aria-label="Secciones principales">
          {canAdmin && (
            <>
              <button
                type="button"
                role="tab"
                id="tab-generar"
                aria-selected={activeTab === 'generar'}
                aria-controls="panel-generar"
                tabIndex={activeTab === 'generar' ? 0 : -1}
                className={activeTab === 'generar' ? 'active' : ''}
                onClick={() => onNavigate('generar')}
              >
                <span className="tab-icon" aria-hidden>
                  ◈
                </span>
                Crear etiquetas
              </button>
              <button
                type="button"
                role="tab"
                id="tab-trazabilidad"
                aria-selected={activeTab === 'trazabilidad'}
                aria-controls="panel-trazabilidad"
                tabIndex={activeTab === 'trazabilidad' ? 0 : -1}
                className={activeTab === 'trazabilidad' ? 'active' : ''}
                onClick={() => onNavigate('trazabilidad')}
              >
                <span className="tab-icon" aria-hidden>
                  ◉
                </span>
                Registrar lecturas
              </button>
              <button
                type="button"
                role="tab"
                id="tab-maestros"
                aria-selected={activeTab === 'maestros'}
                aria-controls="panel-maestros"
                tabIndex={activeTab === 'maestros' ? 0 : -1}
                className={activeTab === 'maestros' ? 'active' : ''}
                onClick={() => onNavigate('maestros')}
              >
                <span className="tab-icon" aria-hidden>
                  ▣
                </span>
                Maestros
              </button>
              {canUsers && (
                <button
                  type="button"
                  role="tab"
                  id="tab-usuarios"
                  aria-selected={activeTab === 'usuarios'}
                  aria-controls="panel-usuarios"
                  tabIndex={activeTab === 'usuarios' ? 0 : -1}
                  className={activeTab === 'usuarios' ? 'active' : ''}
                  onClick={() => onNavigate('usuarios')}
                >
                  <span className="tab-icon" aria-hidden>
                    ◎
                  </span>
                  Usuarios
                </button>
              )}
            </>
          )}
        </nav>
        <button type="button" className="btn secondary" onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  )
}
