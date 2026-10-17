/**
 * Studio-side rules of ADR-033 Amendment D: Studio must not be able to publish
 * what the dashboard refuses (D-3 allergens, D-7 addresses), and the listing
 * section's settings are the D-3 / D-6 shapes.
 */
import { describe, expect, it } from 'vitest'
import { catalogueCollection, catalogueItem, catalogueListingSection, catalogueOption, catalogueOptionList, OPTION_LIST_FOOD_USERS_QUERY, slugsWithoutName, studioChoiceProblem, studioOptionListProblem } from '../schema'

type Field = { name: string; type: string; validation?: (rule: unknown) => unknown; options?: { list?: Array<{ value: string }> }; initialValue?: unknown; fields?: Field[] }
const fieldsOf = (t: unknown) => (t as { fields: Field[] }).fields
const field = (t: unknown, name: string) => fieldsOf(t).find((f) => f.name === name)!

/** Runs a field's Rule.custom validator (the only rule these fields use). */
function validator(f: Field): (value: unknown, context: unknown) => true | string {
  let fn: ((value: unknown, context: unknown) => true | string) | null = null
  const rule: Record<string, unknown> = {}
  rule.custom = (v: typeof fn) => ((fn = v), rule)
  f.validation!(rule)
  return fn!
}

describe('catalogueItem (D-2, D-3)', () => {
  it('itemProfile replaces itemType, with no business default', () => {
    expect(fieldsOf(catalogueItem).some((f) => f.name === 'itemType')).toBe(false)
    const p = field(catalogueItem, 'itemProfile')
    expect(p.options!.list!.map((o) => o.value)).toEqual(['book', 'foodOrDrink', 'product', 'service'])
    expect(p.initialValue).toBeUndefined()
  })
  it('the allergen declaration replaces allergens[]; a new one starts notReviewed', () => {
    expect(fieldsOf(catalogueItem).some((f) => f.name === 'allergens')).toBe(false)
    expect(field(catalogueItem, 'allergenDeclaration').initialValue).toEqual({ status: 'notReviewed' })
  })
  it('Studio cannot publish food that is not reviewed or incomplete (validation ERROR); other profiles are not checked', () => {
    const v = validator(field(catalogueItem, 'allergenDeclaration'))
    const food = { document: { itemProfile: 'foodOrDrink' } }
    expect(v({ status: 'notReviewed' }, food)).toMatch(/Review the allergens/)
    expect(v(undefined, food)).toMatch(/Review the allergens/)
    expect(v({ status: 'containsListedAllergens', allergens: [] }, food)).toMatch(/at least one/)
    expect(v({ status: 'noneDeclared' }, food)).toMatch(/confirmed/)
    expect(v({ status: 'containsListedAllergens', allergens: ['coffee'] }, food)).toMatch(/Unknown allergen/)
    expect(v({ status: 'noneDeclared', confirmed: true }, food)).toBe(true)
    expect(v({ status: 'notReviewed' }, { document: { itemProfile: 'product' } })).toBe(true)
  })
})

describe('slug needs a name in its language (D-7)', () => {
  it('helper', () => {
    expect(slugsWithoutName({ it: { current: 'a' } }, { it: 'A' })).toBe(true)
    expect(slugsWithoutName({ it: { current: 'a' }, en: { current: 'a' } }, { it: 'A', en: ' ' })).toMatch(/\(en\)/)
    expect(slugsWithoutName({ _type: 'localizedSlug', en: { current: '' } }, {})).toBe(true)
    expect(slugsWithoutName(undefined, {})).toBe(true)
  })
  it('is the Studio validation on BOTH item and collection slugs', () => {
    for (const t of [catalogueItem, catalogueCollection]) {
      const v = validator(field(t, 'slug'))
      expect(v({ en: { current: 'x' } }, { document: { name: { it: 'X' } } })).toMatch(/name in the same language/)
      expect(v({ it: { current: 'x' } }, { document: { name: { it: 'X' } } })).toBe(true)
    }
  })
})

