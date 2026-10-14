/**
 * Catalogue dashboard — server-side patch validation (spec §11). Every value
 * is rebuilt; the reserved offer fields are never taken from the client.
 */
import { describe, expect, it } from 'vitest'
import { CatalogueError, cleanAttachments, cleanCatalogueSet, cleanOffers, cleanOptions, cleanSections, slugLocalesWithoutName, slugsForPublish, type PatchContext } from '../dashboard-patch'

let n = 0
const ctx = (o: Partial<PatchContext> = {}): PatchContext => ({
  locales: new Set(['it', 'en']),
  channels: ['dine-in', 'takeaway'],
  categories: ['pizza'],
  dietary: ['vegan'],
  previous: {},
  newKey: () => `k${++n}`,
  ...o,
})
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CatalogueError ? e.code : 'other'
  }
  return 'ok'
}

describe('allowlist', () => {
  it('refuses fields outside the kind, and slugs on option lists', () => {
    expect(code(() => cleanCatalogueSet('item', { publicId: 'x' }, ctx()))).toBe('invalid_field')
    expect(code(() => cleanCatalogueSet('item', { 'offers.0.currency': 'CHF' }, ctx()))).toBe('invalid_field')
    expect(code(() => cleanCatalogueSet('optionList', { 'slug.it': 'x' }, ctx()))).toBe('invalid_field')
    expect(code(() => cleanCatalogueSet('collection', { offers: [] }, ctx()))).toBe('invalid_field')
    expect(code(() => cleanCatalogueSet('item', { 'name.fr': 'x' }, ctx()))).toBe('invalid_field')
  })
  it('localized text: trimmed set, empty unset, type ensured', () => {
    const r = cleanCatalogueSet('item', { 'name.it': '  Margherita ', 'description.en': '' }, ctx())
    expect(r.set).toEqual({ 'name.it': 'Margherita' })
    expect(r.unset).toEqual(['description.en'])
    expect(r.setIfMissing).toEqual({ name: { _type: 'localizedString' }, description: { _type: 'localizedText' } })
  })
  it('vocabularies come from config; allergens from the platform constant', () => {
    const food = ctx({ previous: { itemProfile: 'foodOrDrink' } })
    expect(code(() => cleanCatalogueSet('item', { categories: ['wine'] }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['gluten', 'coffee'] } }, food))).toBe('invalid_value')
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten', 'milk'] } }, food).set.allergenDeclaration).toEqual({
      status: 'containsListedAllergens',
      allergens: ['gluten', 'milk'],
    })
    expect(cleanCatalogueSet('item', { categories: [] }, ctx()).unset).toEqual(['categories'])
    expect(code(() => cleanCatalogueSet('item', { allergens: ['milk'] }, food))).toBe('invalid_field')
  })
  it('slug: normalised, collected for the namespace check', () => {
    const r = cleanCatalogueSet('item', { 'slug.it': 'Pizza Margherita' }, ctx({ previous: { name: { it: 'Margherita' } } }))
    expect(r.set['slug.it']).toEqual({ _type: 'slug', current: 'pizza-margherita' })
    expect(r.slugs).toEqual({ it: 'pizza-margherita' })
    expect(r.setIfMissing.slug).toEqual({ _type: 'localizedSlug' })
  })
  it('photos are references to collect and check', () => {
    const r = cleanCatalogueSet('item', { images: ['m1', 'm2'] }, ctx())
    expect(r.refs.mediaAssets).toEqual(['m1', 'm2'])
    expect((r.set.images as Array<{ _ref: string }>).map((i) => i._ref)).toEqual(['m1', 'm2'])
  })
})

