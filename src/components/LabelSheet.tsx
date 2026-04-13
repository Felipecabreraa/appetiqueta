import { QRCodeSVG } from 'qrcode.react'
import { buildTrackingUrl } from '../lib/qrPayload'
import type { LabelRecord } from '../types'

/** Misma estructura que en pantalla / impresión; reutilizada para PDF vía captura. */
export function LabelSheet({
  record,
  sheetId,
}: {
  record: LabelRecord
  sheetId?: string
}) {
  const payload = buildTrackingUrl(record.id)
  const totesStr =
    record.cantidadTotes === null ? '—' : String(record.cantidadTotes)
  const jefeStr =
    record.jefeCuadrilla.trim() === '' ? '—' : record.jefeCuadrilla

  return (
    <div className="label-sheet" id={sheetId}>
      <div className="label-grid">
        <div className="cell label-header-left">
          <div className="field-title">FECHA COSECHA</div>
          <div className="field-value">{record.fecha}</div>
        </div>
        <div className="cell label-header-right">
          <div className="field-title">EXPORTACIÓN</div>
          <div className="field-value">{record.exportacion || '—'}</div>
        </div>

        <div className="cell label-row-company span-2">
          <span className="field-inline">
            <span className="field-title">Empresa</span>{' '}
            <span className="field-value">{record.empresa}</span>
          </span>
          <span className="field-inline">
            <span className="field-title">CSG</span>{' '}
            <span className="field-value">{record.csg}</span>
          </span>
        </div>

        <div className="cell label-left-stack">
          <div className="stack-row">
            <div className="field-title">ESPECIE</div>
            <div className="field-value">{record.especie}</div>
          </div>
          <div className="stack-row">
            <div className="field-title">VARIEDAD</div>
            <div className="field-value">{record.variedad}</div>
          </div>
          <div className="stack-row">
            <div className="field-title">CENTRO COSTO</div>
            <div className="field-value">{record.centroCosto}</div>
          </div>
          <div className="stack-row">
            <div className="field-title">SECTOR</div>
            <div className="field-value">{record.sector}</div>
          </div>
        </div>

        <div className="cell label-qr">
          <QRCodeSVG value={payload} size={168} level="H" includeMargin={true} />
          <div className="qr-id">{record.id}</div>
        </div>

        <div className="cell label-footer-left">
          <div className="field-title">CANTIDAD TOTES</div>
          <div className="field-value large">{totesStr}</div>
        </div>
        <div className="cell label-footer-right">
          <div className="field-title">JEFE CUADRILLA</div>
          <div className="field-value">{jefeStr}</div>
        </div>
      </div>
    </div>
  )
}
