import type { LabelFormValues } from './labelFormValues'
import type { CompanyOption, CostCenterOption, SeasonOption } from '../types'

interface Props {
  values: LabelFormValues
  onChange: (v: LabelFormValues) => void
  onSeasonChange: (seasonId: number) => void
  onCompanyChange: (companyId: number) => void
  onCostCenterChange: (costCenterId: number) => void
  seasons: SeasonOption[]
  companies: CompanyOption[]
  costCenters: CostCenterOption[]
  mastersLoading?: boolean
  mastersError?: string | null
  onSubmit: () => void
  disabled?: boolean
  submitLabel?: string
}

export function LabelForm({
  values,
  onChange,
  onSeasonChange,
  onCompanyChange,
  onCostCenterChange,
  seasons,
  companies,
  costCenters,
  mastersLoading,
  mastersError,
  onSubmit,
  disabled,
  submitLabel = 'Generar etiqueta y código QR',
}: Props) {
  const set = <K extends keyof LabelFormValues>(key: K, val: LabelFormValues[K]) => {
    onChange({ ...values, [key]: val })
  }
  const formatCcOption = (cc: CostCenterOption): string => {
    const code = cc.center_code.trim()
    const name = cc.center_name.trim()
    if (!name) return code
    if (code.toLowerCase() === name.toLowerCase()) return code
    return `${code} - ${name}`
  }

  return (
    <form
      className="label-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <p className="form-callout" role="note">
        <strong>Totes y jefe de cuadrilla</strong> no van en este formulario: se registran en{' '}
        <strong>Registrar lecturas</strong>, la primera vez que escanea JC.
      </p>
      <div className="form-grid">
        <label>
          Fecha
          <input
            type="datetime-local"
            value={values.fecha}
            onChange={(e) => set('fecha', e.target.value)}
            required
          />
        </label>
        <label>
          Temporada
          <select
            value={values.seasonId ?? ''}
            onChange={(e) => onSeasonChange(Number(e.target.value))}
            required
            disabled={mastersLoading || seasons.length === 0}
          >
            <option value="" disabled>
              Seleccione temporada
            </option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.code} - {season.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exportación
          <input
            type="text"
            value={values.exportacion}
            onChange={(e) => set('exportacion', e.target.value)}
          />
        </label>
        <label>
          Empresa
          <select
            value={values.companyId ?? ''}
            onChange={(e) => onCompanyChange(Number(e.target.value))}
            required
            disabled={mastersLoading || !values.seasonId}
          >
            <option value="" disabled>
              Seleccione empresa
            </option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Centro de costo (CC)
          <select
            value={values.seasonCostCenterId ?? ''}
            onChange={(e) => onCostCenterChange(Number(e.target.value))}
            required
            disabled={mastersLoading || !values.companyId}
          >
            <option value="" disabled>
              Seleccione CC
            </option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {formatCcOption(cc)}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSG (automático)
          <input
            type="text"
            value={values.csg}
            readOnly
            required
          />
        </label>
        <label>
          Especie (automático)
          <input
            type="text"
            value={values.especie}
            readOnly
            required
          />
        </label>
        <label>
          Variedad (automático)
          <input
            type="text"
            value={values.variedad}
            readOnly
            required
          />
        </label>
        <label>
          Sector
          <input
            type="text"
            value={values.sector}
            onChange={(e) => set('sector', e.target.value)}
            required
          />
        </label>
      </div>
      {mastersError && (
        <p className="alert error" role="alert">
          {mastersError}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