describe('offers', () => {
  it('rebuilds without currency; keeps a stored locationKey for the same key only', () => {
    const out = cleanOffers(
      [{ _key: 'a', channel: 'dine-in', price: 8.5, currency: 'CHF', locationKey: 'evil' }, { _key: 'b', price: 0 }],
      ctx({ previous: { offers: [{ _key: 'a', locationKey: 'centro' }] } })
    )
    expect(out[0]).toEqual({ _key: 'a', _type: 'catalogueOffer', channel: 'dine-in', price: 8.5, locationKey: 'centro' })
    expect(out[1]).toEqual({ _key: 'b', _type: 'catalogueOffer', price: 0 })
    expect(JSON.stringify(out)).not.toContain('currency')
    expect(JSON.stringify(out)).not.toContain('evil')
  })
  it('refuses negative / 3-decimal prices, unknown channels, from = to, overlap in one scope', () => {
    expect(code(() => cleanOffers([{ price: -1 }], ctx()))).toBe('invalid_value')
    expect(code(() => cleanOffers([{ price: 1.005 }], ctx()))).toBe('invalid_value')
    expect(code(() => cleanOffers([{ price: 1, channel: 'delivery' }], ctx()))).toBe('invalid_value')
    expect(code(() => cleanOffers([{ price: 1, availability: [{ from: '10:00', to: '10:00' }] }], ctx()))).toBe('invalid_value')
    expect(code(() => cleanOffers([{ price: 1, channel: 'dine-in' }, { price: 2, channel: 'dine-in' }], ctx()))).toBe('invalid_value')
    expect(code(() => cleanOffers([{ price: 1, channel: 'dine-in' }, { price: 2 }], ctx()))).toBe('ok')
    expect(code(() => cleanOffers([{ price: 1, availability: [{ days: ['fri'], from: '18:00', to: '02:00' }] }], ctx()))).toBe('ok')
  })
})

describe('attachments, options', () => {
  it('min ≤ max; max above the list size is allowed (a warning in the UI)', () => {
    expect(code(() => cleanAttachments([{ listId: 'L', min: 3, max: 1 }], () => 'k'))).toBe('invalid_value')
    const r = cleanAttachments([{ listId: 'L', min: 0, max: 50 }, { listId: 'L', min: 1 }], () => `k${++n}`)
    expect(r.lists).toEqual(['L'])
    expect(r.value[1]).toMatchObject({ _type: 'catalogueItemOptionList', list: { _type: 'reference', _ref: 'L' }, min: 1 })
    expect(r.value[1]).not.toHaveProperty('max')
  })
  it('options: kind add/remove, signed price change, optional linked item', () => {
    const r = cleanOptions([{ label: { it: 'Acciughe' }, kind: 'add', priceDelta: 1.5, itemId: 'item-9' }, { label: { it: 'Senza mozzarella' }, kind: 'remove', priceDelta: -1 }], new Set(['it']), () => `k${++n}`)
    expect(r.items).toEqual(['item-9'])
    expect(r.value[1]).toMatchObject({ kind: 'remove', priceDelta: -1 })
    expect(code(() => cleanOptions([{ kind: 'swap' }], new Set(['it']), () => 'k'))).toBe('invalid_value')
  })
})

describe('sections (ADR-033 A7)', () => {
  const s = (k: string, p?: string) => ({ _key: k, name: { it: k }, ...(p ? { parentKey: p } : {}), items: [] })
  it('refuses creating a new orphan, accepts a pre-existing one untouched', () => {
    expect(code(() => cleanSections([s('a'), s('b', 'ghost')], ctx()))).toBe('invalid_value')
    const previous = { sections: [s('a'), s('b', 'ghost')] }
    expect(code(() => cleanSections([s('a'), s('b', 'ghost'), s('c', 'a')], ctx({ previous })))).toBe('ok')
    const out = cleanSections([s('a'), s('b', 'ghost')], ctx({ previous })).value
    expect(out[1]).toMatchObject({ _key: 'b', parentKey: 'ghost' })
  })
  it('refuses a new cycle and duplicate keys', () => {
    expect(code(() => cleanSections([s('a', 'b'), s('b', 'a')], ctx()))).toBe('invalid_value')
    expect(code(() => cleanSections([s('a'), s('a')], ctx()))).toBe('invalid_value')
  })
  it('items become references and are collected for the check', () => {
    const r = cleanSections([{ _key: 'a', name: {}, items: ['i1', 'i2'] }], ctx())
    expect(r.items).toEqual(['i1', 'i2'])
    expect((r.value[0].items as Array<{ _ref: string }>).map((x) => x._ref)).toEqual(['i1', 'i2'])
  })
})

