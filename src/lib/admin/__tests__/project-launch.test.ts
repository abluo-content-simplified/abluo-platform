import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tenancy/generated/route-config', () => ({ GENERATED_PLATFORM_HOSTS: ['abluo.app', 'admin.abluo.app', 'preview.abluo.app'] }))

import { saveProjectDomain, setProjectLive, validateCustomDomain } from '../project-launch'

describe('validateCustomDomain', () => {
  it('normalises what people paste', () => {
    expect(validateCustomDomain(' https://www.Freeriders.app/ ')).toEqual({ ok: true, domain: 'freeriders.app' })
    expect(validateCustomDomain('studio-rossi.co.uk')).toEqual({ ok: true, domain: 'studio-rossi.co.uk' })
    expect(validateCustomDomain('xn--caf-dma.it')).toEqual({ ok: true, domain: 'xn--caf-dma.it' })
  })
  it('empty clears the domain', () => {
    expect(validateCustomDomain('')).toEqual({ ok: true, domain: null })
    expect(validateCustomDomain(null)).toEqual({ ok: true, domain: null })
  })
  it('refuses non-domains and platform addresses', () => {
    for (const bad of ['freeriders', 'free riders.app', '-x.com', 'x-.com', 'x.c', 'a..b.com', 42]) expect(validateCustomDomain(bad)).toMatchObject({ ok: false, error: 'invalid' })
    expect(validateCustomDomain('freeriders.preview.abluo.app')).toEqual({ ok: false, error: 'platform' })
    expect(validateCustomDomain('abluo.app')).toEqual({ ok: false, error: 'platform' })
    expect(validateCustomDomain('x.vercel.app')).toEqual({ ok: false, error: 'platform' })
  })
})

function fakes(opts: { row?: Record<string, unknown> | null; other?: boolean; updateError?: { code?: string } | null; sanityIds?: string[] } = {}) {
  const updates: Record<string, unknown>[] = []
  const row = opts.row === undefined ? { id: 'p1', slug: 'freeriders', custom_domain: null, status: 'preview' } : opts.row
  const db = {
    from: () => {
      const q: Record<string, unknown> = {}
      let mode = 'select'
      let payload: Record<string, unknown> | null = null
      const chain = {
        select: () => chain,
        update: (v: Record<string, unknown>) => ((mode = 'update'), (payload = v), chain),
        eq: () => (mode === 'update' ? (updates.push(payload!), Promise.resolve({ error: opts.updateError ?? null })) : chain),
        neq: () => chain,
        limit: () => Promise.resolve({ data: opts.other ? [{ id: 'p2' }] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
      }
      void q
      return chain
    },
  }
  const patches: Array<{ id: string; op: string; v: unknown }> = []
  const sanity = {
    fetch: vi.fn(async () => opts.sanityIds ?? ['project-freeriders', 'drafts.project-freeriders']),
    patch: (id: string) => ({
      set: (v: Record<string, unknown>) => ({ commit: async () => patches.push({ id, op: 'set', v }), unset: () => ({ commit: async () => undefined }) }),
      unset: (k: string[]) => ({ commit: async () => patches.push({ id, op: 'unset', v: k }) }),
    }),
  }
  return { db: db as never, sanity: sanity as never, updates, patches }
}

describe('saveProjectDomain', () => {
  it('writes Supabase and both Sanity copies (published + open draft)', async () => {
    const f = fakes()
    expect(await saveProjectDomain(f.db, f.sanity, 'p1', 'www.freeriders.app')).toEqual({ ok: true, domain: 'freeriders.app' })
    expect(f.updates).toEqual([{ custom_domain: 'freeriders.app' }])
    expect(f.patches.map((p) => p.id)).toEqual(['project-freeriders', 'drafts.project-freeriders'])
    expect(f.patches[0].v).toEqual({ customDomain: 'freeriders.app' })
  })
  it('refuses a domain another project uses, before writing', async () => {
    const f = fakes({ other: true })
    expect(await saveProjectDomain(f.db, f.sanity, 'p1', 'freeriders.app')).toEqual({ ok: false, error: 'taken' })
    expect(f.updates).toEqual([])
  })
  it('clears with an empty value', async () => {
    const f = fakes()
    expect(await saveProjectDomain(f.db, f.sanity, 'p1', '')).toEqual({ ok: true, domain: null })
    expect(f.updates).toEqual([{ custom_domain: null }])
    expect(f.patches[0]).toMatchObject({ op: 'unset', v: ['customDomain'] })
  })
  it('unknown project, or an ambiguous Sanity project → no write', async () => {
    expect(await saveProjectDomain(fakes({ row: null }).db, fakes().sanity, 'p1', 'x.com')).toEqual({ ok: false, error: 'not_found' })
    const f = fakes({ sanityIds: ['a', 'b'] })
    expect(await saveProjectDomain(f.db, f.sanity, 'p1', 'x.com')).toEqual({ ok: false, error: 'failed' })
    expect(f.updates).toEqual([])
  })
})

describe('setProjectLive', () => {
  it('needs a domain to go live', async () => {
    const f = fakes()
    expect(await setProjectLive(f.db, f.sanity, 'p1', true)).toEqual({ ok: false, error: 'needs_domain' })
    expect(f.updates).toEqual([])
  })
  it('live → active in Supabase and Sanity; off → preview / inactive', async () => {
    const f = fakes({ row: { id: 'p1', slug: 'freeriders', custom_domain: 'freeriders.app', status: 'preview' } })
    expect(await setProjectLive(f.db, f.sanity, 'p1', true)).toEqual({ ok: true, status: 'active' })
    expect(f.updates).toEqual([{ status: 'active' }])
    expect(f.patches[0].v).toEqual({ status: 'active' })
    expect(await setProjectLive(f.db, f.sanity, 'p1', false)).toEqual({ ok: true, status: 'preview' })
    expect(f.patches.at(-1)!.v).toEqual({ status: 'inactive' })
  })
})
