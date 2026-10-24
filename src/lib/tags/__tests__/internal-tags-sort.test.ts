import { describe, expect, it } from 'vitest'
import { showTagSearch, sortTagCounts, TAG_SEARCH_THRESHOLD, tagMatchKey, type TagCount } from '../internal-tags'

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
