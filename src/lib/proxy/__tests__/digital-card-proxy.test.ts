/**
 * Digital Cards through `proxy()` (ADR-049 D5, D10): `/link…` routes like any
 * website path on every host kind, lands in the visitor's language on a
 * project's own domain, is marked noindex (but NOT no-store — cards cache) and
 * carries the bare-layout marker. A client-sent marker never reaches the layout.
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
import { DIGITAL_CARD_HEADER, isDigitalCardPath } from '@/lib/proxy/digital-card'
import { DRAFT_PREVIEW_HEADER } from '@/lib/proxy/draft-preview'

async function call(host: string, path: string, headers: Record<string, string> = {}) {
  const res = await proxy(new NextRequest(new URL(`https://placeholder.invalid${path}`), { headers: { host, ...headers } }))
  const rewrite = res.headers.get('x-middleware-rewrite')
  return { res, rewrite: rewrite ? new URL(rewrite) : null }
}

describe('isDigitalCardPath', () => {
  it.each([
    ['/link', true],
    ['/link/', true],
    ['/link/sofia-rossi', true],
    ['/link/contact.vcf', true],
    ['/link/sofia-rossi/contact.vcf', true],
    ['/it/link', true],
    ['/it/link/sofia', true],
    ['/it/hoffmann/link', true],
    ['/en/cyce/link/anna/contact.vcf', true],
    ['/hoffmann/link/sofia', true],
    ['/linkedin', false],
    ['/links', false],
    ['/link/Sofia', false],
    ['/link/sofia/other', false],
    ['/link/sofia.vcf', false],
    ['/it/hoffmann/blog/link-post', false],
    ['/', false],
    ['/en/dashboard', false],
  ])('%s → %s', (path, expected) => {
    expect(isDigitalCardPath(path)).toBe(expected)
  })
})

describe('digital card routing', () => {
  it.each([
    // [host, request path, expected rewrite pathname or null for pass-through]
    ['dev.abluo.app', '/hoffmann/link', '/it/hoffmann/link'],
    ['dev.abluo.app', '/it/hoffmann/link/sofia', null],
    ['preview.abluo.app', '/hoffmann/link/sofia', '/it/hoffmann/link/sofia'],
    ['preview.abluo.app', '/cyce/link/contact.vcf', '/en/cyce/link/contact.vcf'],
    ['ch-psicoterapeuta.com', '/de/link', '/de/hoffmann/link'],
    ['ch-psicoterapeuta.com', '/link', '/it/hoffmann/link'],
    ['ch-psicoterapeuta.com', '/link/sofia/contact.vcf', '/it/hoffmann/link/sofia/contact.vcf'],
    ['hoffmann.localhost:3000', '/link', '/it/hoffmann/link'],
  ])('%s %s', async (host, path, expected) => {
    const { res, rewrite } = await call(host, path)
    expect(res.status).toBeLessThan(300)
    if (expected) expect(rewrite?.pathname).toBe(expected)
    else expect(rewrite).toBeNull()
  })

  it("lands in the visitor's language on the project's own domain (D5)", async () => {
    const { rewrite } = await call('ch-psicoterapeuta.com', '/link/sofia', { 'accept-language': 'de-CH,de;q=0.9' })
    expect(rewrite?.pathname).toBe('/de/hoffmann/link/sofia')
    const fr = await call('cyce.info', '/link?src=qr', { 'accept-language': 'fr-BE,fr;q=0.9,en;q=0.5' })
    expect(fr.rewrite?.pathname).toBe('/fr/cyce/link')
    expect(fr.rewrite?.search).toBe('?src=qr')
    // A language the site does not offer → its default.
    const ja = await call('cyce.info', '/link', { 'accept-language': 'ja' })
    expect(ja.rewrite?.pathname).toBe('/en/cyce/link')
  })

  it('marks the response noindex and forwards the bare-layout marker, without no-store', async () => {
    const { res } = await call('ch-psicoterapeuta.com', '/link')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(res.headers.get('cache-control')).toBeNull()
    expect(res.headers.get('x-middleware-override-headers')?.split(',')).toContain(DIGITAL_CARD_HEADER)
    expect(res.headers.get(`x-middleware-request-${DIGITAL_CARD_HEADER}`)).toBe('1')
  })

  it('leaves ordinary pages alone', async () => {
    const { res } = await call('ch-psicoterapeuta.com', '/it/chi-sono')
    expect(res.headers.get('x-robots-tag')).toBeNull()
    expect(res.headers.get(`x-middleware-request-${DIGITAL_CARD_HEADER}`)).toBeNull()
  })

  it('never passes a client-sent marker through to the layout', async () => {
    const { res } = await call('ch-psicoterapeuta.com', '/it/chi-sono', { [DIGITAL_CARD_HEADER]: '1', [DRAFT_PREVIEW_HEADER]: '1' })
    const overridden = res.headers.get('x-middleware-override-headers')?.split(',') ?? []
    expect(overridden).not.toContain(DIGITAL_CARD_HEADER)
    expect(overridden).not.toContain(DRAFT_PREVIEW_HEADER)
    expect(res.headers.get(`x-middleware-request-${DIGITAL_CARD_HEADER}`)).toBeNull()
  })
})
