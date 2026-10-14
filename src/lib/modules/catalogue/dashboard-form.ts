// ── Catalogue — client dashboard form logic (pure, browser-safe) ──────────────
//
// Authority: ADR-033 (D2, D3, D6, D7, D12, A1–A4, A7), spec §10–§11,
// content-wizard-spec (one decision per screen).
//
// Everything the item wizard, the item editor, the collection builder and the
// option-list editor decide WITHOUT the server: which steps exist, when Next is
// allowed, how a typed price becomes a number, how the offers screen maps to
// stored offers, what a gap is, and the section-tree edits of the builder. No
// I/O, no React — the server re-validates every value (dashboard-patch.ts).

import { slugifyNestedPath } from '@/lib/sanity/fields/nested-slug'
import { offerIssues, type Offer, type OfferIssue } from './offers'
import { ruleIssues, WEEKDAYS, type Weekday } from './availability'
import { isDescendant, moveSection, readingOrder, removeSection, subtreeOf, type SectionNode } from './sections'
import { orderedAllergens, type AllergenDeclarationStatus, type AllergenKey } from './allergens'

/** ADR-033 D-2 — what the ITEM is (not the tenant). */
export type ItemProfile = 'foodOrDrink' | 'product' | 'service'
export const ITEM_PROFILES: readonly ItemProfile[] = ['foodOrDrink', 'product', 'service']
export const isItemProfile = (v: unknown): v is ItemProfile => ITEM_PROFILES.includes(v as ItemProfile)
export type CollectionType = 'menu' | 'list'
export const COLLECTION_TYPES: readonly CollectionType[] = ['menu', 'list']
export type Visibility = 'public' | 'websiteOnly' | 'unlisted'
export const VISIBILITIES: readonly Visibility[] = ['public', 'websiteOnly', 'unlisted']
export type OptionKind = 'add' | 'remove'

/** Localized text as the dashboard edits it: locale → string. */
export type Texts = Record<string, string>

// ── Prices ────────────────────────────────────────────────────────────────────

/**
 * A typed price → a number, or null when it is not one. Accepts "8", "8.5",
 * "8,50" (decimal comma) and surrounding spaces; refuses negatives (unless
 * `signed`, for option price changes), more than two decimals, and thousands
 * separators (ambiguous between locales).
 */
