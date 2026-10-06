/**
 * The private draft preview through `proxy()`: it must route like any website
 * path on every host kind (never 404, never land in another site), and every
 * response for it is marked noindex / no-store / no-referrer and carries the
 * request marker the website layout reads.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { headers: { 'x-intl-fallthrough': '1' } }),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}))

import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { DRAFT_PREVIEW_HEADER, isDraftPreviewPath } from '@/lib/proxy/draft-preview'

const ID = '11111111-2222-4333-8444-555555555555'
const Q = '?t=tok.mac&theme=dark'

async function call(host: string, path: string) {
  const res = await proxy(new NextRequest(new URL(`https://placeholder.invalid${path}`), { headers: { host } }))
  const rewrite = res.headers.get('x-middleware-rewrite')
  return { res, rewrite: rewrite ? new URL(rewrite) : null }
}

describe('draft preview routing', () => {
  it.each([
    // [host, request path, expected rewrite pathname or null for pass-through]
    ['dev.abluo.app', `/it/hoffmann/preview/post/${ID}`, null],
    ['dev.abluo.app', `/hoffmann/preview/post/${ID}`, `/it/hoffmann/preview/post/${ID}`],
    ['preview.abluo.app', `/hoffmann/preview/post/${ID}`, `/it/hoffmann/preview/post/${ID}`],
    ['ch-psicoterapeuta.com', `/it/hoffmann/preview/post/${ID}`, null],
    ['ch-psicoterapeuta.com', `/de/preview/post/${ID}`, `/de/hoffmann/preview/post/${ID}`],
    ['ch-psicoterapeuta.com', `/preview/post/${ID}`, `/it/hoffmann/preview/post/${ID}`],
    ['hoffmann.localhost:3000', `/preview/post/${ID}`, `/it/hoffmann/preview/post/${ID}`],
  ])('%s %s', async (host, path, expected) => {
    const { res, rewrite } = await call(host, path + Q)
    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('x-intl-fallthrough')).toBeNull()
    if (expected) {
      expect(rewrite?.pathname).toBe(expected)
      expect(rewrite?.search).toBe(Q) // the token survives the rewrite
    } else {
      expect(rewrite).toBeNull()
    }
  })

  it('preview.abluo.app with a locale prefix goes to next-intl like every other website page there', async () => {
    const { res } = await call('preview.abluo.app', `/de/hoffmann/preview/post/${ID}${Q}`)
    expect(res.headers.get('x-intl-fallthrough')).toBe('1')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
  })

  it("another site's domain never serves a project's preview", async () => {
    const { rewrite } = await call('livener.net', `/it/hoffmann/preview/post/${ID}${Q}`)
    expect(rewrite?.pathname).toBe(`/it/livener/hoffmann/preview/post/${ID}`) // → livener's own catch-all, 404
  })

  it('marks every preview response and forwards the layout marker', async () => {
    const { res } = await call('dev.abluo.app', `/it/hoffmann/preview/post/${ID}${Q}`)
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-middleware-override-headers')?.split(',')).toContain(DRAFT_PREVIEW_HEADER)
    expect(res.headers.get(`x-middleware-request-${DRAFT_PREVIEW_HEADER}`)).toBe('1')
  })

  it('leaves ordinary pages alone', async () => {
    const { res } = await call('dev.abluo.app', '/it/hoffmann/blog/some-post')
    expect(res.headers.get('x-robots-tag')).toBeNull()
    expect(res.headers.get(`x-middleware-request-${DRAFT_PREVIEW_HEADER}`)).toBeNull()
  })
})

describe('isDraftPreviewPath', () => {
  it.each([
    [`/it/hoffmann/preview/post/${ID}`, true],
    [`/preview/post/${ID}`, true],
    ['/it/hoffmann/preview/gallery/gallery-studio', true],
    ['/preview/gallery/gallery-studio', true],
    ['/it/hoffmann/preview/page/x', false],
    ['/it/hoffmann/preview', false],
    ['/it/hoffmann/blog/preview', false],
    [`/it/hoffmann/preview/post/${ID}/x`, false],
  ])('%s → %s', (p, expected) => {
    expect(isDraftPreviewPath(p)).toBe(expected)
  })
})
