/**
 * R2 pre-release review fixes (R2 ships to production before data steps D1–D4 run on tmz):
 * the migration-pending guard, setup completion from a legacy preset record, stale category
 * keys, legacy offers that would not convert exactly, the allergen-content guard and the
 * Catalogue "Manage" link. Pure functions only; the services are covered in their own tests.
 */
import { describe, expect, it } from 'vitest'
import { manageHref } from '@/components/client/taxonomy/manage-href'
import { allergenContentChanged } from '../allergens'
import { readChannels } from '../commerce/channels'
import { itemStateFromDoc } from '../dashboard-form'
import { categoriesShape, commerceShape, convertedAssignment, legacyOffersNeedCheck } from '../item-writer'
import { migrationPending, unconvertedOfferItems } from '../migration-markers'
import { buildTree, validateAssignment } from '../taxonomy/tree'
import type { CategoryNode } from '../taxonomy/types'

const node = (key: string, archivedAt: string | null = null): CategoryNode => ({ key, label: { en: key }, parentKey: null, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt })
const TREE = buildTree([node('fiction'), node('poetry'), node('old', '2026-01-01T00:00:00Z')])
const refuse = (message: string, field: string): never => {
  throw Object.assign(new Error(message), { field })
}

describe('migrationPending (one pure guard)', () => {
  const DINE = { _key: 'c1', value: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available' }

  it('commerce: pending while the marker is missing and D2 has work (stored channels or unconverted offers)', () => {
    expect(migrationPending({ serviceChannels: [DINE] }, 'commerce')).toBe(true)
    expect(migrationPending({}, 'commerce')).toBe(false)
    expect(migrationPending({}, 'commerce', { unconvertedOfferItems: 3 })).toBe(true)
    expect(migrationPending({ serviceChannels: [DINE], catalogueMigrations: { commerce: '2026-11-04T10:00:00Z' } }, 'commerce', { unconvertedOfferItems: 3 })).toBe(false)
  })

  it('publicName: pending while the marker is missing and a non-empty navLabel exists', () => {
    expect(migrationPending({ navLabel: { _type: 'localizedString', en: 'Books' } }, 'publicName')).toBe(true)
    expect(migrationPending({ navLabel: { en: '  ' } }, 'publicName')).toBe(false)
    expect(migrationPending({ navLabel: { en: 'Books' }, catalogueMigrations: { publicName: '2026-11-04T10:00:00Z' } }, 'publicName')).toBe(false)
  })

  it('counts items with legacy offers and no formats', () => {
    expect(unconvertedOfferItems([{ offers: [{ price: 1 }] }, { offers: [{ price: 1 }], formats: [{ _key: 'default' }] }, { offers: [] }, {}])).toBe(1)
  })
})

describe('stale category keys', () => {
  it('validateAssignment accepts unknown / archived keys the item already had, refuses new ones', () => {
    const before = { primary: 'gone', additional: ['old'] }
    expect(validateAssignment(TREE, { primary: 'gone', additional: ['old', 'poetry'] }, before)).toEqual({ ok: true })
    expect(validateAssignment(TREE, { primary: 'fiction', additional: ['missing'] }, before)).toMatchObject({ ok: false, code: 'category_unknown' })
    expect(validateAssignment(TREE, { primary: 'old', additional: [] })).toMatchObject({ ok: false, code: 'category_archived_target' })
  })

  it('a legacy item with a stale key can still be saved (keys kept), and the editor shows the server’s primary', () => {
    const previous = { categories: ['gone', 'fiction'] }
    const patch = categoriesShape(previous, { additionalCategories: ['gone', 'poetry'] }, TREE, refuse)
    expect(patch).not.toBeNull()
    expect(convertedAssignment(previous.categories, TREE)).toEqual({ primary: 'fiction', additional: ['gone'] })
    // The editor's initial state uses the same D-15 rule as the first-save conversion.
    expect(itemStateFromDoc(previous, null, undefined, TREE).assignment).toEqual({ primary: 'fiction', additional: ['gone'] })
  })
})

describe('legacy offers that would not convert exactly are never silently lost', () => {
  const channels = readChannels([{ value: 'shop', label: { en: 'Shop' } }]).channels

  it('an unknown channel or a reserved field: offers kept, no formats written for that save', () => {
    const previous = { offers: [{ _key: 'o1', _type: 'catalogueOffer', price: 12, channel: 'delivery' }] }
    expect(legacyOffersNeedCheck(previous, channels)).toBe(true)
    const written = { formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'p', _type: 'cataloguePrice', amount: 5 }] }] }
    expect(commerceShape(previous, written, channels)).toBeNull()
    expect(legacyOffersNeedCheck({ offers: [{ _key: 'o1', price: 3, currency: 'USD' }] }, channels)).toBe(true)
  })

  it('offers that convert exactly still switch shape on the first save', () => {
    const previous = { offers: [{ _key: 'o1', _type: 'catalogueOffer', price: 12 }] }
    expect(legacyOffersNeedCheck(previous, channels)).toBe(false)
    const patch = commerceShape(previous, {}, channels)!
    expect(patch.unset).toContain('offers')
    expect(patch.set.formats).toBeDefined()
  })
})

describe('allergenContentChanged (support-mode guard)', () => {
  it('items: a changed or removed declaration counts; an equal one (key order, _type) does not', () => {
    const a = { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk'] } }
    expect(allergenContentChanged('item', a, { allergenDeclaration: { allergens: ['milk'], status: 'containsListedAllergens', _type: 'x' } })).toBe(false)
    expect(allergenContentChanged('item', a, { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'egg'] } })).toBe(true)
    expect(allergenContentChanged('item', a, {})).toBe(true)
    // A bare "not reviewed" says nothing: same as none.
    expect(allergenContentChanged('item', {}, { allergenDeclaration: { status: 'notReviewed' } })).toBe(false)
  })

  it('option lists: a choice declaration changed counts; a rename, a removed choice or a new unreviewed choice does not', () => {
    const before = { options: [{ _key: 'a', label: { en: 'Cheese' }, allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk'] } }, { _key: 'b' }] }
    expect(allergenContentChanged('optionList', before, { options: [{ ...before.options[0], label: { en: 'Brie' } }, { _key: 'c', allergenDeclaration: { status: 'notReviewed' } }] })).toBe(false)
    expect(allergenContentChanged('optionList', before, { options: [{ _key: 'a', allergenDeclaration: { status: 'noneDeclared', confirmed: true } }] })).toBe(true)
    expect(allergenContentChanged('collection', {}, { allergenDeclaration: { status: 'noneDeclared' } })).toBe(false)
  })
})

describe('TermPicker "Manage" link', () => {
  it('the Catalogue goes to Setup → Categories & Tags (tags tab for tags); other modules keep Categories & Tags', () => {
    expect(manageHref('tmz', 'catalogue', 'category')).toBe('/tmz/catalogue/setup/categories')
    expect(manageHref('tmz', 'catalogue', 'tag')).toBe('/tmz/catalogue/setup/categories?tab=tags')
    expect(manageHref('tmz', 'blog', 'category')).toBe('/tmz/taxonomy?module=blog&kind=category')
  })
})
