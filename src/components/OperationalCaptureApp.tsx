import { useCallback, useEffect, useMemo, useState } from 'react'
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

function initialRemoteGate(labelId: string): RemoteGate {
  const id = labelId.trim().toUpperCase()
  const tpl = getLabelLookupUrlTemplate()
  if (getLabelById(id)) return 'done_ok'
  if (tpl) return 'fetching'
  return 'off'
}

/**
 * Interfaz cerrada al abrir la app con ?e=CODIGO (mismo enlace que el QR).
 * Sin cabecera, pestañas ni módulos administrativos.
 */
export function OperationalCaptureApp({ labelId }: { labelId: string }) {
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((r) => r + 1), [])
  /** Tras JC: mostrar cierre sin encadenar al formulario de acopio (otro escaneo aparte). */
  const [jcAck, setJcAck] = useState(false)

  const id = labelId.trim().toUpperCase()

  useEffect(() => {
    setJcAck(false)
  }, [id])
  const lookupTpl = getLabelLookupUrlTemplate()
  const [remote, setRemote] = useState<RemoteGate>(() => initialRemoteGate(labelId))

  useEffect(() => {
    if (getLabelById(id)) {
      setRemote('done_ok')
      return
    }
    if (!lookupTpl) {
      setRemote('off')
      return
    }
    let cancelled = false
    setRemote('fetching')
    fetchLabelRemote(id, lookupTpl)
      .then((rec) => {
        if (cancelled) return
        if (rec) {
          upsertLabel(rec)
          setRev((x) => x + 1)
          setRemote('done_ok')
        } else {
          setRemote('done_miss')
        }
      })
      .catch(() => {
        if (!cancelled) setRemote('done_err')
      })
    return () => {
      cancelled = true
    }
  }, [id, lookupTpl])

  const { label, phase } = useMemo(() => {
    const l = getLabelById(id)
    const p = getOperationalPhase(id)
    return { label: l, phase: p }
  }, [id, rev])

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

  if (jcAck) {
    return <OperationalJcSavedAckView labelId={id} />
  }

  if (phase === 'jc') {
    return (
      <OperationalJcForm
        key={`jc-${rev}`}
        label={label}
        onSaved={() => {
          bump()
          setJcAck(true)
        }}
      />
    )
  }

  if (phase === 'acopio') {
    return <OperationalAcopioForm key={`ac-${rev}`} label={label} onSaved={bump} />
  }

  return <OperationalCompleteView labelId={id} />
}
