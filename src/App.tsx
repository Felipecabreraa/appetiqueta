import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppTab, MaestrosSubTab } from './appTabs'
import { PAGE_META } from './appNavigation'
import { AdminTopBar } from './components/AdminTopBar'
import { AppShell } from './components/AppShell'
import { AppSidebar } from './components/AppSidebar'
import { DashboardView } from './components/DashboardView'
import { GenerarView } from './components/GenerarView'
import { MastersWorkspace } from './components/MastersWorkspace'
import { OperatorShell } from './components/OperatorShell'
import { PageHeader } from './components/PageHeader'
import { isLabelFormComplete, defaultFormValues, type LabelFormValues } from './components/labelFormValues'
import { LabelPreview } from './components/LabelPreview'
import { TrackingView } from './components/TrackingView'
import { appendBatchLog } from './lib/batchHistory'
import { createLabelRecords, MAX_ETIQUETAS_LOTE } from './lib/createLabelRecords'
import { exportLabelsPdf } from './lib/exportLabelsPdf'
import { pushLabelsBatchToServer } from './lib/pushLabelsBatch'
import { saveLabelsBatch } from './lib/storage'
import { readTrackingFromUrl, type TrackingSeed } from './lib/urlBootstrap'
import type { AuthUser, CompanyOption, CostCenterOption, LabelRecord, SeasonOption } from './types'
import { OperationalCaptureApp } from './components/OperationalCaptureApp'
import { LoginView } from './components/LoginView'
import { fetchCurrentUser, login, logout } from './lib/authApi'
import { getStoredUser } from './lib/session'
import { fetchCatalog } from './lib/masterDataApi'
import { UsersAdminView } from './components/UsersAdminView'
import { OperatorPortal } from './components/OperatorPortal'
import './App.css'

export type Tab = AppTab

const urlBoot = readTrackingFromUrl()

