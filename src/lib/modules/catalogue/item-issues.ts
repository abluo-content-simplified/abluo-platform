// ── Catalogue — what is missing or invalid on an item (pure, browser-safe) ────
//
// Dashboard UX rules 1–3 (content-wizard-spec): a disabled primary action says
// why; drafts are never blocked; publication blockers are listed with links.
//
// This is GUIDANCE only. The server re-validates everything and stays the
// authority (ADR-032/033); nothing here is a permission or a lifecycle rule.
//
//   blocksNext     the minimum for the item to exist (profile, name in the main
//                  language) or input that cannot be saved as typed (a price
//                  that is not an amount). Empty optional fields NEVER block.
//   blocksPublish  what publishing needs and a draft does not (allergen review
//                  for food, a usable page address, an option list that exists).
//   advice         a hint, not an error (Amendment I-3.3: an ISBN that does not
//                  check out). Shown beside the field; a quiet dot on its tab;
//                  NEVER disables a button and NEVER in the publish blocker list.

//
// Since R1 (C6 §6.6) this file is a THIN ADAPTER over the readiness engine
// (`readiness/`): the rules live there once, and `itemIssues` projects the
// website-context result onto `ItemIssue` so the editor is unchanged.

import type { ItemState, ItemStep } from './dashboard-form'
import type { ChannelSet } from './commerce/channels'
import type { CategoryTree } from './taxonomy/types'
import type { CatalogueMigrationState } from './schema-commerce'
import { WEBSITE, evaluateItem } from './readiness/engine'
import { itemReadinessInputFromState } from './readiness/facts-client'
import type { Finding, ReadinessCode } from './readiness/types'

/** The editor's tab ids (ItemEditor). */
export type ItemTab = 'content' | 'photos' | 'prices' | 'details' | 'options' | 'page' | 'languages' | 'publishing'

export type ItemIssueSeverity = 'blocksNext' | 'blocksPublish' | 'advice'

export type ItemIssue = {
  /** Stable per problem, e.g. 'name', 'price', 'allergens'. */
  id: string
  severity: ItemIssueSeverity
  /** The wizard step that fixes it. */
  step: ItemStep
  /** The editor tab that fixes it. */
  tab: ItemTab
  /** Key under `catalogue.dashboard.item.issues`. */
  messageKey: string
  /** ICU values; `locale` is turned into a language name by the UI. */
  values?: Record<string, string | number>
  /** Optional CSS selector of the field to focus after jumping there. */
  focus?: string
}

export type ItemIssueContext = {
  defaultLocale: string
  locales: readonly string[]
  /** The project's channel keys (an older caller); `channelSet` wins when given. */
  channels: readonly string[]
  /** option list id → number of options (every list of the project). */
  optionCounts: ReadonlyMap<string, number>
  /** R2: the project's channels (C2 `readChannels`). */
  channelSet?: ChannelSet
  /** R2: the project's category tree (C1 `buildTree`). */
  tree?: CategoryTree
  /** R2: the site zone (windowed prices without it are `price.indeterminate`). */
  timeZone?: string | null
  /** R2 (C6 step 7): the project's C10-6 markers — the model-dependent rules run only when both data steps are verified. */
  migrations?: CatalogueMigrationState
}

/** The state `itemIssues` reads: an `ItemState` (the wizard's profile may still be null). */
export type ItemIssueState = Pick<ItemState, 'itemProfile' | 'name' | 'bookDetails' | 'formats' | 'itemRules' | 'options' | 'allergenDeclaration' | 'hasPage' | 'slug'> & Partial<Pick<ItemState, 'assignment'>>

/**
 * C6 §6.6 legacy id of each projected finding (tests pin it). Only these codes
 * ever reach the editor through `itemIssues`.
 */
