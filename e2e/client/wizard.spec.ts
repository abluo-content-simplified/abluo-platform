import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * S2c — Add content sheet + the guided creation wizard (ADR-025).
 *
 * By default NOTHING here writes to Sanity: the sheet is opened and closed,
 * and the wizard route is probed with an id that does not exist.
 * Set E2E_WRITE=1 to also run the flows that create a real draft on the test
 * project (title prefix "[e2e]"; they never publish — they end on "Keep as draft").
 */
const project = process.env.E2E_PROJECT ?? 'abluo'
const WRITE = process.env.E2E_WRITE === '1'

async function openAddSheet(page: Page) {
  await page.goto(`/en/${project}/home`)
  await page.getByRole('button', { name: 'Add content' }).filter({ visible: true }).first().click()
  const sheet = page.getByRole('dialog', { name: 'What would you like to create?' })
  await expect(sheet).toBeVisible()
  return sheet
}

async function axeBlocking(page: Page, include: string) {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)
}

async function smallTargets(page: Page, scope: string) {
  return page.evaluate((scope) => {
    return [...document.querySelectorAll<HTMLElement>(`${scope} a[href], ${scope} button, ${scope} input, ${scope} textarea, ${scope} [role="radio"], ${scope} [role="switch"]`)]
      .filter((el) => el.offsetParent !== null || el.closest('dialog[open]'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: r.width, h: r.height }
      })
      .filter((t) => t.w > 0 && (t.w < 44 || t.h < 44))
      .map((t) => `${t.label} — ${Math.round(t.w)}×${Math.round(t.h)}`)
  }, scope)
}

test.describe('Add content sheet (D8)', () => {
  test('lists what can be created; Blog post is a real choice', async ({ page }) => {
    const sheet = await openAddSheet(page)
    await expect(sheet.getByRole('button', { name: /Blog post/ })).toBeEnabled()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
  })

  test('E2 axe — no serious or critical issues in the sheet', async ({ page }) => {
    await openAddSheet(page)
    expect(await axeBlocking(page, 'dialog[open]')).toEqual([])
  })

  test('E3 — every control in the sheet is at least 44×44', async ({ page }) => {
    await openAddSheet(page)
    expect(await smallTargets(page, 'dialog[open]')).toEqual([])
  })

  test('the "+" tab-bar button opens the same sheet on phones', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('phone'), 'phone only')
    await page.goto(`/en/${project}/home`)
    await page.locator('nav').getByRole('button', { name: 'Add content' }).click()
    await expect(page.getByRole('dialog', { name: 'What would you like to create?' })).toBeVisible()
  })
})

test.describe('Wizard route', () => {
  test('an unknown draft id is a 404 (no probing)', async ({ page }) => {
    const res = await page.goto(`/en/${project}/posts/write/00000000-0000-4000-8000-000000000000`)
    expect(res?.status()).toBe(404)
  })

  test('a malformed draft id is a 404', async ({ page }) => {
    const res = await page.goto(`/en/${project}/posts/write/not-a-uuid`)
    expect(res?.status()).toBe(404)
  })
})

test.describe('Wizard flow (writes a draft — E2E_WRITE=1)', () => {
  test.skip(!WRITE, 'set E2E_WRITE=1 to create a real draft on the test project')
  test.describe.configure({ mode: 'serial' })

  test('E4 — create → title → reload restores title and step; axe + targets on each step; ends as draft', async ({ page }) => {
    const sheet = await openAddSheet(page)
    await sheet.getByRole('button', { name: /Blog post/ }).click()
    await expect(page).toHaveURL(new RegExp(`/en/${project}/posts/write/[0-9a-f-]{36}$`))

    // Title step (sites with categories show the topic step first — skip it).
    const next = page.getByRole('button', { name: 'Next' })
    if (await page.getByRole('heading', { level: 1, name: "What's this post about?" }).isVisible()) await next.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Give your story a title' })).toBeVisible()
    await expect(next).toBeDisabled()
    expect(await axeBlocking(page, '[data-surface="create"]')).toEqual([])
    expect(await smallTargets(page, '[data-surface="create"]')).toEqual([])

    const title = `[e2e] Wizard ${Date.now()}`
    await page.getByLabel('Title', { exact: true }).fill(title)
    await expect(next).toBeEnabled()
    await next.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tell your story' })).toBeVisible()
    await expect(page.locator('[data-save-state="saved"]')).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Tell your story' })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)

    // Story → cover → (languages) → preview → publish, kept as a draft.
    await next.click()
    await page.getByRole('textbox').last().click()
    await page.keyboard.type('A short story written by the end-to-end test.')
    await expect(next).toBeEnabled()
    await next.click()
    await page.getByRole('button', { name: /Next|Skip for now/ }).click()
    if (await page.getByRole('heading', { level: 1, name: 'Make it available in other languages?' }).isVisible()) await next.click()
    await expect(page.getByRole('heading', { level: 1, name: "Here's how your post will look" })).toBeVisible()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await next.click()
    await page.getByRole('radio', { name: /Keep as draft/ }).click()
    expect(await axeBlocking(page, '[data-surface="create"]')).toEqual([])
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Saved as a draft' })).toBeVisible()

    // Home lists it under Continue editing; after the first pass it reopens on the overview.
    await page.getByRole('link', { name: 'Back to home' }).click()
    await expect(page.getByText(title)).toBeVisible()
    await page.getByRole('link', { name: 'Continue' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    expect(await axeBlocking(page, '[data-surface="create"]')).toEqual([])
    expect(await smallTargets(page, '[data-surface="create"]')).toEqual([])

    // Edit opens one step; "Done" comes straight back to the overview.
    await page.getByRole('button', { name: 'Edit Title & subtitle' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Give your story a title' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Continue to publish' })).toBeVisible()
  })
})
