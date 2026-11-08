import { describe, expect, it } from 'vitest'
import { cleanOpenId, cleanSearchQ, isAssetId, isSearchLanding, isUuidId, landingListQuery, normalizeListQuery } from '../search-landing'

describe('search landing', () => {
  it('cleans q: strings only, trimmed, capped at 100', () => {
    expect(cleanSearchQ('  rossi ')).toBe('rossi')
    expect(cleanSearchQ(['a'])).toBe('')
    expect(cleanSearchQ(undefined)).toBe('')
    expect(cleanSearchQ('x'.repeat(300))).toHaveLength(100)
  })
  it('accepts open only in the screen id format', () => {
    expect(cleanOpenId('3f2b8c1e-1111-4222-8333-444455556666', isUuidId)).not.toBe('')
    expect(cleanOpenId('nope', isUuidId)).toBe('')
    expect(cleanOpenId(['x'], isUuidId)).toBe('')
    expect(isAssetId('image-abc123-800x600-jpg')).toBe(true)
    expect(isAssetId('a b/../')).toBe(false)
  })
  it('builds the address query, cleaning q and dropping an empty one', () => {
    expect(landingListQuery({ q: '  hi  ', status: 'draft', x: ['a', 'b'] })).toBe('q=hi&status=draft')
    expect(landingListQuery({ q: '   ' })).toBe('')
    expect(normalizeListQuery('q=foo+&when=year')).toBe('q=foo&when=year')
  })
  it('knows a visit from the search (q alone)', () => {
    expect(isSearchLanding('q=rossi')).toBe(true)
    expect(isSearchLanding('q=rossi&when=year')).toBe(false)
    expect(isSearchLanding('')).toBe(false)
  })
})
