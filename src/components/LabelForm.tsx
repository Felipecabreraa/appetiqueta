import type { LabelFormValues } from './labelFormValues'

interface Props {
  values: LabelFormValues
  onChange: (v: LabelFormValues) => void
  onSubmit: () => void
  disabled?: boolean
  submitLabel?: string
}

export function LabelForm({
  values,
  onChange,
  onSubmit,
  disabled,
  submitLabel = 'Generar etiqueta y código QR',
}: Props) {
  const set = <K extends keyof LabelFormValues>(key: K, val: LabelFormValues[K]) => {
    onChange({ ...values, [key]: val })
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
            type="text"
            value={values.fecha}
            onChange={(e) => set('fecha', e.target.value)}
            placeholder="AAAA-MM-DD HH:mm:ss"
            required
          />
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
          <input
            type="text"
            value={values.empresa}
            onChange={(e) => set('empresa', e.target.value)}
            required
          />
        </label>
        <label>
          CSG
          <input
            type="text"
            value={values.csg}
            onChange={(e) => set('csg', e.target.value)}
            required
          />
        </label>
        <label>
          Especie
          <input
            type="text"
            value={values.especie}
            onChange={(e) => set('especie', e.target.value)}
            required
          />
        </label>
        <label>
          Variedad
          <input
            type="text"
            value={values.variedad}
            onChange={(e) => set('variedad', e.target.value)}
            required
          />
        </label>
        <label>
          Centro de costo
          <input
            type="text"
            value={values.centroCosto}
            onChange={(e) => set('centroCosto', e.target.value)}
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
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