describe('slugsForPublish (D11)', () => {
  it('explicit slugs kept; missing ones derived from the name and suffixed until free', () => {
    const r = slugsForPublish({
      names: { it: 'Margherita', en: 'Margherita' },
      slugs: { it: 'la-margherita' },
      locales: ['it', 'en', 'de'],
      taken: (l) => new Set(l === 'en' ? ['margherita', 'margherita-2'] : []),
      fallback: 'item',
    })
    expect(r).toEqual({ it: 'la-margherita', en: 'margherita-3' })
  })
})

describe('item profile + allergen declaration (ADR-033 D-2, D-3)', () => {
  const food = ctx({ previous: { itemProfile: 'foodOrDrink' } })
  it('profiles are foodOrDrink | product | service; the old itemType is refused', () => {
    expect(cleanCatalogueSet('item', { itemProfile: 'service' }, ctx()).set.itemProfile).toBe('service')
    expect(code(() => cleanCatalogueSet('item', { itemProfile: 'dish' }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { itemType: 'dish' }, ctx()))).toBe('invalid_field')
  })
  it('changing the profile TO food resets the declaration to notReviewed — whatever the patch says', () => {
    const r = cleanCatalogueSet('item', { itemProfile: 'foodOrDrink', allergenDeclaration: { status: 'noneDeclared', confirmed: true } }, ctx({ previous: { itemProfile: 'product' } }))
    expect(r.set.allergenDeclaration).toEqual({ status: 'notReviewed' })
  })
  it('staying food keeps the edit; away from food the declaration is removed and never stored', () => {
    expect(cleanCatalogueSet('item', { itemProfile: 'foodOrDrink' }, food).set.allergenDeclaration).toBeUndefined()
    const away = cleanCatalogueSet('item', { itemProfile: 'product' }, ctx({ previous: { itemProfile: 'foodOrDrink', allergenDeclaration: { status: 'notReviewed' } } }))
    expect(away.unset).toContain('allergenDeclaration')
    const nonFood = cleanCatalogueSet('item', { allergenDeclaration: { status: 'noneDeclared', confirmed: true } }, ctx({ previous: { itemProfile: 'service' } }))
    expect(nonFood.set.allergenDeclaration).toBeUndefined()
  })
  it('rebuilds with only the status\'s own fields; unknown fields and keys are refused', () => {
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'noneDeclared', confirmed: true, allergens: ['milk'] } }, food).set.allergenDeclaration).toEqual({ status: 'noneDeclared', confirmed: true })
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk'], mayContain: ['sesame'], note: { it: ' Forno ' } } }, food).set.allergenDeclaration).toEqual({
      status: 'containsListedAllergens',
      allergens: ['milk'],
      mayContain: ['sesame'],
      note: { _type: 'localizedText', it: 'Forno' },
    })
    expect(code(() => cleanCatalogueSet('item', { allergenDeclaration: { status: 'noneDeclared', glutenFree: true } }, food))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { allergenDeclaration: { status: 'allergenFree' } }, food))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { allergenDeclaration: { status: 'containsListedAllergens', mayContain: ['coffee'] } }, food))).toBe('invalid_value')
  })
  it('incomplete states save (publish refuses them)', () => {
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'containsListedAllergens', allergens: [] } }, food).set.allergenDeclaration).toEqual({ status: 'containsListedAllergens', allergens: [] })
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'noneDeclared' } }, food).set.allergenDeclaration).toEqual({ status: 'noneDeclared', confirmed: false })
  })
})

