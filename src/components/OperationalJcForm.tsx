import { useEffect, useState } from 'react'
import type { LabelRecord, Movement } from '../types'
import {
  addMovement,
  getOperationalPhase,
  updateLabelRecord,
} from '../lib/storage'
import { getStoredOperatorName, setStoredOperatorName } from '../lib/operatorProfile'
import { pushMovementToServer } from '../lib/pushMovementToServer'
export function OperationalJcForm({
  label,
  onSaved,
}: {
  label: LabelRecord
  onSaved: () => void
}) {
  const [totes, setTotes] = useState<number>(0)
  const [jefe, setJefe] = useState('')
  const [operador, setOperador] = useState(() => getStoredOperatorName())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('#op-jc-totes')
      el?.focus()
    }, 100)
    return () => window.clearTimeout(t)
  }, [])

  function submit() {
    setErr(null)
    if (getOperationalPhase(label.id) !== 'jc') {
      setErr('El estado de la etiqueta cambió. Vuelva a escanear el QR.')
      return
    }
    if (!Number.isFinite(totes) || totes < 1) {
      setErr('Indique al menos 1 tote en salida.')
      return
    }
    const j = jefe.trim()
    if (j === '') {
      setErr('Ingrese el jefe de cuadrilla.')
      return
    }
    setBusy(true)
    try {
      setStoredOperatorName(operador)
      const at = new Date().toISOString()
      const by = operador.trim() || undefined
      updateLabelRecord(label.id, {
        cantidadTotes: totes,
        jefeCuadrilla: j,
      })
      const movement: Movement = {
        labelId: label.id,
        type: 'jc',
        cantidad: totes,
        at,
        registeredBy: by,
      }
      addMovement(movement)
      void pushMovementToServer(movement)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="operational-app">
      <div className="operational-inner">
        <header className="operational-header">
          <p className="operational-eyebrow">Salida de campo</p>
          <h1 className="operational-title">Registro JC</h1>
          <p className="operational-lead">
            Confirme los totes que salen y el jefe de cuadrilla. La fecha y hora se guardan al pulsar
            Guardar.
          </p>
        </header>

        <div className="operational-card">
          <div className="operational-code-pill">{label.id}</div>
          <p className="operational-meta">
            {label.empresa} · {label.especie} — {label.variedad}
          </p>

          <div className="operational-fields">
            <label className="operational-field">
              <span className="operational-label">Totes en salida</span>
              <input
                id="op-jc-totes"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="operational-input"
                value={totes || ''}
                onChange={(e) =>
                  setTotes(e.target.value === '' ? 0 : Number(e.target.value))
                }
                autoComplete="off"
              />
            </label>

            <label className="operational-field">
              <span className="operational-label">Jefe de cuadrilla</span>
              <input
                type="text"
                className="operational-input"
                value={jefe}
                onChange={(e) => setJefe(e.target.value)}
                placeholder="Nombre"
                autoComplete="name"
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
            Guardar salida
          </button>
        </div>
      </div>
    </div>
  )
}
