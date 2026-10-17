import { describe, expect, it } from 'vitest'
import { buildNewTerm, isTermManagedConfigField, taxonomyModules, termListFilter, usageQueryForTerm } from '../studio'
import { parseTermId } from '../ids'

const registry = [
  { id: 'blog', label: 'Blog' },
  { id: 'catalogue', label: 'Catalogue', taxonomies: [{ kind: 'category' as const, usedBy: [{ type: 'catalogueItem', field: 'categories' }] }] },
]
const base = { projectSlug: 'tmz', module: 'catalogue', kind: 'category' as const, defaultLocale: 'it', existingKeys: [], existingOrders: [], now: '2026-10-17T00:00:00Z' }

describe('termListFilter', () => {
  it('always scopes by project', () => {
    expect(termListFilter('tmz')).toEqual({ filter: '_type == "taxonomyTerm" && projectSlug == $projectSlug', params: { projectSlug: 'tmz' } })
  })
  it('narrows by module and kind', () => {
    const r = termListFilter('tmz', 'catalogue', 'tag')
    expect(r.filter).toContain('module == $module')
    expect(r.filter).toContain('kind == $kind')
    expect(r.params).toEqual({ projectSlug: 'tmz', module: 'catalogue', kind: 'tag' })
  })
})

describe('buildNewTerm', () => {
  it('creates a doc with the deterministic id matching its key', () => {
    const r = buildNewTerm({ ...base, label: ' Letteratura ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc._id).toBe('term.tmz.catalogue.category.letteratura')
    expect(parseTermId(r.doc._id as string)).toMatchObject({ key: r.doc.key })
    expect(r.doc.label).toEqual({ _type: 'localizedString', it: 'Letteratura' })
    expect(r.doc.order).toBe(1000)
  })
  it('suffixes a colliding key and appends order', () => {
    const r = buildNewTerm({ ...base, label: 'Pizza', existingKeys: ['pizza'], existingOrders: [1000, 2000] })
    expect(r.ok && r.doc._id).toBe('term.tmz.catalogue.category.pizza_2')
    expect(r.ok && r.doc.order).toBe(3000)
  })
  it('rejects an empty label', () => {
    expect(buildNewTerm({ ...base, label: '  ' }).ok).toBe(false)
  })
})

describe('usage and modules pane helpers', () => {
  it('finds the usage query from the module declaration', () => {
    expect(usageQueryForTerm(registry, { module: 'catalogue', kind: 'category', key: 'x' })?.params).toEqual({ key: 'x' })
    expect(usageQueryForTerm(registry, { module: 'blog', kind: 'category', key: 'x' })).toBeNull()
  })
  it('lists taxonomy modules only', () => {
    expect(taxonomyModules(registry).map((m) => m.id)).toEqual(['catalogue'])
  })
  it('hides only catalogue categories from the Modules pane', () => {
    expect(isTermManagedConfigField('catalogue', 'categories')).toBe(true)
    expect(isTermManagedConfigField('blog', 'categories')).toBe(false)
    expect(isTermManagedConfigField('catalogue', 'dietaryTags')).toBe(false)
  })
})
