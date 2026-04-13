import { Html5Qrcode } from 'html5-qrcode'
import { useEffect, useRef, useState } from 'react'
import { navigateFromScannedQrPayload } from '../lib/navigateFromQrScan'
import { Modal } from './Modal'

const READER_DOM_ID = 'qr-reader-pc-test'

type Props = {
  open: boolean
  onClose: () => void
}

export function QrScanTestModal({ open, onClose }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const handledRef = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setErr(null)
      setHint(null)
      handledRef.current = false
      return
    }

    let cancelled = false

    async function run() {
      setErr(null)
      setHint('Iniciando cámara…')
      handledRef.current = false

      try {
        const devices = await Html5Qrcode.getCameras()
        if (cancelled) return
        if (!devices?.length) {
          setErr('No se detectó ninguna cámara. Compruebe permisos del navegador.')
          setHint(null)
          return
        }

        const html5 = new Html5Qrcode(READER_DOM_ID)
        scannerRef.current = html5

        const cameraId = devices[0]!.id
        setHint('Enfoque el código QR de la etiqueta.')

        await html5.start(
          cameraId,
          { fps: 8, qrbox: { width: 260, height: 260 } },
          (decoded) => {
            if (cancelled || handledRef.current) return
            handledRef.current = true
            setHint('Código leído. Abriendo…')
            void html5.stop().then(
              () => {
                try {
                  html5.clear()
                } catch {
                  /* ignore */
                }
              },
              () => {},
            ).finally(() => {
              scannerRef.current = null
              navigateFromScannedQrPayload(decoded)
            })
          },
          () => {},
        )
        setHint('Enfoque el código QR de la etiqueta.')
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof Error
              ? e.message
              : 'No se pudo acceder a la cámara (permiso denegado o en uso).',
          )
          setHint(null)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      const s = scannerRef.current
      scannerRef.current = null
      if (s) {
        void s.stop().then(() => {
          try {
            s.clear()
          } catch {
            /* ignore */
          }
        })
      }
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escanear QR (prueba en PC)"
      size="lg"
      closeLabel="Detener y cerrar"
    >
      <p className="qr-scan-modal-lead">
        Use la webcam como haría el celular. Al detectar el QR se abrirá el mismo flujo de registro
        (<code>?e=</code>) en esta pestaña.
      </p>
      {hint && !err && <p className="qr-scan-modal-hint">{hint}</p>}
      {err && (
        <p className="qr-scan-modal-err" role="alert">
          {err}
        </p>
      )}
      <div className="qr-scan-modal-viewport">
        <div id={READER_DOM_ID} className="qr-scan-modal-reader" />
      </div>
    </Modal>
  )
}