function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())
  const [authLoading, setAuthLoading] = useState(true)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [tab, setTab] = useState<AppTab>(urlBoot.tab)
  const [form, setForm] = useState<LabelFormValues>(() => defaultFormValues())
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])
  const [mastersLoading, setMastersLoading] = useState(false)
  const [mastersError, setMastersError] = useState<string | null>(null)
  const [cantidadLote, setCantidadLote] = useState(1)
  const [generatedRecords, setGeneratedRecords] = useState<LabelRecord[]>([])
  const [genError, setGenError] = useState<string | null>(null)
  const [batchHistoryKey, setBatchHistoryKey] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [genSuccess, setGenSuccess] = useState(false)
  const [trackingSeed, setTrackingSeed] = useState<TrackingSeed | null>(urlBoot.seed)
  const [loteModalOpen, setLoteModalOpen] = useState(false)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [maestrosSubTab, setMaestrosSubTab] = useState<MaestrosSubTab>('excel')

  const canAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)')
    const onChange = () => {
      if (mq.matches) setNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const loadCatalog = useCallback(async (seasonId?: number | null, companyId?: number | null) => {
    setMastersLoading(true)
    setMastersError(null)
    try {
      const payload = await fetchCatalog(seasonId, companyId)
      setSeasons(payload.seasons)
      setCompanies(payload.companies)
      setCostCenters(payload.costCenters)
      setForm((current) =>
        !current.seasonId && payload.seasonId ? { ...current, seasonId: payload.seasonId } : current,
      )
    } catch (error) {
      setMastersError('No se pudo cargar el catálogo maestro.')
      console.error(error)
    } finally {
      setMastersLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchCurrentUser().then((next) => {
      if (cancelled) return
      setUser(next)
      setAuthLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user || !canAdmin) return
    void loadCatalog(form.seasonId, form.companyId)
  }, [user, canAdmin, loadCatalog, form.seasonId, form.companyId])

  const goToTrackingWith = useCallback((labelId: string) => {
    setTrackingSeed({ code: labelId.toUpperCase(), nonce: Date.now() })
    setTab('trazabilidad')
  }, [])

  const handleSeasonChange = useCallback((seasonId: number) => {
    setForm((current) => ({
      ...current,
      seasonId,
      companyId: null,
      seasonCostCenterId: null,
      empresa: '',
      centroCosto: '',
      especie: '',
      variedad: '',
      csg: '',
    }))
    void loadCatalog(seasonId, null)
  }, [loadCatalog])

  const handleCompanyChange = useCallback((companyId: number) => {
    const company = companies.find((x) => x.id === companyId)
    setForm((current) => ({
      ...current,
      companyId,
      seasonCostCenterId: null,
      empresa: company?.name || '',
      centroCosto: '',
      especie: '',
      variedad: '',
      csg: '',
    }))
    void loadCatalog(form.seasonId, companyId)
  }, [companies, form.seasonId, loadCatalog])

  const handleCostCenterChange = useCallback((seasonCostCenterId: number) => {
    const selected = costCenters.find((x) => x.id === seasonCostCenterId)
    if (!selected) return
    setForm((current) => ({
      ...current,
      seasonCostCenterId,
      centroCosto: selected.center_code,
      especie: selected.especie,
      variedad: selected.variedad,
      csg: selected.csg,
    }))
  }, [costCenters])

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

  if (authLoading) {
    return <main className="app-main">Cargando sesión...</main>
  }

  if (!user) {
    return (
      <LoginView
        busy={loginBusy}
        error={loginError}
        onLogin={(username, password) => {
          setLoginBusy(true)
          setLoginError(null)
          void login(username, password)
            .then((result) => {
              if (result.ok === false) {
                setLoginError(result.message)
                return
              }
              setUser(result.user)
              setTab(result.user.role === 'operador' ? 'trazabilidad' : 'dashboard')
              if (result.user.role === 'admin' || result.user.role === 'superadmin') {
                void loadCatalog()
              }
            })
            .finally(() => setLoginBusy(false))
        }}
      />
    )
  }

  if (user.role === 'operador') {
    return (
      <OperatorShell
        userName={user.fullName}
        onLogout={() => {
          void logout().finally(() => setUser(null))
        }}
      >
        <OperatorPortal />
      </OperatorShell>
    )
  }

  const roleLabel = user.role === 'superadmin' ? 'SuperAdmin' : 'Admin'

  return (
    <div className="app app--admin">
      <AppShell
        navOpen={navOpen}
        onCloseNav={() => setNavOpen(false)}
        sidebar={
          <AppSidebar
            activeTab={tab}
            onNavigate={setTab}
            canUsers={user.role === 'superadmin'}
            onItemActivate={() => setNavOpen(false)}
          />
        }
        topBar={
          <AdminTopBar
            activeTab={tab}
            navOpen={navOpen}
            onOpenNav={() => setNavOpen(true)}
            loteComplete={formComplete}
            showLoteStatus={tab === 'generar'}
            userName={user.fullName}
            roleLabel={roleLabel}
            onLogout={() => {
              void logout().finally(() => setUser(null))
            }}
          />
        }
      >
        <main id="contenido-principal" className="app-main">
          {tab !== 'generar' ? (
            <PageHeader title={PAGE_META[tab].title} subtitle={PAGE_META[tab].subtitle} />
          ) : null}

          {tab === 'trazabilidad' ? (
            <details className="page-help-fold no-print">
              <summary>Uso en terreno y registro manual</summary>
              <div className="page-help-fold-body">
                <p>
                  Uso interno: búsqueda manual, accesos rápidos y exportación. En terreno, el mismo QR
                  abre solo el formulario que corresponde (sin menús de administración) cuando la URL
                  incluye <code>?e=</code> al escanear.
                </p>
              </div>
            </details>
          ) : null}

          <div
            id="panel-dashboard"
            role="tabpanel"
            aria-label={PAGE_META.dashboard.title}
            hidden={tab !== 'dashboard'}
          >
            <DashboardView userName={user.fullName} onNavigate={setTab} />
          </div>

          <div
            id="panel-generar"
            role="tabpanel"
            aria-label={PAGE_META.generar.title}
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
            seasons={seasons}
            companies={companies}
            costCenters={costCenters}
            mastersLoading={mastersLoading}
            mastersError={mastersError}
            onSeasonChange={handleSeasonChange}
            onCompanyChange={handleCompanyChange}
            onCostCenterChange={handleCostCenterChange}
          />
        </div>

          <div
            id="panel-trazabilidad"
            role="tabpanel"
            aria-label={PAGE_META.trazabilidad.title}
            hidden={tab !== 'trazabilidad'}
            className="tab-panel-traz"
          >
            <div className="no-print">
              <TrackingView key={trackingKey} initialCode={trackingInitial} />
            </div>
          </div>

          <div
            id="panel-maestros"
            role="tabpanel"
            aria-label={PAGE_META.maestros.title}
            hidden={tab !== 'maestros'}
          >
            <MastersWorkspace
              subTab={maestrosSubTab}
              onSubTabChange={setMaestrosSubTab}
              canManage={user.role === 'admin' || user.role === 'superadmin'}
              onImported={() => {
                void loadCatalog(form.seasonId, form.companyId)
              }}
            />
          </div>

          <div
            id="panel-usuarios"
            role="tabpanel"
            aria-label={PAGE_META.usuarios.title}
            hidden={tab !== 'usuarios'}
          >
          {user.role === 'superadmin' ? (
            <UsersAdminView />
          ) : (
            <section className="card">
              <h2>Acceso restringido</h2>
              <p className="sub">Solo SuperAdmin puede administrar usuarios.</p>
            </section>
          )}
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
                salida JC o de llegada a acopio, según corresponda, sin menús. El escritorio permite
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
      </AppShell>
    </div>
  )
}

export default App
