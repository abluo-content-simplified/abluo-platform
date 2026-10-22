import { describe, expect, it } from 'vitest'
import {
  commitFromVersionResponse,
  isNewVersionAvailable,
  isRealCommit,
  shouldCheckOnFocus,
  VERSION_FOCUS_MIN_GAP_MS,
} from '../new-version'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

describe('isRealCommit', () => {
  it('rejects placeholders and non-strings', () => {
    for (const v of ['', ' ', 'local', 'unknown', 'LOCAL', undefined, null, 5]) expect(isRealCommit(v)).toBe(false)
  })
  it('accepts a sha', () => expect(isRealCommit(A)).toBe(true))
})

describe('commitFromVersionResponse', () => {
  it('prefers the full commit, falls back to the short one', () => {
    expect(commitFromVersionResponse({ commitLong: A, commit: 'aaaaaaa' })).toBe(A)
    expect(commitFromVersionResponse({ commitLong: 'unknown', commit: 'bbbbbbb' })).toBe('bbbbbbb')
  })
  it('is null for anything unusable', () => {
    expect(commitFromVersionResponse(null)).toBeNull()
    expect(commitFromVersionResponse('x')).toBeNull()
    expect(commitFromVersionResponse({ commit: 'unknown', commitLong: 'unknown' })).toBeNull()
  })
})

describe('isNewVersionAvailable', () => {
  it('is true only when both are real and differ', () => {
    expect(isNewVersionAvailable(A, B)).toBe(true)
  })
  it('is false for the same build, including short vs full', () => {
    expect(isNewVersionAvailable(A, A)).toBe(false)
    expect(isNewVersionAvailable(A, A.slice(0, 7))).toBe(false)
    expect(isNewVersionAvailable(A.slice(0, 7), A)).toBe(false)
  })
  it('is false when either side is a placeholder (local dev, failed check)', () => {
    expect(isNewVersionAvailable('local', B)).toBe(false)
    expect(isNewVersionAvailable(undefined, B)).toBe(false)
    expect(isNewVersionAvailable(A, 'unknown')).toBe(false)
    expect(isNewVersionAvailable(A, null)).toBe(false)
  })
})

describe('shouldCheckOnFocus', () => {
  it('checks the first time and after the minimum gap, not right after a check', () => {
    expect(shouldCheckOnFocus(null, 1000)).toBe(true)
    expect(shouldCheckOnFocus(1000, 1000 + VERSION_FOCUS_MIN_GAP_MS - 1)).toBe(false)
    expect(shouldCheckOnFocus(1000, 1000 + VERSION_FOCUS_MIN_GAP_MS)).toBe(true)
  })
})
