import { describe, it, expect } from 'vitest'
import { languageSwitchPath } from '@/lib/i18n/language-switch'

/**
 * The locale of a request comes from the URL, and nothing else.
 *
 * This app does not run next-intl's middleware — `src/proxy.ts` owns host and
 * path routing — so next-intl has no way to learn the locale unless the layout
 * tells it. Until 2026-10-16 the layout did not, `requestLocale` was undefined,
 * and `src/i18n/request.ts` fell back to `routing.defaultLocale`. Every page in
 * every language resolved as "en", on the server and in the browser.
 *
 * What that cost, measured in production on 2026-10-16: next-intl's
 * `usePathname()` strips the locale prefix by comparing against `useLocale()`.
 * Believing every page was English, it left "/it" in place, and the header
 * language switcher asked the router for "/it" in French — landing the visitor
 * on /fr/it, which does not exist. Confirmed on nologo.cloud, tmz.it and
 * studiomartegani.com, from every language EXCEPT English, where the wrong
 * guess happened to be right. A second switch stacked another segment.
 *
 * The cause is fixed in `src/app/[locale]/layout.tsx` and asserted where it can
 * be observed rather than read: `src/components/__tests__/root-document-lang`
 * renders the layout and checks the locale handed to setRequestLocale,
 * getMessages and the client provider.
 *
 * What follows is the switcher's half of the contract — given the locale-less
 * pathname `usePathname()` is supposed to return, it must produce a locale-less
 * path for the router to prefix. These are the shapes that were mis-handled.
 */
describe('languageSwitchPath, given the pathname it is promised', () => {
  const base = { slugMap: {}, tenantId: 'nologo', preservePath: true }

  it('keeps the visitor on the home page', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/' })
    ).toBe('/')
  })

  it('keeps the visitor on a sub-page', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/partner' })
    ).toBe('/partner')
  })

  it('prefers a localized slug when the page registered one', () => {
    expect(
      languageSwitchPath({
        ...base, slugMap: { fr: 'systeme-reservation-restaurant' },
        targetLocale: 'fr', hostScoped: true, pathname: '/sistema-prenotazioni-ristorante',
      })
    ).toBe('/systeme-reservation-restaurant')
  })

  it('keeps the project segment on a path-routed project', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: false, pathname: '/nologo/partner' })
    ).toBe('/nologo/partner')
  })
})
