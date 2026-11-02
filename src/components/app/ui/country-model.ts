/**
 * The country list behind CountryPicker (pure, client-safe): every ISO 3166-1
 * alpha-2 code, the EU member states, names localised with Intl.DisplayNames,
 * sorting by localised name and search by name or code. No I/O.
 */

/** Every officially assigned ISO 3166-1 alpha-2 code (249). */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

/** The 27 EU member states (ISO codes — Greece is GR here, EL only in VAT numbers). */
export const EU_COUNTRY_CODES: readonly string[] = 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' ')

const KNOWN = new Set(COUNTRY_CODES)
const EU = new Set(EU_COUNTRY_CODES)

export type Country = { code: string; name: string }

export const isCountryCode = (code: string | null | undefined): code is string => !!code && KNOWN.has(code)
export const isEuCountry = (code: string | null | undefined): boolean => !!code && EU.has(code)

const namesCache = new Map<string, Intl.DisplayNames | null>()
function displayNames(locale: string): Intl.DisplayNames | null {
  if (!namesCache.has(locale)) {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'code' })
    } catch {
      names = null
    }
    namesCache.set(locale, names)
  }
  return namesCache.get(locale) ?? null
}

/** The country's name in `locale` ("Italia" for IT in it); the code itself when unknown. Never throws. */
export function countryName(code: string, locale: string): string {
  const upper = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return code
  try {
    return displayNames(locale)?.of(upper) ?? upper
  } catch {
    return upper
  }
}

/** Lower-case, accents removed: "Österreich" → "osterreich". */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Does a country match what was typed? Name contains it (accent- and case-insensitive), or the code equals it. */
export function matchesCountry(c: Country, query: string): boolean {
  const q = foldText(query)
  if (!q) return true
  return foldText(c.name).includes(q) || c.code.toLowerCase() === q
}

function compare(locale: string): (a: Country, b: Country) => number {
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base' })
  } catch {
    collator = new Intl.Collator('en', { sensitivity: 'base' })
  }
  return (a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code)
}

/**
 * The picker's two groups for `locale`, each sorted by localised name and
 * filtered by `query`: EU member states first, then every other country.
 */
export function countryGroups(locale: string, query = ''): { eu: Country[]; other: Country[] } {
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).filter((c) => matchesCountry(c, query))
  const sort = compare(locale)
  return { eu: all.filter((c) => EU.has(c.code)).sort(sort), other: all.filter((c) => !EU.has(c.code)).sort(sort) }
}
