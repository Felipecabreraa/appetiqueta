import { useState } from 'react'
import {
  getBatchHistory,
  resolveRecordsForBatch,
  type BatchLogEntry,
} from '../lib/batchHistory'
import { exportLabelsPdf } from '../lib/exportLabelsPdf'

export function BatchHistoryPanel() {
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const batches = getBatchHistory()

  async function downloadPdf(entry: BatchLogEntry) {
    const records = resolveRecordsForBatch(entry)
    if (records.length === 0) {
      window.alert(
        'No se encontraron las etiquetas en el navegador (puede haberlas borrado del almacenamiento).',
      )
      return
    }
    if (records.length !== entry.count) {
      const ok = window.confirm(
        `Solo se recuperaron ${records.length} de ${entry.count} etiquetas. ¿Generar el PDF con las disponibles?`,
      )
      if (!ok) return
    }
    setPdfBusy(entry.id)
    try {
      await exportLabelsPdf(records, {
        fileName: `lote-${records.length}-ids-${entry.id.slice(0, 8)}.pdf`,
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Error al generar PDF')
    } finally {
      setPdfBusy(null)
    }
  }

  if (batches.length === 0) {
    return (
      <section className="card batch-history-card batch-history-card--empty">
        <h2>Historial de lotes</h2>
        <div className="empty-state">
          <p className="empty-state-title">Sin lotes aún</p>
          <p className="empty-state-text muted">
            Cuando genere etiquetas, aquí aparecerán la fecha, la cantidad y un acceso rápido al PDF
            de cada lote.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="card batch-history-card">
      <h2>Historial de lotes</h2>
      <p className="sub muted">
        Cada fila es un lote generado. <strong>PDF del lote</strong> vuelve a bajar las mismas
        etiquetas (si aún están en este navegador).
      </p>
      <div className="table-wrap">
        <table className="data-table batch-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cantidad</th>
              <th>Empresa / especie</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="nowrap muted">
                  {new Date(b.createdAt).toLocaleString('es-CL')}
                </td>
                <td>
                  <strong>{b.count}</strong> etiqueta{b.count !== 1 ? 's' : ''}
                </td>
                <td>
                  {b.empresa} · {b.especie}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="btn text"
                    disabled={pdfBusy === b.id}
                    onClick={() => void downloadPdf(b)}
                  >
                    {pdfBusy === b.id ? 'Generando PDF…' : 'PDF del lote'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
