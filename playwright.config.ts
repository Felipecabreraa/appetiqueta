import { defineConfig, devices } from '@playwright/test'
import { loadTestEnv } from './scripts/test-env.mjs'

/**
 * Modo LOCAL (por defecto): entorno de PRUEBAS aislado.
 *   - Carga .env.test (BD local *_test, validada por el guardián) — nunca .env.
 *   - Antes de arrancar la API se recrea la BD con esquema + semilla (la API detecta el esquema al iniciar).
 *   - Levanta API en :3101 y Vite en :5174 (puertos propios: nunca reutiliza un servidor de desarrollo).
 * Modo REMOTO (E2E_REMOTE_URL=https://...): solo specs @smoke de lectura contra un entorno desplegado.
 */
const REMOTE = process.env.E2E_REMOTE_URL?.replace(/\/$/, '')
const testEnv = REMOTE ? {} : loadTestEnv()
const API = REMOTE || `http://127.0.0.1:${testEnv.PORT}`
const WEB = REMOTE || 'http://127.0.0.1:5174'

process.env.E2E_API_BASE = API
process.env.E2E_USER ||= testEnv.E2E_USER
process.env.E2E_PASS ||= testEnv.E2E_PASS

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  grep: REMOTE ? /@smoke/ : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],
  webServer: REMOTE
    ? undefined
    : [
        {
          command: 'node scripts/test-env.mjs reset && node server/index.cjs',
          url: `${API}/api/health`,
          env: testEnv,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: 'npx vite --port 5174 --strictPort',
          url: WEB,
          env: { API_PROXY_TARGET: API },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
})
