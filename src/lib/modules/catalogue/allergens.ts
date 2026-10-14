// ── The fourteen EU allergens — a platform constant (ADR-033 §3, C3) ─────────
//
// Regulation (EU) No 1169/2011, Annex II, in the Annex's order. A closed legal
// list: no tenant may extend it and NO CONFIGURATION MAY HIDE ONE — hiding a
// declarable allergen to reduce clutter is a compliance risk, not a UX choice.
//
// The keys are stable machine values stored on `catalogueItem.allergenDeclaration` and
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

// ── Allergen declaration (ADR-033 D-3) ────────────────────────────────────────
//
// A food-or-drink item carries an EXPLICIT declaration. An empty list never
// means "none": "none declared" is its own status and needs a confirmation.
// No safety claim is ever inferred from any of this ("allergen-free",
// "gluten-free", vegan …) — the website prints only what was declared.
//
//   notReviewed               the editor has not reviewed it yet — BLOCKS publishing
//   containsListedAllergens   ≥ 1 allergen; "may contain" kept separate
//   noneDeclared              confirmed: true — no allergen from the EU list declared
//
// `note` is localizedText (locale → text), shown with the declaration.

export const ALLERGEN_DECLARATION_STATUSES = ['notReviewed', 'containsListedAllergens', 'noneDeclared'] as const
export type AllergenDeclarationStatus = (typeof ALLERGEN_DECLARATION_STATUSES)[number]

/** Localized text as stored (Sanity localizedText: `_type` plus locale keys). */
export type AllergenNote = Record<string, string>

export type AllergenDeclaration =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[]; note?: AllergenNote }
  | { status: 'noneDeclared'; confirmed: true; mayContain?: AllergenKey[]; note?: AllergenNote }

export type AllergenDeclarationIssue =
  | 'missing'
  | 'notReviewed'
  | 'unknownStatus'
  | 'unknownKey'
  | 'noAllergens'
  | 'notConfirmed'
  | 'unexpectedField'

/**
 * Every key the declaration type knows. A key of ANOTHER status (left behind
 * when Studio switches status and hides the field) is tolerated — the server
 * rebuilds the object with only the status's own fields, and the website reads
 * only those; a key the type does not know at all is refused.
 */
const DECLARATION_FIELDS: ReadonlySet<string> = new Set(['status', 'allergens', 'mayContain', 'confirmed', 'note'])

/**
 * Everything wrong with a stored declaration, for Studio validation and the
 * server's publish check. `notReviewed` is reported as an issue: it is a valid
 * DRAFT state but never a publishable one. Sanity's own keys (`_type`,
 * `_key`) are ignored; any other unknown key is refused.
 */
export function allergenDeclarationIssues(value: unknown, opts: { note?: boolean } = {}): AllergenDeclarationIssue[] {
  const allowNote = opts.note !== false
  if (value == null) return ['missing']
  if (typeof value !== 'object' || Array.isArray(value)) return ['unknownStatus']
  const v = value as Record<string, unknown>
  const status = v.status as AllergenDeclarationStatus
  if (!ALLERGEN_DECLARATION_STATUSES.includes(status)) return ['unknownStatus']
  const out: AllergenDeclarationIssue[] = []
  for (const k of Object.keys(v)) if (!k.startsWith('_') && (!DECLARATION_FIELDS.has(k) || (k === 'note' && !allowNote))) out.push('unexpectedField')
  if (status === 'notReviewed') out.push('notReviewed')
  if (status === 'containsListedAllergens') {
    const list = Array.isArray(v.allergens) ? v.allergens : null
    const may = v.mayContain == null ? [] : Array.isArray(v.mayContain) ? v.mayContain : null
    if (!list || !may) out.push('unknownKey')
    else {
      if (unknownAllergenKeys(list).length || unknownAllergenKeys(may).length) out.push('unknownKey')
      if (list.filter(isAllergenKey).length === 0) out.push('noAllergens')
    }
  }
  if (status === 'noneDeclared') {
    // E-1: "none declared" may still carry "may contain" (cross-contamination).
    const may = v.mayContain == null ? [] : Array.isArray(v.mayContain) ? v.mayContain : null
    if (!may || unknownAllergenKeys(may).length) out.push('unknownKey')
    if (v.confirmed !== true) out.push('notConfirmed')
  }
  return [...new Set(out)]
}

/** The declaration a publish may carry: valid and reviewed. */
export function isPublishableDeclaration(value: unknown): value is Exclude<AllergenDeclaration, { status: 'notReviewed' }> {
  return allergenDeclarationIssues(value).length === 0
}

/** Human text for Studio validation (English: Studio is the platform owner's tool). */
export function describeDeclarationIssue(issue: AllergenDeclarationIssue): string {
  switch (issue) {
    case 'missing':
    case 'notReviewed':
      return 'Review the allergens before publishing: choose "Contains allergens" or confirm "None of the fourteen EU allergens".'
    case 'unknownStatus':
      return 'Unknown allergen declaration.'
    case 'unknownKey':
      return 'Unknown allergen key.'
    case 'noAllergens':
      return '"Contains allergens" needs at least one allergen. If there are none, confirm "None of the fourteen EU allergens" instead.'
    case 'notConfirmed':
      return '"None of the fourteen EU allergens" must be confirmed explicitly.'
    case 'unexpectedField':
      return 'This declaration has a field the allergen declaration does not know.'
  }
}

/** Annex II order, deduplicated, known keys only. */
export function orderedAllergens(values: readonly unknown[] | null | undefined): AllergenKey[] {
  const present = new Set((values ?? []).filter(isAllergenKey))
  return ALLERGENS.filter((a) => present.has(a))
}

// ── Option choices (ADR-033 D-3a) ─────────────────────────────────────────────
//
// An extra can change what is on the plate, so a choice carries the same
// explicit-state declaration as an item — without a note. A choice LINKED to a
// catalogue item derives its declaration from that item; a `remove` choice
// never subtracts the item's base allergens and carries none. A FREE-TEXT
// `add` choice needs its own reviewed declaration wherever a food-or-drink item
// uses the list; on a product or service it is irrelevant.

export type OptionAllergenDeclaration =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[] }
  | { status: 'noneDeclared'; confirmed: true; mayContain?: AllergenKey[] }

/** As allergenDeclarationIssues, for a choice: there is no note. */
export function optionDeclarationIssues(value: unknown): AllergenDeclarationIssue[] {
  return allergenDeclarationIssues(value, { note: false })
}

type RawChoice = { _key?: unknown; kind?: unknown; item?: unknown; label?: unknown; allergenDeclaration?: unknown }

/** A free-text `add` choice — the only kind that carries its own declaration. */
export function isFreeTextAddChoice(choice: RawChoice | null | undefined): boolean {
  if (!choice || typeof choice !== 'object') return false
  const linked = typeof (choice.item as { _ref?: unknown } | null | undefined)?._ref === 'string'
  return choice.kind !== 'remove' && !linked
}

/** Free-text `add` choices whose declaration is not publishable (D-3a) — they block a food item's publish. */
export function unreviewedChoices(options: readonly RawChoice[] | null | undefined): RawChoice[] {
  return (options ?? []).filter((o) => isFreeTextAddChoice(o) && optionDeclarationIssues(o.allergenDeclaration).length > 0)
}
