import { describe, it, expect } from 'vitest'
import { checkNewPassword, hashPassword, parsePasswordHash, verifyPassword } from '../password'
import { generateSessionToken, hashSessionToken, isSecureRequest, isWellFormedSessionToken, sessionCookieAttributes, sessionCookieName } from '../session-token'

describe('shared-password hashing', () => {
  it('round-trips, rejects a wrong password, never stores the plaintext', async () => {
    const h = await hashPassword('lotus-river-2026')
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
    expect(h).not.toContain('lotus')
    expect(await verifyPassword('lotus-river-2026', h)).toBe(true)
    expect(await verifyPassword('lotus-river-2025', h)).toBe(false)
    expect(await verifyPassword('', h)).toBe(false)
  })
  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('same-password-x')).not.toBe(await hashPassword('same-password-x'))
  })
  it('normalises Unicode so a password typed on two keyboards matches', async () => {
    const h = await hashPassword('café-yoga-2026')                      // é precomposed
    expect(await verifyPassword('café-yoga-2026', h)).toBe(true)  // e + combining accent
  })
  it('a malformed or hostile stored hash verifies false and never throws', async () => {
    for (const bad of ['', 'plain', 'scrypt$1$8$1$aa$bb', 'scrypt$1073741824$8$1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g', 'bcrypt$x']) {
      expect(await verifyPassword('whatever-123', bad)).toBe(false)
    }
    expect(parsePasswordHash('scrypt$1073741824$8$1$c2FsdA$aGFzaA')).toBeNull()
  })
  it('policy: 10–200 characters, not blank', () => {
    expect(checkNewPassword('short')).toBe('too_short')
    expect(checkNewPassword('          ')).toBe('blank')
    expect(checkNewPassword('x'.repeat(201))).toBe('too_long')
    expect(checkNewPassword('ten chars!')).toBeNull()
  })
})

describe('session token and cookie', () => {
  it('tokens are 32 random bytes, base64url, and only their sha256 is stored', () => {
    const t = generateSessionToken()
    expect(isWellFormedSessionToken(t)).toBe(true)
    expect(generateSessionToken()).not.toBe(t)
    expect(hashSessionToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(t)).not.toContain(t)
  })
  it('anything else is not a token (no DB lookup for junk)', () => {
    for (const v of [undefined, null, '', 'abc', 'x'.repeat(44), 'a'.repeat(42) + '=', 42]) expect(isWellFormedSessionToken(v)).toBe(false)
  })
  it('one cookie per project; __Host- on https; distinct names for two projects on one shared host', () => {
    const a = sessionCookieName('ba57987d-3679-4bf5-8178-6d0cb968d05d', true)
    const b = sessionCookieName('3e308301-6916-4f0c-b616-97a3b7f6d9ef', true)
    expect(a).toBe('__Host-abluo-access-ba57987d3679')
    expect(a).not.toBe(b)
    expect(sessionCookieName('ba57987d-3679-4bf5-8178-6d0cb968d05d', false)).toBe('abluo-access-ba57987d3679')
  })
  it('HttpOnly, SameSite=Lax, Path=/, 30 days', () => {
    expect(sessionCookieAttributes(true)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 })
  })
  it('secure everywhere except plain-http localhost', () => {
    expect(isSecureRequest(new URL('https://cyce.info/x'))).toBe(true)
    expect(isSecureRequest(new URL('https://preview.abluo.app/cyce'))).toBe(true)
    expect(isSecureRequest(new URL('http://localhost:3000/'))).toBe(false)
    expect(isSecureRequest(new URL('http://cyce.localhost:3000/'))).toBe(false)
  })
})
