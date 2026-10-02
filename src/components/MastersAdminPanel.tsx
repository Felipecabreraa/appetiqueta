import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  fetchMasterAdminData,
  upsertCompany,
  upsertCsg,
  upsertJcForeman,
  upsertRelation,
  upsertSeason,
  upsertSpecies,
  upsertVariety,
} from '../lib/masterDataApi'
import { formatLastModified } from '../lib/masterAudit'
import type {
  MasterAudit,
  MasterCompany,
  MasterCsg,
  MasterJcForeman,
  MasterRelation,
  MasterSeason,
  MasterSpecies,
  MasterVariety,
} from '../types'

type CatalogId = 'relations' | 'seasons' | 'companies' | 'species' | 'varieties' | 'csg' | 'jcForemen'
type StatusFilter = 'all' | 'active' | 'inactive'
type CodeNameForm = { id: number; code: string; name: string; isActive: boolean }

const EMPTY_CODE_NAME: CodeNameForm = { id: 0, code: '', name: '', isActive: true }

const EMPTY_SEASON = {
  id: 0,
  code: '',
  name: '',
  startsOn: '',
  endsOn: '',
  isCurrent: false,
  isActive: true,
}

const EMPTY_VARIETY = { id: 0, code: '', name: '', speciesId: 0, isActive: true }

const EMPTY_RELATION = {
  id: 0,
  seasonId: 0,
  companyId: 0,
  centerCode: '',
  centerName: '',
  speciesId: 0,
  varietyId: 0,
  csgId: 0,
  isActive: true,
}

/** Nombre descriptivo del CC: oculto por ahora; poner en true para mostrarlo en el formulario. */
const SHOW_CENTER_NAME = false

type Pane = 'list' | 'form'

const CATALOGS: Array<{
  id: CatalogId
  group: 'operacion' | 'base'
  label: string
  newLabel: string
  blurb: string
}> = [
  {
    id: 'relations',
    group: 'operacion',
    label: 'Relaciones',
    newLabel: 'Nueva relación',
    blurb:
      'Combinación válida de temporada, empresa, centro de costo, especie, variedad y CSG. Es lo que el operador elige al crear etiquetas.',
  },
  {
    id: 'seasons',
    group: 'base',
    label: 'Temporadas',
    newLabel: 'Nueva temporada',
    blurb: 'Campañas de trabajo. Solo una puede marcarse como actual; al hacerlo, las demás dejan de serlo.',
  },
  {
    id: 'companies',
    group: 'base',
    label: 'Empresas',
    newLabel: 'Nueva empresa',
    blurb: 'Exportadoras o productoras que aparecen al generar etiquetas, filtradas por temporada.',
  },
  {
    id: 'species',
    group: 'base',
    label: 'Especies',
    newLabel: 'Nueva especie',
    blurb: 'Fruta de la etiqueta. Las variedades dependen de la especie.',
  },
  {
    id: 'varieties',
    group: 'base',
    label: 'Variedades',
    newLabel: 'Nueva variedad',
    blurb: 'Cada variedad pertenece a una especie. Sin especie no se puede guardar.',
  },
  {
    id: 'csg',
    group: 'base',
    label: 'CSG',
    newLabel: 'Nuevo CSG',
    blurb: 'Código SAG del predio. Se asigna dentro de la relación, no se elige a mano en la etiqueta.',
  },
  {
    id: 'jcForemen',
    group: 'base',
    label: 'Jefes de cuadrilla',
    newLabel: 'Nuevo jefe',
    blurb: 'Se usan al registrar la primera lectura JC, no al crear la etiqueta.',
  },
]

function boolValue(v: number | boolean | undefined): '1' | '0' {
  return v ? '1' : '0'
}

function matchesQuery(query: string, ...parts: Array<string | number | null | undefined>) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => String(part ?? '').toLowerCase().includes(needle))
}

function matchesStatus(filter: StatusFilter, isActive: number | boolean) {
  if (filter === 'all') return true
  return filter === 'active' ? Boolean(isActive) : !isActive
}