export function parsePrice(input: string, opts: { signed?: boolean } = {}): number | null {
  const s = input.trim().replace(/\s+/g, '')
  const re = opts.signed ? /^[+-]?\d{1,7}(?:[.,]\d{1,2})?$/ : /^\d{1,7}(?:[.,]\d{1,2})?$/
  if (!re.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** A stored amount back into the input ("8.5" → "8.50"); '' for none. */
export function priceText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : ''
}

// ── Offers (spec §4.2, ADR-033 A2/A3) ─────────────────────────────────────────

export type AvailabilityForm = { key: string; days: Weekday[]; from: string; to: string }
export type OfferForm = {
  /** The offer's `_key` — its stable identity (D14); never regenerated. */
  key: string
  /** null = unscoped ("everywhere", A2). */
  channel: string | null
  price: string
  availability: AvailabilityForm[]
}

/** Stored offer shape (catalogueOffer). `currency` / `locationKey` are reserved and never written here. */
export type OfferDoc = {
  _key: string
  _type: 'catalogueOffer'
  channel?: string
  price: number
  availability?: { _key: string; _type: 'catalogueAvailability'; days?: string[]; from?: string; to?: string }[]
}

type RawOffer = { _key?: unknown; channel?: unknown; price?: unknown; availability?: unknown }

export function offerFormsFromDoc(offers: unknown): OfferForm[] {
  if (!Array.isArray(offers)) return []
  return (offers as RawOffer[])
    .filter((o) => o && typeof o === 'object' && typeof o._key === 'string')
    .map((o) => ({
      key: o._key as string,
      channel: typeof o.channel === 'string' && o.channel ? o.channel : null,
      price: priceText(typeof o.price === 'number' ? o.price : null),
      availability: (Array.isArray(o.availability) ? o.availability : []).map((a: Record<string, unknown>, i: number) => ({
        key: typeof a?._key === 'string' ? a._key : `a${i}`,
        days: (Array.isArray(a?.days) ? a.days : []).filter((d: unknown): d is Weekday => WEEKDAYS.includes(d as Weekday)),
        from: typeof a?.from === 'string' ? a.from : '',
        to: typeof a?.to === 'string' ? a.to : '',
      })),
    }))
}

/** Rows with a price become stored offers; empty rows are simply "not sold that way". */
export function offersToDoc(forms: readonly OfferForm[]): OfferDoc[] {
  const out: OfferDoc[] = []
  for (const f of forms) {
    const price = parsePrice(f.price)
    if (price === null) continue
    const availability = f.availability
      .filter((a) => a.days.length || a.from || a.to)
      .map((a) => ({
        _key: a.key,
        _type: 'catalogueAvailability' as const,
        ...(a.days.length ? { days: WEEKDAYS.filter((d) => a.days.includes(d)) } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
      }))
    out.push({
      _key: f.key,
      _type: 'catalogueOffer',
      ...(f.channel ? { channel: f.channel } : {}),
      price,
      ...(availability.length ? { availability } : {}),
    })
  }
  return out
}

/**
 * The offers screen: one row per configured channel, plus the unscoped
 * "everywhere" row — existing offers first (in their stored order inside each
 * scope), an empty row for a scope with none. Extra offers on one scope (a
 * lunch and a dinner price) stay as their own rows.
 */
export function offerRows(forms: readonly OfferForm[], channels: readonly string[], newKey: () => string): OfferForm[] {
  const rows: OfferForm[] = []
  for (const scope of [...channels, null] as (string | null)[]) {
    const mine = forms.filter((f) => f.channel === scope)
    if (mine.length) rows.push(...mine)
    else rows.push({ key: newKey(), channel: scope, price: '', availability: [] })
  }
  // Offers on a channel that is no longer configured stay visible (they need fixing, not hiding).
  rows.push(...forms.filter((f) => f.channel !== null && !channels.includes(f.channel)))
  return rows
}

export type OfferFormIssue =
  | { kind: 'invalidPrice'; key: string }
  | { kind: 'invalidTime'; key: string }
  | { kind: 'zeroLength'; key: string }
  | { kind: 'incompleteWindow'; key: string }
  | OfferIssue

/** Everything that blocks saving these offers (spec §11) — the server checks the same. */
export function offerFormIssues(forms: readonly OfferForm[], channels: readonly string[]): OfferFormIssue[] {
  const issues: OfferFormIssue[] = []
  for (const f of forms) {
    const hasTimes = f.availability.some((a) => a.days.length || a.from || a.to)
    if (f.price.trim() === '') {
      continue
    }
    if (parsePrice(f.price) === null) issues.push({ kind: 'invalidPrice', key: f.key })
    if (!hasTimes) continue
    for (const a of f.availability) {
      for (const i of ruleIssues({ days: a.days, from: a.from || null, to: a.to || null })) {
        if (i.kind === 'invalidTime') issues.push({ kind: 'invalidTime', key: f.key })
        else if (i.kind === 'zeroLengthWindow') issues.push({ kind: 'zeroLength', key: f.key })
        else if (i.kind === 'incompleteWindow') issues.push({ kind: 'incompleteWindow', key: f.key })
      }
    }
  }
  if (issues.length) return issues
  return offerIssues(offersToDoc(forms) as Offer[], channels)
}

/** True when an overnight window wraps past midnight (18:00–02:00) — legal, shown as a hint (A1). */
export function wrapsMidnight(a: Pick<AvailabilityForm, 'from' | 'to'>): boolean {
  return Boolean(a.from && a.to && a.to < a.from)
}

// ── Option-list attachments (ADR-033 D2) ──────────────────────────────────────

export type AttachmentForm = { key: string; listId: string; min: number; max: number | null }

export type AttachmentIssue = { kind: 'minAboveMax'; key: string } | { kind: 'maxAboveOptions'; key: string; options: number } | { kind: 'missingList'; key: string }

/**
 * `min > max` blocks saving; `max` larger than the list warns only (the list
 * may grow); a list that no longer exists is reported (the editor warns).
 */
export function attachmentIssues(atts: readonly AttachmentForm[], optionCounts: ReadonlyMap<string, number>): AttachmentIssue[] {
  const out: AttachmentIssue[] = []
  for (const a of atts) {
    if (!optionCounts.has(a.listId)) {
      out.push({ kind: 'missingList', key: a.key })
      continue
    }
    if (a.max !== null && a.min > a.max) out.push({ kind: 'minAboveMax', key: a.key })
    const n = optionCounts.get(a.listId) ?? 0
    if (a.max !== null && a.max > n) out.push({ kind: 'maxAboveOptions', key: a.key, options: n })
  }
  return out
}

export const isBlockingAttachmentIssue = (i: AttachmentIssue) => i.kind === 'minAboveMax'

// ── Slugs ─────────────────────────────────────────────────────────────────────

export const CATALOGUE_SLUG_MAX = 80

/** One URL segment from a name (the same rule the server applies on publish). */
export function slugFromName(name: string): string {
  return slugifyNestedPath(name.replace(/\//g, ' '), CATALOGUE_SLUG_MAX).replace(/-+$/, '')
}

/** "/menu/pizza-margherita" — the preview under the project's public segment. */
export function slugPreview(segment: string | null, slug: string): string {
  return `/${[segment, slug].filter(Boolean).join('/')}`
}

// ── Gaps (spec §11: warn, never block) ────────────────────────────────────────

export type ItemGap = 'noPhoto' | 'noPrice' | 'allergensNotReviewed'

export function itemGaps(item: { imageCount: number; offerCount: number; allergensNotReviewed?: boolean }): ItemGap[] {
  const out: ItemGap[] = []
  if (item.imageCount === 0) out.push('noPhoto')
  if (item.offerCount === 0) out.push('noPrice')
  // D-3: the one gap that also BLOCKS publishing.
  if (item.allergensNotReviewed) out.push('allergensNotReviewed')
  return out
}

// ── Item wizard steps (spec §10.3) ────────────────────────────────────────────

/**
 * 'profile' (D-2: "What are you offering?") is ALWAYS the first step; 'details'
 * is the "Food information" step (D-3), for food and drink only.
 */
export type ItemStep = 'profile' | 'name' | 'category' | 'photo' | 'price' | 'details' | 'options' | 'page' | 'languages' | 'preview' | 'publish'

export type ItemWizardContext = {
  /** The chosen profile; null until the editor picks one. */
  itemProfile: ItemProfile | null
  categoryCount: number
  locales: readonly string[]
}

export function itemWizardSteps(c: ItemWizardContext): ItemStep[] {
  const steps: ItemStep[] = ['profile', 'name']
  if (c.categoryCount > 0) steps.push('category')
  steps.push('photo', 'price')
  if (c.itemProfile === 'foodOrDrink') steps.push('details')
  steps.push('options', 'page')
  if (c.locales.length > 1) steps.push('languages')
  steps.push('preview', 'publish')
  return steps
}

/**
 * The profile the wizard preselects: the module setting `defaultItemProfile`
 * (written by a starter preset or an admin, D-1), else none — the editor picks.
 */
export function initialItemProfile(defaultItemProfile: unknown): ItemProfile | null {
  return isItemProfile(defaultItemProfile) ? defaultItemProfile : null
}

export type ItemFormState = {
  itemProfile?: ItemProfile | null
  name: Texts
  offers: readonly OfferForm[]
  options: readonly AttachmentForm[]
  hasPage: boolean
}

/** Whether Next is allowed on a step. The profile and the name are required; every other step can be skipped. */
export function canAdvanceItem(step: ItemStep, s: ItemFormState, defaultLocale: string, ctx: { channels: readonly string[]; optionCounts: ReadonlyMap<string, number> }): boolean {
  if (step === 'profile') return isItemProfile(s.itemProfile)
  if (step === 'name') return Boolean(s.name[defaultLocale]?.trim())
  if (step === 'price') return offerFormIssues(s.offers, ctx.channels).length === 0
  if (step === 'options') return !attachmentIssues(s.options, ctx.optionCounts).some(isBlockingAttachmentIssue)
  return true
}

// ── List status filter (shared vocabulary; archived hidden from "All") ───────

export type CatalogueStatusFilter = 'all' | 'draft' | 'scheduled' | 'published' | 'unpublished' | 'archived'
export const CATALOGUE_STATUS_FILTERS: readonly CatalogueStatusFilter[] = ['all', 'draft', 'scheduled', 'published', 'unpublished', 'archived']

export function inCatalogueStatus(status: Exclude<CatalogueStatusFilter, 'all'>, filter: CatalogueStatusFilter): boolean {
  return filter === 'all' ? status !== 'archived' : status === filter
}

export function parseStatusFilter(value: string | null | undefined): CatalogueStatusFilter {
  return CATALOGUE_STATUS_FILTERS.includes(value as CatalogueStatusFilter) ? (value as CatalogueStatusFilter) : 'all'
}

/** Accent- and case-insensitive search text. */
export function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// ── Collection builder — section tree edits (spec §10.4, ADR-033 D6/A7) ──────

export type SectionForm = SectionNode & {
  _key: string
  parentKey?: string | null
  name: Texts
  /** Item ids, in order. */
  items: string[]
}

/** A new top-level section at the end. */
export function addSection(sections: readonly SectionForm[], key: string, name: Texts = {}): SectionForm[] {
  return [...sections, { _key: key, parentKey: null, name, items: [] }]
}

/**
 * "Add subsection": a new child of `parentKey`, inserted right AFTER that
 * section's existing children (and their descendants) — never at the bottom
 * of the whole list to be dragged back up. Refuses an unknown parent (the
 * editor never creates an orphan).
 */
export function addSubsection(sections: readonly SectionForm[], parentKey: string, key: string, name: Texts = {}): SectionForm[] {
  const block = subtreeOf(sections, parentKey)
  if (!block.length) return [...sections]
  // The last STORED member of the subtree (storage may not be contiguous after Studio edits).
  const members = new Set(block.map((s) => s._key))
  let at = -1
  sections.forEach((s, i) => {
    if (members.has(s._key)) at = i
  })
  const next: SectionForm = { _key: key, parentKey, name, items: [] }
  return [...sections.slice(0, at + 1), next, ...sections.slice(at + 1)]
}

/** What a delete took away, so Undo can put it back where it was. */
export type RemovedSections = { removed: SectionForm[]; index: number }

/** Deletes a section with its subsections (no confirm — spec §10.4); keep the result for Undo. */
export function deleteSection(sections: readonly SectionForm[], key: string): { sections: SectionForm[]; undo: RemovedSections | null } {
  const index = sections.findIndex((s) => s._key === key)
  if (index < 0) return { sections: [...sections], undo: null }
  const r = removeSection(sections, key)
  return { sections: r.sections, undo: { removed: r.removed, index } }
}

/** Undo of `deleteSection`: the removed block goes back at its old position. */
export function undoDelete(sections: readonly SectionForm[], undo: RemovedSections): SectionForm[] {
  const present = new Set(sections.map((s) => s._key))
  const back = undo.removed.filter((s) => !present.has(s._key))
  const at = Math.min(Math.max(0, undo.index), sections.length)
  return [...sections.slice(0, at), ...back, ...sections.slice(at)]
}

const parentOf = (s: SectionNode) => (typeof s.parentKey === 'string' && s.parentKey ? s.parentKey : null)

/** Siblings of a section (same parent), in stored order. */
export function siblingsOf(sections: readonly SectionForm[], key: string): SectionForm[] {
  const me = sections.find((s) => s._key === key)
  if (!me) return []
  const p = parentOf(me)
  return sections.filter((s) => parentOf(s) === p)
}

/** Keyboard reorder: one place up/down among its siblings, its subsections moving with it. */
export function moveSectionBy(sections: readonly SectionForm[], key: string, delta: -1 | 1): SectionForm[] {
  const sibs = siblingsOf(sections, key)
  const i = sibs.findIndex((s) => s._key === key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= sibs.length) return [...sections]
  const me = sibs[i]
  // Up: before the previous sibling. Down: the next sibling moves up before this one.
  if (delta < 0) return moveSection(sections, key, { parentKey: parentOf(me), beforeKey: sibs[j]._key }).sections
  return moveSection(sections, sibs[j]._key, { parentKey: parentOf(me), beforeKey: key }).sections
}

/**
 * Drag reorder: move `key` (with its subtree) to sit just before `beforeKey`
 * among `beforeKey`'s siblings, or to the end of `parentKey`'s children when
 * `beforeKey` is null. Cycles are refused (input returned unchanged).
 */
export function dropSection(sections: readonly SectionForm[], key: string, target: { parentKey: string | null; beforeKey: string | null }): SectionForm[] {
  if (target.beforeKey === key) return [...sections]
  // Into its own subtree (or onto an unknown parent): refused, unchanged.
  if (target.parentKey !== null && (!sections.some((s) => s._key === target.parentKey) || isDescendant(sections, key, target.parentKey))) return [...sections]
  if (target.beforeKey) return moveSection(sections, key, { parentKey: target.parentKey, beforeKey: target.beforeKey }).sections
  // End of the parent's children: before whatever follows the parent's block (top level: the very end).
  if (target.parentKey === null) return moveSection(sections, key, { parentKey: null, beforeKey: null }).sections
  const block = subtreeOf(sections, target.parentKey).filter((s) => !subtreeOf(sections, key).some((b) => b._key === s._key))
  const last = block[block.length - 1]
  const rest = sections.filter((s) => !subtreeOf(sections, key).some((b) => b._key === s._key))
  const idx = rest.findIndex((s) => s._key === last._key)
  const following = rest[idx + 1]
  return moveSection(sections, key, { parentKey: target.parentKey, beforeKey: following ? following._key : null }).sections
}

/** The builder's guidance: depth (0 = top) per section; `deep` beyond 3 levels warns (D6). */
export const SECTION_DEPTH_WARNING = 3
export function sectionDepths(sections: readonly SectionForm[]): Map<string, number> {
  return readingOrder(sections).depth
}

/**
 * Sections whose `parentKey` is NEW and names no section — what the editor
 * refuses to create (A7). A pre-existing orphan (same key, same parentKey as
 * before) is reported elsewhere, not refused, so broken content stays visible.
 */
export function newOrphans(previous: readonly SectionNode[], next: readonly SectionNode[]): string[] {
  const keys = new Set(next.map((s) => s._key))
  const before = new Map(previous.map((s) => [s._key, parentOf(s)]))
  return next
    .filter((s) => {
      const p = parentOf(s)
      if (p === null || keys.has(p)) return false
      return !(before.has(s._key) && before.get(s._key) === p)
    })
    .map((s) => s._key)
}

// ── Document → form state (the editors start from the stored draft) ─────────

/** A localized field as locale → text (Sanity's `_type` and empty values dropped). */
export function textsOf(value: unknown): Texts {
  const out: Texts = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!k.startsWith('_') && typeof v === 'string') out[k] = v
  return out
}

/** A localizedSlug as locale → current. */
export function slugTextsOf(value: unknown): Texts {
  const out: Texts = {}
  if (!value || typeof value !== 'object') return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = (v as { current?: unknown } | null)?.current
    if (!k.startsWith('_') && typeof c === 'string') out[k] = c
  }
  return out
}

const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const refsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((r) => (r as { _ref?: unknown } | null)?._ref).filter((r): r is string => typeof r === 'string') : [])

export function attachmentsFromDoc(value: unknown): AttachmentForm[] {
  if (!Array.isArray(value)) return []
  return value
    .map((a, i) => {
      const r = a as { _key?: unknown; list?: { _ref?: unknown }; min?: unknown; max?: unknown }
      const listId = typeof r?.list?._ref === 'string' ? r.list._ref : ''
      return {
        key: typeof r?._key === 'string' ? r._key : `att${i}`,
        listId,
        min: typeof r?.min === 'number' ? r.min : 0,
        max: typeof r?.max === 'number' ? r.max : null,
      }
    })
    .filter((a) => a.listId)
}

/** What the autosave sends for `optionLists` (the server rebuilds the stored shape). */
export function attachmentsPatch(atts: readonly AttachmentForm[]) {
  return atts.map((a) => ({ _key: a.key, listId: a.listId, min: a.min, max: a.max }))
}

// ── Allergen declaration (ADR-033 D-3) ────────────────────────────────────────

/** The "Food information" form. Partial states save; publishing needs a complete one. */
export type DeclarationForm = {
  status: AllergenDeclarationStatus
  allergens: AllergenKey[]
  mayContain: AllergenKey[]
  confirmed: boolean
  note: Texts
}

export const NOT_REVIEWED: DeclarationForm = Object.freeze({ status: 'notReviewed', allergens: [], mayContain: [], confirmed: false, note: {} }) as DeclarationForm

export function declarationFormFromDoc(value: unknown): DeclarationForm {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const status = v.status === 'containsListedAllergens' || v.status === 'noneDeclared' ? v.status : 'notReviewed'
  return {
    status,
    allergens: orderedAllergens(Array.isArray(v.allergens) ? v.allergens : []),
    mayContain: orderedAllergens(Array.isArray(v.mayContain) ? v.mayContain : []),
    confirmed: v.confirmed === true,
    note: textsOf(v.note),
  }
}

/** What the autosave sends for `allergenDeclaration` (the server rebuilds the stored shape). */
export function declarationPatch(f: DeclarationForm): Record<string, unknown> {
  if (f.status === 'notReviewed') return { status: 'notReviewed' }
  if (f.status === 'noneDeclared') return { status: 'noneDeclared', confirmed: f.confirmed, mayContain: f.mayContain, note: f.note }
  return { status: 'containsListedAllergens', allergens: f.allergens, mayContain: f.mayContain, note: f.note }
}

/** A choice's declaration (D-3a): the item's shape without the note. */
export function optionDeclarationPatch(f: DeclarationForm): Record<string, unknown> {
  const { note: _note, ...rest } = declarationPatch(f)
  void _note
  return rest
}

export type DeclarationIssue = 'notReviewed' | 'noAllergens' | 'notConfirmed'

/** What still blocks publishing a food item (the server and Studio check the same). */
export function declarationIssues(f: DeclarationForm): DeclarationIssue[] {
  if (f.status === 'notReviewed') return ['notReviewed']
  if (f.status === 'containsListedAllergens' && f.allergens.length === 0) return ['noAllergens']
  if (f.status === 'noneDeclared' && !f.confirmed) return ['notConfirmed']
  return []
}

/**
 * D-7 — which site languages have NO page address because the name is not
 * written in them ("Not translated" in the dashboard). Never the main language
 * (a page needs it, the publish refuses without it).
 */
export function untranslatedLocales(name: Texts, locales: readonly string[], defaultLocale: string): string[] {
  return locales.filter((l) => l !== defaultLocale && !name[l]?.trim())
}

export type ItemState = {
  /** null only in the wizard, before "What are you offering?" is answered. */
  itemProfile: ItemProfile | null
  name: Texts
  description: Texts
  categories: string[]
  imageIds: string[]
  offers: OfferForm[]
  allergenDeclaration: DeclarationForm
  dietary: string[]
  options: AttachmentForm[]
  hasPage: boolean
  slug: Texts
  visibility: Visibility
}

export function itemStateFromDoc(doc: Record<string, unknown> | null | undefined, fallbackProfile: ItemProfile | null = null): ItemState {
  const d = doc ?? {}
  return {
    itemProfile: isItemProfile(d.itemProfile) ? d.itemProfile : fallbackProfile,
    name: textsOf(d.name),
    description: textsOf(d.description),
    categories: stringsOf(d.categories),
    imageIds: refsOf(d.images),
    offers: offerFormsFromDoc(d.offers),
    allergenDeclaration: declarationFormFromDoc(d.allergenDeclaration),
    dietary: stringsOf(d.dietary),
    options: attachmentsFromDoc(d.optionLists),
    hasPage: d.hasPage === true,
    slug: slugTextsOf(d.slug),
    visibility: VISIBILITIES.includes(d.visibility as Visibility) ? (d.visibility as Visibility) : 'public',
  }
}

// ── Option lists ──────────────────────────────────────────────────────────────

/** `declaration` matters only for a free-text "add" choice (D-3a); its note is never used. */
export type OptionForm = { key: string; label: Texts; kind: OptionKind; delta: string; itemId: string | null; declaration: DeclarationForm }

/** A free-text "add" choice: the only kind that declares its own allergens (D-3a). */
export const isFreeTextAdd = (o: Pick<OptionForm, 'kind' | 'itemId'>) => o.kind === 'add' && !o.itemId

export function optionFormsFromDoc(value: unknown): OptionForm[] {
  if (!Array.isArray(value)) return []
  return value.map((o, i) => {
    const r = o as { _key?: unknown; label?: unknown; kind?: unknown; priceDelta?: unknown; item?: { _ref?: unknown }; allergenDeclaration?: unknown }
    return {
      key: typeof r?._key === 'string' ? r._key : `opt${i}`,
      label: textsOf(r?.label),
      kind: r?.kind === 'remove' ? 'remove' : 'add',
      delta: typeof r?.priceDelta === 'number' && r.priceDelta !== 0 ? r.priceDelta.toFixed(2) : '',
      itemId: typeof r?.item?._ref === 'string' ? r.item._ref : null,
      declaration: declarationFormFromDoc(r?.allergenDeclaration),
    }
  })
}

/** Options with a valid price change become the patch; '' is no change (0). Null when one is not a price. */
export function optionsPatch(opts: readonly OptionForm[]) {
  const out: { _key: string; label: Texts; kind: OptionKind; priceDelta: number; itemId: string | null; allergenDeclaration?: Record<string, unknown> }[] = []
  for (const o of opts) {
    const delta = o.delta.trim() === '' ? 0 : parsePrice(o.delta, { signed: true })
    if (delta === null) return null
    const own = isFreeTextAdd(o) ? { allergenDeclaration: optionDeclarationPatch(o.declaration) } : {}
    out.push({ _key: o.key, label: o.label, kind: o.kind, priceDelta: delta, itemId: o.itemId, ...own })
  }
  return out
}

/** Moves one entry of a list (option reorder), clamped. */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list]
  const target = Math.max(0, Math.min(list.length - 1, to))
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(target, 0, x)
  return next
}

