import { useState } from 'react'
import type { MovementType } from '../types'
import { QrScanTestModal } from './QrScanTestModal'
import { exportTrackingsExcel } from '../lib/exportTrackingsExcel'
import {
  addMovement,
  getLabelById,
  getLabels,
  getMovements,
  movementsForLabel,
  totalsForLabel,
  updateLabelRecord,
} from '../lib/storage'

const TIPO_LABEL: Record<MovementType, string> = {
  jc: 'Salida de campo (JC)',
  acopio: 'Llegada al acopio',
}

const PILL_SHORT: Record<MovementType, string> = {
  jc: 'JC · salida',
  acopio: 'Acopio · llegada',
}

interface Props {
  initialCode?: string
  canExportExcel?: boolean
}

export function TrackingView({ initialCode = '', canExportExcel = false }: Props) {
  const [code, setCode] = useState(() => initialCode.trim().toUpperCase())
  const [tipo, setTipo] = useState<MovementType>('jc')
  const [cantidad, setCantidad] = useState<number>(0)
  const [jefeCuadrilla, setJefeCuadrilla] = useState('')
  const [, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err' | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)

  const label = code.trim() ? getLabelById(code) : undefined
  const movements = label ? movementsForLabel(label.id) : []
  const totals = label ? totalsForLabel(label.id) : { jc: 0, acopio: 0 }
  const diffJcAcopio = totals.jc - totals.acopio
  const declaradoEnEtiqueta = label?.cantidadTotes
  const diffJcVsEtiqueta =
    declaradoEnEtiqueta != null ? totals.jc - declaradoEnEtiqueta : null
  const recent = getLabels().slice(0, 12)
  const allMovements = getMovements()

  function register() {
    setMsg(null)
    setMsgTone(null)
    const id = code.trim().toUpperCase()
    if (!id) {
      setMsg('Ingrese el código del QR.')
      setMsgTone('err')
      return
    }
    const found = getLabelById(id)
    if (!found) {
      setMsg('Código no encontrado. Verifique o genere la etiqueta primero.')
      setMsgTone('err')
      return
    }
    if (cantidad < 0 || !Number.isFinite(cantidad)) {
      setMsg('Cantidad inválida.')
      setMsgTone('err')
      return
    }

    if (tipo === 'jc') {
      if (cantidad < 1) {
        setMsg('En trackeo JC indique al menos 1 tote en salida.')
        setMsgTone('err')
        return
      }
      const primeraCaptura = found.cantidadTotes === null
      if (primeraCaptura) {
        const jefe = jefeCuadrilla.trim()
        if (jefe === '') {
          setMsg('En el primer trackeo JC debe ingresar el jefe de cuadrilla.')
          setMsgTone('err')
          return
        }
        updateLabelRecord(found.id, {
          cantidadTotes: cantidad,
          jefeCuadrilla: jefe,
        })
      }
    }

    addMovement({
      labelId: found.id,
      type: tipo,
      cantidad,
      at: new Date().toISOString(),
    })
    setTick((t) => t + 1)
    setMsg(
      `Registrado: ${TIPO_LABEL[tipo]} — ${cantidad} totes para ${found.id}.`,
    )
    setMsgTone('ok')
  }

  return (
    <div className="tracking-view">
      <section className="card tracking-register-card">
        <div className="tracking-card-head">
          <h2>Registrar lectura del QR</h2>
          <button
            type="button"
            className="btn secondary tracking-scan-btn"
            onClick={() => setScanModalOpen(true)}
          >
            Escanear QR (cámara)
          </button>
        </div>
        <QrScanTestModal open={scanModalOpen} onClose={() => setScanModalOpen(false)} />
        <ul className="guide-list" aria-label="Recordatorio">
          <li>
            Use el <strong>mismo QR de la misma etiqueta física</strong> para la salida (JC) y para la
            llegada al acopio.
          </li>
          <li>
            <strong>Primera vez (JC):</strong> totes que salen y nombre del jefe de cuadrilla.
          </li>
          <li>
            <strong>En acopio:</strong> totes que llegaron.
          </li>
        </ul>
        <div className="track-form">
          <label>
            Código de la etiqueta
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Escanee o escriba el código"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Qué está registrando
            <select
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value as MovementType)
                setMsg(null)
                setMsgTone(null)
              }}
            >
              <option value="jc">1 — Salida de campo (JC)</option>
              <option value="acopio">2 — Llegada al acopio</option>
            </select>
          </label>
          <label>
            {tipo === 'jc' ? 'Totes en salida' : 'Totes que llegaron'}
            <input
              type="number"
              min={tipo === 'jc' ? 1 : 0}
              step={1}
              value={cantidad || ''}
              onChange={(e) =>
                setCantidad(e.target.value === '' ? 0 : Number(e.target.value))
              }
            />
          </label>
          {tipo === 'jc' && (
            <label className="full-width">
              Jefe de cuadrilla
              {label && label.cantidadTotes !== null ? (
                <span className="field-optional-hint muted">
                  {' '}
                  (obligatorio solo el <strong>primer</strong> JC de esta etiqueta)
                </span>
              ) : null}
              <input
                type="text"
                value={jefeCuadrilla}
                onChange={(e) => setJefeCuadrilla(e.target.value)}
                placeholder={
                  label?.cantidadTotes === null
                    ? 'Requerido la primera vez (JC)'
                    : 'Opcional si ya hubo primer JC'
                }
                autoComplete="off"
              />
            </label>
          )}
          <button type="button" className="btn primary" onClick={register}>
            Guardar esta lectura
          </button>
        </div>
        {tipo === 'jc' && label && label.cantidadTotes !== null && (
          <p className="sub muted jc-followup-hint">
            Ya hay datos del primer JC en esta etiqueta; puede seguir registrando salidas JC sin
            volver a exigir jefe.
          </p>
        )}
        {msg && (
          <p
            className={`feedback${msgTone === 'ok' ? ' feedback--ok' : ''}${msgTone === 'err' ? ' feedback--err' : ''}`}
            role={msgTone === 'err' ? 'alert' : 'status'}
          >
            {msg}
          </p>
        )}
      </section>

      <section className="card tracking-shortcuts-card">
        <h2>Acceso rápido</h2>
        <p className="sub shortcuts-intro">
          Toque un código para cargarlo arriba y registrar sin escribir a mano.
        </p>
        <ul className="recent-list">
          {recent.length === 0 && (
            <li className="recent-empty muted">Aún no hay etiquetas en este equipo.</li>
          )}
          {recent.map((l) => (
            <li key={l.id}>
              <button type="button" className="linkish" onClick={() => setCode(l.id)}>
                {l.id}
              </button>
              <span className="muted">
                {l.especie} ·{' '}
                {l.cantidadTotes === null ? 'JC pendiente' : `${l.cantidadTotes} totes`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {label && (
        <section className="card tracking-detail-card">
          <h2>Etiqueta {label.id}</h2>
          <dl className="detail-list">
            <dt>Empresa</dt>
            <dd>{label.empresa}</dd>
            <dt>Especie / variedad</dt>
            <dd>
              {label.especie} — {label.variedad}
            </dd>
            <dt>Totes / jefe (primer JC)</dt>
            <dd>
              {label.cantidadTotes === null ? (
                <em>Pendiente — complete en primer JC</em>
              ) : (
                <>
                  {label.cantidadTotes} totes · Jefe:{' '}
                  {label.jefeCuadrilla.trim() || '—'}
                </>
              )}
            </dd>
          </dl>
          <div className="totals totals-four">
            <div>
              <span className="totals-label">Declarado en etiqueta (JC)</span>
              <strong>
                {label.cantidadTotes === null ? '—' : label.cantidadTotes}
              </strong>
            </div>
            <div>
              <span className="totals-label">Total JC (movimientos)</span>
              <strong>{totals.jc}</strong>
            </div>
            <div>
              <span className="totals-label">Total Acopio</span>
              <strong>{totals.acopio}</strong>
            </div>
            <div
              className={
                totals.jc > 0 && totals.acopio > 0 && diffJcAcopio === 0
                  ? 'ok'
                  : totals.jc > 0 && totals.acopio > 0 && diffJcAcopio !== 0
                    ? 'warn'
                    : ''
              }
            >
              <span className="totals-label">Diferencia (JC − Acopio)</span>
              <strong>{diffJcAcopio}</strong>
            </div>
          </div>
          {diffJcVsEtiqueta !== null &&
            Math.abs(diffJcVsEtiqueta) > 0 &&
            totals.jc > 0 && (
            <p className="warn-banner" role="status">
              La suma de movimientos JC ({totals.jc}) no coincide con la cantidad registrada en la
              etiqueta en el primer JC ({declaradoEnEtiqueta}).
            </p>
          )}
          {totals.jc > 0 && totals.acopio > 0 && diffJcAcopio === 0 && (
            <p className="ok-banner" role="status">
              JC y Acopio cuadran: misma cantidad de totes en salida y en llegada al acopio.
            </p>
          )}
          {totals.jc > 0 && totals.acopio > 0 && diffJcAcopio !== 0 && (
            <p className="warn-banner" role="status">
              Hay diferencia entre totes registrados en JC (salida) y en Acopio (llegada).
            </p>
          )}
          <h3>Historial de lecturas</h3>
          <ul className="movement-list">
            {movements.length === 0 && <li>Sin lecturas registradas aún.</li>}
            {[...movements]
              .reverse()
              .map((m, i) => (
                <li key={`${m.at}-${i}`}>
                  <span className={`pill ${m.type}`} title={TIPO_LABEL[m.type]}>
                    {PILL_SHORT[m.type]}
                  </span>
                  <span>{m.cantidad} totes</span>
                  <span className="muted">
                    {new Date(m.at).toLocaleString('es-CL')}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="card export-excel-card">
        <h2>Exportar a Excel</h2>
        <p className="sub">
          Un archivo con <strong>dos hojas</strong>: salidas JC y llegadas a acopio, con fechas y datos
          de cada etiqueta.
        </p>
        <div className="export-excel-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!canExportExcel}
            onClick={() => {
              try {
                exportTrackingsExcel()
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Error al exportar')
              }
            }}
          >
            Descargar Excel (.xlsx)
          </button>
          {!canExportExcel ? (
            <p className="sub muted export-excel-empty">
              Solo Admin y Super Admin pueden descargar el archivo Excel.
            </p>
          ) : allMovements.length === 0 ? (
            <p className="sub muted export-excel-empty">
              Puede descargar ahora: el archivo incluirá hojas con mensaje si aún no hay lecturas.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
