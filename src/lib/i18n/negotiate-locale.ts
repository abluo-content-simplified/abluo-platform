// ─── Locale negotiation for a website's root URL ─────────────────────────────
//
// THE PLATFORM RULE (Tom, 2026-09-30) — applies to every Abluo website:
//
//   1. The visitor chose a language on this site before (NEXT_LOCALE cookie,
//      written by the language switcher) and the site still offers it → that one.
//   2. Otherwise, walk the browser's languages in the visitor's order of
//      preference (Accept-Language, by q-value) and take the FIRST one this site
//      offers.  A German browser on a site with German → German.
//   3. Otherwise → the site's default language.  A Lithuanian browser on an
//      en/fr site → the default.
//
// "Offers" means the PROJECT's supportedLocales, never the platform's full
// locale registry. Negotiating against the registry sent a German browser to
// /de on a site without German, which the [tenant] layout then 404ed — a live
// defect on livener.net and ameliez.com until this fix.
//
// Pure and synchronous: it runs in src/proxy.ts on every root request.

export interface NegotiateLocaleInput {
  /** Value of the NEXT_LOCALE cookie, if any. */
  cookieLocale?: string | null
  /** Raw Accept-Language header, if any. */
  acceptLanguage?: string | null
  /** The site's languages. Empty/absent → only the default is offered. */
  supportedLocales?: readonly string[] | null
  /** The site's default language. Always a valid answer. */
  defaultLocale: string
}

/**
 * Parses an Accept-Language header into primary language subtags, most
 * preferred first. `fr-BE,fr;q=0.9,en;q=0.8` → ['fr', 'en'].
 * Ties keep header order; q=0 means "not acceptable" and is dropped; `*` is
 * ignored (it expresses no preference we can act on).
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  const entries: { code: string; q: number; index: number }[] = []
  header.split(',').forEach((part, index) => {
    const [rawTag, ...params] = part.trim().split(';')
    const tag = rawTag?.trim().toLowerCase()
    if (!tag || tag === '*') return
    let q = 1
    for (const p of params) {
      const [k, v] = p.trim().split('=')
      if (k?.trim() === 'q') {
        const n = Number(v)
        q = Number.isFinite(n) ? n : 0
      }
    }
    if (q <= 0) return
    entries.push({ code: tag.split('-')[0], q, index })
  })
  entries.sort((a, b) => b.q - a.q || a.index - b.index)
  const seen = new Set<string>()
  return entries.map((e) => e.code).filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
}

export function negotiateLocale({
  cookieLocale,
  acceptLanguage,
  supportedLocales,
  defaultLocale,
}: NegotiateLocaleInput): string {
  const offered = new Set(
    supportedLocales && supportedLocales.length > 0 ? supportedLocales : [defaultLocale]
  )
  offered.add(defaultLocale)

  // 1. An explicit earlier choice on this site wins.
  if (cookieLocale && offered.has(cookieLocale)) return cookieLocale

  // 2. The browser's languages, in the visitor's order of preference.
  for (const code of parseAcceptLanguage(acceptLanguage)) {
    if (offered.has(code)) return code
  }

  // 3. The site's default.
  return defaultLocale
}
