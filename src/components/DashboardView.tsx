import type { AppTab } from '../appTabs'
import { ModuleIcon } from './NavIcons'

type Props = {
  userName: string
  onNavigate: (tab: AppTab) => void
}

export function DashboardView({ userName, onNavigate }: Props) {
  return (
    <div className="dashboard-grid">
      <section className="card dashboard-hero">
        <p className="page-eyebrow">Bienvenido</p>
        <h2 className="dashboard-greeting">Hola, {userName}</h2>
        <p className="sub dashboard-lead">
          Elija una tarea para continuar. El flujo operativo prioriza crear etiquetas y registrar lecturas;
          los maestros y usuarios concentran la configuración.
        </p>
      </section>

      <section className="card dashboard-panel" aria-labelledby="dash-actions-title">
        <div className="dashboard-panel-head">
          <h2 id="dash-actions-title" className="dashboard-section-title">
            Operación
          </h2>
          <p className="dashboard-panel-kicker">Flujo diario</p>
        </div>
        <ul className="dashboard-link-grid">
          <li>
            <button type="button" className="dashboard-tile" onClick={() => onNavigate('generar')}>
              <span className="dashboard-tile-icon" aria-hidden>
                <ModuleIcon tab="generar" />
              </span>
              <span className="dashboard-tile-body">
                <span className="dashboard-tile-label">Crear etiquetas</span>
                <span className="dashboard-tile-desc">Lotes, QR e impresión</span>
              </span>
              <span className="dashboard-tile-chevron" aria-hidden />
            </button>
          </li>
          <li>
            <button type="button" className="dashboard-tile" onClick={() => onNavigate('trazabilidad')}>
              <span className="dashboard-tile-icon" aria-hidden>
                <ModuleIcon tab="trazabilidad" />
              </span>
              <span className="dashboard-tile-body">
                <span className="dashboard-tile-label">Registrar lecturas</span>
                <span className="dashboard-tile-desc">Búsqueda y trazabilidad</span>
              </span>
              <span className="dashboard-tile-chevron" aria-hidden />
            </button>
          </li>
        </ul>
      </section>

      <section className="card dashboard-panel" aria-labelledby="dash-admin-title">
        <div className="dashboard-panel-head">
          <h2 id="dash-admin-title" className="dashboard-section-title">
            Administración
          </h2>
          <p className="dashboard-panel-kicker">Configuración</p>
        </div>
        <ul className="dashboard-link-grid">
          <li>
            <button type="button" className="dashboard-tile" onClick={() => onNavigate('maestros')}>
              <span className="dashboard-tile-icon" aria-hidden>
                <ModuleIcon tab="maestros" />
              </span>
              <span className="dashboard-tile-body">
                <span className="dashboard-tile-label">Maestros</span>
                <span className="dashboard-tile-desc">Excel, temporadas y catálogos</span>
              </span>
              <span className="dashboard-tile-chevron" aria-hidden />
            </button>
          </li>
          <li>
            <button type="button" className="dashboard-tile" onClick={() => onNavigate('usuarios')}>
              <span className="dashboard-tile-icon" aria-hidden>
                <ModuleIcon tab="usuarios" />
              </span>
              <span className="dashboard-tile-body">
                <span className="dashboard-tile-label">Usuarios</span>
                <span className="dashboard-tile-desc">Accesos y roles</span>
              </span>
              <span className="dashboard-tile-chevron" aria-hidden />
            </button>
          </li>
        </ul>
      </section>
    </div>
  )
}
