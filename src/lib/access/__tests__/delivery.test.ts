/** ADR-040 B2.4 — the pure parts of protected file delivery. */
import { describe, it, expect, vi } from 'vitest'
import { decideDocument, decideRange, deliveryLocales, denyResponse, etagOf, fileResponse, isNavigation } from '../delivery'
import type { DeliverableFile, SiteAccessStore } from '../store'
import { createFakeFiles, pdfBytes } from './fake-files'
import { downloadFilename, inspectPdf, sanitizeFilename } from '../pdf'
import { createHash } from 'crypto'

const P = '0a000000-0000-4000-8000-00000000000a'
const D = '0d000000-0000-4000-8000-00000000000d'
const G = '06000000-0000-4000-8000-000000000006'
const file = (over: Partial<DeliverableFile> = {}): DeliverableFile => ({
  archived: false, title: { en: 'Timetable 2026', it: 'Orario 2026' }, groupIds: [G], locale: 'en',
  storagePath: `${P}/11111111-1111-4111-8111-111111111111.pdf`, sizeBytes: 1000, sha256: 'a'.repeat(64), ...over,
})

describe('decideRange', () => {
  const E = '"e"'
  it.each([
    [null, { kind: 'full' }],
    ['bytes=0-99', { kind: 'partial', start: 0, end: 99 }],
    ['bytes=900-', { kind: 'partial', start: 900, end: 999 }],
    ['bytes=-100', { kind: 'partial', start: 900, end: 999 }],
    ['bytes=-5000', { kind: 'partial', start: 0, end: 999 }],
    ['bytes=990-5000', { kind: 'partial', start: 990, end: 999 }],
    ['bytes=1000-', { kind: 'unsatisfiable' }],
    ['bytes=-0', { kind: 'unsatisfiable' }],
    ['bytes=5-2', { kind: 'full' }],
    ['bytes=0-1,5-6', { kind: 'full' }], // multi-range: ignored, whole file
    ['items=0-1', { kind: 'full' }],
    ['bytes=abc', { kind: 'full' }],
    ['bytes=-', { kind: 'full' }],
    ['bytes=99999999999999999999-', { kind: 'full' }],
  ])('%s', (h, want) => expect(decideRange(h as string | null, 1000, null, E)).toEqual(want))
  it('If-Range that does not match the current file → whole file', () => {
    expect(decideRange('bytes=0-9', 1000, '"old"', E)).toEqual({ kind: 'full' })
    expect(decideRange('bytes=0-9', 1000, E, E)).toEqual({ kind: 'partial', start: 0, end: 9 })
  })
})

