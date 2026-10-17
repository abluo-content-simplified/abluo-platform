import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'

// next/font is a build-time loader; outside Next it has no runtime. Each loader
// only has to hand back a `variable` class name here.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font-var', className: 'font-class', style: {} })
  return { Geist_Mono: font, Barlow_Condensed: font, Poppins: font }
})
// RECORDED, not merely stubbed. The locale handed to these three is the thing
// that broke, and the reason this file's original assertions could not see it:
// `<html lang>` comes straight from the route param, so it was right while
// everything next-intl knew was wrong. See the second describe block.
const requestLocales: string[] = []
const messagesFor: Array<string | undefined> = []
const providerLocales: Array<string | undefined> = []
// By default next-intl resolves whatever setRequestLocale established, which
// is the healthy case. `pinnedLocale` simulates the broken plumbing: next-intl
// answering something else, as it did in production.
let pinnedLocale: string | null = null
vi.mock('next-intl/server', () => ({
  getMessages: async (opts?: { locale?: string }) => {
    messagesFor.push(opts?.locale)
    return {}
  },
  setRequestLocale: (locale: string) => {
    requestLocales.push(locale)
  },
  getLocale: async () => pinnedLocale ?? requestLocales.at(-1) ?? 'en',
}))
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ locale, children }: { locale?: string; children: React.ReactNode }) => {
    providerLocales.push(locale)
    return children
  },
}))

import { RootDocument } from '@/components/RootDocument'
import LocaleLayout from '@/app/[locale]/layout'
import PlatformRootLayout from '@/app/(platform)/layout'

beforeEach(() => {
  requestLocales.length = 0
  messagesFor.length = 0
  providerLocales.length = 0
  pinnedLocale = null
})

describe('<html lang> follows the URL locale', () => {
  it('RootDocument writes the lang it is given', () => {
    const html = renderToStaticMarkup(<RootDocument lang="it"><p>x</p></RootDocument>)
    expect(html).toMatch(/^<html lang="it"/)
  })

  it.each(['en', 'it', 'de'])('the [locale] root layout renders lang="%s"', async (locale) => {
    const el = await LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale }) })
    expect(renderToStaticMarkup(el)).toContain(`<html lang="${locale}"`)
  })

  it('locale-less platform pages use the platform default locale', () => {
    const html = renderToStaticMarkup(<PlatformRootLayout><p>x</p></PlatformRootLayout>)
    expect(html).toContain('<html lang="en"')
  })

  it('there is no single top-level root layout that could hardcode the language again', () => {
    expect(existsSync(resolve(__dirname, '../../app/layout.tsx'))).toBe(false)
  })
})

/**
 * REGRESSION — the locale next-intl is given, measured in production 2026-10-16.
 *
 * `src/proxy.ts` has 21 return paths; only three delegate to next-intl's
 * middleware (the platform surfaces). Every tenant website request is a
 * rewrite, so next-intl never saw it, `requestLocale` was undefined, and
 * `src/i18n/request.ts` fell back to routing.defaultLocale. The app believed
 * every page was English whatever its URL said.
 *
 * Visible cost: next-intl's usePathname() removes the locale prefix by
 * comparing against useLocale(). Believing it was on "en" it returned "/it"
 * unchanged, so the switcher asked the router for "/it" in French and sent the
 * visitor to /fr/it — a 404. Reproduced on nologo.cloud, tmz.it and
 * studiomartegani.com from every language except English. 57 components import
 * Link / useRouter / usePathname from @/i18n/navigation and all prefix URLs
 * from that same value.
 *
 * WHY THE OLD TESTS MISSED IT, which is the gap these close:
 *   - This file rendered the very layout that held the bug, but asserted only
 *     `<html lang>` — and that attribute is written from the route param
 *     directly, never through next-intl. It was right while everything else
 *     was wrong.
 *   - src/i18n/__tests__/request.test.ts exercised request.ts as a pure
 *     function with a hand-supplied locale, and even asserted that a MISSING
 *     locale falls back to "en" — true and desirable for the locale-less
 *     platform routes, but it blessed the fallback without anyone ever asking
 *     whether the app establishes the locale in routes that require one.
 *   - Nothing tested the producer side of the contract: proxy → layout →
 *     next-intl. That end-to-end path had no coverage at all.
 */
describe('next-intl is told which locale the request is for', () => {
  it.each(['en', 'it', 'de', 'fr', 'nl', 'pt', 'es'])(
    'establishes "%s" for the server, the bundle and the browser',
    async (locale) => {
      renderToStaticMarkup(
        await LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale }) })
      )
      // Server components — all 25 getTranslations() callers read this.
      expect(requestLocales).toEqual([locale])
      // The bundle shipped to the browser.
      expect(messagesFor).toEqual([locale])
      // What useLocale() returns in the browser, and therefore what decides
      // whether usePathname() strips the prefix.
      expect(providerLocales).toEqual([locale])
    }
  )

  it('refuses to render when the locale was not established', async () => {
    // Simulates exactly the production failure: the layout asks for "it" but
    // next-intl resolves the default. Before this contract existed, that
    // rendered a perfectly normal-looking English page.
    pinnedLocale = 'en'
    await expect(
      LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale: 'it' }) })
    ).rejects.toThrow(/Locale contract violated/)
  })

  it('still rejects a locale that is not ours', async () => {
    await expect(
      LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale: 'zz' }) })
    ).rejects.toThrow()
  })
})
