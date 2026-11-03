/**
 * C1.12.4 (D-22) studio/validation — Studio's critical validation runs the same applicability rule
 * (break-glass protection; Studio stays read-only, C9) and refuses malformed "Use for" values.
 */
import { describe, expect, it } from 'vitest'
import { catalogueItem, catalogueOptionList } from '../schema'
import { catalogueCategory, catalogueTag } from '../schema-taxonomy'
import { profilesWith } from '../profiles'

const FOOD = profilesWith('foodInformation')[0]
type Field = { name: string; validation?: (rule: unknown) => unknown }
const field = (t: unknown, name: string) => (t as { fields: Field[] }).fields.find((f) => f.name === name)!

/** Collects every Rule.custom validator of a field (arrays of rules included). */
function customs(f: Field): Array<(value: unknown, context: unknown) => unknown> {
  const out: Array<(value: unknown, context: unknown) => unknown> = []
  const rule: Record<string, unknown> = {}
  const self = () => rule
  rule.custom = (fn: (value: unknown, context: unknown) => unknown) => (out.push(fn), rule)
  for (const k of ['required', 'error', 'warning', 'min', 'max']) rule[k] = self
  f.validation!(rule)
  return out
}

const TAXONOMY = {
  categories: [
    { key: 'books', label: { en: 'Books' }, order: 1000, useFor: ['book'] },
    { key: 'design', label: { en: 'Design' }, parentKey: 'books', order: 1000 },
  ],
  tags: [],
}

describe('studio/validation (C1.12.4)', () => {
  const [check] = customs(field(catalogueItem, 'itemProfile'))
  const ctx = (doc: Record<string, unknown>, answer: unknown) => {
    const calls: unknown[][] = []
    return { calls, context: { document: { projectSlug: 'tmz', ...doc }, getClient: () => ({ fetch: async (...a: unknown[]) => (calls.push(a), typeof answer === 'function' ? (answer as () => unknown)() : answer) }) } }
  }

  it('an incompatible primary category is a validation ERROR naming it; the query is project-scoped', async () => {
    const c = ctx({ primaryCategory: 'design' }, { taxonomy: TAXONOMY, lists: [] })
    expect(await check(FOOD, c.context)).toMatch(/Main category "Books › Design" isn't used for/)
    expect(c.calls[0][1]).toMatchObject({ projectSlug: 'tmz', taxonomyId: 'catalogue-taxonomy.tmz' })
  })
  it('compatible → true; option lists are read drafts included', async () => {
    const c = ctx({ primaryCategory: 'design', optionLists: [{ list: { _ref: 'l1' } }] }, { taxonomy: TAXONOMY, lists: [{ _id: 'drafts.l1', useFor: ['book'] }] })
    expect(await check('book', c.context)).toBe(true)
    expect(c.calls[0][1]).toMatchObject({ ids: ['l1'], draftIds: ['drafts.l1'] })
    expect(c.calls[0][2]).toEqual({ perspective: 'raw' })
  })
  it('fails closed when the read fails', async () => {
    const c = ctx({ primaryCategory: 'design' }, () => {
      throw new Error('offline')
    })
    expect(await check(FOOD, c.context)).toMatch(/Could not check/)
  })

  it('"Use for" fields refuse unknown ids, and a value on a non-root category', () => {
    const [cat] = customs(field(catalogueCategory, 'useFor'))
    expect(cat(['book'], { parent: {} })).toBe(true)
    expect(cat(['all'], { parent: {} })).toMatch(/Unknown item type/)
    expect(cat(['book'], { parent: { parentKey: 'books' } })).toMatch(/Only a top-level category/)
    const [tag] = customs(field(catalogueTag, 'useFor'))
    expect(tag(['book'], { parent: {} })).toBe(true)
    expect(tag(['nope'], { parent: {} })).toMatch(/Unknown item type/)
    expect(customs(field(catalogueOptionList, 'useFor'))).toHaveLength(1)
  })
})
