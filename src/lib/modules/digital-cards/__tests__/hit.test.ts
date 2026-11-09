import { describe, it, expect } from 'vitest'
import { hasSupabaseAuthCookie, hitDecision, isProductionHostFor, parseHitBody, preflightHit } from '../hit'

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const known = [{ publicId: 'card-1', linkKeys: ['k1', 'k2'] }]

describe('parseHitBody', () => {
  it('accepts the beacon shape (JSON text or object)', () => {
    expect(parseHitBody('{"p":"cyce","c":"card-1","k":"visit","s":"qr","r":"l.instagram.com"}')).toEqual({ p: 'cyce', c: 'card-1', k: 'visit', s: 'qr', r: 'l.instagram.com' })
    expect(parseHitBody({ p: 'cyce', c: 'card-1', k: 'click', l: 'k1' })).toEqual({ p: 'cyce', c: 'card-1', k: 'click', l: 'k1' })
  })
  it('refuses anything else', () => {
    for (const bad of [null, '', 'nope', '[]', '{"p":"cyce","c":"card-1","k":"view"}', '{"p":"Cyce!","c":"card-1","k":"visit"}', '{"p":"cyce","c":"card 1","k":"visit"}', '{"p":"cyce","c":"card-1","k":"click"}', 'x'.repeat(2000)]) {
      expect(parseHitBody(bad), String(bad).slice(0, 40)).toBeNull()
    }
  })
  it('drops a referrer that is not a bare host (paths never pass)', () => {
    expect(parseHitBody({ p: 'cyce', c: 'card-1', k: 'visit', r: 'evil.example/path?x=1' })?.r).toBeUndefined()
  })
})

describe('production host', () => {
  it('only the project’s own custom domain counts', () => {
    expect(isProductionHostFor('cyce.info', 'cyce')).toBe(true)
    expect(isProductionHostFor('www.cyce.info', 'cyce')).toBe(true)
    expect(isProductionHostFor('cyce.info', 'hoffmann')).toBe(false)
    expect(isProductionHostFor('cyce.preview.abluo.app', 'cyce')).toBe(false)
    expect(isProductionHostFor('cyce.localhost:3000', 'cyce')).toBe(false)
    expect(isProductionHostFor('preview.abluo.app', 'cyce')).toBe(false)
    expect(isProductionHostFor('abluo-platform.vercel.app', 'cyce')).toBe(false)
    expect(isProductionHostFor(null, 'cyce')).toBe(false)
  })
})

describe('preflight + decision', () => {
  const base = { payload: parseHitBody({ p: 'cyce', c: 'card-1', k: 'visit' }), production: true, host: 'cyce.info', userAgent: UA, cookieNames: ['NEXT_LOCALE'] }

  it('counts a real visit on production, with the source normalised', () => {
    const pre = preflightHit({ ...base, payload: parseHitBody({ p: 'cyce', c: 'card-1', k: 'visit', r: 'l.instagram.com' }) })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    expect(hitDecision(pre.payload, known)).toEqual({
      count: true,
      hit: { projectSlug: 'cyce', cardId: 'card-1', kind: 'visit', linkKey: null, source: 'instagram' },
    })
  })

  it.each([
    ['invalid', { payload: null }],
    ['not-production', { production: false }],
    ['wrong-host', { host: 'cyce.preview.abluo.app' }],
    ['wrong-host', { host: 'ch-psicoterapeuta.com' }],
    ['bot', { userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }],
    ['signed-in', { cookieNames: ['sb-abcdefgh-auth-token'] }],
    ['signed-in', { cookieNames: ['sb-abcdefgh-auth-token.0'] }],
  ])('refuses: %s', (reason, over) => {
    expect(preflightHit({ ...base, ...over } as typeof base)).toEqual({ ok: false, reason })
  })

  it('refuses unknown cards and links, and unreadable data', () => {
    const p = (o: Record<string, unknown>) => parseHitBody({ p: 'cyce', c: 'card-1', k: 'visit', ...o })!
    expect(hitDecision(p({ c: 'card-x' }), known)).toEqual({ count: false, reason: 'unknown' })
    expect(hitDecision(p({ k: 'click', l: 'k9' }), known)).toEqual({ count: false, reason: 'unknown' })
    expect(hitDecision(p({}), null)).toEqual({ count: false, reason: 'unknown' })
    expect(hitDecision(p({ k: 'click', l: 'k2', s: 'qr' }), known)).toMatchObject({ count: true, hit: { linkKey: 'k2', source: 'qr', kind: 'click' } })
  })

  it('auth cookie detection', () => {
    expect(hasSupabaseAuthCookie(['NEXT_LOCALE', 'abluo_consent'])).toBe(false)
    expect(hasSupabaseAuthCookie(['sb-xyz-auth-token-code-verifier'])).toBe(false)
  })
})
