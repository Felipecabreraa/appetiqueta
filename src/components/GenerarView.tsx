import type { LabelFormValues } from './labelFormValues'
import { BatchHistoryPanel } from './BatchHistoryPanel'
import { LabelForm } from './LabelForm'
import { Modal } from './Modal'
import { LabelPreview } from './LabelPreview'
import { MAX_ETIQUETAS_LOTE } from '../lib/createLabelRecords'
import type { CompanyOption, CostCenterOption, LabelRecord, SeasonOption } from '../types'

export type GenerarViewProps = {
  form: LabelFormValues
  onFormChange: (v: LabelFormValues) => void
  cantidadLote: number
  onCantidadLoteChange: (n: number) => void
  generatedRecords: LabelRecord[]
  genError: string | null
  genSuccess: boolean
  /** Aviso si falló el guardado en el API / MySQL (VITE_SYNC_API_BASE). */
  syncWarning?: string | null
  pdfBusy: boolean
  loteModalOpen: boolean
  onLoteModalOpenChange: (open: boolean) => void
  batchHistoryKey: number
  formComplete: boolean
  onGenerate: () => void
  submitLabel: string
  onGoToTracking: (labelId: string) => void
  onPrint: () => void
  onDownloadPdf: (records: LabelRecord[], fileName?: string) => void
  seasons: SeasonOption[]
  companies: CompanyOption[]
  costCenters: CostCenterOption[]
  mastersLoading?: boolean
  mastersError?: string | null
  onSeasonChange: (seasonId: number) => void
  onCompanyChange: (companyId: number) => void
  onCostCenterChange: (costCenterId: number) => void
}

