import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * S0 foundation checks (verification.md E1, E2, E3, E8).
 * Runs in phone/desktop × light/dark (see playwright.config.ts).
 */
const project = process.env.E2E_PROJECT ?? 'abluo'
const PAGES = [`/en/account`, `/en/${project}/submissions`]

/** Relative luminance of the computed background of `.abluo-app`. */
async function appBackgroundLuminance(page: Page): Promise<number> {
  return page.locator('.abluo-app').first().evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d')!
    c.fillStyle = getComputedStyle(el).backgroundColor
    c.fillRect(0, 0, 1, 1)
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data
    const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  })
}

test.describe('Abluo App foundation', () => {
  for (const path of PAGES) {
    test(`renders inside .abluo-app: ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('.abluo-app').first()).toBeVisible()
    })

    test(`E2 axe — no serious or critical issues: ${path}`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page })
        .include('.abluo-app')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => {
          const where = v.nodes
            .slice(0, 5)
            .map((n) => `\n    at ${n.target.join(' ')} — ${(n.any[0]?.message ?? n.failureSummary ?? '').split('\n')[0]}`)
            .join('')
          return `${v.id} (${v.impact}): ${v.nodes.length}× — ${v.help}${where}`
        })
      expect(blocking).toEqual([])
    })

    test(`E3 targets — every control ≥ 24px, Create surface ≥ 44px: ${path}`, async ({ page }) => {
      await page.goto(path)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.abluo-app a[href], .abluo-app button, .abluo-app input, .abluo-app select, .abluo-app [role="radio"], .abluo-app [role="switch"]')]
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect()
            const min = el.closest('[data-surface="create"]') ? 44 : 24
            return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: r.width, h: r.height, min }
          })
          .filter((t) => t.w < t.min || t.h < t.min)
          .map((t) => `${t.label} — ${Math.round(t.w)}×${Math.round(t.h)} (min ${t.min})`),
      )
      expect(small).toEqual([])
    })
  }

  test('E8 — Auto follows the device theme', async ({ page }, info) => {
    await page.context().clearCookies({ name: 'abluo-app-theme' })
    await page.goto(PAGES[1])
    await expect(page.locator('.abluo-app').first()).not.toHaveAttribute('data-theme')
    const lum = await appBackgroundLuminance(page)
    if (info.project.use.colorScheme === 'dark') expect(lum).toBeLessThan(0.1)
    else expect(lum).toBeGreaterThan(0.8)
  })

  test('E8 — an explicit choice sticks across reloads, from the first paint', async ({ page }, info) => {
    test.skip(info.project.name.startsWith('phone'), 'switch lives in the desktop sidebar until S1')
    const pick = info.project.use.colorScheme === 'dark' ? 'light' : 'dark'
    await page.goto(PAGES[1])
    await page.getByRole('radio', { name: pick === 'dark' ? 'Dark' : 'Light' }).click()
    await expect(page.locator('.abluo-app').first()).toHaveAttribute('data-theme', pick)
    // The server must render the attribute itself — check the raw HTML, not the hydrated DOM.
    const html = await (await page.request.get(PAGES[1])).text()
    expect(html).toMatch(new RegExp(`class="abluo-app[^"]*"[^>]*data-theme="${pick}"|data-theme="${pick}"[^>]*class="abluo-app`))
    await page.context().clearCookies({ name: 'abluo-app-theme' })
  })

  test('E8 — the app theme never touches the website theme key', async ({ page }) => {
    await page.goto(PAGES[1])
    const websiteKey = await page.evaluate(() => {
      try { return localStorage.getItem('abluo-theme') } catch { return null }
    })
    const appCookie = (await page.context().cookies()).find((c) => c.name === 'abluo-theme')
    expect({ websiteKey, appCookie }).toEqual({ websiteKey: null, appCookie: undefined })
  })
})
