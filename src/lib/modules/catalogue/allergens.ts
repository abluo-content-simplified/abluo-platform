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

// ── Review evidence (C13 §13.1) — READ tolerantly from R1, written by the allergen slice ──
//
// `review` is optional ONLY for legacy declarations (stored before C13): a
// reviewed status without `review` stays publishable (nothing is unpublished,
// no data migration) and is reported by the recommended readiness rule
// `allergenEvidenceMissing` once the allergen slice activates it. Nothing in
// R1 writes any of these fields (C10-6 R1 row, C13 §13.7).

export const REVIEW_BASES = ['recipe', 'supplierLabel', 'technicalSheet', 'riskAssessment', 'other'] as const
export type ReviewBasis = (typeof REVIEW_BASES)[number]

export type AllergenReview = {
  reviewedBy: string
  reviewedAt: string
  basis: ReviewBasis
  basisNote?: string
  mayContainRiskAssessment?: { confirmed: true; confirmedBy: string; confirmedAt: string }
  declarationVersion: number
  contentFingerprint: string
  linked?: ReadonlyArray<{ choiceKey: string; itemId: string; fingerprint: string }>
}

/** D-16 "Reset when", one cause per clause (C13 §13.1). */
export const ALLERGEN_INVALIDATION_CAUSES = [
  'profileChangedToFood',
  'optionListAttached',
  'freeTextChoiceAdded',
  'freeTextChoiceEdited',
  'choiceChangedToAdd',
  'linkedChoiceTargetChanged',
  'linkedItemChanged',
  'declarationStatusChanged',
  'reviewBasisDataChanged',
] as const
export type AllergenInvalidationCause = (typeof ALLERGEN_INVALIDATION_CAUSES)[number]

export type AllergenDeclaration =
  | { status: 'notReviewed'; invalidation?: { cause: AllergenInvalidationCause; at: string } }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[]; note?: AllergenNote; review?: AllergenReview }
  | { status: 'noneDeclared'; confirmed: true; mayContain?: AllergenKey[]; note?: AllergenNote; review?: AllergenReview }

/** C13 §13.1 — a system-created compliance task on the item (`catalogueItem.complianceTasks`). Read-only in R1. */
export type ComplianceTask = {
  _key: string
  taskId: string
  kind: 'allergenReview'
  reason: 'linkedItemChanged'
  linkedItemId: string
  choiceKeys: string[]
  createdAt: string
  createdBy: 'system'
  carriedDraft: boolean
  resolvedAt?: string
}

export type AllergenDeclarationIssue =
  | 'missing'
  | 'notReviewed'
  | 'unknownStatus'
  | 'unknownKey'
  | 'noAllergens'
  | 'notConfirmed'
  | 'unexpectedField'
  // C13 §13.5 — only ever reported for a declaration that HAS a `review` block:
  | 'reviewShape' // the review evidence itself is malformed (gate: integrity.declarationShape)
  | 'mayContainNotAssessed' // "may contain" without the risk-assessment confirmation
  | 'editedOutsideReview' // content changed after the review (fingerprint mismatch)

/**
 * Every key the declaration type knows. A key of ANOTHER status (left behind
 * when Studio switches status and hides the field) is tolerated — the server
 * rebuilds the object with only the status's own fields, and the website reads
 * only those; a key the type does not know at all is refused.
 */
// C13 (§13.1, C10-6 R1): `review`, `invalidation` and `declarationVersion` are
// known keys — tolerated on any status, like the other status's fields.
const DECLARATION_FIELDS: ReadonlySet<string> = new Set(['status', 'allergens', 'mayContain', 'confirmed', 'note', 'review', 'invalidation', 'declarationVersion'])
const REVIEW_FIELDS: ReadonlySet<string> = new Set(['reviewedBy', 'reviewedAt', 'basis', 'basisNote', 'mayContainRiskAssessment', 'declarationVersion', 'contentFingerprint', 'linked'])

/**
 * Everything wrong with a stored declaration, for Studio validation and the
 * server's publish check. `notReviewed` is reported as an issue: it is a valid
 * DRAFT state but never a publishable one. Sanity's own keys (`_type`,
 * `_key`) are ignored; any other unknown key is refused.
 */
export function allergenDeclarationIssues(value: unknown, opts: { note?: boolean; defaultLocale?: string } = {}): AllergenDeclarationIssue[] {
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
  // C13 — the evidence, judged only when present. Legacy declarations carry
  // none and are judged exactly as before (no new issue can appear for them).
  if (v.declarationVersion != null && !isPositiveInt(v.declarationVersion)) out.push('reviewShape')
  if (status !== 'notReviewed' && v.review != null) {
    const review = v.review
    if (!isReviewShape(review)) out.push('reviewShape')
    else {
      const may = Array.isArray(v.mayContain) ? v.mayContain : []
      if (may.length > 0 && review.mayContainRiskAssessment?.confirmed !== true) out.push('mayContainNotAssessed')
      // Needs the site's default locale (the note's reviewed language); callers that do not know it skip this check.
      if (opts.defaultLocale && contentFingerprint(v, { defaultLocale: opts.defaultLocale }) !== review.contentFingerprint) out.push('editedOutsideReview')
    }
  }
  return [...new Set(out)]
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1
const isIso = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))
const isId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128

