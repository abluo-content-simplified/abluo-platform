// ── The fourteen EU allergens — a platform constant (ADR-033 §3, C3) ─────────
//
// Regulation (EU) No 1169/2011, Annex II, in the Annex's order. A closed legal
// list: no tenant may extend it and NO CONFIGURATION MAY HIDE ONE — hiding a
// declarable allergen to reduce clutter is a compliance risk, not a UX choice.
//
// The keys are stable machine values stored on `catalogueItem.allergens[]` and
// are never shown. Labels live in messages/{locale}.json under
// `catalogue.allergens.<key>`; a test keeps every locale complete.

export const ALLERGENS = Object.freeze([
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'treeNuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const)

export type AllergenKey = (typeof ALLERGENS)[number]

const KEYS: ReadonlySet<string> = new Set(ALLERGENS)

export function isAllergenKey(value: unknown): value is AllergenKey {
  return typeof value === 'string' && KEYS.has(value)
}

/** Unknown keys (imported or legacy data) — reported by validation, never silently dropped. */
export function unknownAllergenKeys(values: readonly unknown[] | undefined | null): unknown[] {
  return (values ?? []).filter((v) => !isAllergenKey(v))
}
