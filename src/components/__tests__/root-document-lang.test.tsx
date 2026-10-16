import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'

// next/font is a build-time loader; outside Next it has no runtime. Each loader
// only has to hand back a `variable` class name here.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font-var', className: 'font-class', style: {} })
  return { Geist_Mono: font, Barlow_Condensed: font, Poppins: font }
})
// Recorded, not just stubbed: the locale these two are given IS the thing that
// broke. See the "next-intl is told which locale" block below.
const requestLocales: string[] = []
const messagesFor: Array<string | undefined> = []
const providerLocales: Array<string | undefined> = []
vi.mock('next-intl/server', () => ({
  getMessages: async (opts?: { locale?: string }) => {
    messagesFor.push(opts?.locale)
    return {}
  },
  setRequestLocale: (locale: string) => {
    requestLocales.push(locale)
  },
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
 * REGRESSION, measured in production on 2026-10-16.
 *
 * This app does not run next-intl's middleware — `src/proxy.ts` owns host and
 * path routing — so next-intl cannot learn the locale unless this layout tells
 * it. It did not. `requestLocale` was undefined, `src/i18n/request.ts` fell
 * back to `routing.defaultLocale`, and every page in every language resolved
 * as "en" on the server AND in the browser.
 *
 * The visible cost: next-intl's `usePathname()` strips the locale prefix by
 * comparing against `useLocale()`. Believing it was on "en", it returned "/it"
 * unchanged, and the header language switcher asked the router for "/it" in
 * French — sending the visitor to /fr/it, which does not exist. Reproduced on
 * nologo.cloud, tmz.it and studiomartegani.com, from every language except
 * English, where the wrong guess happened to be right. Switching twice stacked
 * a third segment.
 *
 * These assertions watch the values the layout hands to next-intl, because a
 * missing argument was the entire defect.
 */
describe('next-intl is told which locale the request is for', () => {
  it.each(['en', 'it', 'de', 'fr'])('sets the request locale to "%s"', async (locale) => {
    requestLocales.length = 0
    messagesFor.length = 0
    providerLocales.length = 0

    const el = await LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale }) })
    renderToStaticMarkup(el)

    // Server components: all 26 `getTranslations()` callers read this.
    expect(requestLocales).toEqual([locale])
    // The bundle shipped to the browser.
    expect(messagesFor).toEqual([locale])
    // The value `useLocale()` returns in the browser — the one that decides
    // whether `usePathname()` strips the prefix.
    expect(providerLocales).toEqual([locale])
  })
})
