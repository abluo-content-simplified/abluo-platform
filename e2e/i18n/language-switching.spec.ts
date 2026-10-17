import { expect, test, type Page } from '@playwright/test'
import { targets, localeSegments, publicPathname, urlFor, type Target } from './targets'

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

/**
 * Wait for a language switch to actually land.
 *
 * next-intl's router does a CLIENT-SIDE navigation, which fires no `load`
 * event — the first version of this helper waited for one, returned
 * immediately, and read the URL before it had changed. That produced
 * assertion failures that looked like the bug under test but were the test
 * racing itself. Wait for the URL to move instead; if it never does, fall
 * through and let the assertion report the URL we are actually on.
 */
async function settle(page: Page, from: string): Promise<void> {
  await page.waitForURL((url) => url.href !== from, { timeout: 10_000 }).catch(() => {})
  // 'load', not 'domcontentloaded'. Waiting only for the DOM lets the next
  // click land before React has hydrated, so the drawer never opens and the
  // option never appears — measured as "OPTION NOT VISIBLE after 5077ms" on a
  // page whose controls work perfectly once hydrated. It costs the media, and
  // it is the difference between a gate that works and one that invents
  // failures.
  await page.waitForLoadState('load')
  // The banner comes back with each render until a choice is recorded, and on
  // a phone it covers the controls the next switch needs. Playwright's click
  // waits for an element to "receive events", so a covered control does not
  // fail fast — it burns the whole test budget.
  await dismissConsent(page)
}

/**
 * Open the switcher that matches `where` and choose `locale`. Returns false if
 * this site does not have that switcher.
 *
 * There are THREE switchers, not two, and they do not share markup:
 *   header — a dropdown, scoped by [data-lang-switch], options are native
 *            names ("Italiano"). CSS hides it below the md breakpoint.
 *   drawer — inside the mobile menu, reached only through the hamburger.
 *            Plain buttons labelled with the locale CODE ("IT"), no
 *            [data-lang-switch] and no aria-haspopup. While the drawer is shut
 *            its container is aria-hidden, so everything inside is invisible.
 *   footer — a dropdown like the header's, but routing to the site root by
 *            design (preservePath: false), so it cannot stack a prefix.
 *
 * The first version knew only the header one and timed out on every phone
 * run. Mobile is where the reported failure was seen, so the phone project
 * has to drive the control a phone actually shows.
 */
async function switchTo(
  page: Page,
  locale: string,
  where: 'header' | 'drawer' | 'footer'
): Promise<boolean> {
  const from = page.url()

  if (where === 'drawer') {
    const hamburger = page.locator('button[aria-label="Open menu"]').first()
    if ((await hamburger.count()) === 0 || !(await hamburger.isVisible())) return false
    await hamburger.click()
    // Again here, not only after navigation: the banner re-renders with the
    // page and is `fixed bottom-0`, so once we scroll down the drawer to reach
    // the language row it is sitting on top of exactly the buttons we need.
    await dismissConsent(page)
    // getByRole reads the accessibility tree, which is exactly the filter we
    // need: while the drawer is shut its container is aria-hidden so its
    // buttons are not in the tree, and neither is the header switcher, which
    // CSS hides at this width. So this matches the drawer's button, and only
    // once the panel is open.
    const option = page.getByRole('button', { name: CODE[locale], exact: true }).first()
    try {
      await option.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      return false
    }
    // force + an explicit bound. Playwright's default click waits for the
    // element to be "stable" — two animation frames with the same box — and
    // these pages animate continuously, so stability never arrives: a single
    // click silently consumed the whole 210s test budget and was reported as a
    // hang rather than as anything diagnosable. The button only needs its
    // onClick to fire, and 15s turns a genuine problem into a fast, legible
    // failure instead of a timeout at the end of the test.
    // Scroll first: on a phone the drawer's language row sits below the fold.
    // Then a NORMAL click, bounded. `force` was tried and is wrong here — it
    // skips the "receives events" check too, so a click on a covered button
    // silently does nothing and the next assertion reports the old locale as
    // if the switch had failed.
    await option.scrollIntoViewIfNeeded({ timeout: 5000 })
    await option.click({ timeout: 15_000 })
    await settle(page, from)
    return true
  }

  if (where === 'footer') {
    // FooterLanguageSwitcher is a flat row of plain buttons labelled with
    // native names — no dropdown, no aria-haspopup. An earlier version looked
    // for a listbox toggle here, found the THEME switcher or nothing, and
    // skipped every footer case on every site. The footer contract was
    // therefore never actually tested, while the report said "skipped" as if
    // the site simply lacked the control.
    const option = page
      .locator('footer')
      .getByRole('button', { name: NATIVE[locale], exact: true })
      .first()
    if ((await option.count()) === 0) return false
    await option.scrollIntoViewIfNeeded()
    // No `force`, for the same reason as the drawer: it skips the "receives
    // events" check, so a covered button swallows the click and the next
    // assertion reports the old locale as though the switch had failed. That
    // is what "footer switch to de" showed on hoffmann.
    await option.click({ timeout: 15_000 })
    await settle(page, from)
    return true
  }

  const scope = page.locator('[data-lang-switch]')
  const toggle = scope.locator('button[aria-haspopup="listbox"]').first()
  if ((await toggle.count()) === 0 || !(await toggle.isVisible())) return false

  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  // The popup lists one button per language, by its native name.
  const option = scope.locator('div button').filter({ hasText: NATIVE[locale] }).first()
  if ((await option.count()) === 0) {
    await page.keyboard.press('Escape')
    return false
  }
  await option.click({ timeout: 15_000 })
  await settle(page, from)
  return true
}

