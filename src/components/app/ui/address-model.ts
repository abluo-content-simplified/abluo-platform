/**
 * Pure parsing behind AddressAutocomplete (Google Places API (New)): the
 * autocomplete response → suggestions, and a place's addressComponents → our
 * address fields. No I/O; the component does the requests.
 */

/** Suggestions are asked for from this many typed characters. */
export const ADDRESS_MIN_QUERY = 3

export type AddressSuggestion = {
  placeId: string
  /** Main line, e.g. "Via Roma 1". */
  primary: string
  /** Second line, e.g. "Cervia RA, Italia". */
  secondary: string
}

/** What a picked place fills in. null = the place does not say. */
export type ParsedAddress = {
  addressLine1: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  /** ISO 3166-1 alpha-2, upper-case. */
  country: string | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const textOf = (v: unknown): string => (isObject(v) ? str(v.text) : '')

/** `places:autocomplete` JSON → suggestions (place predictions only; anything malformed is skipped). */
export function parseSuggestions(json: unknown): AddressSuggestion[] {
  if (!isObject(json) || !Array.isArray(json.suggestions)) return []
  const out: AddressSuggestion[] = []
  for (const s of json.suggestions) {
    const p = isObject(s) ? s.placePrediction : null
    if (!isObject(p)) continue
    const placeId = str(p.placeId)
    if (!placeId) continue
    const structured = isObject(p.structuredFormat) ? p.structuredFormat : null
    const primary = textOf(structured?.mainText) || textOf(p.text)
    if (!primary) continue
    out.push({ placeId, primary, secondary: textOf(structured?.secondaryText) })
  }
  return out
}

/** Countries that write the house number before the street ("10 Downing Street"); everywhere else it follows ("Via Roma 1"). */
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'FR', 'AU', 'NZ', 'IN', 'ZA', 'SG', 'MY', 'PH', 'IL', 'HK', 'LU', 'MC'])

/** Street line in the country's order: "Via Roma 1" (IT, DE, …) or "1600 Amphitheatre Pkwy" (US, GB, FR, …). */
export function formatStreetLine(route: string | null, streetNumber: string | null, country: string | null): string | null {
  const r = route?.trim() || null
  const n = streetNumber?.trim() || null
  if (!r) return n
  if (!n) return r
  return country && NUMBER_FIRST.has(country.toUpperCase()) ? `${n} ${r}` : `${r} ${n}`
}

/** Countries whose state/province is written as its short code. */
const REGION_SHORT = new Set(['US', 'CA', 'AU', 'BR', 'MX'])

/**
 * A place's `addressComponents` (Places API (New): `{ longText, shortText, types }`)
 * → line 1, postal code, city, region and country.
 *  - city: locality, else postal_town, else administrative_area_level_3
 *  - region: IT → the province code (administrative_area_level_2 short, e.g. "RA");
 *    otherwise administrative_area_level_1 (short code for US/CA/AU/BR/MX)
 */
export function parseAddressComponents(components: unknown): ParsedAddress {
  const list = Array.isArray(components) ? components.filter(isObject) : []
  const find = (type: string) => list.find((c) => Array.isArray(c.types) && c.types.includes(type))
  const long = (type: string) => str(find(type)?.longText) || str(find(type)?.shortText) || null
  const short = (type: string) => str(find(type)?.shortText) || str(find(type)?.longText) || null

  const countryRaw = short('country')?.toUpperCase() ?? null
  const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null
  const route = long('route')
  const line1 = formatStreetLine(route, long('street_number'), country) ?? long('premise')
  const city = long('locality') ?? long('postal_town') ?? long('administrative_area_level_3')
  const region =
    country === 'IT'
      ? (short('administrative_area_level_2') ?? long('administrative_area_level_1'))
      : country && REGION_SHORT.has(country)
        ? short('administrative_area_level_1')
        : long('administrative_area_level_1')

  return { addressLine1: line1, postalCode: long('postal_code'), city, region, country }
}

/** `GET places/{id}` JSON → parsed address (empty when malformed). */
export function parsePlaceDetails(json: unknown): ParsedAddress {
  return parseAddressComponents(isObject(json) ? json.addressComponents : null)
}
