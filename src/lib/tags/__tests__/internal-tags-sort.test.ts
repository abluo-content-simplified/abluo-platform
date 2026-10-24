import { describe, expect, it } from 'vitest'
import { countTagsWithListed, findDuplicateTag, internalTagListId, rewriteListed, showTagSearch, sortTagCounts, TAG_SEARCH_THRESHOLD, tagMatchKey, type TagCount } from '../internal-tags'

const counts: TagCount[] = [
  { tag: 'zebra', count: 1 },
  { tag: 'Été', count: 3 },
  { tag: 'apple', count: 3 },
  { tag: 'Ecole', count: 7 },
  { tag: 'banana', count: 0 },
  { tag: 'tag 10', count: 1 },
  { tag: 'tag 2', count: 1 },
]
const tags = (c: TagCount[]) => c.map((x) => x.tag)

describe('tags manager order', () => {
  it('A–Z ignores case and accents and follows the language (numbers in order)', () => {
    expect(tags(sortTagCounts(counts, 'az', 'it'))).toEqual(['apple', 'banana', 'Ecole', 'Été', 'tag 2', 'tag 10', 'zebra'])
    expect(tags(sortTagCounts(counts, 'az', 'de'))).toEqual(['apple', 'banana', 'Ecole', 'Été', 'tag 2', 'tag 10', 'zebra'])
  })

  it('Most used: by count, ties A–Z', () => {
    expect(tags(sortTagCounts(counts, 'used', 'en'))).toEqual(['Ecole', 'apple', 'Été', 'tag 2', 'tag 10', 'zebra', 'banana'])
  })

  it('does not change the list it is given, and survives an unknown locale', () => {
    const before = tags(counts)
    sortTagCounts(counts, 'az', 'not a locale!!')
    expect(tags(counts)).toEqual(before)
  })
})

describe('tags manager search box', () => {
  it('shows only for lists longer than the threshold', () => {
    expect(TAG_SEARCH_THRESHOLD).toBe(20)
    expect(showTagSearch(0)).toBe(false)
    expect(showTagSearch(20)).toBe(false)
    expect(showTagSearch(21)).toBe(true)
  })
})

describe('duplicate tags (accent- and case-insensitive)', () => {
  it('"Été" and "ete" are the same tag', () => {
    expect(tagMatchKey('Été')).toBe(tagMatchKey('ete'))
    expect(tagMatchKey('Café  Bar')).toBe(tagMatchKey('cafe bar'))
    expect(tagMatchKey('Été')).not.toBe(tagMatchKey('Eta'))
  })
})

describe('added-but-unused tags', () => {
  it('a listed tag nothing uses appears with count 0; one items carry is not shown twice', () => {
    const rows = [{ id: 'a', tags: ['Été', 'sea'] }, { id: 'b', tags: ['sea'] }]
    expect(countTagsWithListed(rows, ['moon', 'ete', 'moon'])).toEqual([
      { tag: 'sea', count: 2 },
      { tag: 'Été', count: 1 },
      { tag: 'moon', count: 0 },
    ])
    expect(countTagsWithListed([], ['x'])).toEqual([{ tag: 'x', count: 0 }])
  })

  it('finds the duplicate a new name would make (case, accents, spacing)', () => {
    expect(findDuplicateTag('Ete', ['Été', 'sea'])).toBe('Été')
    expect(findDuplicateTag('  SEA ', ['Été', 'sea'])).toBe('sea')
    expect(findDuplicateTag('sky', ['Été', 'sea'])).toBeNull()
    expect(findDuplicateTag('   ', ['x'])).toBeNull()
  })

  it('rename / merge / delete keep the list in step, each name once', () => {
    expect(rewriteListed(['a', 'b'], { op: 'merge', from: ['a'], to: 'z' })).toEqual(['z', 'b'])
    expect(rewriteListed(['a', 'b', 'z'], { op: 'merge', from: ['a', 'b'], to: 'z' })).toEqual(['z'])
    expect(rewriteListed(['a', 'b'], { op: 'delete', tags: ['a'] })).toEqual(['b'])
    expect(rewriteListed(['a'], { op: 'delete', tags: ['q'] })).toEqual(['a'])
  })

  it('the list id is deterministic and refuses slugs that could forge another', () => {
    expect(internalTagListId('amelie', 'media')).toBe('internalTagList.amelie.media')
    expect(internalTagListId('ch-psico', 'galleries')).toBe('internalTagList.ch-psico.galleries')
    expect(() => internalTagListId('a.b', 'media')).toThrow()
    expect(() => internalTagListId('', 'media')).toThrow()
    expect(() => internalTagListId('amelie', 'posts' as never)).toThrow()
  })
})
