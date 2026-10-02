import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { fetchMasterAdminData, importMasterRows } from '../lib/masterDataApi'
import {
  buildMastersExport,
  buildTemplateWorkbook,
  IMPORT_ROW_LIMIT,
  importedSeasonCode,
  parseMasterWorkbook,
  type MasterBundle,
  type MasterImportRow,
} from '../lib/masterExcel'

type SeasonsLoad = 'loading' | 'ready' | 'error'
type ExportMessage = { kind: 'error' | 'info'; text: string }

const EXPORT_LOAD_ERROR = 'No se pudieron obtener los maestros. Intente nuevamente.'

export function MasterDataView({ onImported }: { onImported: () => void }) {
  const [seasonCode, setSeasonCode] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [isCurrent, setIsCurrent] = useState(true)
  const [rows, setRows] = useState<MasterImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [bundle, setBundle] = useState<MasterBundle | null>(null)
  const [seasonsLoad, setSeasonsLoad] = useState<SeasonsLoad>('loading')
  const [exportSeasonId, setExportSeasonId] = useState<number | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMessage, setExportMessage] = useState<ExportMessage | null>(null)
  const exportingRef = useRef(false)

  const distinctCompanies = useMemo(() => new Set(rows.map((r) => r.empresa)).size, [rows])

  /** Aplica un bundle fresco: guarda los datos y conserva la temporada elegida (o la actual, o la primera). */
  const applyBundle = useCallback((data: MasterBundle) => {
    setBundle(data)
    setExportSeasonId((prev) => {
      if (prev !== null && data.seasons.some((s) => s.id === prev)) return prev
      const current = data.seasons.find((s) => s.is_current === 1) ?? data.seasons[0]
      return current ? current.id : null
    })
  }, [])

  const loadSeasons = useCallback(async () => {
    setSeasonsLoad('loading')
    setExportMessage(null)
    try {
      applyBundle(await fetchMasterAdminData())
      setSeasonsLoad('ready')
    } catch {
      setSeasonsLoad('error')
    }
  }, [applyBundle])

  useEffect(() => {
    void loadSeasons()
  }, [loadSeasons])

  const seasons = bundle?.seasons ?? []
  const selectedSeason = seasons.find((s) => s.id === exportSeasonId) ?? null
  const exportReady = seasonsLoad === 'ready' && selectedSeason !== null

  function downloadTemplate() {
    XLSX.writeFile(buildTemplateWorkbook(), 'plantilla-maestros-etiquetado.xlsx')
  }

  async function exportMasters() {
    if (exportingRef.current || exportSeasonId === null) return
    exportingRef.current = true
    setExportBusy(true)
    setExportMessage(null)
    const fallbackCode = selectedSeason?.code ?? ''
    try {
      let data: MasterBundle
      try {
        data = await fetchMasterAdminData()
      } catch {
        setExportMessage({ kind: 'error', text: EXPORT_LOAD_ERROR })
        return
      }
      applyBundle(data)
      const result = buildMastersExport(data, exportSeasonId, new Date())
      if (result.kind === 'empty') {
        setExportMessage({
          kind: 'info',
          text: `La temporada ${result.seasonCode || fallbackCode} no tiene relaciones activas para exportar.`,
        })
        return
      }
      XLSX.writeFile(result.workbook, result.fileName)
      if (result.overImportLimit) {
        setExportMessage({
          kind: 'info',
          text: `El archivo tiene ${result.rowCount} filas; la importación acepta hasta ${IMPORT_ROW_LIMIT} por carga.`,
        })
      }
    } catch {
      setExportMessage({ kind: 'error', text: 'No se pudo generar el archivo Excel. Intente nuevamente.' })
    } finally {
      exportingRef.current = false
      setExportBusy(false)
    }
  }

  function onPickFile(file: File) {
    setError(null)
    setStatus(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const parsed = parseMasterWorkbook(wb)
        if (parsed.length === 0) {
          setError('No se encontraron filas válidas en el Excel.')
          return
        }
        setRows(parsed)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo procesar el archivo.')
      }
    }
    reader.onerror = () => setError('No se pudo leer el archivo.')
    reader.readAsArrayBuffer(file)
  }

  async function submitImport() {
    if (rows.length === 0) {
      setError('Debe seleccionar un Excel con datos válidos.')
      return
    }
    if (!seasonCode.trim() || !seasonName.trim()) {
      setError('Debe indicar código y nombre de temporada.')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await importMasterRows({
        season: { code: seasonCode.trim(), name: seasonName.trim(), isCurrent },
        rows,
      })
      setStatus(`Carga completada: ${result.applied} filas aplicadas de ${result.received}.`)
      onImported()
      void loadSeasons()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar maestros.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card master-excel">
      <h2>Carga maestra desde Excel</h2>
      <section className="master-excel-section" aria-labelledby="master-excel-exportar-titulo">
        <h3 id="master-excel-exportar-titulo">Exportar maestros</h3>
        <p className="sub">
          Descarga los maestros de una temporada para revisarlos o editarlos y volver a importarlos.
        </p>
        <div className="master-export">
          <label className="master-export-field">
            Temporada a exportar
            <select
              value={exportSeasonId ?? ''}
              disabled={!exportReady || exportBusy}
              onChange={(e) => {
                setExportSeasonId(Number(e.target.value))
                setExportMessage(null)
              }}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.code} - ${s.name}${s.is_active === 1 ? '' : ' (inactiva)'}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!exportReady || exportBusy}
            onClick={() => void exportMasters()}
          >
            {exportBusy ? 'Exportando...' : 'Exportar maestros a Excel'}
          </button>
          {seasonsLoad === 'error' && (
            <button type="button" className="btn secondary" onClick={() => void loadSeasons()}>
              Reintentar
            </button>
          )}
        </div>
        <div className="master-export-info" role="status">
          {seasonsLoad === 'error' && <p className="alert error">{EXPORT_LOAD_ERROR}</p>}
          {seasonsLoad === 'ready' && seasons.length === 0 && (
            <p className="alert info">No hay temporadas para exportar.</p>
          )}
          {exportMessage && <p className={`alert ${exportMessage.kind}`}>{exportMessage.text}</p>}
          {exportReady && selectedSeason && (
            <div className="master-export-notes">
              <p className="sub">
                {`Para reimportar, use el mismo código y nombre de temporada: «${selectedSeason.code}» / «${selectedSeason.name}».`}
              </p>
              <p className="sub">
                {selectedSeason.is_current === 1
                  ? 'Es la temporada actual: al reimportar, deje «Marcar como temporada actual» en Sí.'
                  : 'No es la temporada actual: al reimportar, elija «Marcar como temporada actual» = No, o pasará a ser la actual.'}
              </p>
              {selectedSeason.is_active !== 1 && (
                <p className="sub">Esta temporada está inactiva: reimportarla la reactivará.</p>
              )}
              {importedSeasonCode(selectedSeason.code) !== selectedSeason.code && (
                <p className="sub">
                  {`La importación convierte este código en «${importedSeasonCode(selectedSeason.code)}» y crearía otra temporada; corrija el código en Mantenimiento antes de reimportar.`}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="master-excel-section" aria-labelledby="master-excel-importar-titulo">
        <h3 id="master-excel-importar-titulo">Importar maestros desde Excel</h3>
        <p className="sub">Carga o actualiza empresas, especies, variedades, CC y CSG de una temporada.</p>
        <p className="master-template">
          ¿No tiene archivo?{' '}
          <button type="button" className="btn secondary" onClick={downloadTemplate}>
            Descargar plantilla Excel
          </button>
        </p>
        <div className="label-form">
          <p className="master-step-title">1. Temporada</p>
          <div className="form-grid">
            <label>
              Código temporada
              <input
                type="text"
                value={seasonCode}
                onChange={(e) => setSeasonCode(e.target.value)}
                placeholder="2026-2027"
              />
            </label>
            <label>
              Nombre temporada
              <input
                type="text"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="Temporada 2026-2027"
              />
            </label>
            <label className="full-width">
              <span className="operational-label">Marcar como temporada actual</span>
              <select value={isCurrent ? '1' : '0'} onChange={(e) => setIsCurrent(e.target.value === '1')}>
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </label>
          </div>
          <p className="master-step-title">2. Archivo</p>
          <div className="form-grid">
            <label className="full-width">
              Archivo Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onPickFile(file)
                }}
              />
            </label>
          </div>
          <p className="sub">Columnas esperadas: EMPRESA, ESPECIE, VARIEDAD, CC, CSG y NOMBRE CC (opcional).</p>
          {rows.length > 0 && (
            <p className="info-banner">
              Filas válidas detectadas: <strong>{rows.length}</strong> | Empresas: <strong>{distinctCompanies}</strong>
            </p>
          )}
          {status && <p className="alert success">{status}</p>}
          {error && <p className="alert error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void submitImport()}>
              {busy ? 'Importando...' : 'Importar maestros'}
            </button>
          </div>
        </div>
      </section>
    </section>
  )
}
