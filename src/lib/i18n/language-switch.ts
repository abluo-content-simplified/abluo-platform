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
    let sub = ''
    if (hostScoped) {
      sub = pathname === '/' ? '' : pathname
    } else if (pathname === base || pathname.startsWith(`${base}/`)) {
      sub = pathname.slice(base.length)
    }
    return `${base}${sub}` || '/'
  }

  return base || '/'
}
