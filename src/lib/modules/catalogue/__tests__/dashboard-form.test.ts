/**
 * Catalogue dashboard — pure form logic (spec §10.3/§10.4/§11): prices, the
 * offers screen, wizard steps, attachments, and the collection builder's tree
 * edits (add subsection position, delete + undo, reorder, drop, orphans).
 */
import { describe, expect, it } from 'vitest'
import {
  addSection,
  addSubsection,
  attachmentIssues,
  canAdvanceItem,
  declarationFormFromDoc,
  isFreeTextAdd,
  declarationIssues,
  declarationPatch,
  initialItemProfile,
  untranslatedLocales,
  deleteSection,
  dropRelative,
  inCatalogueStatus,
  itemGaps,
  itemStateFromDoc,
  itemWizardSteps,
  moveIndex,
  moveSectionBy,
  newOrphans,
  offerFormIssues,
  offerRows,
  offersToDoc,
  optionFormsFromDoc,
  optionsPatch,
  parsePrice,
  sectionFormsFromDoc,
  sectionsPatch,
  slugFromName,
  slugPreview,
  undoDelete,
  wrapsMidnight,
  type OfferForm,
  type SectionForm,
} from '../dashboard-form'

const keys = (s: readonly SectionForm[]) => s.map((x) => x._key)
const sec = (key: string, parentKey: string | null = null): SectionForm => ({ _key: key, parentKey, name: { it: key }, items: [] })
let n = 0
const nk = () => `k${++n}`

describe('parsePrice', () => {
  it('accepts dot and comma decimals, at most two', () => {
    expect(parsePrice('8')).toBe(8)
    expect(parsePrice(' 8,5 ')).toBe(8.5)
    expect(parsePrice('8.50')).toBe(8.5)
    expect(parsePrice('0')).toBe(0)
    expect(parsePrice('8.505')).toBeNull()
    expect(parsePrice('-1')).toBeNull()
    expect(parsePrice('1.000,00')).toBeNull()
    expect(parsePrice('abc')).toBeNull()
  })
  it('signed for option price changes', () => {
    expect(parsePrice('-1,50', { signed: true })).toBe(-1.5)
    expect(parsePrice('+2', { signed: true })).toBe(2)
  })
})

describe('offers screen ↔ stored offers', () => {
  it('one row per configured channel plus the unscoped row; existing offers kept with their keys', () => {
    const rows = offerRows([{ key: 'o1', channel: 'takeaway', price: '7.00', availability: [] }], ['dine-in', 'takeaway'], nk)
    expect(rows.map((r) => r.channel)).toEqual(['dine-in', 'takeaway', null])
    expect(rows[1].key).toBe('o1')
    expect(rows[0].price).toBe('')
  })
  it('keeps offers on a channel no longer configured visible', () => {
    const rows = offerRows([{ key: 'x', channel: 'delivery', price: '5', availability: [] }], ['dine-in'], nk)
    expect(rows.map((r) => r.channel)).toEqual(['dine-in', null, 'delivery'])
  })
  it('empty rows are "not sold that way"; never writes currency or locationKey', () => {
    const forms: OfferForm[] = [
      { key: 'a', channel: 'dine-in', price: '9,50', availability: [{ key: 'w', days: ['fri', 'mon'], from: '18:00', to: '02:00' }] },
      { key: 'b', channel: null, price: '', availability: [] },
    ]
    const doc = offersToDoc(forms)
    expect(doc).toEqual([
      { _key: 'a', _type: 'catalogueOffer', channel: 'dine-in', price: 9.5, availability: [{ _key: 'w', _type: 'catalogueAvailability', days: ['mon', 'fri'], from: '18:00', to: '02:00' }] },
    ])
    expect(JSON.stringify(doc)).not.toMatch(/currency|locationKey/)
  })
  it('validation: bad price, zero-length window, overlap within a scope (not across scopes)', () => {
    expect(offerFormIssues([{ key: 'a', channel: null, price: '8.505', availability: [] }], [])).toEqual([{ kind: 'invalidPrice', key: 'a' }])
    expect(offerFormIssues([{ key: 'a', channel: null, price: '8', availability: [{ key: 'w', days: [], from: '10:00', to: '10:00' }] }], [])).toEqual([{ kind: 'zeroLength', key: 'a' }])
    const lunch = { key: 'l', channel: 'dine-in', price: '8', availability: [{ key: 'w1', days: [], from: '12:00', to: '15:00' }] }
    const dinner = { key: 'd', channel: 'dine-in', price: '10', availability: [{ key: 'w2', days: [], from: '14:00', to: '22:00' }] }
    expect(offerFormIssues([lunch, dinner], ['dine-in']).map((i) => i.kind)).toEqual(['overlappingOffers'])
    const everywhere = { key: 'e', channel: null, price: '9', availability: [] }
    expect(offerFormIssues([lunch, everywhere], ['dine-in'])).toEqual([])
  })
  it('overnight windows are legal and flagged as wrapping', () => {
    expect(offerFormIssues([{ key: 'a', channel: null, price: '8', availability: [{ key: 'w', days: ['fri'], from: '18:00', to: '02:00' }] }], [])).toEqual([])
    expect(wrapsMidnight({ from: '18:00', to: '02:00' })).toBe(true)
    expect(wrapsMidnight({ from: '12:00', to: '15:00' })).toBe(false)
  })
})

