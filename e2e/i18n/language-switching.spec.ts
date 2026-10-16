import { expect, test, type Page } from '@playwright/test'
import { targets, localeSegments, type Target } from './targets'

/**
 * The i18n release gate.
 *
 * WHAT IT PROTECTS — measured in a browser on 2026-10-16, before the fix:
 *   www.nologo.cloud/it        + switch to French -> /fr/it        (404)
 *   www.nologo.cloud/de        + switch to English -> /en/de       (404)
 *   www.tmz.it/it              + switch to English -> /en/it       (404)
 *   www.studiomartegani.com/it + switch to English -> /en/it       (404)
 * and a second switch stacked a third segment. Every language failed except
 * English, where next-intl's wrong assumption happened to match the URL.
 *
 * WHY IT MUST BE A BROWSER TEST. The defect lived in the agreement between
 * three things that only exist at runtime: the locale next-intl resolved, what
 * `usePathname()` therefore returned, and what the router prefixed onto it.
 * jsdom has no router and no navigation, so no vitest could have caught it —
 * and none did. The unit side of this contract is in
 * src/components/__tests__/root-document-lang.test.tsx; this is the half that
 * needs a real browser.
 *
 * Targets come from the generated route table (see targets.ts), so a new tenant
 * is covered automatically.
 *
 *   E2E_I18N_MODE=preview-path   preview.abluo.app/<project>   (default)
 *   E2E_I18N_MODE=preview-host   <project>.preview.abluo.app
 *   E2E_I18N_MODE=production     www.<customDomain>
 */

const SITES = targets()

/** Open the switcher that matches `where` and choose `locale`. Returns false if absent. */
async function switchTo(page: Page, locale: string, where: 'header' | 'footer'): Promise<boolean> {
  const scope = where === 'header' ? page.locator('[data-lang-switch]') : page.locator('footer')
  const toggle = scope.locator('button[aria-haspopup="listbox"]').first()
  if ((await toggle.count()) === 0) return false

  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  // The popup lists one button per language, by its native name.
  const option = scope.locator('div button').filter({ hasText: NATIVE[locale] }).first()
  if ((await option.count()) === 0) {
    await page.keyboard.press('Escape')
    return false
  }
  await option.click()
  await page.waitForLoadState('load')
  return true
}

const NATIVE: Record<string, string> = {
  en: 'English', it: 'Italiano', de: 'Deutsch', fr: 'Français',
  es: 'Español', nl: 'Nederlands', pt: 'Português',
}

/** Everything that must agree about the locale, read off the live page. */
async function observe(page: Page, site: Target) {
  const url = new URL(page.url())
  // The base may carry a path prefix (preview-path mode); strip it first.
  const prefix = new URL(site.base).pathname.replace(/\/$/, '')
  const pathname = prefix && url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) || '/'
    : url.pathname
  return {
    url: page.url(),
    pathname,
    segments: localeSegments(pathname, site.locales),
    htmlLang: await page.locator('html').getAttribute('lang'),
    title: await page.title(),
  }
}