describe('decideDocument — deny by default', () => {
  const store = (f: DeliverableFile | null | Error) => ({
    documentForDelivery: vi.fn(async () => { if (f instanceof Error) throw f; return f }),
  }) as unknown as SiteAccessStore & { documentForDelivery: ReturnType<typeof vi.fn> }
  const visitor = (groups: string[] | null) => vi.fn(async () => (groups ? { sessionId: 's', groupIds: new Set(groups) } : null))
  const run = (o: { f?: DeliverableFile | null | Error; groups?: string[] | null; token?: string | null; id?: string; module?: boolean | Error }) => {
    const s = store(o.f === undefined ? file() : o.f)
    const r = decideDocument(
      { projectId: P, documentId: o.id ?? D, locales: ['en'], token: o.token === undefined ? 't' : o.token },
      { store: s, environment: 'production', resolveVisitor: visitor(o.groups === undefined ? [G] : o.groups), moduleEnabled: async () => { if (o.module instanceof Error) throw o.module; return o.module ?? true } }
    )
    return { r, s }
  }
  it('granted with a matching live group', async () => expect((await run({}).r).kind).toBe('file'))
  it('no cookie: denied without reading anything', async () => {
    const { r, s } = run({ token: null })
    expect(await r).toEqual({ kind: 'deny' })
    expect(s.documentForDelivery).not.toHaveBeenCalled()
  })
  it.each([
    ['unknown / other project', { f: null }],
    ['archived', { f: file({ archived: true }) }],
    ['no live group (nobody)', { f: file({ groupIds: [] }) }],
    ['session without the group', { groups: ['99999999-9999-4999-8999-999999999999'] }],
    ['session expired / revoked / rotated / other environment', { groups: null }],
    ['module switched off', { module: false }],
    ['module state unreadable', { module: new Error('sanity down') }],
    ['store failure', { f: new Error('db down') }],
    ['a path outside the project (defence in depth)', { f: file({ storagePath: `0b000000-0000-4000-8000-00000000000b/x.pdf` }) }],
  ])('%s → deny', async (_n, o) => expect(await run(o as never).r).toEqual({ kind: 'deny' }))
  it('a malformed id is denied without a document lookup', async () => {
    const { r, s } = run({ id: '../../etc/passwd' })
    expect(await r).toEqual({ kind: 'deny' })
    expect(s.documentForDelivery).not.toHaveBeenCalled()
  })
  it('languages: the URL\'s, then the site default, once each', () => {
    expect(deliveryLocales('de', 'en')).toEqual(['de', 'en'])
    expect(deliveryLocales('en', 'en')).toEqual(['en'])
    expect(deliveryLocales('it', null)).toEqual(['it'])
  })
})

describe('the refusal is one response', () => {
  const signIn = new URL('https://site.test/en/site-access/sign-in?returnTo=%2Fen%2Fsite-access%2Fdocuments%2Fx')
  it('navigation → 303 to the sign-in page; anything else → 401; both private, no-store', async () => {
    const nav = denyResponse(new Headers({ 'sec-fetch-mode': 'navigate' }), signIn)
    expect(nav.status).toBe(303)
    expect(nav.headers.get('location')).toBe(signIn.toString())
    const api = denyResponse(new Headers({ 'sec-fetch-mode': 'no-cors', range: 'bytes=0-9' }), signIn)
    expect(api.status).toBe(401)
    for (const r of [nav, api]) {
      expect(r.headers.get('cache-control')).toBe('private, no-store')
      expect(r.headers.get('x-robots-tag')).toMatch(/noindex/)
    }
    expect(isNavigation(new Headers({ accept: 'text/html,application/xhtml+xml' }))).toBe(true)
    expect(isNavigation(new Headers({ accept: '*/*' }))).toBe(false)
  })
})