describe('item wizard steps', () => {
  const base = { itemProfile: 'foodOrDrink' as const, categoryCount: 2, locales: ['it', 'en'] }
  it('full flow for food in a multilingual project', () => {
    expect(itemWizardSteps(base)).toEqual(['profile', 'name', 'category', 'photo', 'price', 'details', 'options', 'page', 'languages', 'preview', 'publish'])
  })
  it('"What are you offering?" is ALWAYS first (D-2); food information only for food; languages only with >1 locale; categories only when configured', () => {
    expect(itemWizardSteps({ itemProfile: 'product', categoryCount: 0, locales: ['it'] })).toEqual(['profile', 'name', 'photo', 'price', 'options', 'page', 'preview', 'publish'])
    expect(itemWizardSteps({ itemProfile: null, categoryCount: 0, locales: ['it'] })[0]).toBe('profile')
    expect(itemWizardSteps({ itemProfile: 'service', categoryCount: 0, locales: ['it'] })).not.toContain('details')
  })
  it('preselected from the module setting defaultItemProfile; none (or unknown) → nothing preselected', () => {
    expect(initialItemProfile('foodOrDrink')).toBe('foodOrDrink')
    expect(initialItemProfile('product')).toBe('product')
    expect(initialItemProfile(undefined)).toBeNull()
    expect(initialItemProfile('dish')).toBeNull()
  })
  it('the profile step needs a choice', () => {
    const ctx = { channels: [], optionCounts: new Map() }
    const state = { name: {}, offers: [], options: [], hasPage: false }
    expect(canAdvanceItem('profile', { ...state, itemProfile: null }, 'it', ctx)).toBe(false)
    expect(canAdvanceItem('profile', { ...state, itemProfile: 'service' }, 'it', ctx)).toBe(true)
  })
  it('only the name is required; invalid prices / min > max hold Next', () => {
    const ctx = { channels: [], optionCounts: new Map([['L', 3]]) }
    const state = { name: {}, offers: [], options: [], hasPage: false }
    expect(canAdvanceItem('name', state, 'it', ctx)).toBe(false)
    expect(canAdvanceItem('name', { ...state, name: { it: ' Margherita ' } }, 'it', ctx)).toBe(true)
    expect(canAdvanceItem('photo', state, 'it', ctx)).toBe(true)
    expect(canAdvanceItem('price', { ...state, offers: [{ key: 'a', channel: null, price: 'x', availability: [] }] }, 'it', ctx)).toBe(false)
    expect(canAdvanceItem('options', { ...state, options: [{ key: 'a', listId: 'L', min: 3, max: 1 }] }, 'it', ctx)).toBe(false)
    expect(canAdvanceItem('options', { ...state, options: [{ key: 'a', listId: 'L', min: 0, max: 9 }] }, 'it', ctx)).toBe(true)
  })
})

describe('option-list attachments', () => {
  it('min > max blocks, max beyond the list only warns, a deleted list is reported', () => {
    const counts = new Map([['L', 2]])
    expect(attachmentIssues([{ key: 'a', listId: 'L', min: 2, max: 1 }], counts)).toEqual([{ kind: 'minAboveMax', key: 'a' }])
    expect(attachmentIssues([{ key: 'a', listId: 'L', min: 0, max: 5 }], counts)).toEqual([{ kind: 'maxAboveOptions', key: 'a', options: 2 }])
    expect(attachmentIssues([{ key: 'a', listId: 'gone', min: 0, max: null }], counts)).toEqual([{ kind: 'missingList', key: 'a' }])
  })
})

