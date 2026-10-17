import { describe, expect, it } from 'vitest'
import { EMPTY_BOOK_DETAILS, NOT_REVIEWED, itemOptionsRelevant, itemWizardSteps, type ItemState } from '../dashboard-form'
import { adviceTabs, blocksNextOn, issueCountByTab, itemIssues, publishBlockers, type ItemIssueContext } from '../item-issues'

const ctx: ItemIssueContext = { defaultLocale: 'it', locales: ['it'], channels: [], optionCounts: new Map([['L', 3]]) }
const base: ItemState = {
  itemProfile: 'product',
  name: { it: 'Libro' },
  byline: {},
  bookDetails: EMPTY_BOOK_DETAILS,
  description: {},
  links: [],
  categories: [],
  tags: [],
  imageIds: [],
  offers: [{ key: 'a', channel: null, price: '', availability: [] }],
  allergenDeclaration: NOT_REVIEWED,
  dietary: [],
  options: [],
  hasPage: false,
  slug: {},
  visibility: 'public',
}
const ids = (s: Partial<ItemState>, c: Partial<ItemIssueContext> = {}) => itemIssues({ ...base, ...s }, { ...ctx, ...c }).map((i) => `${i.severity}:${i.id}`)

describe('itemIssues', () => {
  it('a complete minimal product has no issues; an empty optional price never blocks', () => {
    expect(ids({})).toEqual([])
  })

  it('no profile blocks Next on the profile step', () => {
    const issues = itemIssues({ ...base, itemProfile: null }, ctx)
    expect(issues.map((i) => [i.id, i.severity, i.step])).toEqual([['profile', 'blocksNext', 'profile']])
  })

  it('a missing default-language name blocks Next (a name in another language does not help)', () => {
    expect(ids({ name: { de: 'Buch' } }, { locales: ['it', 'de'] })).toEqual(['blocksNext:name'])
    expect(ids({ name: { it: '   ' } })).toEqual(['blocksNext:name'])
    const [i] = itemIssues({ ...base, name: {} }, ctx)
    expect(i.values).toEqual({ locale: 'it' })
    expect(i.focus).toBe('[data-name-locale="it"]')
  })

  it('food without an allergen review blocks publish but not Next', () => {
    const issues = itemIssues({ ...base, itemProfile: 'foodOrDrink' }, ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ id: 'allergens', severity: 'blocksPublish', step: 'details', tab: 'details', messageKey: 'allergens.notReviewed' })
    for (const step of ['profile', 'name', 'price', 'details', 'options', 'page'] as const) expect(blocksNextOn(issues, step)).toEqual([])
  })

  it('a reviewed food item has no allergen issue; half-finished declarations name the next thing', () => {
    expect(ids({ itemProfile: 'foodOrDrink', allergenDeclaration: { ...NOT_REVIEWED, status: 'noneDeclared', confirmed: true } })).toEqual([])
    expect(itemIssues({ ...base, itemProfile: 'foodOrDrink', allergenDeclaration: { ...NOT_REVIEWED, status: 'containsListedAllergens' } }, ctx)[0].messageKey).toBe('allergens.noAllergens')
    expect(itemIssues({ ...base, itemProfile: 'foodOrDrink', allergenDeclaration: { ...NOT_REVIEWED, status: 'noneDeclared' } }, ctx)[0].messageKey).toBe('allergens.notConfirmed')
  })

  it('product and service never get allergen issues', () => {
    expect(ids({ itemProfile: 'service' })).toEqual([])
  })

  it('a malformed price blocks Next on the price step and focuses that field', () => {
    const issues = itemIssues({ ...base, offers: [{ key: 'k1', channel: null, price: '8,5,0', availability: [] }] }, ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ id: 'price', severity: 'blocksNext', step: 'price', tab: 'prices', focus: '[data-offer-key="k1"]' })
  })

  it('half-filled serving times and overlapping prices are named separately', () => {
    const times = itemIssues({ ...base, offers: [{ key: 'k1', channel: null, price: '5', availability: [{ key: 'w', days: ['mon'], from: '12:00', to: '' }] }] }, ctx)
    expect(times.map((i) => i.id)).toEqual(['priceTimes'])
    const overlap = itemIssues(
      {
        ...base,
        offers: [
          { key: 'a', channel: null, price: '5', availability: [] },
          { key: 'b', channel: null, price: '6', availability: [] },
        ],
      },
      ctx
    )
    expect(overlap.map((i) => i.id)).toEqual(['priceOverlap'])
  })

  it('an offer on a channel that is gone is reported', () => {
    expect(ids({ offers: [{ key: 'a', channel: 'old', price: '5', availability: [] }] })).toEqual(['blocksNext:priceChannel'])
  })

  it('option list: min above max blocks Next; a list that no longer exists blocks publish only', () => {
    expect(ids({ options: [{ key: 'o', listId: 'L', min: 3, max: 1 }] })).toEqual(['blocksNext:optionsMinMax'])
    expect(ids({ options: [{ key: 'o', listId: 'gone', min: 0, max: null }] })).toEqual(['blocksPublish:optionList'])
    // "max above the number of options" only warns.
    expect(ids({ options: [{ key: 'o', listId: 'L', min: 0, max: 9 }] })).toEqual([])
  })

  it('own page: a name that yields no address blocks publish; a stray address names the language', () => {
    expect(ids({ hasPage: true, name: { it: '!!!' } })).toEqual(['blocksPublish:pageAddress'])
    expect(ids({ hasPage: false, name: { it: '!!!' } })).toEqual([])
    const stray = itemIssues({ ...base, hasPage: true, slug: { de: 'buch' }, name: { it: 'Libro' } }, { ...ctx, locales: ['it', 'de'] })
    expect(stray).toHaveLength(1)
    expect(stray[0]).toMatchObject({ id: 'strayAddress', severity: 'blocksPublish', tab: 'languages', step: 'languages', values: { locale: 'de' } })
  })

  it('counts issues per tab', () => {
    const issues = itemIssues({ ...base, itemProfile: 'foodOrDrink', offers: [{ key: 'a', channel: null, price: 'x', availability: [] }] }, ctx)
    expect(issueCountByTab(issues)).toEqual({ prices: 1, details: 1 })
  })
})

