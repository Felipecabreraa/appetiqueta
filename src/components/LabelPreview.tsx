import type { LabelRecord } from '../types'
import { LabelSheet } from './LabelSheet'

interface Props {
  record: LabelRecord
}

export function LabelPreview({ record }: Props) {
  return (
    <div className="label-preview-wrap">
      <LabelSheet record={record} sheetId="print-label" />
      <p className="hint">
        Código <strong>{record.id}</strong> — use <strong>el mismo QR</strong> para salida (JC) y para
        acopio. En <em>Registrar lecturas</em> elija primero JC (totes + jefe) y después acopio
        (totes que llegaron).
      </p>
    </div>
  )
}
