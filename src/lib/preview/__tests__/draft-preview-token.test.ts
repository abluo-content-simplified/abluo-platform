import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  PREVIEW_TOKEN_TTL_SECONDS,
  previewSecret,
  signDraftPreviewToken,
  verifyDraftPreviewToken,
} from '../draft-preview-token'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const other = Buffer.from('another-secret-another-secret-xx')
const claims = { draftId: '11111111-2222-4333-8444-555555555555', projectSlug: 'hoffmann', userId: 'u1' }
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0)

describe('draft preview token', () => {
  it('round-trips the claims and expires after 15 minutes', () => {
    const { token, exp } = signDraftPreviewToken(claims, { secret, now: NOW })
    expect(exp).toBe(NOW / 1000 + PREVIEW_TOKEN_TTL_SECONDS)
    expect(verifyDraftPreviewToken(token, { secret, now: NOW + 60_000 })).toEqual({ ...claims, kind: 'post', pageId: null, exp })
    expect(verifyDraftPreviewToken(token, { secret, now: NOW + PREVIEW_TOKEN_TTL_SECONDS * 1000 })).toBeNull()
  })

  it('gallery tokens carry their kind and optional page; old post tokens stay posts', () => {
    const g = signDraftPreviewToken({ ...claims, kind: 'gallery', pageId: 'page-home' }, { secret, now: NOW })
    expect(verifyDraftPreviewToken(g.token, { secret, now: NOW + 1000 })).toMatchObject({ kind: 'gallery', pageId: 'page-home' })
    const alone = signDraftPreviewToken({ ...claims, kind: 'gallery' }, { secret, now: NOW })
    expect(verifyDraftPreviewToken(alone.token, { secret, now: NOW + 1000 })).toMatchObject({ kind: 'gallery', pageId: null })
    // A page id on a post token is never emitted.
    const p = signDraftPreviewToken({ ...claims, pageId: 'x' }, { secret, now: NOW })
    expect(verifyDraftPreviewToken(p.token, { secret, now: NOW + 1000 })).toMatchObject({ kind: 'post', pageId: null })
  })

  it('never mints longer than the TTL', () => {
    const { exp } = signDraftPreviewToken(claims, { secret, now: NOW, ttlSeconds: 86_400 })
    expect(exp - NOW / 1000).toBe(PREVIEW_TOKEN_TTL_SECONDS)
  })

  it('rejects a token signed with another secret', () => {
    const { token } = signDraftPreviewToken(claims, { secret: other, now: NOW })
    expect(verifyDraftPreviewToken(token, { secret, now: NOW })).toBeNull()
  })

  it('rejects a tampered payload (another draft, another project)', () => {
    const { token } = signDraftPreviewToken(claims, { secret, now: NOW })
    const [, mac] = token.split('.')
    for (const change of [{ d: 'other-draft' }, { p: 'livener' }]) {
      const body = Buffer.from(
        JSON.stringify({ v: 1, d: claims.draftId, p: claims.projectSlug, u: 'u1', e: NOW / 1000 + 600, ...change })
      ).toString('base64url')
      expect(verifyDraftPreviewToken(`${body}.${mac}`, { secret, now: NOW })).toBeNull()
    }
  })

  it('rejects a correctly signed token that claims an over-long life', () => {
    const body = Buffer.from(JSON.stringify({ v: 1, d: 'x', p: 'hoffmann', u: 'u1', e: NOW / 1000 + 86_400 })).toString('base64url')
    const mac = createHmac('sha256', secret).update(body).digest('base64url')
    expect(verifyDraftPreviewToken(`${body}.${mac}`, { secret, now: NOW })).toBeNull()
  })

  it.each([undefined, null, '', 'abc', 'a.b.c', '.', 'x'.repeat(5000), 42])('rejects garbage %#', (t) => {
    expect(verifyDraftPreviewToken(t, { secret, now: NOW })).toBeNull()
  })

  it('fails closed without a secret', () => {
    const { token } = signDraftPreviewToken(claims, { secret, now: NOW })
    expect(verifyDraftPreviewToken(token, { secret: null, now: NOW })).toBeNull()
    expect(() => signDraftPreviewToken(claims, { secret: null })).toThrow()
  })

  it('uses PREVIEW_SECRET, else a key derived from the service key, else nothing', () => {
    expect(previewSecret({ PREVIEW_SECRET: 'p'.repeat(32) })?.toString()).toBe('p'.repeat(32))
    const derived = previewSecret({ SUPABASE_SERVICE_ROLE_KEY: 'service' })
    expect(derived).not.toBeNull()
    expect(derived!.toString('utf8')).not.toContain('service')
    expect(previewSecret({})).toBeNull()
    expect(previewSecret({ PREVIEW_SECRET: 'short' })).toBeNull()
  })
})