describe('gaps, slugs, status', () => {
  it('gaps are warnings, never errors', () => {
    expect(itemGaps({ imageCount: 0, offerCount: 0 })).toEqual(['noPhoto', 'noPrice'])
    expect(itemGaps({ imageCount: 1, offerCount: 1 })).toEqual([])
    // "No category" only when the caller knows the categories.
    expect(itemGaps({ imageCount: 1, offerCount: 1, categoryCount: 0 })).toEqual(['noCategory'])
    expect(itemGaps({ imageCount: 1, offerCount: 1, categoryCount: 2 })).toEqual([])
  })
  it('slug derived from the name, previewed under the project segment', () => {
    expect(slugFromName('Pizza Margherita / DOP')).toBe('pizza-margherita-dop')
    expect(slugPreview('menu', 'pizza-margherita')).toBe('/menu/pizza-margherita')
    expect(slugPreview(null, 'x')).toBe('/x')
  })
  it('archived is hidden from "All"', () => {
    expect(inCatalogueStatus('archived', 'all')).toBe(false)
    expect(inCatalogueStatus('archived', 'archived')).toBe(true)
    expect(inCatalogueStatus('draft', 'all')).toBe(true)
  })
})

describe('collection builder — section tree edits', () => {
  // Pizza → Classiche, Bianche · Vini
  const tree = [sec('pizza'), sec('classiche', 'pizza'), sec('napoletane', 'classiche'), sec('bianche', 'pizza'), sec('vini')]

  it('add section appends at the top level', () => {
    expect(addSection(tree, 'new').at(-1)).toMatchObject({ _key: 'new', parentKey: null })
  })
  it('"Add subsection" inserts AFTER the section\'s existing children (and their descendants)', () => {
    expect(keys(addSubsection(tree, 'pizza', 'speciali'))).toEqual(['pizza', 'classiche', 'napoletane', 'bianche', 'speciali', 'vini'])
    expect(addSubsection(tree, 'pizza', 'speciali').find((s) => s._key === 'speciali')?.parentKey).toBe('pizza')
    expect(keys(addSubsection(tree, 'vini', 'rossi'))).toEqual(['pizza', 'classiche', 'napoletane', 'bianche', 'vini', 'rossi'])
  })
  it('storage that is not contiguous (Studio edits): still after the LAST stored descendant', () => {
    const odd = [sec('pizza'), sec('bianche', 'pizza'), sec('vini'), sec('classiche', 'pizza')]
    expect(keys(addSubsection(odd, 'pizza', 'x'))).toEqual(['pizza', 'bianche', 'vini', 'classiche', 'x'])
  })
  it('never creates an orphan: an unknown parent is refused', () => {
    expect(keys(addSubsection(tree, 'missing', 'x'))).toEqual(keys(tree))
  })
  it('delete removes the subsections too, and Undo puts the block back where it was', () => {
    const r = deleteSection(tree, 'classiche')
    expect(keys(r.sections)).toEqual(['pizza', 'bianche', 'vini'])
    expect(r.undo?.removed.map((s) => s._key)).toEqual(['classiche', 'napoletane'])
    expect(keys(undoDelete(r.sections, r.undo!))).toEqual(keys(tree))
  })
  it('up/down move a section among its siblings with its subtree', () => {
    expect(keys(moveSectionBy(tree, 'bianche', -1))).toEqual(['pizza', 'bianche', 'classiche', 'napoletane', 'vini'])
    expect(keys(moveSectionBy(tree, 'classiche', 1))).toEqual(['pizza', 'bianche', 'classiche', 'napoletane', 'vini'])
    expect(keys(moveSectionBy(tree, 'pizza', 1))).toEqual(['vini', 'pizza', 'classiche', 'napoletane', 'bianche'])
    expect(keys(moveSectionBy(tree, 'pizza', -1))).toEqual(keys(tree))
  })
  it('pointer drop before/after a row, as its sibling; into its own subtree is refused', () => {
    const before = dropRelative(tree, 'vini', 'bianche', false)
    expect(keys(before)).toEqual(['pizza', 'classiche', 'napoletane', 'vini', 'bianche'])
    expect(before.find((s) => s._key === 'vini')?.parentKey).toBe('pizza')
    expect(keys(dropRelative(tree, 'vini', 'pizza', false))).toEqual(['vini', 'pizza', 'classiche', 'napoletane', 'bianche'])
    const after = dropRelative(tree, 'bianche', 'classiche', true)
    expect(keys(after)).toEqual(keys(tree))
    expect(keys(dropRelative(tree, 'pizza', 'napoletane', true))).toEqual(keys(tree))
  })
  it('newOrphans: a NEW dangling parentKey is caught, a pre-existing one is not', () => {
    const stored = [sec('a'), sec('lost', 'gone')]
    expect(newOrphans(stored, stored)).toEqual([])
    expect(newOrphans(stored, [...stored, sec('b', 'nope')])).toEqual(['b'])
    expect(newOrphans(stored, [sec('a'), sec('lost', 'other-missing')])).toEqual(['lost'])
  })
  it('doc ↔ form round trip for sections', () => {
    const doc = [{ _key: 'a', _type: 'catalogueSection', name: { _type: 'localizedString', it: 'Pizze' }, items: [{ _key: 'x', _type: 'reference', _ref: 'item-1' }] }, { _key: 'b', parentKey: 'a', name: { it: 'Bianche' } }]
    const forms = sectionFormsFromDoc(doc)
    expect(forms).toEqual([
      { _key: 'a', parentKey: null, name: { it: 'Pizze' }, items: ['item-1'] },
      { _key: 'b', parentKey: 'a', name: { it: 'Bianche' }, items: [] },
    ])
    expect(sectionsPatch(forms)).toEqual([
      { _key: 'a', name: { it: 'Pizze' }, items: ['item-1'] },
      { _key: 'b', name: { it: 'Bianche' }, parentKey: 'a', items: [] },
    ])
  })
})

