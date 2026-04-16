import { useCallback, useEffect, useState } from 'react'
import { getLabelLookupUrlTemplate } from '../lib/labelApiUrl'
import { syncLabelOperationalFromServer } from '../lib/syncLabelOperationalFromServer'
import { getLabelById, getOperationalPhase } from '../lib/storage'
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
  const label = getLabelById(id)
  const phase = getOperationalPhase(id)

  let remote: RemoteGate = 'off'
  if (lookupTpl) {
    const st = remoteState.labelId === id ? remoteState.status : 'idle'
    if (st === 'idle' && !label) remote = 'fetching'
    else if (st === 'idle' && label) remote = 'done_ok'
    else if (st === 'done_ok') remote = 'done_ok'
    else if (st === 'done_miss') remote = 'done_miss'
    else if (st === 'done_err') remote = 'done_err'
  }

  useEffect(() => {
    if (!lookupTpl) return
    let cancelled = false
    setRemoteState({ labelId: id, status: 'idle' })
    void syncLabelOperationalFromServer(id).then((r) => {
      if (cancelled) return
      const after = getLabelById(id)
      if (r.ok) {
        setRemoteState({ labelId: id, status: 'done_ok' })
        setRev((x) => x + 1)
        return
      }
      if (r.error === 'not_found' && !after) {
        setRemoteState({ labelId: id, status: 'done_miss' })
        return
      }
      if (after) {
        setRemoteState({ labelId: id, status: 'done_ok' })
        setRev((x) => x + 1)
        return
      }
      setRemoteState({ labelId: id, status: 'done_err' })
    })
    return () => {
      cancelled = true
    }
  }, [id, lookupTpl])

  if (remote === 'fetching') {
    return <OperationalLoading message="Sincronizando con el servidor…" />
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
