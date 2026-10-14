import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { VISIBILITY_BY_CONTEXT, admits, isIndexable, visibilityFilter, visibilityOf, type CatalogueDeliveryContext } from '../visibility'

const docs = [
  { _id: 'p', _type: 'x', visibility: 'public' },
  { _id: 'w', _type: 'x', visibility: 'websiteOnly' },
  { _id: 'u', _type: 'x', visibility: 'unlisted' },
  { _id: 'n', _type: 'x' },
]

async function ids(context: CatalogueDeliveryContext) {
  const r = await (await evaluate(parse(`*[_type == "x" && ${visibilityFilter(context)}]._id`), { dataset: docs })).get()
  return (r as string[]).sort()
}

describe('catalogue visibility by context (ADR-033 C5/C10/C11)', () => {
  it('is the agreed table', () => {
    expect(VISIBILITY_BY_CONTEXT).toEqual({
      automaticListing: ['public', 'websiteOnly'],
      explicitReference: ['public', 'websiteOnly', 'unlisted'],
      partner: ['public'],
      sitemap: ['public', 'websiteOnly'],
      structuredData: ['public', 'websiteOnly'],
    })
  })

  it.each([
    ['automaticListing', ['n', 'p', 'w']],
    ['explicitReference', ['n', 'p', 'u', 'w']],
    ['partner', ['n', 'p']],
    ['sitemap', ['n', 'p', 'w']],
    ['structuredData', ['n', 'p', 'w']],
  ] as const)('GROQ %s admits %j (missing = public)', async (ctx, expected) => {
    expect(await ids(ctx)).toEqual(expected)
  })

  it('TypeScript agrees with GROQ in every context', () => {
    for (const ctx of Object.keys(VISIBILITY_BY_CONTEXT) as CatalogueDeliveryContext[]) {
      for (const d of docs) expect(admits(ctx, d.visibility), `${ctx}/${d._id}`).toBe(VISIBILITY_BY_CONTEXT[ctx].includes(visibilityOf(d.visibility)))
    }
  })

  it('unknown values read as public; unlisted pages are noindex', () => {
    expect(visibilityOf('weird')).toBe('public')
    expect(isIndexable('unlisted')).toBe(false)
    expect(isIndexable(undefined)).toBe(true)
  })

  it('supports a dereference path', () => {
    expect(visibilityFilter('partner', '@->')).toBe('(!defined(@->visibility) || @->visibility in ["public"])')
  })
})
