import type { AppTab } from '../appTabs'
import { ModuleIcon } from './NavIcons'

type Props = {
  userName: string
  allowedTabs: AppTab[]
  onNavigate: (tab: AppTab) => void
}

const OPERATION_TABS: AppTab[] = ['generar', 'trazabilidad']
const ADMIN_TABS: AppTab[] = ['maestros', 'usuarios']

const labels: Record<AppTab, { title: string; desc: string }> = {
  dashboard: { title: 'Resumen', desc: 'Vista general del sistema' },
  generar: { title: 'Crear etiquetas', desc: 'Lote, QR e impresión' },
  trazabilidad: { title: 'Registrar lecturas', desc: 'Búsqueda y movimientos' },
  maestros: { title: 'Maestros', desc: 'Excel, temporadas y catálogos' },
  usuarios: { title: 'Usuarios', desc: 'Accesos y roles' },
}

export function DashboardView({ userName, allowedTabs, onNavigate }: Props) {
  const operationTabs = OPERATION_TABS.filter((tab) => allowedTabs.includes(tab))
  const adminTabs = ADMIN_TABS.filter((tab) => allowedTabs.includes(tab))

  return (
    <div className="dashboard-grid">
      <section className="dashboard-hero">
        <h2 className="dashboard-greeting">Hola, {userName}</h2>
        <p className="sub dashboard-lead">
          Etiquetas, lecturas y administración del catálogo.
        </p>
      </section>

      {operationTabs.length > 0 ? (
        <section className="card dashboard-panel" aria-labelledby="dash-actions-title">
          <div className="dashboard-panel-head">
            <h2 id="dash-actions-title" className="dashboard-section-title">
              Operación
            </h2>
            <p className="dashboard-panel-kicker">Trabajo diario</p>
          </div>
          <ul className="dashboard-link-grid">
            {operationTabs.map((tab) => (
              <li key={tab}>
                <button type="button" className="dashboard-tile" onClick={() => onNavigate(tab)}>
                  <span className="dashboard-tile-icon" aria-hidden>
                    <ModuleIcon tab={tab} />
                  </span>
                  <span className="dashboard-tile-body">
                    <span className="dashboard-tile-label">{labels[tab].title}</span>
                    <span className="dashboard-tile-desc">{labels[tab].desc}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {adminTabs.length > 0 ? (
        <section className="card dashboard-panel" aria-labelledby="dash-admin-title">
          <div className="dashboard-panel-head">
            <h2 id="dash-admin-title" className="dashboard-section-title">
              Administración
            </h2>
            <p className="dashboard-panel-kicker">Catálogo y accesos</p>
          </div>
          <ul className="dashboard-link-grid">
            {adminTabs.map((tab) => (
              <li key={tab}>
                <button type="button" className="dashboard-tile" onClick={() => onNavigate(tab)}>
                  <span className="dashboard-tile-icon" aria-hidden>
                    <ModuleIcon tab={tab} />
                  </span>
                  <span className="dashboard-tile-body">
                    <span className="dashboard-tile-label">{labels[tab].title}</span>
                    <span className="dashboard-tile-desc">{labels[tab].desc}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