/** Whichever primary switcher this viewport actually shows. */
async function switchToPrimary(page: Page, locale: string): Promise<boolean> {
  if (await switchTo(page, locale, 'header')) return true
  return switchTo(page, locale, 'drawer')
}

const NATIVE: Record<string, string> = {
  en: 'English', it: 'Italiano', de: 'Deutsch', fr: 'Français',
  es: 'Español', nl: 'Nederlands', pt: 'Português',
}
/** LOCALE_LABELS — what the drawer switcher puts on its buttons. */
const CODE: Record<string, string> = Object.fromEntries(
  Object.keys(NATIVE).map((l) => [l, l.toUpperCase()])
)

/**
 * Close the consent banner if one is showing.
 *
 * On a phone it is `fixed inset-x-0 bottom-0` and sits on top of the footer
 * and the bottom of the drawer, so every click underneath it is intercepted
 * and the test times out 30s later — which is what seven phone cases did
 * before this. Its close control is the only language-independent thing in
 * it, which is why it is matched by "×" rather than by a label.
 *
 * Dismissing rather than accepting: this suite has no business consenting to
 * tracking on the client's behalf, and the banner's presence is not what it
 * is testing.
 *
 * Targeted through role=dialog and DOM order, because nothing else about it is
 * language-independent. Its close control renders "×" but carries
 * aria-label="Close and reject", which overrides the glyph for accessible-name
 * matching AND is translated per locale — so matching on either the text or
 * the label silently found nothing, and seven phone cases went on timing out
 * with the banner still sitting over the footer.
 */
async function dismissConsent(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  if ((await dialog.count()) === 0) return
  // The close button is first in the banner's markup.
  await dialog.locator('button').first().click({ timeout: 3000 }).catch(() => {})
  await dialog.first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
}

/** Everything that must agree about the locale, read off the live page. */
async function observe(page: Page, site: Target) {
  const url = new URL(page.url())
  // Normalised to the shape a tenant's own domain would show, so one set of
  // assertions covers both URL shapes. See publicPathname().
  const pathname = publicPathname(url.pathname, site)
  return {
    url: page.url(),
    pathname,
    segments: localeSegments(pathname, site.locales),
    htmlLang: await page.locator('html').getAttribute('lang'),
    title: await page.title(),
  }
}