/** C13 §13.5 `reviewShape`: reviewer id, server date, basis, version and fingerprint as the review service writes them. */
function isReviewShape(value: unknown): value is AllergenReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  for (const k of Object.keys(r)) if (!k.startsWith('_') && !REVIEW_FIELDS.has(k)) return false
  if (!isId(r.reviewedBy) || !isIso(r.reviewedAt) || !isPositiveInt(r.declarationVersion) || !isId(r.contentFingerprint)) return false
  if (!(REVIEW_BASES as readonly unknown[]).includes(r.basis)) return false
  if (r.basisNote != null && (r.basis !== 'other' || typeof r.basisNote !== 'string' || r.basisNote.length > 120)) return false
  if (r.mayContainRiskAssessment != null) {
    const m = r.mayContainRiskAssessment as Record<string, unknown>
    if (typeof m !== 'object' || m.confirmed !== true || !isId(m.confirmedBy) || !isIso(m.confirmedAt)) return false
  }
  if (r.linked != null) {
    if (!Array.isArray(r.linked)) return false
    for (const l of r.linked as Array<Record<string, unknown> | null>) if (!l || !isId(l.choiceKey) || !isId(l.itemId) || !isId(l.fingerprint)) return false
  }
  return true
}

/**
 * C13 §13.2 — the fingerprint of the declaration CONTENT as reviewed: status,
 * sorted "contains", sorted "may contain", the "none" confirmation and the
 * default-locale note. Other locales of the note are not part of it
 * (translation-only edits never reset). Pure and synchronous, so Studio, the
 * browser and the server compute the same value; the review service (allergen
 * slice) writes it, the reader compares it.
 */
export function contentFingerprint(decl: unknown, opts: { defaultLocale: string }): string {
  const v = (decl && typeof decl === 'object' ? decl : {}) as Record<string, unknown>
  const sorted = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((k): k is string => typeof k === 'string'))].sort() : [])
  const note = v.note && typeof v.note === 'object' ? (v.note as Record<string, unknown>)[opts.defaultLocale] : undefined
  const canonical = JSON.stringify([
    typeof v.status === 'string' ? v.status : null,
    v.status === 'containsListedAllergens' ? sorted(v.allergens) : [],
    sorted(v.mayContain),
    v.status === 'noneDeclared' ? v.confirmed === true : null,
    typeof note === 'string' ? note.trim() : '',
  ])
  return `fp1-${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x050c5d1f)}`
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. Not a security hash: an edit detector. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
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
    case 'reviewShape':
      return 'The recorded allergen review is incomplete or malformed. Review the allergens again.'
    case 'mayContainNotAssessed':
      return '"May contain" needs a confirmed risk assessment. Review the allergens again.'
    case 'editedOutsideReview':
      return 'The allergens were changed after they were reviewed. Review them again.'
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
  | { status: 'notReviewed'; invalidation?: { cause: AllergenInvalidationCause; at: string } }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[]; review?: AllergenReview }
  | { status: 'noneDeclared'; confirmed: true; mayContain?: AllergenKey[]; review?: AllergenReview }

/** As allergenDeclarationIssues, for a choice: there is no note. */
export function optionDeclarationIssues(value: unknown, opts: { defaultLocale?: string } = {}): AllergenDeclarationIssue[] {
  return allergenDeclarationIssues(value, { ...opts, note: false })
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

// ── Support-mode guard: does a write change allergen content? ────────────────

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([k, x]) => !k.startsWith('_') && x !== undefined && x !== null && !(Array.isArray(x) && x.length === 0))
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canonical(x)]))
  }
  return v
}
/** A bare "not reviewed" declaration says nothing: it equals no declaration (new choices start with it). */
const declarationText = (d: unknown): string => {
  const c = canonical(d ?? null)
  const bare = !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 1 && (c as Record<string, unknown>).status === 'notReviewed'
  return JSON.stringify(bare ? null : c)
}

/**
 * True when going from `before` to `after` changes allergen content: an item's
 * `allergenDeclaration`, or the declaration of an option-list choice present in `after` (matched
 * by `_key`; removing a whole choice is not an allergen edit). `after` is the document as it would
 * be written. Used to run `item.editAllergenContent` (refused in support mode) on saves and publishes.
 */
export function allergenContentChanged(kind: 'item' | 'collection' | 'optionList', before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): boolean {
  if (kind === 'item') return declarationText(before?.allergenDeclaration) !== declarationText(after.allergenDeclaration)
  if (kind !== 'optionList') return false
  const list = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown> | null>) : []).filter((o): o is Record<string, unknown> => !!o && typeof o._key === 'string')
  const previous = new Map(list(before?.options).map((o) => [o._key as string, o.allergenDeclaration]))
  return list(after.options).some((o) => declarationText(previous.get(o._key as string)) !== declarationText(o.allergenDeclaration))
}
