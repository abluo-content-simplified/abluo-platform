import { mkdirSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'

/** Logs the tenant test client in once; every project reuses the session. */
setup('log in as the test client', async ({ page }) => {
  const email = process.env.E2E_CLIENT_EMAIL
  const password = process.env.E2E_CLIENT_PASSWORD
  if (!email || !password) {
    throw new Error('Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD (env or .env.local) to a tenant client test account.')
  }
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/account(\?|$)/, { timeout: 30_000 })
  mkdirSync('e2e/.auth', { recursive: true })
  await page.context().storageState({ path: 'e2e/.auth/client.json' })
})