describe('catalogueListingSection (D-3, D-6)', () => {
  it('showPrices is three-state, default "default"; showAllergens is gone; allergenPresentation compact | expanded', () => {
    const sp = field(catalogueListingSection, 'showPrices')
    expect(sp.type).toBe('string')
    expect(sp.options!.list!.map((o) => o.value)).toEqual(['default', 'show', 'hide'])
    expect(sp.initialValue).toBe('default')
    expect(fieldsOf(catalogueListingSection).some((f) => f.name === 'showAllergens')).toBe(false)
    const ap = field(catalogueListingSection, 'allergenPresentation')
    expect(ap.options!.list!.map((o) => o.value)).toEqual(['compact', 'expanded'])
    expect(ap.initialValue).toBe('compact')
  })
})

describe('catalogueOption allergens (D-3a)', () => {
  const decl = () => field(catalogueOption, 'allergenDeclaration') as Field & { hidden: (x: { parent: unknown }) => boolean }
  it('an explicit-state object without a note, starting notReviewed; hidden for remove and linked choices', () => {
    const f = decl()
    expect(f.type).toBe('object')
    expect(f.fields!.map((x) => x.name)).toEqual(['status', 'allergens', 'mayContain', 'confirmed'])
    expect(f.initialValue).toEqual({ status: 'notReviewed' })
    expect(f.hidden({ parent: { kind: 'remove' } })).toBe(true)
    expect(f.hidden({ parent: { kind: 'add', item: { _ref: 'x' } } })).toBe(true)
    expect(f.hidden({ parent: { kind: 'add' } })).toBe(false)
  })
  it('Studio on the list: shape errors are errors, incomplete is a warning, notReviewed passes (Studio cannot see which items use the list)', () => {
    const levels: string[] = []
    const fns: Array<(v: unknown) => true | string> = []
    const rule = { custom: (fn: (v: unknown) => true | string) => ({ error: () => (levels.push('error'), fns.push(fn)), warning: () => (levels.push('warning'), fns.push(fn)) }) }
    decl().validation!(rule)
    expect(levels).toEqual(['error', 'warning'])
    const [errorFn, warnFn] = fns
    expect(errorFn({ status: 'containsListedAllergens', allergens: ['coffee'] })).toMatch(/Unknown/)
    expect(errorFn({ status: 'notReviewed' })).toBe(true)
    expect(warnFn({ status: 'containsListedAllergens', allergens: [] })).toMatch(/at least one/)
    expect(warnFn({ status: 'notReviewed' })).toBe(true)
  })
  it('Studio on the food ITEM: an unreviewed extra of an attached list blocks publishing (published list first, else its draft)', async () => {
    const v = validator(field(catalogueItem, 'optionLists')) as unknown as (value: unknown, context: unknown) => Promise<true | string>
    const rows = [
      { _id: 'ol', name: { it: 'Extra' }, options: [{ _key: 'a', label: { it: 'Mozzarella' }, kind: 'add', allergenDeclaration: { status: 'notReviewed' } }] },
      { _id: 'drafts.ol', name: { it: 'Extra' }, options: [] },
    ]
    const context = (itemProfile: string) => ({ document: { itemProfile }, getClient: () => ({ fetch: async () => rows }) })
    const value = [{ list: { _ref: 'ol' } }]
    expect(await v(value, context('foodOrDrink'))).toMatch(/"Mozzarella" in the option list "Extra"/)
    expect(await v(value, context('product'))).toBe(true)
    expect(studioChoiceProblem(['ol'], [rows[1]].map((r) => ({ ...r, _id: 'drafts.ol' })))).toBe(true)
    expect(await v(value, { document: { itemProfile: 'foodOrDrink' }, getClient: () => ({ fetch: async () => { throw new Error('offline') } }) })).toBe(true)
  })
})

