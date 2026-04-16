import { useCallback, useEffect, useRef, useState } from 'react'
import type { MovementType } from '../types'
import { QrScanTestModal } from './QrScanTestModal'
import { exportTrackingsExcel } from '../lib/exportTrackingsExcel'
import { getStoredOperatorName } from '../lib/operatorProfile'
import { pushMovementToServer } from '../lib/pushMovementToServer'
import { fetchTrackingExportPayload } from '../lib/trackingExportApi'
import { fetchJcForemen } from '../lib/masterDataApi'
import { normalizeTrackingCodeFromQrPayload } from '../lib/navigateFromQrScan'
import {
  LABELS_STORAGE_KEY,
  MOVEMENTS_STORAGE_KEY,
  addMovement,
  bumpLabelAccessOrder,
  getLabelById,
  getLabels,
  getMovements,
  getOperationalPhase,
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
  const [jefesCuadrilla, setJefesCuadrilla] = useState<Array<{ id: number; name: string }>>([])
  const [jefesCuadrillaError, setJefesCuadrillaError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err' | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const lastBumpedAccessId = useRef<string | null>(null)

  const label = code.trim() ? getLabelById(code) : undefined
  const trackingPhase = label ? getOperationalPhase(label.id) : undefined
  const flowComplete = trackingPhase === 'complete'
  const lockTipoJc = trackingPhase === 'jc'
  const lockTipoAcopio = trackingPhase === 'acopio'
  const movements = label ? movementsForLabel(label.id) : []
  const totals = label ? totalsForLabel(label.id) : { jc: 0, acopio: 0 }
  const diffJcAcopio = totals.jc - totals.acopio
  const declaradoEnEtiqueta = label?.cantidadTotes
  const diffJcVsEtiqueta =
    declaradoEnEtiqueta != null ? totals.jc - declaradoEnEtiqueta : null
  const recent = getLabels().slice(0, 12)
  const allMovements = getMovements()

  const onScanFillCode = useCallback((rawPayload: string) => {
    setCode(normalizeTrackingCodeFromQrPayload(rawPayload))
    setMsg(null)
    setMsgTone(null)
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || (e.key !== LABELS_STORAGE_KEY && e.key !== MOVEMENTS_STORAGE_KEY)) return
      setTick((t) => t + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const id = code.trim().toUpperCase()
    if (!id) {
      lastBumpedAccessId.current = null
      return
    }
    const found = getLabelById(id)
    if (!found) {
      lastBumpedAccessId.current = null
      return
    }
    if (lastBumpedAccessId.current === id) return
    lastBumpedAccessId.current = id
    bumpLabelAccessOrder(id)
    setTick((t) => t + 1)
  }, [code])

  useEffect(() => {
    if (!label || !trackingPhase || trackingPhase === 'not_found') return
    if (trackingPhase === 'complete') return
    if (trackingPhase === 'jc') setTipo('jc')
    if (trackingPhase === 'acopio') setTipo('acopio')
  }, [label?.id, trackingPhase])

  useEffect(() => {
    let cancelled = false
    void fetchJcForemen()
      .then((rows) => {
        if (!cancelled) {
          setJefesCuadrilla(rows)
          setJefesCuadrillaError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setJefesCuadrilla([])
          setJefesCuadrillaError(
            error instanceof Error ? error.message : 'No se pudo cargar jefes de cuadrilla.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function register() {
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
    const phase = getOperationalPhase(found.id)
    if (phase === 'complete') {
      setMsg(
        'Esta etiqueta ya tiene salida JC y llegada a acopio. No se pueden añadir más lecturas desde aquí.',
      )
      setMsgTone('err')
      return
    }
    if (phase === 'jc' && tipo === 'acopio') {
      setMsg('Primero debe registrar la salida de campo (JC). El acopio solo corresponde después del primer JC.')
      setMsgTone('err')
      return
    }
    if (phase === 'acopio' && tipo === 'jc') {
      setMsg(
        'Ya existe salida JC para esta etiqueta. El paso pendiente es la llegada al acopio; no puede volver a registrar JC desde aquí.',
      )
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
      }
    }

    const movement = {
      labelId: found.id,
      type: tipo,
      cantidad,
      at: new Date().toISOString(),
      registeredBy: getStoredOperatorName().trim() || undefined,
    }
    const jcFirstRead =
      tipo === 'jc' && found.cantidadTotes === null
        ? { jefeCuadrilla: jefeCuadrilla.trim() }
        : undefined

    setRegisterBusy(true)
    try {
      const pushed = await pushMovementToServer(
        movement,
        jcFirstRead ? { jcFirstRead } : undefined,
      )
      if (!pushed.ok) {
        setMsg(pushed.error)
        setMsgTone('err')
        return
      }
      if (tipo === 'jc' && found.cantidadTotes === null) {
        updateLabelRecord(found.id, {
          cantidadTotes: cantidad,
          jefeCuadrilla: jefeCuadrilla.trim(),
        })
      }
      addMovement(movement)
      setTick((t) => t + 1)
      setMsg(
        `Registrado en servidor: ${TIPO_LABEL[tipo]} — ${cantidad} totes para ${found.id}.`,
      )
      setMsgTone('ok')
    } finally {
      setRegisterBusy(false)
    }
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
        <QrScanTestModal
          open={scanModalOpen}
          onClose={() => setScanModalOpen(false)}
          onFillCode={onScanFillCode}
        />
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
          <li>
            Cada <strong>guardado exitoso</strong> se escribe primero en la <strong>base de datos</strong>{' '}
            del servidor (tabla de movimientos); el historial en este navegador es una copia local
            tras confirmar el servidor. Sin conexión o si falla el guardado, el registro{' '}
            <strong>no</strong> queda en la BD.
          </li>
        </ul>
        {label && flowComplete ? (
          <p className="tracking-flow-banner tracking-flow-banner--locked" role="status">
            <strong>Circuito cerrado</strong> para esta etiqueta: ya hay salida JC y llegada a acopio.
            No se pueden registrar más lecturas ni cambiar el tipo; puede cargar otra etiqueta arriba.
          </p>
        ) : null}
        {label && lockTipoAcopio ? (
          <p className="tracking-flow-banner tracking-flow-banner--next" role="status">
            <strong>Paso pendiente: acopio</strong> — Ya hay salida JC. Debe registrar la llegada al
            acopio (2.º paso). El tipo de lectura queda fijado en acopio para evitar errores.
          </p>
        ) : null}
        {label && lockTipoJc ? (
          <p className="tracking-flow-banner tracking-flow-banner--next" role="status">
            <strong>Paso actual: primer JC</strong> — Aún no hay salida de campo registrada. El tipo
            queda en JC hasta completar este paso.
          </p>
        ) : null}
        <div className="track-form">
          <label>
            Código de la etiqueta
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(normalizeTrackingCodeFromQrPayload(e.target.value))
              }
              placeholder="Escanee o escriba el código"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Qué está registrando
            <select
              value={tipo}
              disabled={Boolean(label && (flowComplete || lockTipoJc || lockTipoAcopio))}
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
              disabled={Boolean(label && flowComplete)}
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
                list="jc-foremen-list"
                value={jefeCuadrilla}
                onChange={(e) => setJefeCuadrilla(e.target.value)}
                disabled={Boolean(label && flowComplete)}
                placeholder={
                  label?.cantidadTotes === null
                    ? 'Requerido la primera vez (JC)'
                    : 'Opcional si ya hubo primer JC'
                }
                autoComplete="off"
              />
              <datalist id="jc-foremen-list">
                {jefesCuadrilla.map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
              {jefesCuadrillaError ? (
                <span className="field-optional-hint muted">
                  No se pudo cargar la lista de maestros; puede escribir el nombre manualmente.
                </span>
              ) : null}
            </label>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={Boolean(label && flowComplete) || registerBusy}
            onClick={() => void register()}
          >
            {registerBusy ? 'Guardando en servidor…' : 'Guardar esta lectura'}
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
          Toque un código o escanéelo arriba: la fila activa y el detalle quedan alineados con el
          registro.
        </p>
        <ul className="recent-list">
          {recent.length === 0 && (
            <li className="recent-empty muted">Aún no hay etiquetas en este equipo.</li>
          )}
          {recent.map((l) => {
            const rowPhase = getOperationalPhase(l.id)
            const phaseHint =
              rowPhase === 'complete'
                ? ' · circuito cerrado'
                : rowPhase === 'acopio'
                  ? ' · pendiente: acopio'
                  : rowPhase === 'jc'
                    ? ' · falta salida JC'
                    : ''
            return (
            <li
              key={l.id}
              className={
                l.id === code.trim().toUpperCase() ? 'recent-list-item--active' : undefined
              }
            >
              <button type="button" className="linkish" onClick={() => setCode(l.id)}>
                {l.id}
              </button>
              <span className="muted">
                {l.especie} ·{' '}
                {l.cantidadTotes === null ? 'JC pendiente' : `${l.cantidadTotes} totes`}
                {phaseHint}
              </span>
            </li>
            )
          })}
        </ul>
      </section>

      {label && (
        <section className="card tracking-detail-card">
          <h2>Etiqueta {label.id}</h2>
          {trackingPhase === 'complete' ? (
            <p className="sub muted" role="status">
              Flujo JC + acopio completado; no se admiten más lecturas manuales para esta etiqueta.
            </p>
          ) : trackingPhase === 'acopio' ? (
            <p className="sub" role="status">
              <strong>Siguiente paso:</strong> llegada al acopio (registre totes que llegaron).
            </p>
          ) : trackingPhase === 'jc' ? (
            <p className="sub" role="status">
              <strong>Siguiente paso:</strong> primera salida de campo (JC).
            </p>
          ) : null}
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
          Un archivo con <strong>dos hojas</strong> (JC y acopio). En cada descarga se consulta de
          nuevo el servidor y se incluyen <strong>todos los movimientos</strong> que haya en la base
          en ese instante (desde cualquier celular que ya haya sincronizado).
        </p>
        <div className="export-excel-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!canExportExcel || excelBusy}
            onClick={() => {
              if (!canExportExcel) return
              setExcelBusy(true)
              void fetchTrackingExportPayload()
                .then((payload) => {
                  exportTrackingsExcel(undefined, payload)
                })
                .catch((e) => {
                  window.alert(e instanceof Error ? e.message : 'Error al exportar')
                })
                .finally(() => {
                  setExcelBusy(false)
                })
            }}
          >
            {excelBusy ? 'Consultando la base de datos…' : 'Descargar Excel (.xlsx)'}
          </button>
          {!canExportExcel ? (
            <p className="sub muted export-excel-empty">
              Solo perfiles con acceso administrativo (Admin y Super Admin) pueden descargar este
              Excel.
            </p>
          ) : allMovements.length === 0 ? (
            <p className="sub muted export-excel-empty">
              Puede descargar igual: el listado sale de la base de datos (lecturas ya sincronizadas
              desde cualquier celular).
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