describe('a localized address needs a localized name (ADR-033 D-7)', () => {
  it('a slug in a language without a name is refused', () => {
    expect(code(() => cleanCatalogueSet('item', { 'slug.en': 'margherita' }, ctx({ previous: { name: { it: 'Margherita' } } })))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('collection', { 'slug.en': 'menu' }, ctx({ previous: { name: { it: 'Menù' } } })))).toBe('invalid_value')
  })
  it('a name written in the same patch is enough', () => {
    expect(cleanCatalogueSet('item', { 'name.en': 'Margherita', 'slug.en': 'margherita' }, ctx()).slugs).toEqual({ en: 'margherita' })
  })
  it('clearing the name never removes the address behind the editor\'s back (E-3)', () => {
    const r = cleanCatalogueSet('item', { 'name.en': '' }, ctx({ previous: { name: { it: 'A', en: 'B' }, slug: { en: { current: 'b' } } } }))
    expect(r.unset).toEqual(['name.en'])
  })
  it('the refusal names the language(s)', () => {
    try {
      cleanCatalogueSet('item', { 'slug.en': 'x', 'slug.de': 'y' }, ctx({ previous: { name: { it: 'A' } }, locales: new Set(['it', 'en', 'de']) }))
      throw new Error('not refused')
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogueError)
      expect((e as CatalogueError).detail?.locales).toEqual(['en', 'de'])
    }
  })
  it('slugLocalesWithoutName', () => {
    expect(slugLocalesWithoutName({ it: 'a', en: 'b' }, { it: 'A', en: ' ' })).toEqual(['en'])
  })
})

describe('option choices carry allergen declarations (ADR-033 D-3a)', () => {
  const opts = (value: unknown) => cleanOptions(value, new Set(['it']), () => 'k').value
  it('a free-text add choice defaults to notReviewed; its declaration is rebuilt without a note', () => {
    expect(opts([{ _key: 'a', label: { it: 'X' } }])[0].allergenDeclaration).toEqual({ status: 'notReviewed' })
    expect(opts([{ _key: 'a', label: { it: 'X' }, allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten'], mayContain: ['sesame'] } }])[0].allergenDeclaration).toEqual({
      status: 'containsListedAllergens',
      allergens: ['gluten', 'milk'],
      mayContain: ['sesame'],
    })
  })
  it('a note, an unknown key or an unknown status is refused', () => {
    expect(code(() => opts([{ _key: 'a', label: { it: 'X' }, allergenDeclaration: { status: 'noneDeclared', confirmed: true, note: { it: 'n' } } }]))).toBe('invalid_value')
    expect(code(() => opts([{ _key: 'a', label: { it: 'X' }, allergenDeclaration: { status: 'containsListedAllergens', allergens: ['coffee'] } }]))).toBe('invalid_value')
    expect(code(() => opts([{ _key: 'a', label: { it: 'X' }, allergenDeclaration: { status: 'allergenFree' } }]))).toBe('invalid_value')
  })
  it('remove and linked choices never store one — a remove never subtracts the item\'s allergens', () => {
    const out = opts([
      { _key: 'r', label: { it: 'Senza' }, kind: 'remove', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
      { _key: 'l', label: { it: 'Patatine' }, itemId: 'side', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
    ])
    expect(out.map((o) => 'allergenDeclaration' in o)).toEqual([false, false])
  })
})

describe('"none declared" keeps "may contain" (ADR-033 E-1)', () => {
  const food = ctx({ previous: { itemProfile: 'foodOrDrink' } })
  it('item declaration', () => {
    expect(cleanCatalogueSet('item', { allergenDeclaration: { status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts', 'gluten'] } }, food).set.allergenDeclaration).toEqual({
      status: 'noneDeclared', confirmed: true, mayContain: ['gluten', 'treeNuts'],
    })
  })
  it('option choice declaration', () => {
    const out = cleanOptions([{ _key: 'a', label: { it: 'X' }, allergenDeclaration: { status: 'noneDeclared', confirmed: true, mayContain: ['sesame'] } }], new Set(['it']), () => 'k').value
    expect(out[0].allergenDeclaration).toEqual({ status: 'noneDeclared', confirmed: true, mayContain: ['sesame'] })
  })
})
