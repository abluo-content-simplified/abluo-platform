// G-03 oracle — the pre-R1 `itemIssues` body, VERBATIM (only renamed), kept as
// the reference the adapter must equal. Do not edit: if the editor's rules are
// meant to change, change the engine and this oracle's expectations together.
import { PROFILES, can } from '../../profiles'
import { isValidIsbn } from '../../isbn'
import { declarationIssues, attachmentIssues, isBlockingAttachmentIssue, offerFormIssues, slugFromName, type OfferForm } from '../../dashboard-form'
import type { ItemIssue, ItemIssueContext, ItemIssueState } from '../../item-issues'

// R2: the editor state carries formats now; the oracle keeps reading the legacy offer form (type only changed).
export function legacyItemIssues(s: Omit<ItemIssueState, 'formats' | 'itemRules'> & { offers: readonly OfferForm[] }, ctx: ItemIssueContext): ItemIssue[] {
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