export const LEGACY_ID: Partial<Record<ReadinessCode, string>> = Object.freeze({
  profileMissing: 'profile',
  nameMissing: 'name',
  'price.invalid': 'price',
  'price.times': 'priceTimes',
  'price.overlap': 'priceOverlap',
  'price.channel': 'priceChannel',
  optionsMinMax: 'optionsMinMax',
  allergenReview: 'allergens',
  optionListMissing: 'optionList',
  pageAddressInvalid: 'pageAddress',
  strayAddress: 'strayAddress',
  isbnInvalid: 'isbn',
  // R2 (C6 step 7): active only in a project whose taxonomy + commerce data steps are verified.
  categoryMissing: 'categoryMissing',
  primaryCategoryMissing: 'primaryCategory',
  'price.ambiguous': 'priceAmbiguous',
  'availability.conflictingRows': 'availabilityConflict',
  'availability.scheduleInvalid': 'scheduleInvalid',
})

/**
 * The order the editor has always listed issues in. It equals the engine's
 * registry order except for the ISBN hint, which the editor shows right after
 * the allergens (registry row 21 comes after the page rows 11–12). Kept so the
 * adapter's output is byte-identical (G-03).
 */
const LEGACY_ORDER: readonly string[] = ['profile', 'name', 'price', 'priceTimes', 'priceOverlap', 'priceChannel', 'categoryMissing', 'primaryCategory', 'optionsMinMax', 'allergens', 'isbn', 'optionList', 'pageAddress', 'strayAddress', 'priceAmbiguous', 'availabilityConflict', 'scheduleInvalid']

/** Pure, 1:1: severity from level + gate; step/tab/focus from the fix target; legacy id. Null when the finding has no editor form. */
export function findingToItemIssue(f: Finding): ItemIssue | null {
  if (f.fix.surface !== 'item') return null
  const severity: ItemIssueSeverity = f.level === 'required' ? (f.gate === 'advance' ? 'blocksNext' : 'blocksPublish') : 'advice'
  return {
    id: LEGACY_ID[f.code] ?? f.code,
    severity,
    step: f.fix.step,
    tab: f.fix.tab,
    messageKey: f.messageKey,
    ...(f.values && { values: f.values }),
    ...(f.fix.focus !== undefined && { focus: f.fix.focus }),
  }
}

/**
 * Everything the person should know about this item, in the order they would
 * fix it. Pure: same input, same output.
 */
export function itemIssues(s: ItemIssueState, ctx: ItemIssueContext): ItemIssue[] {
  const result = evaluateItem(itemReadinessInputFromState(s, ctx), WEBSITE, { families: ['standard'] })
  // Advice stays advice: only non-overridable recommended findings (data hints) are projected; the
  // other recommended findings (photo, description, translation …) belong to the readiness panel.
  const findings = [...result.required, ...result.recommended.filter((f) => f.overridable === false)].filter((f) => LEGACY_ID[f.code] !== undefined)
  const issues = findings.map(findingToItemIssue).filter((i): i is ItemIssue => i !== null)
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => LEGACY_ORDER.indexOf(a.issue.id) - LEGACY_ORDER.indexOf(b.issue.id) || a.i - b.i).map((x) => x.issue)
}

export const blocksNextOn = (issues: readonly ItemIssue[], step: ItemStep) => issues.filter((i) => i.severity === 'blocksNext' && i.step === step)

/** Everything that stops "Publish" (both kinds: a publish needs the minimum too). */
export const publishBlockers = (issues: readonly ItemIssue[]) => issues.filter((i) => i.severity !== 'advice')

/** Issues per editor tab, for the count badges. Advice is not counted (see `adviceTabs`). */
export function issueCountByTab(issues: readonly ItemIssue[]): Partial<Record<ItemTab, number>> {
  const out: Partial<Record<ItemTab, number>> = {}
  for (const i of publishBlockers(issues)) out[i.tab] = (out[i.tab] ?? 0) + 1
  return out
}

/** The tabs holding advice only — shown as a quiet dot, never a number. */
export function adviceTabs(issues: readonly ItemIssue[]): ReadonlySet<ItemTab> {
  return new Set(issues.filter((i) => i.severity === 'advice').map((i) => i.tab))
}
