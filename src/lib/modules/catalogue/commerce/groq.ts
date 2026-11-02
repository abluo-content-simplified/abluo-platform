// ── Catalogue commerce — GROQ reader fragments (dual-read, C10-4 / C5-5) ──────
//
// The same rule as commerceOf, in GROQ: a non-empty `formats` array wins;
// otherwise the legacy `offers[]`. `select()` rather than `coalesce()` so an
// empty `formats: []` written next to legacy offers cannot hide them
// (coalesce treats [] as a value), exactly as commerceOf does.
// Reserved price fields (currency, locationKey) are never projected.

/** True when the document's commerce lives in `formats` (else legacy offers). */
const HAS_FORMATS = 'count(formats) > 0'

/** Every price amount of the document (formats, else legacy offers). Used by the D7 currency-change warning. */
export const COMMERCE_PRICE_AMOUNTS_GROQ = `select(${HAS_FORMATS} => formats[].prices[defined(amount)].amount, offers[defined(price)].price)`

/** All price amounts, undefined filtered in TS (dashboard list "from" price). */
export const COMMERCE_PRICES_GROQ = `select(${HAS_FORMATS} => formats[].prices[].amount, offers[].price)`

/** Number of stored price rows (formats, else legacy offers). */
export const COMMERCE_PRICE_COUNT_GROQ = `select(${HAS_FORMATS} => count(formats[].prices[]), count(coalesce(offers, [])))`

/** D-21 option-item picker: the version carries at least one price on any format (an item with a price qualifies even when unavailable on a channel). */
export const COMMERCE_HAS_PRICE_GROQ = `(${COMMERCE_PRICE_COUNT_GROQ}) > 0`
