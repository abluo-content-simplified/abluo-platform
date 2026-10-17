import { describe, it, expect } from 'vitest'
import { schemaTypes } from '@/lib/sanity/schema'
import { MODULE_REGISTRY } from '@/lib/modules'
import { taxonomyTermType } from '../schema'

describe('taxonomyTerm schema', () => {
  it('is registered once, as a liveEdit document', () => {
    const found = (schemaTypes as { name: string }[]).filter((t) => t.name === 'taxonomyTerm')
    expect(found).toHaveLength(1)
    expect(taxonomyTermType.liveEdit).toBe(true)
    expect(taxonomyTermType.type).toBe('document')
  })
  it('has the documented fields', () => {
    const names = (taxonomyTermType.fields as { name: string }[]).map((f) => f.name)
    expect(names).toEqual(['projectSlug', 'module', 'kind', 'key', 'label', 'order', 'color', 'description', 'redirectFrom', 'noindex', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
  })
  it('key is read-only once set', () => {
    const key = (taxonomyTermType.fields as { name: string; readOnly?: (c: { value?: unknown }) => boolean }[]).find((f) => f.name === 'key')!
    expect(key.readOnly!({ value: 'x' })).toBe(true)
    expect(key.readOnly!({ value: undefined })).toBe(false)
  })
})

describe('manifest taxonomies', () => {
  it('only catalogue declares one, a category used by catalogueItem.categories', () => {
    const declaring = MODULE_REGISTRY.filter((m) => m.taxonomies)
    expect(declaring.map((m) => m.id)).toEqual(['catalogue'])
    expect(declaring[0].taxonomies).toEqual([
      { kind: 'category', usedBy: [{ type: 'catalogueItem', field: 'categories' }] },
      { kind: 'tag', usedBy: [{ type: 'catalogueItem', field: 'tags' }] },
    ])
  })
})
