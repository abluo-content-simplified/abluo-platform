/**
 * Which BCP-47 tag the dashboards (client + admin) use to format DATES.
 *
 * Tom's rule (2026-10-29), one pure function so it is decided in one place:
 *   - Italian / German (and any other interface language): that language's own
 *     convention ("it-IT", "de-DE", ...) — the region of the browser is ignored.
 *   - English follows the person's REGION, read from `Accept-Language`:
 *       en-US            -> "en-US"  ("Nov 11, 2026")
 *       en-GB, en-IE, en-AU, ... -> that tag ("11 Nov 2026")
 *     The first English tag (by q-value, then order) that names a region wins.
 *     No English region known (no header, "en", "it-IT" only, ...) -> "en-GB":
 *     European order, because Tom and his clients are in Europe.
 *   - TIMES are not decided here: every time of day is 24-hour (`hourCycle: 'h23'`
 *     at the formatter, guarded by `src/lib/time/__tests__/24-hour.test.ts`).
 *
 * Interface language only — never derive it from a tenant's content locale.
 * Dashboards only; public websites keep their own content-locale rules.
 */

const DEFAULT_ENGLISH = 'en-GB'

/** Region-less interface locales mapped to the tag whose date conventions we want. */
const OWN_CONVENTION: Record<string, string> = {
  it: 'it-IT',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-PT',
  nl: 'nl-NL',
}

interface Tag {
  primary: string
  region: string | null
  tag: string
  q: number
}

function parseAcceptLanguage(header: string | null | undefined): Tag[] {
  if (!header) return []
  const out: Tag[] = []
  header.split(',').forEach((raw) => {
    const [range, ...params] = raw.trim().split(';')
    const m = /^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2}|\d{3}))?(?:-[a-zA-Z0-9-]+)?$/.exec(range.trim())
    if (!m) return
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='))
    const q = qParam ? Number(qParam.slice(2)) : 1
    if (!Number.isFinite(q) || q <= 0) return
    const primary = m[1].toLowerCase()
    const region = m[2] ? m[2].toUpperCase() : null
    out.push({ primary, region, tag: region ? `${primary}-${region}` : primary, q })
  })
  // Stable sort: higher q first, header order kept for ties.
  return out.map((t, i) => ({ t, i })).sort((a, b) => b.t.q - a.t.q || a.i - b.i).map((x) => x.t)
}

function isSupported(tag: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0
  } catch {
    return false
  }
}

export function resolveDateLocale(interfaceLocale: string, acceptLanguage?: string | null): string {
  const primary = interfaceLocale.split('-')[0].toLowerCase()
  if (primary !== 'en') return OWN_CONVENTION[primary] ?? interfaceLocale

  const english = parseAcceptLanguage(acceptLanguage).find((t) => t.primary === 'en' && t.region)
  if (english && isSupported(english.tag)) return english.tag
  return DEFAULT_ENGLISH
}

/** `Intl.DateTimeFormat(dateLocale, options).format(date)` — what `format.dateTime` does, with the date locale instead of the interface one. */
export function formatDateTime(dateLocale: string, date: Date | number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(dateLocale, options).format(date)
}