export function GenerarView({
  form,
  onFormChange,
  cantidadLote,
  onCantidadLoteChange,
  generatedRecords,
  genError,
  genSuccess,
  syncWarning,
  pdfBusy,
  loteModalOpen,
  onLoteModalOpenChange,
  batchHistoryKey,
  formComplete,
  onGenerate,
  submitLabel,
  onGoToTracking,
  onPrint,
  onDownloadPdf,
  seasons,
  companies,
  costCenters,
  mastersLoading,
  mastersError,
  onSeasonChange,
  onCompanyChange,
  onCostCenterChange,
}: GenerarViewProps) {
  const primera = generatedRecords[0]
  const esLote = generatedRecords.length > 1

  const hasPreview = generatedRecords.length > 0

  return (
    <>
      <div className="generar-stack no-print">
        <section className="card workflow-card" aria-labelledby="workflow-heading">
          <p className="page-eyebrow">Flujo de trabajo</p>
          <h2 id="workflow-heading" className="page-heading">
            Crear e imprimir etiquetas
          </h2>
          <p className="page-lead">
            Complete el lote en el formulario modal, confirme la cantidad, genere e imprima o exporte
            a PDF. En campo use la pestaña <strong>Registrar lecturas</strong>.
          </p>
          <ol className="flow-stepper" aria-label="Pasos del proceso">
            <li>
              <span className="flow-stepper-num" aria-hidden>
                1
              </span>
              <span className="flow-stepper-body">
                <strong>Datos del lote</strong>
                <span className="flow-stepper-desc">Cantidad de etiquetas y formulario en ventana.</span>
              </span>
            </li>
            <li>
              <span className="flow-stepper-num" aria-hidden>
                2
              </span>
              <span className="flow-stepper-body">
                <strong>Generar</strong>
                <span className="flow-stepper-desc">Un QR único por etiqueta, mismo lote.</span>
              </span>
            </li>
            <li>
              <span className="flow-stepper-num" aria-hidden>
                3
              </span>
              <span className="flow-stepper-body">
                <strong>Imprimir / PDF</strong>
                <span className="flow-stepper-desc">Luego registre JC y acopio en la otra pestaña.</span>
              </span>
            </li>
          </ol>
        </section>

        <div
          className={`layout-workbench${hasPreview ? '' : ' layout-workbench--awaiting'}`}
        >
        <section className="card lote-setup-card" aria-labelledby="lote-setup-title">
          <div className="card-head card-head--with-badge">
            <div className="card-head-titles">
              <span className="card-step-badge" aria-hidden>
                1
              </span>
              <h2 id="lote-setup-title">Nueva generación</h2>
            </div>
          </div>
          <div className="bulk-count-highlight">
            <div className="bulk-count-row">
              <label>
                Cantidad de etiquetas
                <input
                  type="number"
                  min={1}
                  max={MAX_ETIQUETAS_LOTE}
                  step={1}
                  value={cantidadLote}
                  onChange={(e) =>
                    onCantidadLoteChange(e.target.value === '' ? 1 : Number(e.target.value))
                  }
                />
              </label>
              <span className="bulk-hint muted">Máximo {MAX_ETIQUETAS_LOTE} por generación.</span>
            </div>
          </div>
          <div className="lote-cta-banner">
            <button
              type="button"
              className="btn primary btn-block btn-pad-lg"
              onClick={() => onLoteModalOpenChange(true)}
            >
              {formComplete ? 'Editar datos del lote' : 'Abrir formulario de datos del lote'}
            </button>
            <p className="lote-cta-hint muted">
              {formComplete
                ? 'Puede ajustar los campos del lote antes de generar.'
                : 'Complete empresa, especie, fechas y el resto de campos obligatorios en el formulario.'}
            </p>
          </div>
          <div className="lote-summary">
            <h3 className="lote-summary-title">Resumen del lote</h3>
            {formComplete ? (
              <dl className="lote-summary-dl">
                <div className="lote-summary-row">
                  <dt>Fecha</dt>
                  <dd>{form.fecha}</dd>
                </div>
                <div className="lote-summary-row">
                  <dt>Empresa</dt>
                  <dd>{form.empresa}</dd>
                </div>
                <div className="lote-summary-row">
                  <dt>Especie / variedad</dt>
                  <dd>
                    {form.especie} — {form.variedad}
                  </dd>
                </div>
                <div className="lote-summary-row">
                  <dt>CSG / sector</dt>
                  <dd>
                    {form.csg} · {form.sector}
                  </dd>
                </div>
                <div className="lote-summary-row">
                  <dt>Centro de costo</dt>
                  <dd>{form.centroCosto}</dd>
                </div>
                {form.exportacion.trim() !== '' && (
                  <div className="lote-summary-row">
                    <dt>Exportación</dt>
                    <dd>{form.exportacion}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="lote-summary-empty muted">
                Complete los datos obligatorios en el formulario para ver el resumen aquí.
              </p>
            )}
          </div>
          <div className="lote-setup-actions lote-setup-actions--tail">
            <button type="button" className="btn primary btn-generate-solo" onClick={onGenerate}>
              {submitLabel}
            </button>
          </div>
          {genError && (
            <p className="alert error" role="alert">
              {genError}
            </p>
          )}
        </section>

        <section
          className={`card preview-card${generatedRecords.length === 0 ? ' preview-card--empty' : ''}`}
          aria-labelledby="preview-title"
        >
          <div className="card-head card-head--with-badge">
            <div className="card-head-titles">
              <span className="card-step-badge card-step-badge--muted" aria-hidden>
                2
              </span>
              <h2 id="preview-title">Resultado</h2>
            </div>
          </div>
          {genSuccess && (
            <p className="alert success" role="status">
              Generación lista. Imprima o baje el PDF; para trazas use{' '}
              <strong>Registrar lecturas</strong>.
            </p>
          )}
          {syncWarning && (
            <p className="alert warn" role="status">
              {syncWarning}
            </p>
          )}
          {generatedRecords.length === 0 && (
            <div className="preview-empty-block">
              <span className="preview-empty-icon" aria-hidden>
                ▢
              </span>
              <p className="placeholder">
                Cuando genere, verá la vista previa de la etiqueta y las acciones de impresión y PDF.
              </p>
            </div>
          )}
          {generatedRecords.length === 1 && primera && (
            <>
              <LabelPreview record={primera} />
              <div className="preview-actions" aria-busy={pdfBusy}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onGoToTracking(primera.id)}
                >
                  Registrar lecturas con esta etiqueta
                </button>
                <button type="button" className="btn secondary" onClick={onPrint}>
                  Imprimir etiqueta
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={pdfBusy}
                  onClick={() => void onDownloadPdf(generatedRecords, `etiqueta-${primera.id}.pdf`)}
                >
                  {pdfBusy ? 'Generando PDF…' : 'Descargar PDF'}
                </button>
              </div>
            </>
          )}
          {esLote && primera && (
            <>
              <p className="bulk-summary">
                <strong>{generatedRecords.length}</strong> etiquetas con los mismos datos; cada una
                con su propio QR.
              </p>
              <p className="sub">Vista de la primera del lote:</p>
              <LabelPreview record={primera} />
              <div className="preview-actions wrap" aria-busy={pdfBusy}>
                <button type="button" className="btn primary" onClick={onPrint}>
                  Imprimir todas ({generatedRecords.length})
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={pdfBusy}
                  onClick={() =>
                    void onDownloadPdf(
                      generatedRecords,
                      `lote-${generatedRecords.length}-${new Date().toISOString().slice(0, 10)}.pdf`,
                    )
                  }
                >
                  {pdfBusy ? 'Generando PDF…' : `PDF del lote (${generatedRecords.length})`}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => onGoToTracking(primera.id)}
                >
                  Lecturas — primera del lote
                </button>
              </div>
              <details className="bulk-codes-details">
                <summary>Códigos del lote ({generatedRecords.length})</summary>
                <ul className="bulk-id-list">
                  {generatedRecords.map((r) => (
                    <li key={r.id}>
                      <code>{r.id}</code>
                      <button
                        type="button"
                        className="linkish tiny"
                        onClick={() => onGoToTracking(r.id)}
                      >
                        Abrir en lecturas
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>
        </div>

        <div className="batch-history-outer">
          <BatchHistoryPanel key={batchHistoryKey} />
        </div>
      </div>

      <Modal
        open={loteModalOpen}
        onClose={() => onLoteModalOpenChange(false)}
        title="Datos del lote"
        size="lg"
      >
        <p className="sub bulk-intro modal-form-intro">
          Mismos datos para todas las etiquetas de esta generación. Cada etiqueta tendrá un código QR
          único. La cantidad se ajusta en la tarjeta principal.
        </p>
        <LabelForm
          values={form}
          onChange={onFormChange}
          onSeasonChange={onSeasonChange}
          onCompanyChange={onCompanyChange}
          onCostCenterChange={onCostCenterChange}
          seasons={seasons}
          companies={companies}
          costCenters={costCenters}
          mastersLoading={mastersLoading}
          mastersError={mastersError}
          onSubmit={onGenerate}
          submitLabel={submitLabel}
        />
      </Modal>
    </>
  )
}
