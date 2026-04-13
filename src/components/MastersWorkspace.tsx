import type { MaestrosSubTab } from '../appTabs'
import { MasterDataView } from './MasterDataView'
import { MastersAdminPanel } from './MastersAdminPanel'

type Props = {
  onImported: () => void
  canManage: boolean
  subTab: MaestrosSubTab
  onSubTabChange: (t: MaestrosSubTab) => void
}

export function MastersWorkspace({ onImported, canManage, subTab, onSubTabChange }: Props) {
  return (
    <div className="masters-workspace">
      <div className="subnav-rail no-print" role="tablist" aria-label="Secciones de maestros">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'excel'}
          className={`subnav-rail-btn${subTab === 'excel' ? ' subnav-rail-btn--active' : ''}`}
          onClick={() => onSubTabChange('excel')}
        >
          Carga desde Excel
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'admin'}
          className={`subnav-rail-btn${subTab === 'admin' ? ' subnav-rail-btn--active' : ''}`}
          onClick={() => onSubTabChange('admin')}
        >
          Mantenimiento en pantalla
        </button>
      </div>

      <div
        className="masters-workspace-panel"
        role="tabpanel"
        hidden={subTab !== 'excel'}
        id="panel-maestros-excel"
      >
        <MasterDataView onImported={onImported} />
      </div>
      <div
        className="masters-workspace-panel"
        role="tabpanel"
        hidden={subTab !== 'admin'}
        id="panel-maestros-admin"
      >
        <MastersAdminPanel canManage={canManage} />
      </div>
    </div>
  )
}
