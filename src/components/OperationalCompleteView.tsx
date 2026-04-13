import { useMemo } from 'react'
import {
  firstMovementOfType,
  getLabelById,
} from '../lib/storage'
export function OperationalCompleteView({ labelId }: { labelId: string }) {
  const id = labelId.trim().toUpperCase()
  const label = getLabelById(id)
  const firstJc = firstMovementOfType(id, 'jc')
  const firstAcopio = firstMovementOfType(id, 'acopio')

  const summary = useMemo(() => {
    if (!firstJc || !firstAcopio) return null
    const salida = firstJc.cantidad
    const llegada = firstAcopio.cantidad
    const diff = llegada - salida
    return { salida, llegada, diff, match: diff === 0 }
  }, [firstJc, firstAcopio])

  return (
    <div className="operational-app">
      <div className="operational-inner">
        <div className="operational-card operational-card--state">
          <p className="operational-eyebrow">Etiqueta</p>
          <h1 className="operational-title">Registro completo</h1>
          <p className="operational-lead">
            La salida de campo y la llegada al acopio quedaron guardadas para esta etiqueta. No debe
            realizar más pasos aquí.
          </p>
          <div className="operational-code-pill">{id}</div>
          {label && (
            <p className="operational-meta">
              {label.especie} · {label.variedad}
            </p>
          )}
          {summary && (
            <>
              <dl className="operational-summary operational-summary--final">
                <div>
                  <dt>Totes en salida (campo)</dt>
                  <dd>{summary.salida}</dd>
                </div>
                <div>
                  <dt>Totes en acopio</dt>
                  <dd>{summary.llegada}</dd>
                </div>
              </dl>
              {summary.match ? (
                <p className="operational-final-note operational-final-note--ok" role="status">
                  Las cantidades registradas en salida y en acopio coinciden.
                </p>
              ) : (
                <p className="operational-final-note operational-final-note--neutral" role="status">
                  Las cantidades de totes en salida ({summary.salida}) y en acopio ({summary.llegada})
                  no son iguales. Esta información queda registrada; el responsable revisará la
                  diferencia.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
