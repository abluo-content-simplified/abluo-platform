/**
 * Consumer-level behaviour of project-grain notification scope (2026-08-31).
 *
 * The defect these cover is not "the wrong email address" — it is that a
 * notification which could not be addressed was finalized `skipped`, a TERMINAL
 * status, with no error raised anywhere. The customer's form submission simply
 * never arrived and nothing said so. These tests pin the replacement: an
 * unresolvable scope is a retryable `failed`, then `dead`, always carrying the
 * reason in `last_error`.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/client', () => ({ sanityClient: { fetch: vi.fn() } }))
vi.mock('@/lib/notifications/resend', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: vi.fn(async (_reason: string, fn: (db: unknown) => unknown) => fn(currentDb)),
}))

import { sanityClient } from '@/lib/sanity/client'
import { sendEmail } from '@/lib/notifications/resend'
import { deliverEvent } from '@/lib/notifications/consumer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (sanityClient as any).fetch as ReturnType<typeof vi.fn>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSend = sendEmail as any as ReturnType<typeof vi.fn>

interface Fixture {
  event: Record<string, unknown>
  /** Supabase projects rows, by id. */
  projects: Record<string, { id: string; slug: string }>
  submission: Record<string, unknown> | null
  finalized?: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentDb: any

/** Minimal stand-in for the Supabase query builder, covering only what the consumer chains. */
function makeDb(fx: Fixture) {
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = { table, filters: {}, selected: false, update: null as Record<string, unknown> | null }
      const run = () => {
        if (ctx.table === 'form_events') {
          if (ctx.selected) return { data: [fx.event] } // the atomic claim
          fx.finalized = ctx.update ?? undefined // finalize()
          return { data: null }
        }
        if (ctx.table === 'projects') {
          if (ctx.filters.id) return { data: fx.projects[ctx.filters.id] ?? null }
          const bySlug = Object.values(fx.projects).find((p) => p.slug === ctx.filters.slug)
          return { data: bySlug ?? null }
        }
        if (ctx.table === 'form_submissions') return { data: fx.submission }
        throw new Error(`unexpected table ${ctx.table}`)
      }
      const chain = {
        update(vals: Record<string, unknown>) { ctx.update = vals; return chain },
        select() { ctx.selected = true; return chain },
        eq(col: string, val: unknown) { ctx.filters[col] = val; return chain },
        in() { return chain },
        maybeSingle: async () => run(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
      }
      return chain
    },
  }
}

const T42_PROJECT = { id: 'p-t42', slug: 't42' }
const NOLOGO_PROJECT = { id: 'p-nologo', slug: 'nologo' }

function productionEvent(over: Record<string, unknown> = {}) {
  return {
    event_id: 'evt-1',
    environment: 'production',
    attempts: 0,
    topic: 'contact',
    form_id: 'contact',
    locale: 'en',
    submission_id: 'sub-1',
    project_id: 'p-t42',
    project_slug: 't42',
    ...over,
  }
}

function arrange(over: Record<string, unknown> = {}, submission: Record<string, unknown> | null = { submission_data: { email: 'lead@x.test' }, source: {}, created_at: null, form_id: 'contact', locale: 'en' }) {
  const fx: Fixture = {
    event: productionEvent(over),
    projects: { 'p-t42': T42_PROJECT, 'p-nologo': NOLOGO_PROJECT },
    submission,
  }
  currentDb = makeDb(fx)
  return fx
}

describe('deliverEvent — project-grain addressing', () => {
  it('sends each project of one tenant its own recipients and branding', async () => {
    mockSend.mockClear()
    mockFetch.mockImplementation(async (_q: string, params: Record<string, unknown>) =>
      params.projectId === 'p-t42'
        ? { found: true, recipients: [{ topic: 'all', emails: ['crew@t42.test'], enabled: true }], internalEmail: { fromName: 'T42' } }
        : { found: true, recipients: [{ topic: 'all', emails: ['hello@nologo.test'], enabled: true }], internalEmail: { fromName: 'No!Logo' } },
    )

    const t42 = arrange({ project_id: 'p-t42' })
    expect(await deliverEvent('evt-1')).toEqual({ outcome: 'delivered' })
    expect(t42.finalized?.status).toBe('delivered')
    expect(mockSend.mock.calls.at(-1)?.[0]).toMatchObject({ to: ['crew@t42.test'], fromName: 'T42' })

    arrange({ project_id: 'p-nologo' })
    expect(await deliverEvent('evt-1')).toEqual({ outcome: 'delivered' })
    expect(mockSend.mock.calls.at(-1)?.[0]).toMatchObject({ to: ['hello@nologo.test'], fromName: 'No!Logo' })
  })

  it('resolves a legacy row with no project_id back through its project_slug', async () => {
    mockSend.mockClear()
    mockFetch.mockImplementation(async (_q: string, params: Record<string, unknown>) => {
      expect(params.projectId).toBe('p-t42') // resolved from the slug, then keyed by id
      return { found: true, recipients: [{ topic: 'all', emails: ['crew@t42.test'], enabled: true }], internalEmail: {} }
    })
    arrange({ project_id: null, project_slug: 't42' })
    expect(await deliverEvent('evt-1')).toEqual({ outcome: 'delivered' })
  })
})

describe('deliverEvent — an unaddressable notification fails loudly', () => {
  it('is retryable failed (NOT terminal skipped) when no Sanity project is linked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockImplementation(async () => null)
    const fx = arrange()
    const out = await deliverEvent('evt-1')

    expect(out.outcome).toBe('failed')
    expect(out.outcome).not.toBe('skipped') // the old silent behaviour
    expect(fx.finalized?.status).toBe('failed')
    expect(fx.finalized?.attempts).toBe(1)
    expect(String(fx.finalized?.last_error)).toContain('no Sanity project')
    expect(String(fx.finalized?.last_error)).toContain('t42') // names the project
    expect(fx.finalized?.processed_at).toBeNull() // not terminal — the sweep re-drives it
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('goes dead (never quietly skipped) once attempts are exhausted', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockImplementation(async () => null)
    const fx = arrange({ attempts: 4 })
    expect((await deliverEvent('evt-1')).outcome).toBe('dead')
    expect(fx.finalized?.status).toBe('dead')
    expect(fx.finalized?.processed_at).not.toBeNull()
    spy.mockRestore()
  })

  it('still skips (terminally, correctly) when the project resolved but configures no recipients', async () => {
    mockFetch.mockImplementation(async () => ({ found: true, recipients: [] }))
    const fx = arrange()
    expect(await deliverEvent('evt-1')).toEqual({ outcome: 'skipped', reason: 'no recipients' })
    expect(String(fx.finalized?.last_error)).toContain('no recipients configured')
  })

  it('skips when the event names no project at all', async () => {
    mockFetch.mockImplementation(async () => null)
    const fx = arrange({ project_id: null, project_slug: null })
    expect((await deliverEvent('evt-1')).outcome).toBe('skipped')
    expect(String(fx.finalized?.last_error)).toContain('no project on event')
  })
})
