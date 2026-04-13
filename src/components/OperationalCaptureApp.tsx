import { useCallback, useEffect, useState } from 'react'
import { fetchLabelRemote } from '../lib/fetchLabelRemote'
import { getLabelLookupUrlTemplate } from '../lib/labelApiUrl'
import {
  getLabelById,
  getOperationalPhase,
  upsertLabel,
} from '../lib/storage'
import { OperationalAcopioForm } from './OperationalAcopioForm'
import { OperationalCompleteView } from './OperationalCompleteView'
import { OperationalJcForm } from './OperationalJcForm'
import { OperationalJcSavedAckView } from './OperationalJcSavedAckView'
import { OperationalLoading } from './OperationalLoading'
import { OperationalNotFound } from './OperationalNotFound'
import '../operational.css'

type RemoteGate = 'fetching' | 'off' | 'done_ok' | 'done_miss' | 'done_err'

/**
 * Interfaz cerrada al abrir la app con ?e=CODIGO (mismo enlace que el QR).
 * Sin cabecera, pestañas ni módulos administrativos.
 */
export function OperationalCaptureApp({ labelId }: { labelId: string }) {
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((r) => r + 1), [])
  /** Tras JC: mostrar cierre sin encadenar al formulario de acopio (otro escaneo aparte). */
  const [jcAckLabelId, setJcAckLabelId] = useState<string | null>(null)
  const [remoteState, setRemoteState] = useState<{
    labelId: string
    status: 'idle' | 'done_ok' | 'done_miss' | 'done_err'
  }>({
    labelId: labelId.trim().toUpperCase(),
    status: 'idle',
  })

  const id = labelId.trim().toUpperCase()
  const lookupTpl = getLabelLookupUrlTemplate()
  const localLabel = getLabelById(id)
  const remoteStatusForId =
    remoteState.labelId === id
      ? remoteState.status
      : localLabel
        ? 'done_ok'
        : 'idle'
  const remote: RemoteGate = localLabel
    ? 'done_ok'
    : !lookupTpl
      ? 'off'
      : remoteStatusForId === 'idle'
        ? 'fetching'
        : remoteStatusForId

  useEffect(() => {
    if (localLabel || !lookupTpl || remoteStatusForId !== 'idle') return
    let cancelled = false
    fetchLabelRemote(id, lookupTpl)
      .then((rec) => {
        if (cancelled) return
        if (rec) {
          upsertLabel(rec)
          setRev((x) => x + 1)
          setRemoteState({ labelId: id, status: 'done_ok' })
        } else {
          setRemoteState({ labelId: id, status: 'done_miss' })
        }
      })
      .catch(() => {
        if (!cancelled) setRemoteState({ labelId: id, status: 'done_err' })
      })
    return () => {
      cancelled = true
    }
  }, [id, lookupTpl, localLabel, remoteStatusForId])

  const label = getLabelById(id)
  const phase = getOperationalPhase(id)

  if (remote === 'fetching') {
    return <OperationalLoading message="Buscando etiqueta en el servidor…" />
  }

  if (!label || phase === 'not_found') {
    if (remote === 'done_err') {
      return <OperationalNotFound code={id} reason="network" />
    }
    if (remote === 'done_miss') {
      return <OperationalNotFound code={id} reason="remote" />
    }
    return <OperationalNotFound code={id} reason="local" />
  }

  if (phase === 'complete') {
    return <OperationalCompleteView labelId={id} />
  }

  if (jcAckLabelId === id) {
    return <OperationalJcSavedAckView labelId={id} />
  }

  if (phase === 'jc') {
    return (
      <OperationalJcForm
        key={`jc-${rev}`}
        label={label}
        onSaved={() => {
          bump()
          setJcAckLabelId(id)
        }}
      />
    )
  }

  if (phase === 'acopio') {
    return <OperationalAcopioForm key={`ac-${rev}`} label={label} onSaved={bump} />
  }

  return <OperationalCompleteView labelId={id} />
}