function sortByName<T extends { name: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function MastersAdminPanel({ canManage }: { canManage: boolean }) {
  const editorRef = useRef<HTMLElement>(null)
  const [catalog, setCatalog] = useState<CatalogId>('relations')
  const [pane, setPane] = useState<Pane>('list')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [seasonFilter, setSeasonFilter] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<MasterSeason[]>([])
  const [companies, setCompanies] = useState<MasterCompany[]>([])
  const [species, setSpecies] = useState<MasterSpecies[]>([])
  const [csg, setCsg] = useState<MasterCsg[]>([])
  const [jcForemen, setJcForemen] = useState<MasterJcForeman[]>([])
  const [varieties, setVarieties] = useState<MasterVariety[]>([])
  const [relations, setRelations] = useState<MasterRelation[]>([])

  const [seasonForm, setSeasonForm] = useState(EMPTY_SEASON)
  const [companyForm, setCompanyForm] = useState(EMPTY_CODE_NAME)
  const [speciesForm, setSpeciesForm] = useState(EMPTY_CODE_NAME)
  const [csgForm, setCsgForm] = useState(EMPTY_CODE_NAME)
  const [jcForemanForm, setJcForemanForm] = useState(EMPTY_CODE_NAME)
  const [varietyForm, setVarietyForm] = useState(EMPTY_VARIETY)
  const [relationForm, setRelationForm] = useState(EMPTY_RELATION)

  const currentCatalog = CATALOGS.find((item) => item.id === catalog) ?? CATALOGS[0]

  const counts: Record<CatalogId, number> = {
    relations: relations.length,
    seasons: seasons.length,
    companies: companies.length,
    species: species.length,
    varieties: varieties.length,
    csg: csg.length,
    jcForemen: jcForemen.length,
  }

  const filteredVarieties = useMemo(
    () => varieties.filter((row) => !relationForm.speciesId || row.species_id === relationForm.speciesId),
    [varieties, relationForm.speciesId],
  )

  const editingId = currentEditingId(
    catalog,
    seasonForm.id,
    companyForm.id,
    speciesForm.id,
    csgForm.id,
    jcForemanForm.id,
    varietyForm.id,
    relationForm.id,
  )

  const filteredSeasons = useMemo(
    () =>
      [...seasons]
        .sort((a, b) => b.is_current - a.is_current || a.code.localeCompare(b.code, 'es'))
        .filter(
          (row) =>
            matchesStatus(statusFilter, row.is_active) &&
            matchesQuery(query, row.code, row.name, row.starts_on, row.ends_on),
        ),
    [seasons, query, statusFilter],
  )

  const filteredCompanies = useMemo(
    () =>
      sortByName(companies).filter(
        (row) => matchesStatus(statusFilter, row.is_active) && matchesQuery(query, row.code, row.name),
      ),
    [companies, query, statusFilter],
  )

  const filteredSpecies = useMemo(
    () =>
      sortByName(species).filter(
        (row) => matchesStatus(statusFilter, row.is_active) && matchesQuery(query, row.code, row.name),
      ),
    [species, query, statusFilter],
  )

  const filteredCsg = useMemo(
    () =>
      sortByName(csg).filter(
        (row) => matchesStatus(statusFilter, row.is_active) && matchesQuery(query, row.code, row.name),
      ),
    [csg, query, statusFilter],
  )

  const filteredForemen = useMemo(
    () =>
      sortByName(jcForemen).filter(
        (row) => matchesStatus(statusFilter, row.is_active) && matchesQuery(query, row.code, row.name),
      ),
    [jcForemen, query, statusFilter],
  )

  const filteredVarietiesTable = useMemo(
    () =>
      [...varieties]
        .sort((a, b) => (a.species_name || '').localeCompare(b.species_name || '', 'es') || a.name.localeCompare(b.name, 'es'))
        .filter(
          (row) =>
            matchesStatus(statusFilter, row.is_active) &&
            matchesQuery(query, row.code, row.name, row.species_name, row.species_id),
        ),
    [varieties, query, statusFilter],
  )

  const filteredRelations = useMemo(
    () =>
      [...relations]
        .sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '', 'es') || a.center_code.localeCompare(b.center_code, 'es'))
        .filter(
          (row) =>
            matchesStatus(statusFilter, row.is_active) &&
            (!seasonFilter || row.season_id === seasonFilter) &&
            matchesQuery(
              query,
              row.season_code,
              row.company_name,
              row.center_code,
              row.center_name,
              row.species_name,
              row.variety_name,
              row.csg_name,
            ),
        ),
    [relations, query, statusFilter, seasonFilter],
  )

  async function reload() {
    setLoading(true)
    setError(null)
    setLoadFailed(false)
    try {
      const data = await fetchMasterAdminData()
      setSeasons(data.seasons)
      setCompanies(data.companies)
      setSpecies(data.species)
      setCsg(data.csg)
      setJcForemen(data.jcForemen || [])
      setVarieties(data.varieties)
      setRelations(data.relations)
    } catch (e) {
      setLoadFailed(true)
      setError(e instanceof Error ? e.message : 'No se pudo cargar el módulo de maestros.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canManage) void reload()
  }, [canManage])

  useEffect(() => {
    if (pane !== 'form') return
    editorRef.current?.focus()
  }, [pane, editingId])

  useEffect(() => {
    if (!ok) return
    const timer = window.setTimeout(() => setOk(null), 4200)
    return () => window.clearTimeout(timer)
  }, [ok])

  function selectCatalog(id: CatalogId) {
    setCatalog(id)
    setPane('list')
    setQuery('')
    setStatusFilter('all')
    setSeasonFilter(0)
  }

  function openNewRecord() {
    resetCurrentForm()
    setPane('form')
  }

  function cancelForm() {
    const wasEditing = editingId > 0
    resetCurrentForm()
    if (wasEditing) setPane('list')
  }

  function resetCurrentForm() {
    if (catalog === 'seasons') setSeasonForm(EMPTY_SEASON)
    if (catalog === 'companies') setCompanyForm(EMPTY_CODE_NAME)
    if (catalog === 'species') setSpeciesForm(EMPTY_CODE_NAME)
    if (catalog === 'csg') setCsgForm(EMPTY_CODE_NAME)
    if (catalog === 'jcForemen') setJcForemanForm(EMPTY_CODE_NAME)
    if (catalog === 'varieties') setVarietyForm(EMPTY_VARIETY)
    if (catalog === 'relations') setRelationForm(EMPTY_RELATION)
  }

  async function runSave(action: () => Promise<void>, success: string, reset: () => void) {
    setSaving(true)
    setError(null)
    setOk(null)
    try {
      await action()
      setOk(success)
      reset()
      setPane('list')
      const data = await fetchMasterAdminData()
      setSeasons(data.seasons)
      setCompanies(data.companies)
      setSpecies(data.species)
      setCsg(data.csg)
      setJcForemen(data.jcForemen || [])
      setVarieties(data.varieties)
      setRelations(data.relations)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section className="card">
        <h2>Mantenimiento en pantalla</h2>
        <p className="sub">Sin permisos para editar maestros. Solo Admin y Super Admin pueden mantener catálogos.</p>
      </section>
    )
  }

  const visibleCount = visibleRowCount(
    catalog,
    filteredSeasons.length,
    filteredCompanies.length,
    filteredSpecies.length,
    filteredCsg.length,
    filteredForemen.length,
    filteredVarietiesTable.length,
    filteredRelations.length,
  )
  const listEmptyHint = loading
    ? 'Cargando registros…'
    : loadFailed && counts[catalog] === 0
      ? 'No se pudieron cargar los registros.'
      : emptyHint(query, statusFilter, counts[catalog], catalog === 'relations' && seasonFilter > 0)

  return (
    <section className="masters-admin">
      <header className="masters-admin-head">
        <div>
          <h2 className="masters-admin-title">Mantenimiento en pantalla</h2>
          <p className="masters-admin-lead">
            Alta y corrección puntual. La carga masiva sigue en Excel. Marcar un registro como inactivo lo oculta en
            operación; no se elimina.
          </p>
        </div>
        <button type="button" className="btn secondary" disabled={loading || saving} onClick={() => void reload()}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <details className="masters-howto">
        <summary>Cómo funciona este maestro</summary>
        <div className="masters-howto-body">
          <ol className="masters-flow">
            <li className="masters-flow-step">
              <span className="masters-flow-index">1</span>
              <div>
                <strong>Catálogos base</strong>
                <p>Temporada, empresa, especie, variedad, CSG y jefes se mantienen por separado.</p>
              </div>
            </li>
            <li className="masters-flow-step">
              <span className="masters-flow-index">2</span>
              <div>
                <strong>Relación</strong>
                <p>Une esos catálogos con un centro de costo. Esa fila es la que alimenta Crear etiquetas.</p>
              </div>
            </li>
            <li className="masters-flow-step">
              <span className="masters-flow-index">3</span>
              <div>
                <strong>Operación</strong>
                <p>
                  Al generar, el operador elige temporada → empresa → CC. Especie, variedad y CSG salen de la
                  relación. El jefe de cuadrilla se registra en la primera lectura JC.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </details>

      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="alert success" role="status">
          {ok}
        </p>
      ) : null}

      <div className="masters-workbench">
        <nav className="masters-module-tabs" aria-label="Módulos del maestro">
          {CATALOGS.map((item, index) => (
            <span key={item.id} className="masters-module-tab-wrap">
              {index === 1 ? <span className="masters-module-split" aria-hidden /> : null}
              <CatalogButton
                item={item}
                count={counts[item.id]}
                active={catalog === item.id}
                onSelect={selectCatalog}
              />
            </span>
          ))}
        </nav>

        <div className="masters-pane-tabs" role="tablist" aria-label={`Vistas de ${currentCatalog.label}`}>
          <button
            type="button"
            role="tab"
            id="masters-tab-list"
            aria-controls="masters-panel-list"
            aria-selected={pane === 'list'}
            className={`masters-pane-tab${pane === 'list' ? ' masters-pane-tab--active' : ''}`}
            onClick={() => setPane('list')}
          >
            Listado
            <span className="masters-pane-tab-count">{loading ? '…' : visibleCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="masters-tab-form"
            aria-controls="masters-panel-form"
            aria-selected={pane === 'form'}
            className={`masters-pane-tab${pane === 'form' ? ' masters-pane-tab--active' : ''}`}
            onClick={() => setPane('form')}
          >
            {editingId ? editorTitle(catalog, editingId) : currentCatalog.newLabel}
          </button>
        </div>

        <div className="masters-stage">
          <section
            className="card masters-list"
            id="masters-panel-list"
            role="tabpanel"
            aria-labelledby="masters-tab-list"
            hidden={pane !== 'list'}
          >
            <div className="masters-list-head">
              <div>
                <h3 id="masters-list-title" className="masters-list-title">
                  {currentCatalog.label}
                </h3>
                <p className="masters-list-blurb">{currentCatalog.blurb}</p>
              </div>
              <div className="masters-list-head-actions">
                <p className="masters-list-count">
                  {loading ? 'Cargando…' : `${visibleCount} de ${counts[catalog]}`}
                </p>
                <button type="button" className="btn primary" onClick={openNewRecord}>
                  {currentCatalog.newLabel}
                </button>
              </div>
            </div>

            <div className="masters-toolbar">
              <label className="masters-search">
                <span className="visually-hidden">Buscar en {currentCatalog.label}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar código, nombre o dato…"
                />
              </label>
              <div className="masters-filter" role="group" aria-label="Filtrar por estado">
                {(
                  [
                    ['all', 'Todos'],
                    ['active', 'Activos'],
                    ['inactive', 'Inactivos'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`masters-filter-btn${statusFilter === value ? ' masters-filter-btn--active' : ''}`}
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {catalog === 'relations' ? (
                <label className="masters-season-filter">
                  <span className="visually-hidden">Filtrar por temporada</span>
                  <select value={seasonFilter || ''} onChange={(e) => setSeasonFilter(Number(e.target.value) || 0)}>
                    <option value="">Todas las temporadas</option>
                    {seasons.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.code}
                        {row.is_current ? ' · actual' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            {catalog === 'seasons' ? (
              <SeasonTable
                rows={filteredSeasons}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setSeasonForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    startsOn: (row.starts_on || '').slice(0, 10),
                    endsOn: (row.ends_on || '').slice(0, 10),
                    isCurrent: Boolean(row.is_current),
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'companies' ? (
              <CodeNameTable
                rows={filteredCompanies}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setCompanyForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'species' ? (
              <CodeNameTable
                rows={filteredSpecies}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setSpeciesForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'csg' ? (
              <CodeNameTable
                rows={filteredCsg}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setCsgForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'jcForemen' ? (
              <CodeNameTable
                rows={filteredForemen}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setJcForemanForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'varieties' ? (
              <VarietyTable
                rows={filteredVarietiesTable}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setVarietyForm({
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    speciesId: row.species_id,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}

            {catalog === 'relations' ? (
              <RelationTable
                rows={filteredRelations}
                editingId={editingId}
                emptyHint={listEmptyHint}
                onEdit={(row) => {
                  setRelationForm({
                    id: row.id,
                    seasonId: row.season_id,
                    companyId: row.company_id,
                    centerCode: row.center_code,
                    centerName: row.center_name || '',
                    speciesId: row.species_id,
                    varietyId: row.variety_id,
                    csgId: row.csg_id,
                    isActive: Boolean(row.is_active),
                  })
                  setPane('form')
                }}
              />
            ) : null}
          </section>

          <section
            ref={editorRef}
            className={`card masters-editor${editingId ? ' masters-editor--editing' : ''}`}
            id="masters-panel-form"
            role="tabpanel"
            aria-labelledby="masters-tab-form"
            hidden={pane !== 'form'}
            tabIndex={-1}
          >
            <p className="card-kicker">{editingId ? 'Editando registro' : 'Nuevo registro'}</p>
            <h3 id="masters-editor-title" className="masters-editor-title">
              {editorTitle(catalog, editingId)}
            </h3>
            <p className="masters-editor-hint">{editorHint(catalog)}</p>

            {catalog === 'seasons' ? (
              <SeasonForm
                form={seasonForm}
                setForm={setSeasonForm}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertSeason(seasonForm),
                    seasonForm.id ? 'Temporada actualizada.' : 'Temporada creada.',
                    () => setSeasonForm(EMPTY_SEASON),
                  )
                }
              />
            ) : null}

            {catalog === 'companies' ? (
              <CodeNameFormFields
                title="empresa"
                form={companyForm}
                setForm={setCompanyForm}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertCompany(companyForm),
                    companyForm.id ? 'Empresa actualizada.' : 'Empresa creada.',
                    () => setCompanyForm(EMPTY_CODE_NAME),
                  )
                }
              />
            ) : null}

            {catalog === 'species' ? (
              <CodeNameFormFields
                title="especie"
                form={speciesForm}
                setForm={setSpeciesForm}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertSpecies(speciesForm),
                    speciesForm.id ? 'Especie actualizada.' : 'Especie creada.',
                    () => setSpeciesForm(EMPTY_CODE_NAME),
                  )
                }
              />
            ) : null}

            {catalog === 'csg' ? (
              <CodeNameFormFields
                title="CSG"
                form={csgForm}
                setForm={setCsgForm}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertCsg(csgForm),
                    csgForm.id ? 'CSG actualizado.' : 'CSG creado.',
                    () => setCsgForm(EMPTY_CODE_NAME),
                  )
                }
              />
            ) : null}

            {catalog === 'jcForemen' ? (
              <CodeNameFormFields
                title="jefe de cuadrilla"
                form={jcForemanForm}
                setForm={setJcForemanForm}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertJcForeman(jcForemanForm),
                    jcForemanForm.id ? 'Jefe de cuadrilla actualizado.' : 'Jefe de cuadrilla creado.',
                    () => setJcForemanForm(EMPTY_CODE_NAME),
                  )
                }
              />
            ) : null}

            {catalog === 'varieties' ? (
              <VarietyForm
                form={varietyForm}
                setForm={setVarietyForm}
                species={species}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertVariety(varietyForm),
                    varietyForm.id ? 'Variedad actualizada.' : 'Variedad creada.',
                    () => setVarietyForm(EMPTY_VARIETY),
                  )
                }
              />
            ) : null}

            {catalog === 'relations' ? (
              <RelationForm
                form={relationForm}
                setForm={setRelationForm}
                seasons={seasons}
                companies={companies}
                species={species}
                varieties={filteredVarieties}
                csg={csg}
                busy={saving}
                onCancel={cancelForm}
                onSave={() =>
                  runSave(
                    () => upsertRelation(relationForm),
                    relationForm.id ? 'Relación actualizada.' : 'Relación creada.',
                    () => setRelationForm(EMPTY_RELATION),
                  )
                }
              />
            ) : null}
          </section>
        </div>
      </div>
    </section>
  )
}

function CatalogButton({
  item,
  count,
  active,
  onSelect,
}: {
  item: (typeof CATALOGS)[number]
  count: number
  active: boolean
  onSelect: (id: CatalogId) => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={`masters-module-tab${active ? ' masters-module-tab--active' : ''}`}
      onClick={() => onSelect(item.id)}
    >
      <span>{item.label}</span>
      <span className="masters-module-count">{count}</span>
    </button>
  )
}

function StatusChip({
  active,
  current,
}: {
  active: number | boolean
  current?: number | boolean
}) {
  if (current) return <span className="masters-chip masters-chip--current">Actual</span>
  if (active) return <span className="masters-chip masters-chip--ok">Activo</span>
  return <span className="masters-chip">Inactivo</span>
}

function CodeNameTable({
  rows,
  editingId,
  emptyHint,
  onEdit,
}: {
  rows: Array<{ id: number; code: string; name: string; is_active: number } & MasterAudit>
  editingId: number
  emptyHint: string
  onEdit: (row: { id: number; code: string; name: string; is_active: number } & MasterAudit) => void
}) {
  return (
    <div className="table-wrap masters-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={editingId === row.id ? 'masters-row--active' : undefined}>
              <td className="nowrap">{row.code}</td>
              <td>
                {row.name}
                <AuditNote row={row} />
              </td>
              <td>
                <StatusChip active={row.is_active} />
              </td>
              <td className="actions">
                <button type="button" className="btn text" onClick={() => onEdit(row)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="masters-empty-cell">
                {emptyHint}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function AuditNote({ row }: { row: MasterAudit }) {
  const text = formatLastModified(row)
  return text ? <span className="masters-audit">{text}</span> : null
}

function SeasonTable({
  rows,
  editingId,
  emptyHint,
  onEdit,
}: {
  rows: MasterSeason[]
  editingId: number
  emptyHint: string
  onEdit: (row: MasterSeason) => void
}) {
  return (
    <div className="table-wrap masters-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Rango</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={editingId === row.id ? 'masters-row--active' : undefined}>
              <td className="nowrap">{row.code}</td>
              <td>
                {row.name}
                <AuditNote row={row} />
              </td>
              <td className="nowrap">
                {row.starts_on || '—'} · {row.ends_on || '—'}
              </td>
              <td>
                <StatusChip active={row.is_active} current={row.is_current} />
              </td>
              <td className="actions">
                <button type="button" className="btn text" onClick={() => onEdit(row)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="masters-empty-cell">
                {emptyHint}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function VarietyTable({
  rows,
  editingId,
  emptyHint,
  onEdit,
}: {
  rows: MasterVariety[]
  editingId: number
  emptyHint: string
  onEdit: (row: MasterVariety) => void
}) {
  return (
    <div className="table-wrap masters-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Especie</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={editingId === row.id ? 'masters-row--active' : undefined}>
              <td className="nowrap">{row.code}</td>
              <td>
                {row.name}
                <AuditNote row={row} />
              </td>
              <td>{row.species_name || row.species_id}</td>
              <td>
                <StatusChip active={row.is_active} />
              </td>
              <td className="actions">
                <button type="button" className="btn text" onClick={() => onEdit(row)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="masters-empty-cell">
                {emptyHint}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function RelationTable({
  rows,
  editingId,
  emptyHint,
  onEdit,
}: {
  rows: MasterRelation[]
  editingId: number
  emptyHint: string
  onEdit: (row: MasterRelation) => void
}) {
  return (
    <div className="table-wrap masters-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Temporada</th>
            <th>Empresa</th>
            <th>CC</th>
            <th>Especie</th>
            <th>Variedad</th>
            <th>CSG</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={editingId === row.id ? 'masters-row--active' : undefined}>
              <td className="nowrap">{row.season_code || row.season_id}</td>
              <td>
                {row.company_name || row.company_id}
                <AuditNote row={row} />
              </td>
              <td className="nowrap">{row.center_code}</td>
              <td>{row.species_name}</td>
              <td>{row.variety_name}</td>
              <td>{row.csg_name}</td>
              <td>
                <StatusChip active={row.is_active} />
              </td>
              <td className="actions">
                <button type="button" className="btn text" onClick={() => onEdit(row)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="masters-empty-cell">
                {emptyHint}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function ActiveSelect({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label>
      Estado
      <select value={boolValue(value)} onChange={(e) => onChange(e.target.value === '1')}>
        <option value="1">Activo</option>
        <option value="0">Inactivo</option>
      </select>
    </label>
  )
}

function EditorActions({
  busy,
  editing,
  submitLabel,
  onCancel,
}: {
  busy: boolean
  editing: boolean
  submitLabel: string
  onCancel: () => void
}) {
  return (
    <div className="form-actions masters-editor-actions">
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Guardando…' : submitLabel}
      </button>
      <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
        {editing ? 'Cancelar edición' : 'Limpiar'}
      </button>
    </div>
  )
}

function CodeNameFormFields({
  title,
  form,
  setForm,
  busy,
  onSave,
  onCancel,
}: {
  title: string
  form: CodeNameForm
  setForm: Dispatch<SetStateAction<CodeNameForm>>
  busy: boolean
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    void onSave()
  }
  return (
    <form className="label-form" onSubmit={submit}>
      <div className="form-grid masters-editor-grid">
        <label>
          Código
          <input
            value={form.code}
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Nombre
          <input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        <ActiveSelect value={form.isActive} onChange={(isActive) => setForm((s) => ({ ...s, isActive }))} />
      </div>
      <EditorActions
        busy={busy}
        editing={form.id > 0}
        submitLabel={form.id ? `Guardar ${title}` : `Crear ${title}`}
        onCancel={onCancel}
      />
    </form>
  )
}

function SeasonForm({
  form,
  setForm,
  busy,
  onSave,
  onCancel,
}: {
  form: typeof EMPTY_SEASON
  setForm: Dispatch<SetStateAction<typeof EMPTY_SEASON>>
  busy: boolean
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    void onSave()
  }
  return (
    <form className="label-form" onSubmit={submit}>
      <div className="form-grid masters-editor-grid">
        <label>
          Código
          <input
            value={form.code}
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
            placeholder="2026-2027"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Nombre
          <input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Inicio
          <input type="date" value={form.startsOn} onChange={(e) => setForm((s) => ({ ...s, startsOn: e.target.value }))} />
        </label>
        <label>
          Término
          <input type="date" value={form.endsOn} onChange={(e) => setForm((s) => ({ ...s, endsOn: e.target.value }))} />
        </label>
        <ActiveSelect value={form.isActive} onChange={(isActive) => setForm((s) => ({ ...s, isActive }))} />
        <label>
          Temporada actual
          <select
            value={boolValue(form.isCurrent)}
            onChange={(e) => setForm((s) => ({ ...s, isCurrent: e.target.value === '1' }))}
          >
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <p className="masters-field-note">Si la marca como actual, el resto de temporadas deja de serlo.</p>
      <EditorActions
        busy={busy}
        editing={form.id > 0}
        submitLabel={form.id ? 'Guardar temporada' : 'Crear temporada'}
        onCancel={onCancel}
      />
    </form>
  )
}

function VarietyForm({
  form,
  setForm,
  species,
  busy,
  onSave,
  onCancel,
}: {
  form: typeof EMPTY_VARIETY
  setForm: Dispatch<SetStateAction<typeof EMPTY_VARIETY>>
  species: MasterSpecies[]
  busy: boolean
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    void onSave()
  }
  return (
    <form className="label-form" onSubmit={submit}>
      <div className="form-grid masters-editor-grid">
        <label>
          Código
          <input
            value={form.code}
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Nombre
          <input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Especie
          <select
            value={form.speciesId || ''}
            onChange={(e) => setForm((s) => ({ ...s, speciesId: Number(e.target.value) }))}
            required
          >
            <option value="" disabled>
              Seleccione especie
            </option>
            {species.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <ActiveSelect value={form.isActive} onChange={(isActive) => setForm((s) => ({ ...s, isActive }))} />
      </div>
      <EditorActions
        busy={busy}
        editing={form.id > 0}
        submitLabel={form.id ? 'Guardar variedad' : 'Crear variedad'}
        onCancel={onCancel}
      />
    </form>
  )
}

function RelationForm({
  form,
  setForm,
  seasons,
  companies,
  species,
  varieties,
  csg,
  busy,
  onSave,
  onCancel,
}: {
  form: typeof EMPTY_RELATION
  setForm: Dispatch<SetStateAction<typeof EMPTY_RELATION>>
  seasons: MasterSeason[]
  companies: MasterCompany[]
  species: MasterSpecies[]
  varieties: MasterVariety[]
  csg: MasterCsg[]
  busy: boolean
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    void onSave()
  }
  return (
    <form className="label-form" onSubmit={submit}>
      <div className="form-grid masters-editor-grid masters-editor-grid--relation">
        <label>
          Temporada
          <select
            value={form.seasonId || ''}
            onChange={(e) => setForm((s) => ({ ...s, seasonId: Number(e.target.value) }))}
            required
          >
            <option value="" disabled>
              Seleccione temporada
            </option>
            {seasons.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} · {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Empresa
          <select
            value={form.companyId || ''}
            onChange={(e) => setForm((s) => ({ ...s, companyId: Number(e.target.value) }))}
            required
          >
            <option value="" disabled>
              Seleccione empresa
            </option>
            {companies.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Centro de costo (CC)
          <input
            value={form.centerCode}
            onChange={(e) => setForm((s) => ({ ...s, centerCode: e.target.value }))}
            required
            autoComplete="off"
          />
        </label>
        {SHOW_CENTER_NAME ? (
          <label>
            Nombre CC
            <input
              value={form.centerName}
              onChange={(e) => setForm((s) => ({ ...s, centerName: e.target.value }))}
              autoComplete="off"
            />
          </label>
        ) : null}
        <label>
          Especie
          <select
            value={form.speciesId || ''}
            onChange={(e) => setForm((s) => ({ ...s, speciesId: Number(e.target.value), varietyId: 0 }))}
            required
          >
            <option value="" disabled>
              Seleccione especie
            </option>
            {species.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Variedad
          <select
            value={form.varietyId || ''}
            onChange={(e) => setForm((s) => ({ ...s, varietyId: Number(e.target.value) }))}
            required
            disabled={!form.speciesId}
          >
            <option value="" disabled>
              {form.speciesId ? 'Seleccione variedad' : 'Elija especie primero'}
            </option>
            {varieties.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSG
          <select
            value={form.csgId || ''}
            onChange={(e) => setForm((s) => ({ ...s, csgId: Number(e.target.value) }))}
            required
          >
            <option value="" disabled>
              Seleccione CSG
            </option>
            {csg.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <ActiveSelect value={form.isActive} onChange={(isActive) => setForm((s) => ({ ...s, isActive }))} />
      </div>
      <EditorActions
        busy={busy}
        editing={form.id > 0}
        submitLabel={form.id ? 'Guardar relación' : 'Crear relación'}
        onCancel={onCancel}
      />
    </form>
  )
}

function currentEditingId(
  catalog: CatalogId,
  seasonId: number,
  companyId: number,
  speciesId: number,
  csgId: number,
  foremanId: number,
  varietyId: number,
  relationId: number,
) {
  switch (catalog) {
    case 'seasons':
      return seasonId
    case 'companies':
      return companyId
    case 'species':
      return speciesId
    case 'csg':
      return csgId
    case 'jcForemen':
      return foremanId
    case 'varieties':
      return varietyId
    case 'relations':
      return relationId
  }
}

function visibleRowCount(
  catalog: CatalogId,
  seasons: number,
  companies: number,
  species: number,
  csg: number,
  foremen: number,
  varieties: number,
  relations: number,
) {
  switch (catalog) {
    case 'seasons':
      return seasons
    case 'companies':
      return companies
    case 'species':
      return species
    case 'csg':
      return csg
    case 'jcForemen':
      return foremen
    case 'varieties':
      return varieties
    case 'relations':
      return relations
  }
}

function editorTitle(catalog: CatalogId, editingId: number) {
  const labels: Record<CatalogId, [string, string]> = {
    relations: ['Nueva relación', 'Editar relación'],
    seasons: ['Nueva temporada', 'Editar temporada'],
    companies: ['Nueva empresa', 'Editar empresa'],
    species: ['Nueva especie', 'Editar especie'],
    varieties: ['Nueva variedad', 'Editar variedad'],
    csg: ['Nuevo CSG', 'Editar CSG'],
    jcForemen: ['Nuevo jefe de cuadrilla', 'Editar jefe de cuadrilla'],
  }
  return editingId ? labels[catalog][1] : labels[catalog][0]
}

function editorHint(catalog: CatalogId) {
  if (catalog === 'relations') {
            return 'El centro de costo es el mismo dato que elige el operador al crear etiquetas. La variedad se filtra por la especie.'
  }
  if (catalog === 'seasons') {
    return 'El código suele ser la campaña, por ejemplo 2026-2027.'
  }
  if (catalog === 'jcForemen') {
    return 'Estos nombres aparecen al registrar la primera lectura JC.'
  }
  return 'Código y nombre deben ser únicos. Si ya se usó en operación, márquelo como inactivo en lugar de borrarlo.'
}

function emptyHint(query: string, statusFilter: StatusFilter, total: number, extraFilter = false) {
  if (total === 0) return 'Aún no hay registros. Créelos aquí o impórtelos desde Excel.'
  if (query.trim() || statusFilter !== 'all' || extraFilter) {
    return 'Ningún registro coincide con el filtro. Pruebe otra búsqueda o muestre todos.'
  }
  return 'No hay registros para mostrar.'
}
