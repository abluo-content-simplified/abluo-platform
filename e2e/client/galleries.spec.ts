import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Galleries (client dashboard). Non-writing: the list page and an unknown id
 * only. Skipped when the test project has no Gallery module (the page 404s).
 */
const project = process.env.E2E_PROJECT ?? 'abluo'

async function openList(page: Page) {
  const res = await page.goto(`/en/${project}/galleries`)
  test.skip(res?.status() === 404, 'Gallery module not installed on the test project')
  await expect(page.getByRole('heading', { level: 1, name: 'Galleries' })).toBeVisible()
}

test.describe('Galleries list', () => {
  test('E2 axe — no serious or critical issues', async ({ page }) => {
    await openList(page)
    const results = await new AxeBuilder({ page })
      .include('.abluo-app')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.help}`)
    expect(blocking).toEqual([])
  })

  test('E3 — controls ≥ 24px, list rows and "New gallery" ≥ 44px', async ({ page }) => {
    await openList(page)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.abluo-app main a[href], .abluo-app main button')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: r.width, h: r.height }
        })
        .filter((t) => t.w < 44 || t.h < 44)
        .map((t) => `${t.label} — ${Math.round(t.w)}×${Math.round(t.h)}`)
    )
    expect(small).toEqual([])
  })

  test('the sidebar (desktop) or the More drawer (phone) links to Galleries', async ({ page }, info) => {
    await openList(page)
    if (info.project.name.startsWith('phone')) await page.getByRole('button', { name: 'More' }).click()
    await expect(page.locator('#client-sidebar').getByRole('link', { name: 'Galleries' })).toBeVisible()
  })

  test('an unknown gallery id is a 404', async ({ page }) => {
    await openList(page)
    const res = await page.goto(`/en/${project}/galleries/00000000-0000-4000-8000-000000000000`)
    expect(res?.status()).toBe(404)
  })

  test('"New gallery" opens the wizard with nothing created; Close leaves nothing behind', async ({ page }) => {
    await openList(page)
    const before = await page.locator('.abluo-app main li').count()
    await page.getByRole('link', { name: 'New gallery' }).click()
    await expect(page).toHaveURL(new RegExp(`/${project}/galleries/new$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Name your gallery' })).toBeVisible()
    // No title yet: Next is off and there is no "Save & exit", only Close.
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save & exit' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Galleries' })).toBeVisible()
    expect(await page.locator('.abluo-app main li').count()).toBe(before)
  })
})
