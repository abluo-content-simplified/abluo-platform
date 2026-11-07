import { describe, expect, it } from 'vitest'
import { generateManagementToken, hashToken, isWellFormedToken } from '../tokens'

describe('management tokens (re-exported from access/session-token)', () => {
  it('generates 43-char base64url tokens, different each time', () => {
    const a = generateManagementToken(), b = generateManagementToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isWellFormedToken(a)).toBe(true)
    expect(isWellFormedToken('short')).toBe(false)
  })
  it('hashes to sha256 hex, deterministically', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const t = generateManagementToken()
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toBe(t)
  })
})