describe('fileResponse', () => {
  const setup = () => {
    const files = createFakeFiles()
    const f = file({ sizeBytes: 4096 })
    files.objects.set(f.storagePath, pdfBytes(4096))
    const req = (h: Record<string, string> = {}, over: Partial<{ method: string; download: boolean; locale: string }> = {}) =>
      ({ method: 'GET', headers: new Headers(h), download: false, locale: 'en', ...over })
    return { files, f, req }
  }
  it('whole file: 200, PDF headers, private, never sniffed or embedded elsewhere', async () => {
    const { files, f, req } = setup()
    const r = await fileResponse(req(), f, files, files.fetch)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-length')).toBe('4096')
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect(r.headers.get('etag')).toBe(etagOf(f))
    expect(r.headers.get('content-disposition')).toBe(`inline; filename="Timetable 2026.pdf"; filename*=UTF-8''Timetable%202026.pdf`)
    expect(r.headers.get('content-language')).toBe('en')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect((await r.arrayBuffer()).byteLength).toBe(4096)
    expect(files.signed[0].seconds).toBeLessThanOrEqual(60)
  })
  it('a range: 206 with Content-Range, only those bytes, fetched as a range', async () => {
    const { files, f, req } = setup()
    const r = await fileResponse(req({ range: 'bytes=100-199' }), f, files, files.fetch)
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 100-199/4096')
    expect(r.headers.get('content-length')).toBe('100')
    expect((await r.arrayBuffer()).byteLength).toBe(100)
    expect(files.fetchCalls[0].range).toBe('bytes=100-199')
  })
  it('unsatisfiable → 416 with the size, nothing fetched', async () => {
    const { files, f, req } = setup()
    const r = await fileResponse(req({ range: 'bytes=5000-' }), f, files, files.fetch)
    expect(r.status).toBe(416)
    expect(r.headers.get('content-range')).toBe('bytes */4096')
    expect(files.fetchCalls).toHaveLength(0)
  })
  it('HEAD: headers only, nothing fetched', async () => {
    const { files, f, req } = setup()
    const r = await fileResponse(req({}, { method: 'HEAD' }), f, files, files.fetch)
    expect(r.status).toBe(200)
    expect(r.body).toBeNull()
    expect(files.fetchCalls).toHaveLength(0)
  })
  it.each(['error', 'missing', 'ignore-range', 'wrong-length'] as const)('storage misbehaving (%s) → 503, never passed through', async (mode) => {
    const { files, f, req } = setup()
    files.nextFetch = mode
    const r = await fileResponse(req(mode === 'ignore-range' ? { range: 'bytes=0-9' } : {}), f, files, files.fetch)
    expect(r.status).toBe(503)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
  })
  it('download → 303 to a signed link of at most 60 s, as an attachment with the localized title', async () => {
    const { files, f, req } = setup()
    const r = await fileResponse(req({}, { download: true, locale: 'it' }), f, files, files.fetch)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/^https:\/\/storage\.test\/object\/sign\//)
    expect(files.signed).toEqual([{ path: f.storagePath, seconds: 60, downloadName: 'Orario 2026.pdf' }])
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it('a signed link longer than 60 s cannot be made', async () => {
    const { files, f } = setup()
    await expect(files.signedUrl(f.storagePath, 61)).rejects.toThrow()
    await expect(files.signedUrl(f.storagePath, 0)).rejects.toThrow()
  })
})

describe('PDF checks', () => {
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
  it('accepts a real-looking PDF whose size and hash match the declaration', () => {
    const b = pdfBytes(2048)
    expect(inspectPdf(b, { declaredSize: 2048, declaredSha256: sha(b) })).toEqual({ ok: true, sizeBytes: 2048, sha256: sha(b) })
  })
  it('refuses another type, a truncated file, a size or hash mismatch, and > 20 MB', () => {
    const html = new TextEncoder().encode('<html>%%EOF</html>')
    expect(inspectPdf(html, { declaredSize: html.length, declaredSha256: sha(html) })).toEqual({ ok: false, problem: 'not_a_pdf' })
    const b = pdfBytes(2048); const truncated = b.slice(0, 1000)
    expect(inspectPdf(truncated, { declaredSize: 1000, declaredSha256: sha(truncated) })).toEqual({ ok: false, problem: 'not_a_pdf' })
    expect(inspectPdf(b, { declaredSize: 2047, declaredSha256: sha(b) })).toEqual({ ok: false, problem: 'size_mismatch' })
    expect(inspectPdf(b, { declaredSize: 2048, declaredSha256: 'b'.repeat(64) })).toEqual({ ok: false, problem: 'hash_mismatch' })
    const big = new Uint8Array(20 * 1024 * 1024 + 1)
    expect(inspectPdf(big, { declaredSize: big.length, declaredSha256: 'a'.repeat(64) })).toEqual({ ok: false, problem: 'too_large' })
  })
  it('names: uploaded names lose paths and control characters; download names are safe and end in .pdf', () => {
    expect(sanitizeFilename('C:\\Users\\x\\Orario\u0007.pdf')).toBe('Orario.pdf')
    expect(sanitizeFilename('')).toBeNull()
    expect(downloadFilename('Plan: "A/B" <2026>')).toBe('Plan AB 2026.pdf')
    expect(downloadFilename(null)).toBe('document.pdf')
  })
})
