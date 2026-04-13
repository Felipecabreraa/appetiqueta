import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  fetchMasterAdminData,
  upsertCompany,
  upsertCsg,
  upsertRelation,
  upsertSeason,
  upsertSpecies,
  upsertVariety,
} from '../lib/masterDataApi'
import type {
  MasterCompany,
  MasterCsg,
  MasterRelation,
  MasterSeason,
  MasterSpecies,
  MasterVariety,
} from '../types'

function boolValue(v: number | boolean | undefined): '1' | '0' {
  return v ? '1' : '0'
}

export function MastersAdminPanel({ canManage }: { canManage: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<MasterSeason[]>([])
  const [companies, setCompanies] = useState<MasterCompany[]>([])
  const [species, setSpecies] = useState<MasterSpecies[]>([])
  const [csg, setCsg] = useState<MasterCsg[]>([])
  const [varieties, setVarieties] = useState<MasterVariety[]>([])
  const [relations, setRelations] = useState<MasterRelation[]>([])

  const [seasonForm, setSeasonForm] = useState({
    id: 0,
    code: '',
    name: '',
    startsOn: '',
    endsOn: '',
    isCurrent: true,
    isActive: true,
  })
  const [companyForm, setCompanyForm] = useState({ id: 0, code: '', name: '', isActive: true })
  const [speciesForm, setSpeciesForm] = useState({ id: 0, code: '', name: '', isActive: true })
  const [csgForm, setCsgForm] = useState({ id: 0, code: '', name: '', isActive: true })
  const [varietyForm, setVarietyForm] = useState({
    id: 0,
    code: '',
    name: '',
    speciesId: 0,
    isActive: true,
  })
  const [relationForm, setRelationForm] = useState({
    id: 0,
    seasonId: 0,
    companyId: 0,
    centerCode: '',
    centerName: '',
    speciesId: 0,
    varietyId: 0,
    csgId: 0,
    isActive: true,
  })

  const filteredVarieties = useMemo(
    () => varieties.filter((v) => !relationForm.speciesId || v.species_id === relationForm.speciesId),
    [varieties, relationForm.speciesId],
  )

  async function reload() {
    setBusy(true)
    setError(null)
    try {
      const data = await fetchMasterAdminData()
      setSeasons(data.seasons)
      setCompanies(data.companies)
      setSpecies(data.species)
      setCsg(data.csg)
      setVarieties(data.varieties)
      setRelations(data.relations)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el módulo de maestros.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (canManage) void reload()
  }, [canManage])

  if (!canManage) {
    return (
      <section className="card">
        <h2>Módulo de mantenimiento maestro</h2>
        <p className="sub">Sin permisos para editar maestros.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Mantenimiento maestro interno</h2>
      <p className="sub">Gestione temporadas, catálogos y relaciones operativas sin tocar código.</p>
      {error && <p className="alert error">{error}</p>}
      {ok && <p className="alert success">{ok}</p>}

      <h3>Temporadas</h3>
      <div className="form-grid">
        <label>
          Código
          <input value={seasonForm.code} onChange={(e) => setSeasonForm((s) => ({ ...s, code: e.target.value }))} />
        </label>
        <label>
          Nombre
          <input value={seasonForm.name} onChange={(e) => setSeasonForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label>
          Inicio
          <input type="date" value={seasonForm.startsOn} onChange={(e) => setSeasonForm((s) => ({ ...s, startsOn: e.target.value }))} />
        </label>
        <label>
          Término
          <input type="date" value={seasonForm.endsOn} onChange={(e) => setSeasonForm((s) => ({ ...s, endsOn: e.target.value }))} />
        </label>
        <label>
          Activa
          <select value={boolValue(seasonForm.isActive)} onChange={(e) => setSeasonForm((s) => ({ ...s, isActive: e.target.value === '1' }))}>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
        <label>
          Actual
          <select value={boolValue(seasonForm.isCurrent)} onChange={(e) => setSeasonForm((s) => ({ ...s, isCurrent: e.target.value === '1' }))}>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void upsertSeason(seasonForm)
              .then(() => {
                setOk('Temporada guardada.')
                setSeasonForm({ id: 0, code: '', name: '', startsOn: '', endsOn: '', isCurrent: false, isActive: true })
                return reload()
              })
              .catch((e) => setError(e instanceof Error ? e.message : 'Error guardando temporada.'))
          }
        >
          Guardar temporada
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Rango</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td><td>{s.name}</td><td>{s.starts_on || '-'} / {s.ends_on || '-'}</td>
                <td>{s.is_current ? 'Actual' : s.is_active ? 'Activa' : 'Archivada'}</td>
                <td className="actions"><button type="button" className="btn text" onClick={() => setSeasonForm({ id: s.id, code: s.code, name: s.name, startsOn: s.starts_on || '', endsOn: s.ends_on || '', isCurrent: Boolean(s.is_current), isActive: Boolean(s.is_active) })}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Empresas</h3>
      <SimpleMasterForm
        busy={busy}
        title="Empresa"
        form={companyForm}
        setForm={setCompanyForm}
        onSave={() =>
          upsertCompany(companyForm).then(() => {
            setOk('Empresa guardada.')
            setCompanyForm({ id: 0, code: '', name: '', isActive: true })
            return reload()
          })
        }
        rows={companies.map((x) => ({ id: x.id, code: x.code, name: x.name, active: x.is_active }))}
        onEdit={(id) => {
          const item = companies.find((x) => x.id === id)
          if (item) setCompanyForm({ id: item.id, code: item.code, name: item.name, isActive: Boolean(item.is_active) })
        }}
      />

      <h3>Especies</h3>
      <SimpleMasterForm
        busy={busy}
        title="Especie"
        form={speciesForm}
        setForm={setSpeciesForm}
        onSave={() =>
          upsertSpecies(speciesForm).then(() => {
            setOk('Especie guardada.')
            setSpeciesForm({ id: 0, code: '', name: '', isActive: true })
            return reload()
          })
        }
        rows={species.map((x) => ({ id: x.id, code: x.code, name: x.name, active: x.is_active }))}
        onEdit={(id) => {
          const item = species.find((x) => x.id === id)
          if (item) setSpeciesForm({ id: item.id, code: item.code, name: item.name, isActive: Boolean(item.is_active) })
        }}
      />

      <h3>CSG</h3>
      <SimpleMasterForm
        busy={busy}
        title="CSG"
        form={csgForm}
        setForm={setCsgForm}
        onSave={() =>
          upsertCsg(csgForm).then(() => {
            setOk('CSG guardado.')
            setCsgForm({ id: 0, code: '', name: '', isActive: true })
            return reload()
          })
        }
        rows={csg.map((x) => ({ id: x.id, code: x.code, name: x.name, active: x.is_active }))}
        onEdit={(id) => {
          const item = csg.find((x) => x.id === id)
          if (item) setCsgForm({ id: item.id, code: item.code, name: item.name, isActive: Boolean(item.is_active) })
        }}
      />

      <h3>Variedades</h3>
      <div className="form-grid">
        <label>
          Código
          <input value={varietyForm.code} onChange={(e) => setVarietyForm((s) => ({ ...s, code: e.target.value }))} />
        </label>
        <label>
          Nombre
          <input value={varietyForm.name} onChange={(e) => setVarietyForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label>
          Especie
          <select value={varietyForm.speciesId || ''} onChange={(e) => setVarietyForm((s) => ({ ...s, speciesId: Number(e.target.value) }))}>
            <option value="" disabled>Seleccione especie</option>
            {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Activa
          <select value={boolValue(varietyForm.isActive)} onChange={(e) => setVarietyForm((s) => ({ ...s, isActive: e.target.value === '1' }))}>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void upsertVariety(varietyForm)
              .then(() => {
                setOk('Variedad guardada.')
                setVarietyForm({ id: 0, code: '', name: '', speciesId: 0, isActive: true })
                return reload()
              })
              .catch((e) => setError(e instanceof Error ? e.message : 'Error guardando variedad.'))
          }
        >
          Guardar variedad
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Especie</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {varieties.map((v) => (
              <tr key={v.id}>
                <td>{v.code}</td><td>{v.name}</td><td>{v.species_name || v.species_id}</td><td>{v.is_active ? 'Activo' : 'Inactivo'}</td>
                <td className="actions"><button type="button" className="btn text" onClick={() => setVarietyForm({ id: v.id, code: v.code, name: v.name, speciesId: v.species_id, isActive: Boolean(v.is_active) })}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Relación maestra (temporada + empresa + CC + CSG + especie + variedad)</h3>
      <div className="form-grid">
        <label>
          Temporada
          <select value={relationForm.seasonId || ''} onChange={(e) => setRelationForm((s) => ({ ...s, seasonId: Number(e.target.value) }))}>
            <option value="" disabled>Seleccione temporada</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
        </label>
        <label>
          Empresa
          <select value={relationForm.companyId || ''} onChange={(e) => setRelationForm((s) => ({ ...s, companyId: Number(e.target.value) }))}>
            <option value="" disabled>Seleccione empresa</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          CC
          <input value={relationForm.centerCode} onChange={(e) => setRelationForm((s) => ({ ...s, centerCode: e.target.value }))} />
        </label>
        <label>
          Nombre CC
          <input value={relationForm.centerName} onChange={(e) => setRelationForm((s) => ({ ...s, centerName: e.target.value }))} />
        </label>
        <label>
          Especie
          <select value={relationForm.speciesId || ''} onChange={(e) => setRelationForm((s) => ({ ...s, speciesId: Number(e.target.value), varietyId: 0 }))}>
            <option value="" disabled>Seleccione especie</option>
            {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Variedad
          <select value={relationForm.varietyId || ''} onChange={(e) => setRelationForm((s) => ({ ...s, varietyId: Number(e.target.value) }))}>
            <option value="" disabled>Seleccione variedad</option>
            {filteredVarieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>
          CSG
          <select value={relationForm.csgId || ''} onChange={(e) => setRelationForm((s) => ({ ...s, csgId: Number(e.target.value) }))}>
            <option value="" disabled>Seleccione CSG</option>
            {csg.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Activa
          <select value={boolValue(relationForm.isActive)} onChange={(e) => setRelationForm((s) => ({ ...s, isActive: e.target.value === '1' }))}>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void upsertRelation(relationForm)
              .then(() => {
                setOk('Relación maestra guardada.')
                setRelationForm({ id: 0, seasonId: 0, companyId: 0, centerCode: '', centerName: '', speciesId: 0, varietyId: 0, csgId: 0, isActive: true })
                return reload()
              })
              .catch((e) => setError(e instanceof Error ? e.message : 'Error guardando relación.'))
          }
        >
          Guardar relación
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Temporada</th><th>Empresa</th><th>CC</th><th>Atributos</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {relations.map((r) => (
              <tr key={r.id}>
                <td>{r.season_code || r.season_id}</td>
                <td>{r.company_name || r.company_id}</td>
                <td>{r.center_code}</td>
                <td>{r.csg_name} · {r.species_name} · {r.variety_name}</td>
                <td>{r.is_active ? 'Activa' : 'Inactiva'}</td>
                <td className="actions">
                  <button
                    type="button"
                    className="btn text"
                    onClick={() =>
                      setRelationForm({
                        id: r.id,
                        seasonId: r.season_id,
                        companyId: r.company_id,
                        centerCode: r.center_code,
                        centerName: r.center_name,
                        speciesId: r.species_id,
                        varietyId: r.variety_id,
                        csgId: r.csg_id,
                        isActive: Boolean(r.is_active),
                      })
                    }
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SimpleMasterForm({
  busy,
  title,
  form,
  setForm,
  onSave,
  rows,
  onEdit,
}: {
  busy: boolean
  title: string
  form: { id: number; code: string; name: string; isActive: boolean }
  setForm: Dispatch<SetStateAction<{ id: number; code: string; name: string; isActive: boolean }>>
  onSave: () => Promise<void>
  rows: Array<{ id: number; code: string; name: string; active: number }>
  onEdit: (id: number) => void
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          Código {title}
          <input value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} />
        </label>
        <label>
          Nombre {title}
          <input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label>
          Activo
          <select value={boolValue(form.isActive)} onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.value === '1' }))}>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void onSave()}>
          Guardar {title.toLowerCase()}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.active ? 'Activo' : 'Inactivo'}</td>
                <td className="actions">
                  <button type="button" className="btn text" onClick={() => onEdit(r.id)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