describe('options visibility (D7)', () => {
  it('shows for food, for attached lists, or when the project has lists; hides otherwise', () => {
    expect(itemOptionsRelevant({ itemProfile: 'foodOrDrink', attachedCount: 0, projectListCount: 0 })).toBe(true)
    expect(itemOptionsRelevant({ itemProfile: 'product', attachedCount: 1, projectListCount: 0 })).toBe(true)
    expect(itemOptionsRelevant({ itemProfile: 'service', attachedCount: 0, projectListCount: 2 })).toBe(true)
    expect(itemOptionsRelevant({ itemProfile: 'product', attachedCount: 0, projectListCount: 0 })).toBe(false)
    expect(itemOptionsRelevant({ itemProfile: null, attachedCount: 0, projectListCount: 0 })).toBe(false)
  })

  it('the wizard drops the Options step when it is not relevant', () => {
    const c = { itemProfile: 'product' as const, categoryCount: 0, locales: ['it'] }
    expect(itemWizardSteps({ ...c, showOptions: false })).toEqual(['profile', 'name', 'photo', 'price', 'page', 'preview', 'publish'])
    expect(itemWizardSteps({ ...c, showOptions: true })).toContain('options')
    expect(itemWizardSteps(c)).toContain('options')
  })
})

describe('book details and the advice severity (Amendment I-3.3)', () => {
  const book = (isbn: string, over: Partial<ItemState> = {}): Partial<ItemState> => ({ itemProfile: 'book', bookDetails: { author: '', publisher: '', year: '', isbn }, ...over })

  it('a book with only a title has no issues: nothing in the book details is mandatory', () => {
    expect(ids(book(''))).toEqual([])
  })

  it('a valid ISBN (hyphens and spaces ignored) raises nothing', () => {
    expect(ids(book('978-0-345-39180-3'))).toEqual([])
    expect(ids(book('0 345 39180 2'))).toEqual([])
  })

  it('an ISBN that does not check out is advice only', () => {
    const issues = itemIssues({ ...base, ...book('9780345391804') }, ctx)
    expect(issues.map((i) => [i.id, i.severity, i.tab])).toEqual([['isbn', 'advice', 'content']])
    expect(issues[0].focus).toBe('[data-book-isbn]')
  })

  it('advice never blocks Next, never blocks publishing, and is not counted on a tab', () => {
    const issues = itemIssues({ ...base, ...book('12345') }, ctx)
    expect(issues).toHaveLength(1)
    expect(blocksNextOn(issues, 'name')).toEqual([])
    expect(publishBlockers(issues)).toEqual([])
    expect(issueCountByTab(issues)).toEqual({})
    expect([...adviceTabs(issues)]).toEqual(['content'])
  })

  it('advice sits next to real blockers without changing them', () => {
    const issues = itemIssues({ ...base, ...book('12345', { name: {} }) }, ctx)
    expect(issues.map((i) => i.id)).toEqual(['name', 'isbn'])
    expect(publishBlockers(issues).map((i) => i.id)).toEqual(['name'])
    expect(issueCountByTab(issues)).toEqual({ content: 1 })
  })

  it('a missing book title asks for a title, not a name', () => {
    const [i] = itemIssues({ ...base, ...book('', { name: {} }) }, ctx)
    expect([i.id, i.messageKey]).toEqual(['name', 'bookTitle'])
  })

  it('hidden book details (type changed away from book) raise no advice', () => {
    expect(ids({ itemProfile: 'product', bookDetails: { author: 'x', publisher: '', year: '', isbn: '12345' } })).toEqual([])
  })
})
