import { LOCALE_CODES } from '@/lib/i18n/locales'

/**
 * Strip a leading locale segment that should not be there.
 *
 * `pathname` is meant to arrive locale-less, from next-intl's `usePathname()`.
 * MEASURED on production 2026-10-16: it does not always. next-intl strips the
 * prefix by comparing against `useLocale()`, and this app hands
 * `NextIntlClientProvider` no `locale`, so the client falls back to
 * `routing.defaultLocale` ("en"). On /it the computed prefix is "/en", no match
 * is found, and `usePathname()` returns "/it" unchanged. The switcher then
 * asked the router for "/it" in French and got `/fr/it` — a page that does not
 * exist. Switching again stacked another one.
 *
 * The real repair is to give the provider its locale; that is a separate change
 * with a much wider blast radius (every next-intl string in the dashboard is
 * currently English for the same reason). This guard is here so a wrong locale
 * upstream can never again turn the language switcher into a 404 generator: a
 * locale-less path passes through untouched, so it is a no-op once the provider
 * is fixed.
 *
 * The one ambiguity is a page whose own slug is exactly a locale code
 * ("/de" as a page). That page would lose its segment here — but it is already
 * unreachable through the switcher today, and no site has one.
 */
function withoutLocalePrefix(pathname: string): string {
  // Repeatedly, so a visitor already stranded on a stacked URL (/nl/fr/it, the
  // shape two switches produced) is sent to the site root rather than to the
  // next broken path down.
  let here = pathname
  for (;;) {
    const match = /^\/([a-z]{2})(?=\/|$)/.exec(here)
    if (!match) return here
    if (!(LOCALE_CODES as readonly string[]).includes(match[1])) return here
    here = here.slice(match[0].length) || '/'
    if (here === '/') return here
  }
}

/**
 * Where a language switcher sends the visitor — the path BELOW the locale,
 * handed to next-intl's router with `{ locale }`, which adds the prefix.
 *
 * Shared by the header/drawer switcher and the footer switcher, which used to
 * carry two slightly different copies of this decision.
 *
 *   1. The page registered a per-locale target (SlugMapProvider): use it. This
 *      is how a localized slug (`news/caso-studio-…`) and an index route
 *      (`news`) keep the visitor on the same page in the other language.
 *   2. Otherwise, when `preservePath` is set, keep the current path below the
 *      site base — correct for routes whose path is the same in every language.
 *   3. Otherwise the site's home.
 *
 * `hostScoped` — the site is on its own host, so the public path has no
 * project segment (see siteBasePath() in `@/lib/sanity/href`). `pathname` is
 * next-intl's locale-less pathname as the browser shows it.
 */
export function languageSwitchPath(opts: {
  targetLocale: string
  slugMap: Partial<Record<string, string>>
  tenantId: string
  hostScoped: boolean
  pathname: string
  preservePath: boolean
}): string {
  const { targetLocale, slugMap, tenantId, hostScoped, pathname, preservePath } = opts
  const base = hostScoped ? '' : `/${tenantId}`
  const target = slugMap[targetLocale]
  if (target) return `${base}/${target.replace(/^\/+/, '')}`

  if (preservePath) {
    const here = withoutLocalePrefix(pathname)
    let sub = ''
    if (hostScoped) {
      sub = here === '/' ? '' : here
    } else if (here === base || here.startsWith(`${base}/`)) {
      sub = here.slice(base.length)
    }
    return `${base}${sub}` || '/'
  }

  return base || '/'
}

/**
 * The slug map an INDEX route registers (`/news`, `/blog`, `/events`): the same
 * segment in every site language.
 *
 * Without it the footer switcher — which never guesses a path — sent a visitor
 * on /en/news to the German home page instead of /de/news.
 */
export function indexRouteSlugMap(locales: readonly string[], segment: string): Record<string, string> {
  return Object.fromEntries(locales.map((locale) => [locale, segment]))
}
