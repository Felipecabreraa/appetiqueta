import { useEffect, useState } from 'react'
import type { LabelRecord, Movement } from '../types'
import {
  addMovement,
  getOperationalPhase,
  updateLabelRecord,
} from '../lib/storage'
import { getStoredOperatorName, setStoredOperatorName } from '../lib/operatorProfile'
import { pushMovementToServer } from '../lib/pushMovementToServer'
import { fetchJcForemen } from '../lib/masterDataApi'
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
  const [jefesMaestro, setJefesMaestro] = useState<Array<{ id: number; name: string }>>([])
  const [jefesMaestroLoading, setJefesMaestroLoading] = useState(true)
  const [jefesMaestroError, setJefesMaestroError] = useState<string | null>(null)
  const [jefesMaestroReloadKey, setJefesMaestroReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setJefesMaestroLoading(true)
    setJefesMaestroError(null)
    void fetchJcForemen()
      .then((rows) => {
        if (!cancelled) {
          setJefesMaestro(rows)
          setJefesMaestroError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setJefesMaestro([])
          setJefesMaestroError(
            e instanceof Error ? e.message : 'No se pudo cargar el listado de jefes de cuadrilla.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setJefesMaestroLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jefesMaestroReloadKey])

  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('#op-jc-totes')
      el?.focus()
    }, 100)
    return () => window.clearTimeout(t)
  }, [])

  async function submit() {
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
      const movement: Movement = {
        labelId: label.id,
        type: 'jc',
        cantidad: totes,
        at,
        registeredBy: by,
      }
      const jcFirstRead = label.cantidadTotes === null ? { jefeCuadrilla: j } : undefined
      const pushed = await pushMovementToServer(
        movement,
        jcFirstRead ? { jcFirstRead } : undefined,
      )
      if (!pushed.ok) {
        setErr(pushed.error)
        return
      }
      updateLabelRecord(label.id, {
        cantidadTotes: totes,
        jefeCuadrilla: j,
      })
      addMovement(movement)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  const usarSelectJefes = !jefesMaestroLoading && jefesMaestro.length > 0

  return (
    <div className="operational-app">
      <div className="operational-inner">
        <header className="operational-header">
          <p className="operational-eyebrow">Salida de campo</p>
          <h1 className="operational-title">Registro JC</h1>
          <p className="operational-lead">
            Confirme los totes que salen y el jefe de cuadrilla. Al pulsar Guardar, el registro se
            escribe en la base de datos del servidor y queda copiado en este teléfono (requiere
            conexión a internet).
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
              {!jefesMaestroLoading && jefesMaestroError ? (
                <p className="operational-hint operational-hint--warn" role="status">
                  {jefesMaestroError}{' '}
                  <button
                    type="button"
                    className="operational-link-btn"
                    onClick={() => setJefesMaestroReloadKey((k) => k + 1)}
                  >
                    Reintentar
                  </button>
                </p>
              ) : null}
              {jefesMaestroLoading ? (
                <select className="operational-input" disabled value="">
                  <option value="">Cargando lista…</option>
                </select>
              ) : usarSelectJefes ? (
                <select
                  className="operational-input"
                  value={jefe}
                  onChange={(e) => setJefe(e.target.value)}
                  autoComplete="off"
                >
                  <option value="">Seleccione jefe de cuadrilla</option>
                  {jefesMaestro.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="operational-input"
                  value={jefe}
                  onChange={(e) => setJefe(e.target.value)}
                  placeholder={
                    jefesMaestroError
                      ? 'Escriba el nombre a mano o pulse Reintentar'
                      : 'Escriba el nombre (no hay jefes activos en maestro)'
                  }
                  autoComplete="name"
                />
              )}
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
            onClick={() => void submit()}
            disabled={busy}
          >
            Guardar salida
          </button>
        </div>
      </div>
    </div>
  )
}
