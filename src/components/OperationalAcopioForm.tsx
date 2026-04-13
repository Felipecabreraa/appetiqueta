import { useEffect, useMemo, useState } from 'react'
import type { LabelRecord } from '../types'
import {
  addMovement,
  firstMovementOfType,
  getOperationalPhase,
} from '../lib/storage'
import { getStoredOperatorName, setStoredOperatorName } from '../lib/operatorProfile'
export function OperationalAcopioForm({
  label,
  onSaved,
}: {
  label: LabelRecord
  onSaved: () => void
}) {
  const firstJc = useMemo(
    () => firstMovementOfType(label.id, 'jc'),
    [label.id],
  )

  const [llegada, setLlegada] = useState<number | ''>('')
  const [operador, setOperador] = useState(() => getStoredOperatorName())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('#op-acopio-totes')?.focus()
    }, 100)
    return () => window.clearTimeout(t)
  }, [])

  function submit() {
    setErr(null)
    if (getOperationalPhase(label.id) !== 'acopio') {
      setErr('El estado de la etiqueta cambió. Vuelva a escanear el QR.')
      return
    }
    if (!firstJc) {
      setErr('No hay registro de salida JC. Escanee de nuevo o contacte a administración.')
      return
    }
    if (llegada === '' || !Number.isFinite(llegada) || llegada < 0) {
      setErr('Indique una cantidad válida de totes recibidos.')
      return
    }
    setBusy(true)
    try {
      setStoredOperatorName(operador)
      const at = new Date().toISOString()
      const by = operador.trim() || undefined
      addMovement({
        labelId: label.id,
        type: 'acopio',
        cantidad: llegada as number,
        at,
        registeredBy: by,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  if (!firstJc) {
    return (
      <div className="operational-app">
        <div className="operational-inner">
          <div className="operational-card operational-card--state" role="alert">
            <p className="operational-eyebrow">Error de datos</p>
            <h1 className="operational-title">Sin salida JC</h1>
            <p className="operational-lead">
              No se encontró el primer registro para esta etiqueta. Vuelva a escanear el QR o use el
              módulo interno si tiene acceso.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="operational-app">
      <div className="operational-inner">
        <header className="operational-header">
          <p className="operational-eyebrow">Llegada al acopio</p>
          <h1 className="operational-title">Registro en acopio</h1>
          <p className="operational-lead">
            Ingrese la cantidad de totes recibidos. La fecha y hora se guardan al pulsar Guardar.
          </p>
        </header>

        <div className="operational-card">
          <div className="operational-code-pill">{label.id}</div>

          <div className="operational-fields">
            <label className="operational-field">
              <span className="operational-label">Totes recibidos en acopio</span>
              <input
                id="op-acopio-totes"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className="operational-input"
                value={llegada === '' ? '' : llegada}
                onChange={(e) => {
                  const v = e.target.value
                  setLlegada(v === '' ? '' : Number(v))
                }}
                autoComplete="off"
              />
            </label>

            <label className="operational-field">
              <span className="operational-label">Operador (opcional)</span>
              <input
                type="text"
                className="operational-input"
                value={operador}
                onChange={(e) => setOperador(e.target.value)}
                placeholder="Se recuerda en este dispositivo"
                autoComplete="off"
              />
            </label>
          </div>

          {err && (
            <p className="operational-feedback operational-feedback--err" role="alert">
              {err}
            </p>
          )}

          <button
            type="button"
            className="operational-btn operational-btn--primary"
            onClick={submit}
            disabled={busy}
          >
            Guardar llegada
          </button>
        </div>
      </div>
    </div>
  )
}
