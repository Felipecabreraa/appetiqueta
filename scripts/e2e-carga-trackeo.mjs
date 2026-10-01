/**
 * Prueba de punta a punta: genera un lote grande, simula escaneo QR
 * (primer trackeo JC y segundo trackeo acopio) y valida el resto del sistema.
 *
 * Uso: node scripts/e2e-carga-trackeo.mjs
 */
const API = process.env.E2E_API_BASE || 'http://127.0.0.1:3001'
const WEB = process.env.E2E_WEB_BASE || 'http://127.0.0.1:5173'
const USER = process.env.E2E_USER || 'superadmin'
const PASS = process.env.E2E_PASS || 'ChangeMe123!'
const BATCH = Number(process.env.E2E_BATCH || 120)
const CONCURRENCY = Number(process.env.E2E_CONCURRENCY || 4)

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const results = []
const startedAt = Date.now()

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix = 'E2E') {
  const rest = 12 - prefix.length
  let s = prefix
  for (let i = 0; i < rest; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

function normalizeTrackingCodeFromQrPayload(text) {
  const t = text.trim()
  if (!t) return ''
  try {
    if (t.startsWith('http://') || t.startsWith('https://')) {
      const u = new URL(t)
      const e = u.searchParams.get('e')?.trim()
      if (e) return e.toUpperCase()
      return t.toUpperCase()
    }
  } catch {
    /* seguir */
  }
  const q = t.indexOf('?')
  if (q >= 0) {
    try {
      const params = new URLSearchParams(t.slice(q + 1))
      const e = params.get('e')?.trim()
      if (e) return e.toUpperCase()
    } catch {
      /* seguir */
    }
  }
  return t.toUpperCase()
}

function getOperationalPhase(label, movements) {
  const hasJc =
    movements.some((m) => m.type === 'jc') ||
    (label.cantidad_totes !== null && label.cantidad_totes !== undefined)
  const hasAcopio = movements.some((m) => m.type === 'acopio')
  if (!hasJc) return 'jc'
  if (!hasAcopio) return 'acopio'
  return 'complete'
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  const mark = ok ? 'OK ' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function assert(name, cond, detail = '') {
  record(name, Boolean(cond), cond ? detail : detail || 'condición falsa')
  return Boolean(cond)
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function req(path, options = {}, { retries = 6, base = API } = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const maxAttempts = method === 'GET' ? retries : 1
  let last
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
    const text = await res.text()
    let data
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }
    last = { res, data, status: res.status }
    const transient =
      res.status >= 500 ||
      data?.error === 'db' ||
      (typeof data?.error === 'string' && data.error.includes('ECONNRESET'))
    if (!transient || attempt === maxAttempts) return last
    await sleep(250 * attempt)
  }
  return last
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length)
  let i = 0
  async function run() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}

async function main() {
  console.log(`\n=== E2E App Etiquetado ===`)
  console.log(`API ${API}  WEB ${WEB}  lote=${BATCH}  conc=${CONCURRENCY}\n`)

  // ---------- 1. Salud y auth ----------
  const health = await req('/api/health')
  assert('API health', health.data?.ok === true && health.data?.dbReady === true, JSON.stringify(health.data))

  const emptyLogin = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({}) })
  assert('Login vacío → 400', emptyLogin.status === 400 && emptyLogin.data.error === 'credentials_required')

  const badLogin = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'noexiste', password: 'x' }),
  })
  assert(
    'Login inválido → 401',
    badLogin.status === 401 && badLogin.data.error === 'invalid_credentials',
    `status=${badLogin.status} error=${badLogin.data.error}`,
  )

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!assert('Login superadmin', login.data?.ok === true && login.data?.token, login.data?.error || '')) {
    console.error('No se puede continuar sin sesión.')
    process.exit(1)
  }
  const token = login.data.token
  const auth = { Authorization: `Bearer ${token}` }

  const me = await req('/api/auth/me', { headers: auth })
  assert('GET /api/auth/me', me.data?.ok === true && me.data.user?.role === 'superadmin', me.data.user?.username)

  const noAuthMe = await req('/api/auth/me')
  assert('GET /api/auth/me sin token → 401', noAuthMe.status === 401)

  const users = await req('/api/admin/users', { headers: auth })
  assert(
    'Listado de usuarios (superadmin)',
    users.data?.ok === true && Array.isArray(users.data.users) && users.data.users.length >= 1,
    `${users.data.users?.length ?? 0} usuarios`,
  )

  // ---------- 2. Catálogo y maestros ----------
  const catalog0 = await req('/api/master-data/catalog', { headers: auth })
  assert(
    'Catálogo inicial',
    catalog0.data?.ok === true && Array.isArray(catalog0.data.seasons) && catalog0.data.seasons.length > 0,
    `temporadas=${catalog0.data.seasons?.length ?? 0} empresas=${catalog0.data.companies?.length ?? 0}`,
  )
  const seasonId = catalog0.data.seasonId || catalog0.data.seasons?.[0]?.id
  const companyId = catalog0.data.companies?.[0]?.id
  const catalog1 = await req(
    `/api/master-data/catalog?seasonId=${seasonId}&companyId=${companyId || ''}`,
    { headers: auth },
  )
  const costCenters = catalog1.data.costCenters || []
  assert(
    'Catálogo con empresa filtra CC',
    catalog1.data?.ok === true,
    `CC=${costCenters.length}`,
  )
  const cc = costCenters[0]
  if (cc) {
    assert(
      'CC determina especie/variedad/CSG',
      Boolean(cc.especie && cc.variedad && cc.csg && cc.center_code),
      `${cc.center_code} ${cc.especie}/${cc.variedad}`,
    )
  } else {
    record('CC determina especie/variedad/CSG', false, 'sin centros de costo en catálogo')
  }

  const foremenPublic = await req('/api/master-data/jc-foremen')
  const jefe =
    foremenPublic.data.foremen?.[0]?.name || 'EDUARDO PIZARRO'
  assert(
    'Jefes JC públicos (escaneo sin login)',
    foremenPublic.data?.ok === true && Array.isArray(foremenPublic.data.foremen) && foremenPublic.data.foremen.length > 0,
    jefe,
  )

  // ---------- 3. Validaciones de lookup / QR ----------
  const invalidId = await req('/api/labels/!!!')
  assert('Lookup ID inválido → 400', invalidId.status === 400 && invalidId.data.error === 'id_invalido')

  const missing = await req('/api/labels/ZZZZNOTFOUND1')
  assert(
    'Lookup inexistente → 404',
    missing.status === 404 && missing.data.error === 'not_found',
    `status=${missing.status} error=${missing.data.error}`,
  )

  const qrCases = [
    ['http://127.0.0.1:5173/?e=ab12cd34ef56', 'AB12CD34EF56'],
    ['https://campo.local/?e=xyz999', 'XYZ999'],
    ['?e=campo01', 'CAMPO01'],
    ['e=solo', 'E=SOLO'],
    ['  abcdefghjklm  ', 'ABCDEFGHJKLM'],
    ['http://127.0.0.1:5173/?e=AaBbCc123456', 'AABBCC123456'],
  ]
  let qrOk = 0
  for (const [input, expected] of qrCases) {
    if (normalizeTrackingCodeFromQrPayload(input) === expected) qrOk++
    else record(`QR parse ${input}`, false, `obtuvo ${normalizeTrackingCodeFromQrPayload(input)}`)
  }
  assert('Normalización de payload QR', qrOk === qrCases.length, `${qrOk}/${qrCases.length}`)

  const ids = new Set()
  while (ids.size < 400) ids.add(createId('E2E'))
  assert('IDs únicos al generar 400 códigos', ids.size === 400)
  assert(
    'Formato ID 12 chars alfabeto seguro',
    [...ids].every((id) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(id)),
  )

  // ---------- 4. Generar lote grande (como oficina) ----------
  const createdAt = nowIso()
  const fecha = createdAt.slice(0, 16)
  const labels = []
  const used = new Set()
  for (let i = 0; i < BATCH; i++) {
    let id = createId('E2E')
    while (used.has(id)) id = createId('E2E')
    used.add(id)
    labels.push({
      id,
      createdAt,
      fecha,
      exportacion: 'E2E-TEST',
      empresa: catalog1.data.companies?.find((c) => c.id === companyId)?.name || 'EMPRESA E2E',
      csg: cc?.csg || 'CSG-E2E',
      especie: cc?.especie || 'ESPECIE-E2E',
      variedad: cc?.variedad || 'VARIEDAD-E2E',
      centroCosto: cc?.center_code || 'CC-E2E',
      seasonId,
      companyId,
      seasonCostCenterId: cc?.id || null,
      sector: `SECTOR-E2E-${(i % 8) + 1}`,
      cantidadTotes: null,
      jefeCuadrilla: '',
    })
  }

  const emptyBatch = await req('/api/labels/batch', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ labels: [] }),
  })
  assert('Batch vacío → 400', emptyBatch.status === 400 && emptyBatch.data.error === 'labels_required')

  const noTokenBatch = await req('/api/labels/batch', {
    method: 'POST',
    body: JSON.stringify({ labels: labels.slice(0, 1) }),
  })
  assert('Batch sin sesión → 401', noTokenBatch.status === 401)

  const t0 = Date.now()
  const batchRes = await req('/api/labels/batch', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ labels }),
  })
  const genMs = Date.now() - t0
  assert(
    `Generar ${BATCH} etiquetas y persistir en servidor`,
    batchRes.data?.ok === true && batchRes.data.count === BATCH,
    `${batchRes.data.error || batchRes.data.count} en ${genMs}ms`,
  )
  if (!batchRes.data?.ok) {
    console.error('No se puede continuar sin el lote.')
    printSummary()
    process.exit(1)
  }

  // ---------- 5. Escaneo 1 + JC, escaneo 2 + acopio ----------
  const edgeFresh = labels[0]
  const stats = {
    scan1Ok: 0,
    jcOk: 0,
    scan2Ok: 0,
    acopioOk: 0,
    verifyOk: 0,
    mismatches: 0,
    scan1Fail: [],
    jcFail: [],
    scan2Fail: [],
    acopioFail: [],
    verifyFail: [],
  }

  const scanResults = await mapPool(labels, CONCURRENCY, async (label, idx) => {
    const totesJc = 4 + (idx % 9)
    const variant = idx % 10
    const totesAcopio =
      variant === 0 ? 0 : variant <= 2 ? Math.max(0, totesJc - 2) : variant === 9 ? totesJc + 1 : totesJc
    if (totesAcopio !== totesJc) stats.mismatches++

    const scan1 = await req(`/api/labels/${label.id}`)
    const phase1 = scan1.data?.ok
      ? getOperationalPhase(scan1.data.label, scan1.data.movements || [])
      : 'error'
    if (
      scan1.data?.ok &&
      scan1.data.label?.id === label.id &&
      phase1 === 'jc' &&
      (scan1.data.label.cantidad_totes === null || scan1.data.label.cantidad_totes === undefined)
    ) {
      stats.scan1Ok++
    } else {
      stats.scan1Fail.push(`${label.id}:${scan1.status}/${scan1.data.error || phase1}`)
    }

    const jcBody = {
      movement: {
        labelId: label.id,
        type: 'jc',
        cantidad: totesJc,
        at: nowIso(),
        precioClp: 1200 + idx,
        jh: 2 + (idx % 6),
      },
      jcFirstRead: { jefeCuadrilla: jefe },
    }
    const jc = await req('/api/movements', { method: 'POST', body: JSON.stringify(jcBody) })
    if (jc.data?.ok) stats.jcOk++
    else stats.jcFail.push(`${label.id}:${jc.status}/${jc.data.error}`)

    const scan2 = await req(`/api/labels/${label.id}`)
    const phase2 = scan2.data?.ok
      ? getOperationalPhase(scan2.data.label, scan2.data.movements || [])
      : 'error'
    const jcMov = (scan2.data.movements || []).filter((m) => m.type === 'jc')
    if (
      scan2.data?.ok &&
      phase2 === 'acopio' &&
      Number(scan2.data.label.cantidad_totes) === totesJc &&
      String(scan2.data.label.jefe_cuadrilla) === jefe &&
      jcMov.length >= 1 &&
      Number(jcMov[0].cantidad) === totesJc
    ) {
      stats.scan2Ok++
    } else {
      stats.scan2Fail.push(`${label.id}:${scan2.status}/${phase2}/totes=${scan2.data.label?.cantidad_totes}`)
    }

    const acopio = await req('/api/movements', {
      method: 'POST',
      body: JSON.stringify({
        movement: {
          labelId: label.id,
          type: 'acopio',
          cantidad: totesAcopio,
          at: nowIso(),
        },
      }),
    })
    if (acopio.data?.ok) stats.acopioOk++
    else stats.acopioFail.push(`${label.id}:${acopio.status}/${acopio.data.error}`)

    const scan3 = await req(`/api/labels/${label.id}`)
    const phase3 = scan3.data?.ok
      ? getOperationalPhase(scan3.data.label, scan3.data.movements || [])
      : 'error'
    const types = (scan3.data.movements || []).map((m) => m.type).sort()
    if (scan3.data?.ok && phase3 === 'complete' && types.includes('acopio') && types.includes('jc')) {
      stats.verifyOk++
    } else {
      stats.verifyFail.push(`${label.id}:${phase3}/${types.join('+')}`)
    }

    return { id: label.id, totesJc, totesAcopio, phase3 }
  })

  assert(`Escaneo 1 (QR → fase JC) ${stats.scan1Ok}/${BATCH}`, stats.scan1Ok === BATCH, stats.scan1Fail.slice(0, 5).join('; '))
  assert(`Primer trackeo JC ${stats.jcOk}/${BATCH}`, stats.jcOk === BATCH, stats.jcFail.slice(0, 5).join('; '))
  assert(`Escaneo 2 (QR → fase acopio) ${stats.scan2Ok}/${BATCH}`, stats.scan2Ok === BATCH, stats.scan2Fail.slice(0, 5).join('; '))
  assert(`Segundo trackeo acopio ${stats.acopioOk}/${BATCH}`, stats.acopioOk === BATCH, stats.acopioFail.slice(0, 5).join('; '))
  assert(`Etiquetas completas JC+acopio ${stats.verifyOk}/${BATCH}`, stats.verifyOk === BATCH, stats.verifyFail.slice(0, 5).join('; '))
  record(
    `Variantes de totes (pérdida/0/exceso)`,
    true,
    `${stats.mismatches} etiquetas con JC ≠ acopio`,
  )

  // ---------- 6. Casos límite de trackeo ----------
  const extra = {
    id: createId('E2X'),
    createdAt: nowIso(),
    fecha,
    exportacion: 'E2E-EDGE',
    empresa: labels[0].empresa,
    csg: labels[0].csg,
    especie: labels[0].especie,
    variedad: labels[0].variedad,
    centroCosto: labels[0].centroCosto,
    seasonId,
    companyId,
    seasonCostCenterId: labels[0].seasonCostCenterId,
    sector: 'EDGE',
    cantidadTotes: null,
    jefeCuadrilla: '',
  }
  const extra2 = { ...extra, id: createId('E2X') }
  const extra3 = { ...extra, id: createId('E2X') }
  const extraBatch = await req('/api/labels/batch', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ labels: [extra, extra2, extra3] }),
  })
  assert('Lote auxiliar de casos límite', extraBatch.data?.ok === true, extraBatch.data.error)

  const jcNoJefe = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: extra.id, type: 'jc', cantidad: 3, at: nowIso(), precioClp: 100, jh: 1 },
    }),
  })
  assert(
    'JC sin jefe de cuadrilla → jc_first_read_required',
    jcNoJefe.status === 400 && jcNoJefe.data.error === 'jc_first_read_required',
    `${jcNoJefe.status} ${jcNoJefe.data.error}`,
  )

  const acopioAntes = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: extra.id, type: 'acopio', cantidad: 3, at: nowIso() },
    }),
  })
  record(
    'API bloquea acopio antes de JC',
    acopioAntes.status >= 400,
    acopioAntes.data.ok
      ? 'FALLO DE NEGOCIO: el API aceptó acopio sin JC (la UI sí lo impide)'
      : `${acopioAntes.status} ${acopioAntes.data.error}`,
  )

  const ghost = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: 'ZZZZNOTFOUND1', type: 'jc', cantidad: 1, at: nowIso() },
      jcFirstRead: { jefeCuadrilla: jefe },
    }),
  })
  assert(
    'Movimiento de etiqueta inexistente → 404',
    ghost.status === 404 && ghost.data.error === 'label_not_found',
    `${ghost.status} ${ghost.data.error}`,
  )

  const invalidMov = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({ movement: { labelId: extra.id, type: 'otro', cantidad: -3 } }),
  })
  assert('Movimiento inválido → 400', invalidMov.status === 400 && invalidMov.data.error === 'invalid_movement')

  const jcOkExtra = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: extra2.id, type: 'jc', cantidad: 5, at: nowIso(), precioClp: 900, jh: 3 },
      jcFirstRead: { jefeCuadrilla: jefe },
    }),
  })
  assert('JC válido en etiqueta auxiliar', jcOkExtra.data?.ok === true, jcOkExtra.data.error)

  const jcDup = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: extra2.id, type: 'jc', cantidad: 8, at: nowIso(), precioClp: 900, jh: 3 },
    }),
  })
  const afterDup = await req(`/api/labels/${extra2.id}`)
  const jcCount = (afterDup.data.movements || []).filter((m) => m.type === 'jc').length
  record(
    'API rechaza un segundo JC (como hace la UI)',
    jcDup.status >= 400 || jcCount === 1,
    jcCount > 1
      ? `FALLO DE NEGOCIO: el API permitió ${jcCount} JC (la UI lo bloquea)`
      : `${jcDup.status} ${jcDup.data.error || 'ok'}`,
  )

  const completed = scanResults[1]
  const extraOnComplete = await req('/api/movements', {
    method: 'POST',
    body: JSON.stringify({
      movement: { labelId: completed.id, type: 'acopio', cantidad: 99, at: nowIso() },
    }),
  })
  const afterComplete = await req(`/api/labels/${completed.id}`)
  const acopioCount = (afterComplete.data.movements || []).filter((m) => m.type === 'acopio').length
  record(
    'API rechaza lectura extra en etiqueta completa',
    extraOnComplete.status >= 400 || acopioCount === 1,
    acopioCount > 1
      ? `FALLO DE NEGOCIO: ${acopioCount} acopios en etiqueta ya completa`
      : `${extraOnComplete.status}`,
  )

  const raceLabel = extra3
  const race = await Promise.all(
    [1, 2, 3].map((n) =>
      req('/api/movements', {
        method: 'POST',
        body: JSON.stringify({
          movement: { labelId: raceLabel.id, type: 'jc', cantidad: n, at: nowIso(), precioClp: 500, jh: 1 },
          jcFirstRead: { jefeCuadrilla: jefe },
        }),
      }),
    ),
  )
  const raceOk = race.filter((r) => r.data?.ok).length
  const raceAfter = await req(`/api/labels/${raceLabel.id}`)
  const raceJc = (raceAfter.data.movements || []).filter((m) => m.type === 'jc').length
  assert(
    'Carrera: solo un JC gana entre 3 simultáneos',
    raceOk === 1 && raceJc === 1,
    `${raceOk}/3 aceptados; movimientos JC=${raceJc}; totes=${raceAfter.data.label?.cantidad_totes}`,
  )

  // ---------- 7. Export Excel / reporte ----------
  const exp = await req('/api/reports/tracking-export', { headers: auth })
  const exportedIds = new Set((exp.data.labels || []).map((l) => l.id))
  const exportedMovs = exp.data.movements || []
  const ourLabels = labels.filter((l) => exportedIds.has(l.id)).length
  const ourJc = exportedMovs.filter((m) => used.has(m.labelId) && m.type === 'jc').length
  const ourAcopio = exportedMovs.filter((m) => used.has(m.labelId) && m.type === 'acopio').length
  assert(
    'Export tracking incluye el lote',
    exp.data?.ok === true && ourLabels === BATCH && ourJc === BATCH && ourAcopio === BATCH,
    `labels ${ourLabels}/${BATCH} jc ${ourJc} acopio ${ourAcopio}`,
  )

  const expNoAuth = await req('/api/reports/tracking-export')
  assert('Export sin sesión → 401', expNoAuth.status === 401)

  // ---------- 8. Frontend (Vite) y flujo ?e= ----------
  const webHome = await fetch(`${WEB}/`)
  const homeHtml = await webHome.text()
  assert(
    'Frontend Vite responde',
    webHome.ok && homeHtml.includes('<div id="root">'),
    `HTTP ${webHome.status}`,
  )

  const sample = labels[2]
  const qrUrl = `${WEB}/?e=${sample.id}`
  const opPage = await fetch(qrUrl)
  const opHtml = await opPage.text()
  assert(
    'URL de QR (?e=) abre la app operativa',
    opPage.ok && opHtml.includes('<div id="root">'),
    qrUrl,
  )

  const proxied = await req(`/api/labels/${sample.id}`, {}, { base: WEB })
  assert(
    'Proxy Vite /api → backend',
    proxied.data?.ok === true && proxied.data.label?.id === sample.id,
    `fase=${getOperationalPhase(proxied.data.label || {}, proxied.data.movements || [])}`,
  )

  const webLogin = await req(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) },
    { base: WEB },
  )
  assert('Login vía proxy Vite', webLogin.data?.ok === true && Boolean(webLogin.data.token))

  // ---------- 9. Integridad de un subconjunto ----------
  const sampleCheck = labels.slice(0, 12)
  let intact = 0
  for (const label of sampleCheck) {
    const row = await req(`/api/labels/${label.id}`)
    const l = row.data.label
    const sameMaster =
      l &&
      l.empresa === label.empresa &&
      l.especie === label.especie &&
      l.variedad === label.variedad &&
      l.csg === label.csg &&
      l.centro_costo === label.centroCosto &&
      l.sector === label.sector
    if (sameMaster && getOperationalPhase(l, row.data.movements || []) === 'complete') intact++
  }
  assert(
    'Maestros del lote intactos tras el trackeo',
    intact === sampleCheck.length,
    `${intact}/${sampleCheck.length}`,
  )

  const logout = await req('/api/auth/logout', { method: 'POST', headers: auth })
  assert('Logout', logout.data?.ok === true, logout.data.error)
  const meAfter = await req('/api/auth/me', { headers: auth })
  assert('Sesión invalidada tras logout', meAfter.status === 401)

  printSummary()
}

function printSummary() {
  const ok = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  const ms = Date.now() - startedAt
  console.log('\n=== Resumen ===')
  console.log(`Pasaron: ${ok}`)
  console.log(`Fallaron: ${fail}`)
  console.log(`Duración: ${(ms / 1000).toFixed(1)}s`)
  if (fail) {
    console.log('\nFallos:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(` - ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
    }
  }
  process.exitCode = fail ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
