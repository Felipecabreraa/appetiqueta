import type { AppTab } from '../appTabs'
import { ModuleIcon } from './NavIcons'

type NavItem = { tab: AppTab; label: string }

type Props = {
  activeTab: AppTab
  onNavigate: (tab: AppTab) => void
  allowedTabs: AppTab[]
  onItemActivate?: () => void
}

const OPERATION_ITEMS: NavItem[] = [
  { tab: 'dashboard', label: 'Resumen' },
  { tab: 'generar', label: 'Crear etiquetas' },
  { tab: 'trazabilidad', label: 'Registrar lecturas' },
]

const ADMIN_ITEMS: NavItem[] = [{ tab: 'maestros', label: 'Maestros' }]

export function AppSidebar({ activeTab, onNavigate, allowedTabs, onItemActivate }: Props) {
  const operationItems = OPERATION_ITEMS.filter((item) => allowedTabs.includes(item.tab))
  const allAdminItems: NavItem[] = [...ADMIN_ITEMS, { tab: 'usuarios', label: 'Usuarios' }]
  const adminItems = allAdminItems.filter((item) => allowedTabs.includes(item.tab))

  function go(tab: AppTab) {
    onNavigate(tab)
    onItemActivate?.()
  }

  return (
    <aside className="app-sidebar no-print" aria-label="Navegación principal">
      <div className="app-sidebar-brand">
        <div className="app-sidebar-mark" aria-hidden>
          <span className="app-sidebar-mark-inner">A</span>
        </div>
        <div className="app-sidebar-brand-text">
          <span className="app-sidebar-product">App etiquetado</span>
          <span className="app-sidebar-tagline">QR y trazabilidad</span>
        </div>
      </div>

      <nav className="app-sidebar-nav" aria-label="Módulos">
        <div className="app-sidebar-group">
          <p className="app-sidebar-group-label" id="nav-grupo-operacion">
            Operación
          </p>
          <ul className="app-sidebar-list" aria-labelledby="nav-grupo-operacion">
            {operationItems.map(({ tab, label }) => (
              <li key={tab}>
                <button
                  type="button"
                  className={`app-sidebar-link${activeTab === tab ? ' app-sidebar-link--active' : ''}`}
                  aria-current={activeTab === tab ? 'page' : undefined}
                  onClick={() => go(tab)}
                >
                  <span className="app-sidebar-link-inner">
                    <ModuleIcon tab={tab} className="app-sidebar-link-icon" />
                    <span className="app-sidebar-link-text">{label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {adminItems.length > 0 ? (
          <div className="app-sidebar-group app-sidebar-group--admin">
            <p className="app-sidebar-group-label" id="nav-grupo-admin">
              Administración
            </p>
            <ul className="app-sidebar-list" aria-labelledby="nav-grupo-admin">
              {adminItems.map(({ tab, label }) => (
                <li key={tab}>
                  <button
                    type="button"
                    className={`app-sidebar-link${activeTab === tab ? ' app-sidebar-link--active' : ''}`}
                    aria-current={activeTab === tab ? 'page' : undefined}
                    onClick={() => go(tab)}
                  >
                    <span className="app-sidebar-link-inner">
                      <ModuleIcon tab={tab} className="app-sidebar-link-icon" />
                      <span className="app-sidebar-link-text">{label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>
    </aside>
  )
}