describe('document → form', () => {
  it('item state from a stored draft', () => {
    const s = itemStateFromDoc({
      itemProfile: 'foodOrDrink',
      allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten'], note: { _type: 'localizedText', it: 'Forno condiviso' } },
      name: { _type: 'localizedString', it: 'Margherita' },
      images: [{ _ref: 'm1' }],
      offers: [{ _key: 'o', price: 8, channel: 'dine-in' }],
      optionLists: [{ _key: 'att', list: { _ref: 'L' }, min: 1 }],
      hasPage: true,
      slug: { it: { current: 'margherita' } },
    })
    expect(s).toMatchObject({ itemProfile: 'foodOrDrink', name: { it: 'Margherita' }, imageIds: ['m1'], hasPage: true, slug: { it: 'margherita' }, visibility: 'public' })
    expect(s.allergenDeclaration).toEqual({ status: 'containsListedAllergens', allergens: ['gluten', 'milk'], mayContain: [], confirmed: false, note: { it: 'Forno condiviso' } })
    expect(itemStateFromDoc({}).itemProfile).toBeNull()
    expect(itemStateFromDoc({ itemType: 'dish' }).itemProfile).toBeNull()
    expect(s.offers[0]).toEqual({ key: 'o', channel: 'dine-in', price: '8.00', availability: [] })
    expect(s.options).toEqual([{ key: 'att', listId: 'L', min: 1, max: null }])
  })
  it('options: price change parsed (signed), invalid → no patch; reorder', () => {
    const forms = optionFormsFromDoc([{ _key: 'a', label: { it: 'Doppia mozzarella' }, kind: 'add', priceDelta: 1.5 }, { _key: 'b', label: { it: 'Senza' }, kind: 'remove', priceDelta: 0 }])
    expect(forms.map((f) => f.delta)).toEqual(['1.50', ''])
    expect(optionsPatch(forms)?.map((o) => o.priceDelta)).toEqual([1.5, 0])
    expect(optionsPatch([{ ...forms[0], delta: 'x' }])).toBeNull()
    expect(moveIndex(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
})

describe('allergen declaration form (ADR-033 D-3)', () => {
  it('a missing or unknown declaration reads as not reviewed', () => {
    expect(declarationFormFromDoc(undefined).status).toBe('notReviewed')
    expect(declarationFormFromDoc({ status: 'allergenFree' }).status).toBe('notReviewed')
  })
  it('publishing needs: a choice; ≥ 1 allergen for "contains"; the confirmation for "none"', () => {
    const f = declarationFormFromDoc(undefined)
    expect(declarationIssues(f)).toEqual(['notReviewed'])
    expect(declarationIssues({ ...f, status: 'containsListedAllergens' })).toEqual(['noAllergens'])
    expect(declarationIssues({ ...f, status: 'containsListedAllergens', mayContain: ['milk'] })).toEqual(['noAllergens'])
    expect(declarationIssues({ ...f, status: 'containsListedAllergens', allergens: ['milk'] })).toEqual([])
    expect(declarationIssues({ ...f, status: 'noneDeclared' })).toEqual(['notConfirmed'])
    expect(declarationIssues({ ...f, status: 'noneDeclared', confirmed: true })).toEqual([])
  })
  it('the patch carries only the status\'s own fields; "may contain" stays separate', () => {
    const f = { status: 'containsListedAllergens' as const, allergens: ['gluten' as const], mayContain: ['treeNuts' as const], confirmed: true, note: { it: 'x' } }
    expect(declarationPatch(f)).toEqual({ status: 'containsListedAllergens', allergens: ['gluten'], mayContain: ['treeNuts'], note: { it: 'x' } })
    expect(declarationPatch({ ...f, status: 'noneDeclared' })).toEqual({ status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts'], note: { it: 'x' } })
    expect(declarationPatch({ ...f, status: 'notReviewed' })).toEqual({ status: 'notReviewed' })
  })
  it('the "allergens not reviewed" gap', () => {
    expect(itemGaps({ imageCount: 1, offerCount: 1, allergensNotReviewed: true })).toEqual(['allergensNotReviewed'])
    expect(itemGaps({ imageCount: 1, offerCount: 1 })).toEqual([])
  })
})

describe('localized addresses need a localized name (ADR-033 D-7)', () => {
  it('languages without a name are "Not translated" (never the main language)', () => {
    expect(untranslatedLocales({ it: 'Margherita', en: ' ' }, ['it', 'en', 'de'], 'it')).toEqual(['en', 'de'])
    expect(untranslatedLocales({}, ['it'], 'it')).toEqual([])
  })
})

describe('option choice declarations in the editor (ADR-033 D-3a)', () => {
  it('read from the stored choice; sent only for free-text add choices, never with a note', () => {
    const forms = optionFormsFromDoc([
      { _key: 'a', label: { it: 'Mozzarella' }, kind: 'add', allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk'] } },
      { _key: 'b', label: { it: 'Senza' }, kind: 'remove' },
      { _key: 'c', label: { it: 'Patatine' }, kind: 'add', item: { _ref: 'side' } },
    ])
    expect(forms[0].declaration.status).toBe('containsListedAllergens')
    expect(forms[1].declaration.status).toBe('notReviewed')
    const patch = optionsPatch([{ ...forms[0], declaration: { ...forms[0].declaration, note: { it: 'never sent' } } }, forms[1], forms[2]])!
    expect(patch[0].allergenDeclaration).toEqual({ status: 'containsListedAllergens', allergens: ['milk'], mayContain: [] })
    expect('allergenDeclaration' in patch[1]).toBe(false)
    expect('allergenDeclaration' in patch[2]).toBe(false)
  })
  it('isFreeTextAdd', () => {
    expect(isFreeTextAdd({ kind: 'add', itemId: null })).toBe(true)
    expect(isFreeTextAdd({ kind: 'remove', itemId: null })).toBe(false)
    expect(isFreeTextAdd({ kind: 'add', itemId: 'x' })).toBe(false)
  })
})

describe('byline and links form logic — ADR-033 Amendment F', () => {
  it('itemStateFromDoc reads byline and links', async () => {
    const { itemStateFromDoc } = await import('../dashboard-form')
    const st = itemStateFromDoc({ byline: { en: 'x', _type: 'localizedString' }, links: [{ _key: 'a', label: { en: 'L' }, url: 'https://e.com' }, { nokey: 1 }] })
    expect(st.byline).toEqual({ en: 'x' })
    expect(st.links).toEqual([{ key: 'a', label: { en: 'L' }, url: 'https://e.com', kind: 'info', affiliate: false }])
    expect(itemStateFromDoc(null).links).toEqual([])
  })

  it('linkFormIssues: blank rows are ignored, half rows are incomplete, bad schemes are badUrl', async () => {
    const { linkFormIssues, linksPatch } = await import('../dashboard-form')
    type LinkForm = import('../dashboard-form').LinkForm
    const rows: LinkForm[] = [
      { key: 'blank', label: {}, url: '', kind: 'info', affiliate: false },
      { key: 'noUrl', label: { en: 'L' }, url: '', kind: 'info', affiliate: false },
      { key: 'noLabel', label: { it: 'x' }, url: 'https://e.com', kind: 'info', affiliate: false },
      { key: 'bad', label: { en: 'L' }, url: 'javascript:alert(1)', kind: 'info', affiliate: false },
      { key: 'ok', label: { en: 'L' }, url: ' https://e.com ', kind: 'info', affiliate: false },
    ]
    expect(linkFormIssues(rows, 'en')).toEqual([
      { kind: 'incomplete', key: 'noUrl' },
      { kind: 'incomplete', key: 'noLabel' },
      { kind: 'badUrl', key: 'bad' },
    ])
    expect(linksPatch(rows, 'en')).toEqual([{ _key: 'ok', label: { en: 'L' }, url: 'https://e.com' }])
  })
})