describe('Studio enforces the option-list side of D-3a (ADR-033 E-2)', () => {
  const optionsRules = () => {
    const f = field(catalogueOptionList, 'options')
    const out: Array<{ level: string; fn: (v: unknown, c: unknown) => unknown }> = []
    const rule = {
      min: () => ({ error: () => out.push({ level: 'error', fn: () => true }) }),
      custom: (fn: (v: unknown, c: unknown) => unknown) => ({ error: () => out.push({ level: 'error', fn }), warning: () => out.push({ level: 'warning', fn }) }),
    }
    f.validation!(rule)
    return out
  }
  const unreviewed = [{ _key: 'a', label: { it: 'Mozzarella' }, kind: 'add', allergenDeclaration: { status: 'notReviewed' } }]
  const reviewed = [{ _key: 'a', label: { it: 'Mozzarella' }, kind: 'add', allergenDeclaration: { status: 'noneDeclared', confirmed: true } }]
  const ctxWith = (users: unknown, calls: unknown[] = []) => ({
    document: { _id: 'drafts.ol-1', projectSlug: 'lucia' },
    getClient: () => ({ fetch: async (...args: unknown[]) => (calls.push(args), typeof users === 'function' ? (users as () => unknown)() : users) }),
  })
  it('is an ERROR-level async rule on options', () => {
    expect(optionsRules().map((r) => r.level)).toEqual(['error', 'error'])
  })
  it('names the food items using the list; queries raw perspective, scoped to the project, by the published id', async () => {
    const check = optionsRules()[1].fn
    const calls: unknown[][] = []
    const r = await check(unreviewed, ctxWith([{ _id: 'drafts.i1', name: { it: 'Margherita' } }, { _id: 'i1', name: { it: 'Margherita' } }, { _id: 'i2', name: { it: 'Diavola' } }], calls))
    expect(r).toBe('Review the allergens of "Mozzarella": food items use this list (Margherita, Diavola).')
    const [q, params, opts] = calls[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(q).toBe(OPTION_LIST_FOOD_USERS_QUERY)
    expect(params).toEqual({ id: 'ol-1', projectSlug: 'lucia' })
    expect(opts).toEqual({ perspective: 'raw' })
  })
  it('passes when no food item uses it, or every extra is reviewed (no read at all then)', async () => {
    const check = optionsRules()[1].fn
    expect(await check(unreviewed, ctxWith([]))).toBe(true)
    const calls: unknown[][] = []
    expect(await check(reviewed, ctxWith([{ _id: 'i1' }], calls))).toBe(true)
    expect(calls).toEqual([])
  })
  it('fails CLOSED when the check cannot run', async () => {
    const check = optionsRules()[1].fn
    expect(await check(unreviewed, ctxWith(() => { throw new Error('offline') }))).toMatch(/Could not check/)
  })
  it('the query finds drafts and weak references, excludes archived, non-food and other projects (groq-js)', async () => {
    const { evaluate, parse } = await import('groq-js')
    const dataset = [
      { _id: 'drafts.a', _type: 'catalogueItem', projectSlug: 'lucia', itemProfile: 'foodOrDrink', name: 'A', optionLists: [{ list: { _type: 'reference', _ref: 'ol-1', _weak: true } }] },
      { _id: 'b', _type: 'catalogueItem', projectSlug: 'lucia', itemProfile: 'foodOrDrink', name: 'B', optionLists: [{ list: { _type: 'reference', _ref: 'ol-1' } }] },
      { _id: 'c', _type: 'catalogueItem', projectSlug: 'lucia', itemProfile: 'foodOrDrink', archivedAt: '2026-01-01', optionLists: [{ list: { _ref: 'ol-1' } }] },
      { _id: 'd', _type: 'catalogueItem', projectSlug: 'lucia', itemProfile: 'product', optionLists: [{ list: { _ref: 'ol-1' } }] },
      { _id: 'e', _type: 'catalogueItem', projectSlug: 'other', itemProfile: 'foodOrDrink', optionLists: [{ list: { _ref: 'ol-1' } }] },
    ]
    const v = (await (await evaluate(parse(OPTION_LIST_FOOD_USERS_QUERY), { dataset, params: { id: 'ol-1', projectSlug: 'lucia' } })).get()) as Array<{ _id: string }>
    expect(v.map((x) => x._id).sort()).toEqual(['b', 'drafts.a'])
  })
  it('studioOptionListProblem shares the dashboard helper', () => {
    expect(studioOptionListProblem(unreviewed, [])).toBe(true)
    expect(studioOptionListProblem([{ _key: 'r', kind: 'remove' }], [{ _id: 'i' }])).toBe(true)
  })
})
