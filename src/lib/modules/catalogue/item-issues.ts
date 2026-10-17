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

import { PROFILES, can } from './profiles'
import { isValidIsbn } from './isbn'
import { declarationIssues, attachmentIssues, isBlockingAttachmentIssue, offerFormIssues, slugFromName, type ItemState, type ItemStep } from './dashboard-form'

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
  channels: readonly string[]
  /** option list id → number of options (every list of the project). */
  optionCounts: ReadonlyMap<string, number>
}

/** The state `itemIssues` reads: an `ItemState` (the wizard's profile may still be null). */
export type ItemIssueState = Pick<ItemState, 'itemProfile' | 'name' | 'bookDetails' | 'offers' | 'options' | 'allergenDeclaration' | 'hasPage' | 'slug'>

/**
 * Everything the person should know about this item, in the order they would
 * fix it. Pure: same input, same output.
 */
export function itemIssues(s: ItemIssueState, ctx: ItemIssueContext): ItemIssue[] {
  const out: ItemIssue[] = []
  const d = ctx.defaultLocale
  const multi = ctx.locales.length > 1

  // ── The minimum to exist ──
  if (s.itemProfile === null || s.itemProfile === undefined) {
    out.push({ id: 'profile', severity: 'blocksNext', step: 'profile', tab: 'content', messageKey: 'profile' })
  }
  if (!s.name[d]?.trim()) {
    out.push({ id: 'name', severity: 'blocksNext', step: 'name', tab: 'content', messageKey: s.itemProfile && PROFILES[s.itemProfile].nameLabelKey === 'title' ? 'bookTitle' : 'name', values: { locale: d }, focus: `[data-name-locale="${d}"]` })
  }

  // ── Input that cannot be saved as typed ──
  const offerIssues = offerFormIssues(s.offers, ctx.channels)
  if (offerIssues.length) {
    const kinds = new Set(offerIssues.map((i) => i.kind))
    const firstKey = (pred: (k: string) => boolean) => {
      const hit = offerIssues.find((i) => pred(i.kind) && 'key' in i)
      return hit && 'key' in hit ? `[data-offer-key="${hit.key}"]` : undefined
    }
    const add = (id: string, messageKey: string, focus?: string) => out.push({ id, severity: 'blocksNext', step: 'price', tab: 'prices', messageKey, focus })
    if (kinds.has('invalidPrice') || kinds.has('negativePrice') || kinds.has('tooManyDecimals')) add('price', 'invalidPrice', firstKey((k) => k === 'invalidPrice' || k === 'negativePrice' || k === 'tooManyDecimals'))
    if (kinds.has('invalidTime') || kinds.has('zeroLength') || kinds.has('incompleteWindow')) add('priceTimes', 'priceTimes', firstKey((k) => k === 'invalidTime' || k === 'zeroLength' || k === 'incompleteWindow'))
    if (kinds.has('overlappingOffers')) add('priceOverlap', 'priceOverlap')
    if (kinds.has('unknownChannel')) add('priceChannel', 'priceChannel', firstKey((k) => k === 'unknownChannel'))
  }
  const attIssues = attachmentIssues(s.options, ctx.optionCounts)
  const minMax = attIssues.find(isBlockingAttachmentIssue)
  if (minMax) out.push({ id: 'optionsMinMax', severity: 'blocksNext', step: 'options', tab: 'options', messageKey: 'optionsMinMax', focus: `[data-attachment-key="${minMax.key}"]` })

  // ── What publishing needs (a draft does not) ──
  if (s.itemProfile && can(s.itemProfile, 'foodInformation')) {
    const first = declarationIssues(s.allergenDeclaration)[0]
    if (first) out.push({ id: 'allergens', severity: 'blocksPublish', step: 'details', tab: 'details', messageKey: `allergens.${first}` })
  }
  // ── Advice: never blocks anything ──
  if (s.itemProfile && can(s.itemProfile, 'bookDetails') && s.bookDetails.isbn.trim() && !isValidIsbn(s.bookDetails.isbn)) {
    out.push({ id: 'isbn', severity: 'advice', step: 'name', tab: 'content', messageKey: 'isbn', focus: '[data-book-isbn]' })
  }
  if (attIssues.some((i) => i.kind === 'missingList')) out.push({ id: 'optionList', severity: 'blocksPublish', step: 'options', tab: 'options', messageKey: 'optionListMissing' })
  if (s.hasPage) {
    const base = s.slug[d]?.trim() ? s.slug[d] : (s.name[d] ?? '')
    if (s.name[d]?.trim() && !slugFromName(base)) out.push({ id: 'pageAddress', severity: 'blocksPublish', step: 'page', tab: 'page', messageKey: 'pageAddress', focus: '[data-slug-locale]' })
    // E-3: an address in a language where the name is empty.
    const stray = ctx.locales.find((l) => s.slug[l]?.trim() && !s.name[l]?.trim())
    if (stray) {
      const inMain = stray === d
      out.push({
        id: 'strayAddress',
        severity: 'blocksPublish',
        step: inMain || !multi ? 'name' : 'languages',
        tab: inMain || !multi ? 'content' : 'languages',
        messageKey: 'strayAddress',
        values: { locale: stray },
        focus: `[data-name-locale="${stray}"]`,
      })
    }
  }
  return out
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
