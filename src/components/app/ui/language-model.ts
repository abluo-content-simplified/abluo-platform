/**
 * The language list behind LanguagePicker (pure, client-safe): every ISO 639-1
 * code, names localised with Intl.DisplayNames, sorting by localised name and
 * search by name or code. No I/O.
 */

/** Every ISO 639-1 language code (two letters, 184). */
export const LANGUAGE_CODES: readonly string[] = (
  'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu ' +
  'fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky ' +
  'la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw ' +
  'sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
).split(' ')

const KNOWN = new Set(LANGUAGE_CODES)

export type LanguageOption = { code: string; name: string }

export const isLanguageCode = (code: string | null | undefined): code is string => !!code && KNOWN.has(code)

const namesCache = new Map<string, Intl.DisplayNames | null>()
function displayNames(locale: string): Intl.DisplayNames | null {
  if (!namesCache.has(locale)) {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'code' })
    } catch {
      names = null
    }
    namesCache.set(locale, names)
  }
  return namesCache.get(locale) ?? null
}

/** The language's name in `locale` ("tedesco" for de in it); the code itself when unknown. Never throws. */
export function languageDisplayName(code: string, locale: string): string {
  const lower = code.trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(lower)) return code
  try {
    return displayNames(locale)?.of(lower) ?? lower
  } catch {
    return lower
  }
}

/** Lower-case, accents removed. */
export function foldLanguageText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function matchesLanguage(l: LanguageOption, query: string): boolean {
  const q = foldLanguageText(query)
  if (!q) return true
  return foldLanguageText(l.name).includes(q) || l.code === q
}

/**
 * The sheet's two groups for `locale`: `first` (e.g. the site's languages, in the
 * given order) then every other language sorted by localised name; both filtered by `query`.
 */
export function languageGroups(locale: string, first: readonly string[], query = ''): { first: LanguageOption[]; other: LanguageOption[] } {
  const firstSet = new Set(first.filter((c) => KNOWN.has(c)))
  const make = (code: string): LanguageOption => ({ code, name: languageDisplayName(code, locale) })
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base' })
  } catch {
    collator = new Intl.Collator('en', { sensitivity: 'base' })
  }
  return {
    first: [...firstSet].map(make).filter((l) => matchesLanguage(l, query)),
    other: LANGUAGE_CODES.filter((c) => !firstSet.has(c))
      .map(make)
      .filter((l) => matchesLanguage(l, query))
      .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code)),
  }
}
