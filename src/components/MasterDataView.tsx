import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { importMasterRows } from '../lib/masterDataApi'

type MasterRow = {
  empresa: string
  cc: string
  especie: string
  variedad: string
  csg: string
}

function normalizeHeaders(row: Record<string, unknown>): MasterRow | null {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = row[key]
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim()
      }
    }
    return ''
  }
  const parsed: MasterRow = {
    empresa: get('empresa', 'Empresa', 'EMPRESA'),
    cc: get('cc', 'CC', 'centro_costo', 'CentroCosto', 'centroCosto'),
    especie: get('especie', 'Especie', 'ESPECIE'),
    variedad: get('variedad', 'Variedad', 'VARIEDAD'),
    csg: get('csg', 'CSG'),
  }
  if (!parsed.empresa || !parsed.cc || !parsed.especie || !parsed.variedad || !parsed.csg) {
    return null
  }
  return parsed
}

export function MasterDataView({ onImported }: { onImported: () => void }) {
  const [seasonCode, setSeasonCode] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [isCurrent, setIsCurrent] = useState(true)
  const [rows, setRows] = useState<MasterRow[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const distinctCompanies = useMemo(() => new Set(rows.map((r) => r.empresa)).size, [rows])

  function downloadTemplate() {
    const templateRows = [
      {
        EMPRESA: 'EMPRESA EJEMPLO SPA',
        ESPECIE: 'CEREZA',
        VARIEDAD: 'LAPINS',
        CC: 'CC-001',
        CSG: '12345',
      },
    ]
    const sheet = XLSX.utils.json_to_sheet(templateRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Plantilla')
    XLSX.writeFile(wb, 'plantilla-maestros-etiquetado.xlsx')
  }

  function onPickFile(file: File) {
    setError(null)
    setStatus(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0] || '']
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        const parsed = json
          .map(normalizeHeaders)
          .filter((row): row is MasterRow => Boolean(row))
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar maestros.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Carga maestra desde Excel</h2>
      <p className="sub">Columnas esperadas: empresa, cc, especie, variedad, csg.</p>
      <div className="label-form">
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
          <label className="full-width">
            <span className="operational-label">Marcar como temporada actual</span>
            <select value={isCurrent ? '1' : '0'} onChange={(e) => setIsCurrent(e.target.value === '1')}>
              <option value="1">Sí</option>
              <option value="0">No</option>
            </select>
          </label>
        </div>
        {rows.length > 0 && (
          <p className="info-banner">
            Filas válidas detectadas: <strong>{rows.length}</strong> | Empresas: <strong>{distinctCompanies}</strong>
          </p>
        )}
        {status && <p className="alert success">{status}</p>}
        {error && <p className="alert error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={downloadTemplate}>
            Descargar plantilla Excel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submitImport()}>
            {busy ? 'Importando...' : 'Importar maestros'}
          </button>
        </div>
      </div>
    </section>
  )
}