for (const site of SITES) {
  test.describe(`${site.project} — ${site.base}`, () => {
    test.beforeEach(async ({ page }) => {
      const res = await page.goto(`${site.base}/${site.defaultLocale}`, { waitUntil: 'load' })
      test.skip(!res || res.status() >= 400, `${site.base} is not reachable in this environment`)
    })

    test('cycling every language twice never stacks a locale', async ({ page }) => {
      // Test group 1. Two full laps, so an error that only appears on the
      // second switch — which is exactly how this bug behaved — is caught.
      const order = [...site.locales, ...site.locales]
      for (const locale of order) {
        const switched = await switchTo(page, locale, 'header')
        if (!switched) {
          test.skip(true, `${site.project} has no header switcher`)
          return
        }
        const seen = await observe(page, site)

        // EXACTLY one locale segment — the heart of the regression.
        expect(seen.segments, `after switching to ${locale}: ${seen.url}`).toEqual([locale])
        // The document language agrees with the URL.
        expect(seen.htmlLang, `html lang after ${locale}: ${seen.url}`).toBe(locale)
        // And it is a real page, not the unavailable page.
        expect(seen.title, `title after ${locale}: ${seen.url}`).not.toMatch(/^Abluo$/)
      }
    })

    test('the home page switches language in place', async ({ page }) => {
      // Test group 2. The original defect ONLY showed on routes without a
      // localized slug, because every other route takes the slugMap branch.
      const other = site.locales.find((l) => l !== site.defaultLocale)!
      const switched = await switchTo(page, other, 'header')
      if (!switched) { test.skip(true, 'no header switcher'); return }

      const seen = await observe(page, site)
      expect(seen.segments).toEqual([other])
      expect(seen.pathname).toBe(`/${other}`)
      expect(seen.htmlLang).toBe(other)
    })

    test('a localized sub-page switches to its translated slug', async ({ page }) => {
      // Test group 3. This path was never broken — a page that registers a
      // localized slug takes the slugMap branch and never reads the pathname,
      // which is precisely why the defect looked like a home-page problem. It
      // is asserted here so the fix cannot regress it while repairing the other.
      const prefix = new URL(site.base).pathname.replace(/\/$/, '')
      const link = page
        .locator(`a[href^="${prefix}/${site.defaultLocale}/"]`)
        .filter({ hasNot: page.locator('[data-lang-switch] a') })
        .first()
      if ((await link.count()) === 0) { test.skip(true, 'no internal sub-page link found'); return }

      const href = await link.getAttribute('href')
      const res = await page.goto(new URL(href!, site.base).toString(), { waitUntil: 'load' })
      if (!res || res.status() >= 400) { test.skip(true, `sub-page ${href} not reachable`); return }
      const before = await observe(page, site)

      const other = site.locales.find((l) => l !== site.defaultLocale)!
      const switched = await switchTo(page, other, 'header')
      if (!switched) { test.skip(true, 'no header switcher'); return }

      const after = await observe(page, site)
      expect(after.segments, `sub-page switch to ${other}: ${after.url}`).toEqual([other])
      expect(after.htmlLang).toBe(other)
      // Still a real page, and still a sub-page rather than a bounce home.
      expect(after.title).not.toMatch(/^Abluo$/)
      expect(after.pathname, `${before.pathname} -> ${after.pathname}`).not.toBe(`/${other}`)
    })

    test('the switcher offers this tenant’s languages and no others', async ({ page }) => {
      // Test group 8 / requirement D. A two-language site must not be able to
      // reach a language it does not publish.
      const scope = page.locator('[data-lang-switch]')
      const toggle = scope.locator('button[aria-haspopup="listbox"]').first()
      if ((await toggle.count()) === 0) { test.skip(true, 'no header switcher'); return }
      await toggle.click()

      const labels = (await scope.locator('div button').allTextContents())
        .map((t) => t.trim()).filter(Boolean)
      const offered = labels
        .map((label) => Object.keys(NATIVE).find((l) => NATIVE[l] === label))
        .filter((l): l is string => Boolean(l))

      expect(new Set(offered)).toEqual(new Set(site.locales))
    })

    test('a refresh and the back button keep the locale', async ({ page }) => {
      // Test group 6. A locale that only survives client-side navigation is
      // not fixed; the server has to agree.
      const other = site.locales.find((l) => l !== site.defaultLocale)!
      const switched = await switchTo(page, other, 'header')
      if (!switched) { test.skip(true, 'no header switcher'); return }

      await page.reload({ waitUntil: 'load' })
      let seen = await observe(page, site)
      expect(seen.segments, `after reload: ${seen.url}`).toEqual([other])
      expect(seen.htmlLang).toBe(other)

      await page.goBack({ waitUntil: 'load' })
      seen = await observe(page, site)
      expect(seen.segments.length, `after back: ${seen.url}`).toBeLessThanOrEqual(1)
      if (seen.segments.length === 1) expect(seen.htmlLang).toBe(seen.segments[0])
    })

    test('the footer switcher obeys the same contract', async ({ page }) => {
      // Test group 7. The two switchers may look different; they may not route
      // differently. ch-psicoterapeuta and abluo.app have ONLY this one, which
      // is the sole reason they escaped the original defect.
      const other = site.locales.find((l) => l !== site.defaultLocale)!
      const switched = await switchTo(page, other, 'footer')
      if (!switched) { test.skip(true, 'no footer switcher'); return }

      const seen = await observe(page, site)
      expect(seen.segments, `footer switch to ${other}: ${seen.url}`).toEqual([other])
      expect(seen.htmlLang).toBe(other)
    })
  })
}