// ── Collections ───────────────────────────────────────────────────────────────

export function sectionFormsFromDoc(value: unknown): SectionForm[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s) => s && typeof (s as { _key?: unknown })._key === 'string')
    .map((s) => {
      const r = s as { _key: string; parentKey?: unknown; name?: unknown; items?: unknown }
      return { _key: r._key, parentKey: typeof r.parentKey === 'string' && r.parentKey ? r.parentKey : null, name: textsOf(r.name), items: refsOf(r.items) }
    })
}

/** What the autosave sends for `sections`. */
export function sectionsPatch(sections: readonly SectionForm[]) {
  return sections.map((s) => ({ _key: s._key, name: s.name, ...(s.parentKey ? { parentKey: s.parentKey } : {}), items: s.items }))
}

/**
 * A pointer drop on a row: before it (`after: false`) or after it and its
 * subsections (`after: true`), as that row's sibling. Dropping a section into
 * its own subtree is refused (unchanged).
 */
export function dropRelative(sections: readonly SectionForm[], key: string, targetKey: string, after: boolean): SectionForm[] {
  const target = sections.find((s) => s._key === targetKey)
  if (!target || key === targetKey) return [...sections]
  const parent = parentOf(target)
  if (!after) return dropSection(sections, key, { parentKey: parent, beforeKey: targetKey })
  const sibs = siblingsOf(sections, targetKey).filter((s) => s._key !== key)
  const i = sibs.findIndex((s) => s._key === targetKey)
  const next = sibs[i + 1]
  return dropSection(sections, key, { parentKey: parent, beforeKey: next ? next._key : null })
}
