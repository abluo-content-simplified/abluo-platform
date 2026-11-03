// ── Readiness facts from a stored item document (C6 §6.7; pure) ──────────────
//
// The server/Studio twin of `itemReadinessInputFromState`: the publish gate
// judges the version it is about to publish. Both builders obtain the model
// through the same readers the editor uses (`commerceOf`, the C1 assignment
// rule of the writer) and judge it through the ONE shared `modelFacts`, so the
// editor and the gate cannot disagree about formats, availability, prices or
// categories (fixture R-30).
//
// Only the facts the MODEL-DEPENDENT rules read are complete here (categories,
// formats, integrity of stored commerce); the R1 rules keep running as the
// gate's inline checks, unchanged (C6 §6.7 step 2 is a later slice).

import { readRuleRows } from '../commerce/read'
import type { ChannelSet } from '../commerce/channels'
import { commerceOf } from '../commerce/legacy-commerce'
import { attachmentsFromDoc } from '../dashboard-form'
import { convertedAssignment } from '../item-writer'
import { isItemProfile } from '../profiles'
import { itemCategoryAssignment } from '../taxonomy/read'
import type { CategoryTree } from '../taxonomy/types'
import type { CatalogueMigrationState } from '../schema-commerce'
import { DEFAULT_RULES } from './rules'
import { activationMarkers, modelFacts } from './facts-model'
import type { ItemReadinessInput, ReadinessRule } from './types'

const texts = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('_') && typeof x === 'string' && x.trim()) out[k] = x
  return out
}
const slugs = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const c = (x as { current?: unknown } | null)?.current
    if (!k.startsWith('_') && typeof c === 'string' && c) out[k] = c
  }
  return out
}

/** A stored price/offer carrying the reserved `currency` (C6 `integrity.currencyStored`, REVIEW X-14). */
function storesCurrency(doc: Record<string, unknown>): boolean {
  const set = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  for (const o of Array.isArray(doc.offers) ? doc.offers : []) if (set((o as { currency?: unknown } | null)?.currency)) return true
  for (const f of Array.isArray(doc.formats) ? doc.formats : [])
    for (const p of Array.isArray((f as { prices?: unknown } | null)?.prices) ? ((f as { prices: unknown[] }).prices) : []) if (set((p as { currency?: unknown } | null)?.currency)) return true
  return false
}

export type DocFactsContext = {
  id: string
  defaultLocale: string
  locales: readonly string[]
  channels: ChannelSet
  tree: CategoryTree
  timeZone: string | null
  migrations: CatalogueMigrationState
}

/** The version to be published → readiness input (model facts complete; server-only facts left to the gate's checks). */
export function itemReadinessInputFromDoc(doc: Record<string, unknown>, ctx: DocFactsContext): ItemReadinessInput {
  const commerce = commerceOf(doc, ctx.channels)
  // A legacy list is read with the writer's D-15 rule (first EXISTING category primary, nothing dropped).
  const legacy = Array.isArray(doc.categories) && doc.primaryCategory === undefined && doc.additionalCategories === undefined
  const assignment = legacy ? convertedAssignment(doc.categories, ctx.tree) : itemCategoryAssignment(doc)
  const formatRowIssues = (Array.isArray(doc.formats) ? doc.formats : []).flatMap((f) => readRuleRows((f as { channelAvailability?: unknown } | null)?.channelAvailability).issues)
  const model = modelFacts({
    formats: commerce.formats,
    itemRules: commerce.itemRules,
    assignment,
    tree: ctx.tree,
    channels: ctx.channels,
    timeZone: ctx.timeZone,
    itemRuleIssues: [...commerce.issues.filter((i) => i.startsWith('availability.')), ...formatRowIssues],
  })
  const book = (doc.bookDetails ?? {}) as { isbn?: unknown }
  return {
    id: ctx.id,
    profile: isItemProfile(doc.itemProfile) ? doc.itemProfile : null,
    name: texts(doc.name),
    description: texts(doc.description),
    siteLocales: ctx.locales,
    defaultLocale: ctx.defaultLocale,
    photoCount: Array.isArray(doc.images) ? doc.images.length : 0,
    ...model,
    placements: null,
    allergen: { declaration: doc.allergenDeclaration },
    options: attachmentsFromDoc(doc.optionLists),
    optionFacts: { counts: new Map(), unreviewedChoices: [] },
    dependencies: { neverPublished: [], missing: [] },
    page: { hasPage: doc.hasPage === true, slug: slugs(doc.slug), conflicts: [] },
    bookIsbn: typeof book.isbn === 'string' ? book.isbn : null,
    integrity: { refs: [], storedCurrency: storesCurrency(doc), unknownKeys: [] },
    overrides: [],
    migrations: activationMarkers(ctx.migrations),
  }
}

/**
 * C10-6 step 7: the rules that need the new model (`activation` taxonomy / commerce — main category,
 * price and availability rules, the model's integrity rules). The gate runs exactly these on top of
 * its unchanged R1 checks, and only in a project whose markers activate them.
 */
export const MODEL_DEPENDENT_RULES: readonly ReadinessRule[] = Object.freeze(DEFAULT_RULES.filter((r) => r.activation === 'taxonomy' || r.activation === 'commerce'))
