import { describe, it, expect } from 'vitest'
import { isPostId, POST_ID_MAX } from '../post-drafts'

describe('post ids leave room for the editable copy (drafts.<id> ≤ 128)', () => {
  it('allows up to 121 characters', () => {
    expect(POST_ID_MAX).toBe(121)
    expect(isPostId('a'.repeat(121))).toBe(true)
    expect(isPostId(`drafts.${'a'.repeat(121)}`.slice(7))).toBe(true)
  })

  it('refuses an id whose working copy Sanity would reject', () => {
    // The Hoffmann post that could not be opened: 126 characters.
    const tooLong = 'hoffmann-post-come-posso-trovare-equilibrio-senso-e-benessere-nei-tempi-attuali-pieni-di-incertezze-e-avversita-a-vari-livelli'
    expect(tooLong.length).toBe(126)
    expect(isPostId(tooLong)).toBe(false)
    expect(isPostId('a'.repeat(122))).toBe(false)
  })

  it('still refuses paths and odd characters', () => {
    expect(isPostId('drafts.abc')).toBe(false)
    expect(isPostId('a/b')).toBe(false)
    expect(isPostId('')).toBe(false)
  })
})
