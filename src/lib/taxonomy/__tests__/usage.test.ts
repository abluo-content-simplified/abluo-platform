import { describe, it, expect } from 'vitest'
import { buildUsageQuery, toLogicalItems, summarizeUsage } from '../usage'

describe('buildUsageQuery', () => {
  it('is always scoped by $projectSlug and filters on the key', () => {
    const q = buildUsageQuery([{ type: 'catalogueItem', field: 'categories' }], 'fiction')
    expect(q.query).toContain('projectSlug == $projectSlug')
    expect(q.query).toContain('_type == "catalogueItem" && $key in coalesce(categories, [])')
    expect(q.params).toEqual({ key: 'fiction' })
    expect(q.perspective).toBe('raw')
    expect(q.params).not.toHaveProperty('projectSlug')
  })
  it('combines several declared fields with OR, inside the project scope', () => {
    const q = buildUsageQuery([{ type: 'a', field: 'x' }, { type: 'b', field: 'y' }], 'k')
    expect(q.query).toMatch(/^\*\[projectSlug == \$projectSlug && \(.*\|\|.*\)\]/)
  })
  it('refuses empty or non-identifier declarations (no GROQ injection)', () => {
    expect(() => buildUsageQuery([], 'k')).toThrow()
    expect(() => buildUsageQuery([{ type: 'a" || true', field: 'x' }], 'k')).toThrow()
    expect(() => buildUsageQuery([{ type: 'a', field: 'x]; *[' }], 'k')).toThrow()
  })
})

describe('logical items', () => {
  it('counts draft + published of one document once; archived and distinct docs count', () => {
    const rows = [
      { _id: 'item1', _type: 'catalogueItem', name: { en: 'Published name' } },
      { _id: 'drafts.item1', _type: 'catalogueItem', name: { en: 'Draft name' } },
      { _id: 'drafts.item2', _type: 'catalogueItem', name: { en: 'Only draft' } },
      { _id: 'item3', _type: 'catalogueItem', name: { en: 'Archived one' } },
    ]
    const items = toLogicalItems(rows)
    expect(items.map((i) => i.id)).toEqual(['item1', 'item2', 'item3'])
    expect(items[0].name).toEqual({ en: 'Draft name' })
    expect(summarizeUsage(rows)).toMatchObject({ count: 3, inUse: true })
  })
  it('empty means unused', () => {
    expect(summarizeUsage([])).toEqual({ count: 0, items: [], inUse: false })
  })
})

describe('usage counts for a whole list', () => {
  it('builds one scoped, validated query over every declared type', async () => {
    const { buildUsageCountsQuery } = await import('../usage')
    const q = buildUsageCountsQuery([{ type: 'catalogueItem', field: 'categories' }, { type: 'post', field: 'tags' }])
    expect(q.perspective).toBe('raw')
    expect(q.query).toContain('projectSlug == $projectSlug')
    expect(q.query).toContain('_type == "post" => coalesce(tags, [])')
    expect(() => buildUsageCountsQuery([])).toThrow()
    expect(() => buildUsageCountsQuery([{ type: 'x"] || true', field: 'f' }])).toThrow()
  })

  it('counts logical documents per key (draft + published once, either copy counts)', async () => {
    const { countUsageByKey } = await import('../usage')
    const counts = countUsageByKey([
      { _id: 'a', _type: 't', keys: ['x', 'y'] },
      { _id: 'drafts.a', _type: 't', keys: ['x'] },
      { _id: 'drafts.b', _type: 't', keys: ['x', 'x'] },
      { _id: 'c', _type: 't', keys: null },
    ])
    expect(counts.get('x')).toBe(2)
    expect(counts.get('y')).toBe(1)
    expect(counts.has('z')).toBe(false)
  })
})
