import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppTab } from './appTabs'
import { AppHeader } from './components/AppHeader'
import { GenerarView } from './components/GenerarView'
import { isLabelFormComplete, defaultFormValues, type LabelFormValues } from './components/labelFormValues'
import { LabelPreview } from './components/LabelPreview'
import { TrackingView } from './components/TrackingView'
import { appendBatchLog } from './lib/batchHistory'
import { createLabelRecords, MAX_ETIQUETAS_LOTE } from './lib/createLabelRecords'
import { exportLabelsPdf } from './lib/exportLabelsPdf'
import { pushLabelsBatchToServer } from './lib/pushLabelsBatch'
import { saveLabelsBatch } from './lib/storage'
import { readTrackingFromUrl, type TrackingSeed } from './lib/urlBootstrap'
import type { LabelRecord } from './types'
import { OperationalCaptureApp } from './components/OperationalCaptureApp'
import './App.css'

export type Tab = AppTab

const urlBoot = readTrackingFromUrl()

function App() {
  const [tab, setTab] = useState<AppTab>(urlBoot.tab)
  const [form, setForm] = useState<LabelFormValues>(() => defaultFormValues())
  const [cantidadLote, setCantidadLote] = useState(1)
  const [generatedRecords, setGeneratedRecords] = useState<LabelRecord[]>([])
  const [genError, setGenError] = useState<string | null>(null)
  const [batchHistoryKey, setBatchHistoryKey] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [genSuccess, setGenSuccess] = useState(false)
  const [trackingSeed, setTrackingSeed] = useState<TrackingSeed | null>(urlBoot.seed)
  const [loteModalOpen, setLoteModalOpen] = useState(false)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)

  const goToTrackingWith = useCallback((labelId: string) => {
    setTrackingSeed({ code: labelId.toUpperCase(), nonce: Date.now() })
    setTab('trazabilidad')
  }, [])

  const generate = useCallback(() => {
    setGenError(null)
    setSyncWarning(null)
    if (!isLabelFormComplete(form)) {
      setGenError('Complete todos los campos obligatorios del lote (use el formulario).')
      setLoteModalOpen(true)
      return
    }
    try {
      const n = Math.min(Math.max(1, Math.floor(cantidadLote)), MAX_ETIQUETAS_LOTE)
      const records = createLabelRecords(form, n)
      saveLabelsBatch(records)
      appendBatchLog(records)
      setBatchHistoryKey((k) => k + 1)
      setGeneratedRecords(records)
      setGenSuccess(true)
      setLoteModalOpen(false)
      void pushLabelsBatchToServer(records).then((r) => {
        if (r.ok === false) setSyncWarning(r.message)
      })
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Error al generar')
    }
  }, [form, cantidadLote])

  useEffect(() => {
    if (!genSuccess) return
    const id = window.setTimeout(() => setGenSuccess(false), 4200)
    return () => window.clearTimeout(id)
  }, [genSuccess])

  const printLabels = () => {
    window.print()
  }

  const downloadPdf = async (records: LabelRecord[], fileName?: string) => {
    if (records.length === 0) return
    setPdfBusy(true)
    try {
      await exportLabelsPdf(records, { fileName })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Error al generar el PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  const trackingKey = trackingSeed ? `t-${trackingSeed.nonce}` : 't-default'
  const trackingInitial = trackingSeed?.code ?? ''

  const submitLabel = useMemo(() => {
    const n = Math.min(Math.max(1, Math.floor(cantidadLote)), MAX_ETIQUETAS_LOTE)
    return n === 1 ? 'Generar 1 etiqueta' : `Generar ${n} etiquetas (mismo lote)`
  }, [cantidadLote])

  const formComplete = isLabelFormComplete(form)

  if (urlBoot.operational && urlBoot.seed) {
    return (
      <OperationalCaptureApp
        labelId={urlBoot.seed.code}
        key={urlBoot.seed.nonce}
      />
    )
  }

  return (
    <div className="app">
      <AppHeader
        activeTab={tab}
        onNavigate={setTab}
        loteComplete={formComplete}
      />

      <main id="contenido-principal" className="app-main">
        <div
          id="panel-generar"
          role="tabpanel"
          aria-labelledby="tab-generar"
          hidden={tab !== 'generar'}
        >
          <GenerarView
            form={form}
            onFormChange={setForm}
            cantidadLote={cantidadLote}
            onCantidadLoteChange={setCantidadLote}
            generatedRecords={generatedRecords}
            genError={genError}
            genSuccess={genSuccess}
            syncWarning={syncWarning}
            pdfBusy={pdfBusy}
            loteModalOpen={loteModalOpen}
            onLoteModalOpenChange={setLoteModalOpen}
            batchHistoryKey={batchHistoryKey}
            formComplete={formComplete}
            onGenerate={generate}
            submitLabel={submitLabel}
            onGoToTracking={goToTrackingWith}
            onPrint={printLabels}
            onDownloadPdf={downloadPdf}
          />
        </div>

        <div
          id="panel-trazabilidad"
          role="tabpanel"
          aria-labelledby="tab-trazabilidad"
          hidden={tab !== 'trazabilidad'}
          className="tab-panel-traz"
        >
          <header className="page-intro no-print">
            <p className="page-eyebrow">En campo y acopio</p>
            <h2 className="page-heading">Registrar lecturas del QR</h2>
            <p className="page-lead">
              Uso interno: búsqueda manual, accesos rápidos y exportación. En terreno, el mismo QR
              abre solo el formulario que corresponde (sin este panel) cuando la URL incluye{' '}
              <code>?e=</code> al escanear.
            </p>
          </header>
          <div className="no-print">
            <TrackingView key={trackingKey} initialCode={trackingInitial} />
          </div>
        </div>

        {generatedRecords.length > 0 && (
          <div className="print-only print-labels-stack" aria-hidden>
            {generatedRecords.map((r) => (
              <div key={r.id} className="print-label-page">
                <LabelPreview record={r} />
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="app-footer no-print">
        <details className="footer-help">
          <summary>Ayuda: escaneo del QR y dónde se guardan los datos</summary>
          <div className="footer-help-body">
            <p>
              El QR abre la app con <code>?e=CÓDIGO</code>: en celular solo verán el formulario de
              salida JC o de llegada a acopio, según corresponda, sin menús. Esta pestaña es para
              administración y registro manual en el mismo navegador.
            </p>
            <p>
              Los datos viven en <strong>este navegador en este equipo</strong>. Para el celular:
              ejecute <code>npm run server</code> (API Node + MySQL con las mismas variables{' '}
              <code>MYSQL_*</code> del <code>.env</code>). En desarrollo, Vite enruta{' '}
              <code>/api</code> al puerto 3001; solo si el API está en otro host use{' '}
              <code>VITE_SYNC_API_BASE=http://IP:3001</code>. Al generar etiquetas se guardan en la
              BD y al escanear el QR el móvil las descarga. Opcional: <code>VITE_LABEL_LOOKUP_URL</code>{' '}
              con <code>{'{{id}}'}</code> si usa otro backend (p. ej. PHP).
            </p>
          </div>
        </details>
      </footer>
    </div>
  )
}

export default App