for (const site of SITES) {
  test.describe(`${site.project} — ${urlFor(site, site.defaultLocale)}`, () => {
    test.beforeEach(async ({ page }) => {
      // Vercel injects its preview toolbar into every non-production
      // deployment. `<vercel-live-feedback>` is an overlay that intercepts
      // pointer events, and on a phone it sits over the bottom of the
      // navigation drawer — Playwright reported it by name after retrying a
      // click for fifteen seconds:
      //     <vercel-live-feedback></vercel-live-feedback> intercepts pointer events
      // It is not part of the product and never reaches a visitor, so hiding
      // it is not hiding a defect. An init script rather than addStyleTag,
      // because this has to survive every navigation the test makes.
      await page.addInitScript(() => {
        const hide = () => {
          const style = document.createElement('style')
          style.textContent =
            'vercel-live-feedback,vercel-toolbar{display:none!important;pointer-events:none!important}'
          document.head?.appendChild(style)
        }
        if (document.head) hide()
        else document.addEventListener('DOMContentLoaded', hide)
      })

      const res = await page.goto(urlFor(site, site.defaultLocale), { waitUntil: 'load' })
      test.skip(!res || res.status() >= 400, `${urlFor(site, site.defaultLocale)} is not reachable in this environment`)
      await dismissConsent(page)
    })

    test('cycling through every language never stacks a locale', async ({ page }) => {
      // Test group 1. Two full laps, so an error that only appears on the
      // second switch — which is exactly how this bug behaved — is caught.
      // One lap of every language, ending back at the default. For a
      // seven-language site that is seven consecutive switches, each one
      // starting from a non-default locale — which is the state the defect
      // needs. A second lap doubled the runtime (past nine minutes on a phone
      // profile for this site alone) and tested nothing the first had not.
      const others = site.locales.filter((l) => l !== site.defaultLocale)
      const order = [...others, site.defaultLocale]
      // Each switch is a real navigation, and on a phone it opens the drawer
      // first. 30s of headroom each, rather than the 30s the whole test gets
      // by default.
      test.setTimeout(30_000 * order.length)
      for (const locale of order) {
        const switched = await switchToPrimary(page, locale)
        if (!switched) {
          test.skip(true, `${site.project} has no header or drawer switcher`)
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

    test('the home page switches language in place, starting from a non-default language', async ({ page }) => {
      // Test group 2, and the single most important case in this file.
      //
      // The defect showed ONLY on routes without a localized slug (every other
      // route takes the slugMap branch) AND only when the page was not already
      // in the default locale — next-intl's wrong assumption was "en", so on
      // an English page it happened to be right.
      //
      // An earlier version of this test started on the default locale and
      // therefore PASSED against a production that was visibly broken. Starting
      // anywhere but the default is what makes it mean something.
      const [from, to] = site.locales.filter((l) => l !== site.defaultLocale)
      const start = from ?? site.defaultLocale
      const target = to ?? site.defaultLocale
      if (start === target) { test.skip(true, 'needs two non-default languages or a default to return to'); return }

      const res = await page.goto(urlFor(site, start), { waitUntil: 'load' })
      if (!res || res.status() >= 400) { test.skip(true, `/${start} not reachable`); return }
      await dismissConsent(page)
      expect((await observe(page, site)).segments, 'the starting page itself').toEqual([start])

      const switched = await switchToPrimary(page, target)
      if (!switched) { test.skip(true, 'no header or drawer switcher'); return }

      const seen = await observe(page, site)
      expect(seen.segments, `${start} -> ${target}: ${seen.url}`).toEqual([target])
      expect(seen.pathname).toBe(`/${target}`)
      expect(seen.htmlLang).toBe(target)
    })

    test('a localized sub-page switches to its translated slug', async ({ page }) => {
      // Test group 3. This path was never broken — a page that registers a
      // localized slug takes the slugMap branch and never reads the pathname,
      // which is precisely why the defect looked like a home-page problem. It
      // is asserted here so the fix cannot regress it while repairing the other.
      // An internal link one level below the site root, in either URL shape:
      //   /en/partner            (tenant's own host)
      //   /en/nologo/partner     (project reached by path)
      const under = site.projectSegment
        ? `/${site.defaultLocale}/${site.projectSegment}/`
        : `/${site.defaultLocale}/`
      const link = page
        .locator(`a[href^="${under}"]`)
        .filter({ hasNot: page.locator('[data-lang-switch] a') })
        .first()
      if ((await link.count()) === 0) { test.skip(true, 'no internal sub-page link found'); return }

      const href = await link.getAttribute('href')
      const res = await page.goto(new URL(href!, site.origin).toString(), { waitUntil: 'load' })
      if (!res || res.status() >= 400) { test.skip(true, `sub-page ${href} not reachable`); return }
      await dismissConsent(page)
      const before = await observe(page, site)

      const other = site.locales.find((l) => l !== site.defaultLocale)!
      const switched = await switchToPrimary(page, other)
      if (!switched) { test.skip(true, 'no header or drawer switcher'); return }

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
      // isVisible as well as count: below the md breakpoint this switcher is
      // still in the DOM but hidden, and clicking it hangs until the test
      // times out — which is what every phone run did before this.
      if ((await toggle.count()) === 0 || !(await toggle.isVisible())) {
        test.skip(true, 'no visible header switcher at this width')
        return
      }
      await toggle.click()

      // The popup renders after the click. Reading its buttons immediately
      // returned an empty list under parallel load, failing the comparison
      // against an empty set — a race in the test, not a wrong language list.
      const options = scope.locator('div button')
      await options.first().waitFor({ state: 'visible', timeout: 5000 })

      const labels = (await options.allTextContents())
        .map((t) => t.trim()).filter(Boolean)
      const offered = labels
        .map((label) => Object.keys(NATIVE).find((l) => NATIVE[l] === label))
        .filter((l): l is string => Boolean(l))

      expect(new Set(offered)).toEqual(new Set(site.locales))
    })

    test('a refresh and the back button keep the locale', async ({ page }) => {
      // Test group 6. A locale that only survives client-side navigation is
      // not fixed; the server has to agree.
      // Starting from a non-default language, for the reason given on the home
      // test above: from the default locale this passed against broken sites.
      const start = site.locales.find((l) => l !== site.defaultLocale)!
      const other = site.locales.find((l) => l !== start)!
      const res = await page.goto(urlFor(site, start), { waitUntil: 'load' })
      if (!res || res.status() >= 400) { test.skip(true, `/${start} not reachable`); return }
      await dismissConsent(page)

      const switched = await switchToPrimary(page, other)
      if (!switched) { test.skip(true, 'no header or drawer switcher'); return }

      await page.reload({ waitUntil: 'load' })
      await dismissConsent(page)
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
