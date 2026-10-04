import { readFileSync, existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * `npm run verify:dashboard` — the browser half of the /verify checklist
 * (docs/engineering/client-dashboard/verification.md, E-checks).
 *
 * Every flow runs four times: phone + desktop, light + dark.
 * Credentials come from env vars (or `.env.local`, never committed):
 *   E2E_CLIENT_EMAIL, E2E_CLIENT_PASSWORD — a tenant client test account
 *   E2E_PROJECT  — the projectSlug that account owns (default "abluo")
 *   E2E_BASE_URL — default http://localhost:3000 (starts `npm run dev` if needed)
 */
function loadE2eEnv() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*(E2E_[A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadE2eEnv()

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const local = baseURL.startsWith('http://localhost')
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const desktop = { viewport: { width: 1280, height: 800 } }

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    ...(['light', 'dark'] as const).flatMap((colorScheme) => [
      {
        name: `phone-${colorScheme}`,
        dependencies: ['setup'],
        use: { ...devices['Desktop Chrome'], ...phone, colorScheme, storageState: 'e2e/.auth/client.json' },
      },
      {
        name: `desktop-${colorScheme}`,
        dependencies: ['setup'],
        use: { ...devices['Desktop Chrome'], ...desktop, colorScheme, storageState: 'e2e/.auth/client.json' },
      },
    ]),
  ],
  webServer: local
    ? { command: 'npm run dev', url: baseURL, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
})
