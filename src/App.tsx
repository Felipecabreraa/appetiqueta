import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppTab, MaestrosSubTab } from './appTabs'
import { PAGE_META } from './appNavigation'
import { AdminTopBar } from './components/AdminTopBar'
import { AppShell } from './components/AppShell'
import { AppSidebar } from './components/AppSidebar'
import { DashboardView } from './components/DashboardView'
import { GenerarView } from './components/GenerarView'
import { MastersWorkspace } from './components/MastersWorkspace'
import { PageHeader } from './components/PageHeader'
import { isLabelFormComplete, defaultFormValues, type LabelFormValues } from './components/labelFormValues'
import { LabelPreview } from './components/LabelPreview'
import { TrackingView } from './components/TrackingView'
import { appendBatchLog, getBatchHistory, resolveRecordsForBatch } from './lib/batchHistory'
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
import {
  canAccessTab,
  canExportTrackingExcel,
  getAllowedTabs,
  getDefaultTabForRole,
  getRoleLabel,
} from './lib/roleAccess'
import './App.css'

export type Tab = AppTab

const urlBoot = readTrackingFromUrl()
const TAB_SET: Set<AppTab> = new Set(['dashboard', 'generar', 'trazabilidad', 'maestros', 'usuarios'])

function readTabFromHash(): AppTab | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()
  if (!raw) return null
  return TAB_SET.has(raw as AppTab) ? (raw as AppTab) : null
}

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
  const [generatedRecords, setGeneratedRecords] = useState<LabelRecord[]>(() => {
    const latestBatch = getBatchHistory()[0]
    if (!latestBatch) return []
    return resolveRecordsForBatch(latestBatch)
  })
  const [genError, setGenError] = useState<string | null>(null)
  const [batchHistoryKey, setBatchHistoryKey] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [genSuccess, setGenSuccess] = useState(false)
  const [trackingSeed, setTrackingSeed] = useState<TrackingSeed | null>(urlBoot.seed)
  const [loteModalOpen, setLoteModalOpen] = useState(false)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [maestrosSubTab, setMaestrosSubTab] = useState<MaestrosSubTab>('excel')
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null)

  const role = user?.role ?? null
  const allowedTabs = useMemo(() => (role ? getAllowedTabs(role) : []), [role])
  const canUseGenerator = role ? canAccessTab(role, 'generar') : false
  const canDownloadTrackingExcel = role ? canExportTrackingExcel(role) : false
  const canManageMasters = role === 'superadmin'

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

  const navigateToTab = useCallback(
    (nextTab: AppTab, notifyOnDenied = true) => {
      if (!role) return
      if (canAccessTab(role, nextTab)) {
        setTab(nextTab)
        if (notifyOnDenied) setAccessDeniedMessage(null)
        return
      }
      setTab(getDefaultTabForRole(role))
      if (notifyOnDenied) {
        setAccessDeniedMessage(`No tiene permisos para acceder al módulo "${PAGE_META[nextTab].title}".`)
      }
    },
    [role],
  )

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
    if (!user || !canUseGenerator) return
    void loadCatalog(form.seasonId, form.companyId)
  }, [user, canUseGenerator, loadCatalog, form.seasonId, form.companyId])

  useEffect(() => {
    if (!role) return
    if (canAccessTab(role, tab)) return
    setTab(getDefaultTabForRole(role))
  }, [role, tab])

  useEffect(() => {
    if (!accessDeniedMessage) return
    const id = window.setTimeout(() => setAccessDeniedMessage(null), 4200)
    return () => window.clearTimeout(id)
  }, [accessDeniedMessage])

  useEffect(() => {
    if (!user || urlBoot.operational) return
    const applyHashTab = () => {
      const hashTab = readTabFromHash()
      if (!hashTab) return
      navigateToTab(hashTab)
    }
    applyHashTab()
    window.addEventListener('hashchange', applyHashTab)
    return () => window.removeEventListener('hashchange', applyHashTab)
  }, [user, navigateToTab])

  useEffect(() => {
    if (!role || urlBoot.operational) return
    const expected = `#${tab}`
    if (window.location.hash !== expected) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${expected}`)
    }
  }, [role, tab])

  const goToTrackingWith = useCallback((labelId: string) => {
    setTrackingSeed({ code: labelId.toUpperCase(), nonce: Date.now() })
    navigateToTab('trazabilidad', false)
  }, [navigateToTab])

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
      setForm(defaultFormValues())
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
              setTab(getDefaultTabForRole(result.user.role))
              if (canAccessTab(result.user.role, 'generar')) {
                void loadCatalog()
              }
            })
            .finally(() => setLoginBusy(false))
        }}
      />
    )
  }

  const roleLabel = getRoleLabel(user.role)

  return (
    <div className="app app--admin">
      <AppShell
        navOpen={navOpen}
        onCloseNav={() => setNavOpen(false)}
        sidebar={
          <AppSidebar
            activeTab={tab}
            onNavigate={navigateToTab}
            allowedTabs={allowedTabs}
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
          {accessDeniedMessage ? (
            <p className="alert warn no-print" role="alert">
              {accessDeniedMessage}
            </p>
          ) : null}

          {tab !== 'generar' && canAccessTab(user.role, tab) ? (
            <PageHeader title={PAGE_META[tab].title} subtitle={PAGE_META[tab].subtitle} />
          ) : null}

          {tab === 'trazabilidad' && canAccessTab(user.role, 'trazabilidad') ? (
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
            hidden={tab !== 'dashboard' || !canAccessTab(user.role, 'dashboard')}
          >
            {canAccessTab(user.role, 'dashboard') ? (
              <DashboardView
                userName={user.fullName}
                allowedTabs={allowedTabs}
                onNavigate={navigateToTab}
              />
            ) : null}
          </div>

          <div
            id="panel-generar"
            role="tabpanel"
            aria-label={PAGE_META.generar.title}
            hidden={tab !== 'generar' || !canAccessTab(user.role, 'generar')}
          >
            {canAccessTab(user.role, 'generar') ? (
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
            ) : null}
          </div>

          <div
            id="panel-trazabilidad"
            role="tabpanel"
            aria-label={PAGE_META.trazabilidad.title}
            hidden={tab !== 'trazabilidad' || !canAccessTab(user.role, 'trazabilidad')}
            className="tab-panel-traz"
          >
            {canAccessTab(user.role, 'trazabilidad') ? (
              <div className="no-print">
                <TrackingView
                  key={trackingKey}
                  initialCode={trackingInitial}
                  canExportExcel={canDownloadTrackingExcel}
                />
              </div>
            ) : null}
          </div>

          <div
            id="panel-maestros"
            role="tabpanel"
            aria-label={PAGE_META.maestros.title}
            hidden={tab !== 'maestros' || !canAccessTab(user.role, 'maestros')}
          >
            {canAccessTab(user.role, 'maestros') ? (
              <MastersWorkspace
                subTab={maestrosSubTab}
                onSubTabChange={setMaestrosSubTab}
                canManage={canManageMasters}
                onImported={() => {
                  void loadCatalog(form.seasonId, form.companyId)
                }}
              />
            ) : null}
          </div>

          <div
            id="panel-usuarios"
            role="tabpanel"
            aria-label={PAGE_META.usuarios.title}
            hidden={tab !== 'usuarios' || !canAccessTab(user.role, 'usuarios')}
          >
            {user.role === 'superadmin' ? (
              <UsersAdminView />
            ) : null}
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

      </AppShell>
    </div>
  )
}

export default App
