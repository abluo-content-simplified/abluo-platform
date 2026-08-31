/**
 * Project-grain notification scope (2026-08-31).
 *
 * These tests exist because the previous resolution — a Supabase PROJECT slug
 * fed into `TENANT_TO_PROJECT`, a map keyed by TENANT slug — was invisible
 * while every tenant owned exactly one project. The cases below are written at
 * the shape that breaks it: ONE tenant (`freeriders`) owning TWO projects
 * (`nologo`, `t42`), where `nologo` is also a key in that tenant-grain map.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/client', () => ({ sanityClient: { fetch: vi.fn() } }))

import { sanityClient } from '@/lib/sanity/client'
import {
  resolveRecipients,
  NotificationScopeError,
  describeScope,
  type NotificationScope,
} from '@/lib/notifications/recipients'
import { resolveInternalEmailConfig } from '@/lib/notifications/branding'
import { asProjectSlug } from '@/lib/tenancy/ids'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (sanityClient as any).fetch as ReturnType<typeof vi.fn>

/** Both projects belong to tenant `freeriders`. Ids are the only lookup key. */
const NOLOGO: NotificationScope = { projectId: 'p-nologo', projectSlug: asProjectSlug('nologo') }
const T42: NotificationScope = { projectId: 'p-t42', projectSlug: asProjectSlug('t42') }

/** The live Sanity dataset, keyed the way the code now keys it: by projectId. */
const DATASET: Record<string, { recipients: unknown; internalEmail: unknown; clientName: string; logoUrl: string }> = {
  'p-nologo': {
    recipients: [{ topic: 'all', emails: ['hello@nologo.test'], enabled: true }],
    internalEmail: { fromName: 'No!Logo' },
    clientName: 'Freeriders',
    logoUrl: 'https://cdn.sanity.io/images/x/y/nologo.png',
  },
  'p-t42': {
    recipients: [{ topic: 'all', emails: ['crew@t42.test'], enabled: true }],
    internalEmail: { fromName: 'T42' },
    clientName: 'Freeriders',
    logoUrl: 'https://cdn.sanity.io/images/x/y/t42.png',
  },
}

function serveDataset() {
  mockFetch.mockImplementation(async (...args: unknown[]) => {
    const params = (args[1] ?? {}) as Record<string, unknown>
    const row = DATASET[params.projectId as string]
    if (!row) return null // GROQ [0] on no match
    return { found: true, ...row }
  })
}

// NOTE: no `mockReset()` between tests. Under vitest 4, resetting a mock that
// has recorded a rejected result detaches the bookkeeping that marks it
// handled, and the rejection then surfaces as an unhandled error attributed to
// whichever test is running. Every test below installs its own implementation,
// so a reset buys nothing.

describe('one tenant, two projects', () => {
  it('gives each project its OWN recipients', async () => {
    serveDataset()
    expect(await resolveRecipients(NOLOGO, 'contact')).toEqual(['hello@nologo.test'])
    expect(await resolveRecipients(T42, 'contact')).toEqual(['crew@t42.test'])
  })

  it('gives each project its OWN sender identity and logo', async () => {
    serveDataset()
    const nologo = await resolveInternalEmailConfig(NOLOGO, 'en')
    const t42 = await resolveInternalEmailConfig(T42, 'en')
    expect(nologo.fromName).toBe('No!Logo')
    expect(t42.fromName).toBe('T42')
    expect(nologo.logoUrl).toContain('nologo.png')
    expect(t42.logoUrl).toContain('t42.png')
    // Same tenant, different brands — branding must NOT be shared.
    expect(t42.fromName).not.toBe(nologo.fromName)
    expect(t42.logoUrl).not.toBe(nologo.logoUrl)
  })

  it('keys the lookup on projectId only — never on a slug', async () => {
    serveDataset()
    const before = mockFetch.mock.calls.length
    await resolveRecipients(NOLOGO, 'contact')
    await resolveInternalEmailConfig(NOLOGO, 'en')
    const calls = mockFetch.mock.calls.slice(before) as [string, Record<string, unknown>][]
    expect(calls).toHaveLength(2)
    for (const [query, params] of calls) {
      expect(params.projectId).toBe('p-nologo')
      expect(params).not.toHaveProperty('projectSlug')
      expect(query).toContain('projectId == $projectId')
    }
  })

  it('does not resolve a project through another tenant\'s slug', async () => {
    // The old failure: project slug `nologo` was a TENANT_TO_PROJECT key, so a
    // lookup by slug SUCCEEDED against a different customer's project. With ids
    // there is no such collision — an unlinked id resolves to nothing at all.
    serveDataset()
    const impostor: NotificationScope = { projectId: 'p-unlinked', projectSlug: asProjectSlug('nologo') }
    await expect(resolveRecipients(impostor, 'contact')).rejects.toBeInstanceOf(NotificationScopeError)
  })
})

describe('unresolvable scope fails loudly', () => {
  it('throws (does not return []) when no Sanity project is linked to the id', async () => {
    mockFetch.mockImplementation(async () => null)
    await expect(resolveRecipients(T42, 'contact')).rejects.toThrow(NotificationScopeError)
    await expect(resolveInternalEmailConfig(T42, 'en')).rejects.toThrow(NotificationScopeError)
  })

  it('throws on a failed read rather than silently dropping recipients', async () => {
    mockFetch.mockImplementation(async () => { throw new Error('sanity down') })
    await expect(resolveRecipients(T42, 'contact')).rejects.toThrow(/sanity down/)
  })

  it('names the project in the error, so the outbox row is actionable', async () => {
    mockFetch.mockImplementation(async () => null)
    const err = await resolveRecipients(T42, 'contact').then(
      () => null,
      (e: unknown) => e as NotificationScopeError,
    )
    expect(err).toBeInstanceOf(NotificationScopeError)
    if (!err) throw new Error('unreachable')
    expect(err.message).toContain('t42')
    expect(err.message).toContain('p-t42')
    expect(err.scope).toBe(T42)
  })

  it('still returns [] for the legitimate case: project found, no group for the topic', async () => {
    mockFetch.mockImplementation(async () => ({ found: true, recipients: [{ topic: 'careers', emails: ['jobs@x.test'], enabled: true }] }))
    expect(await resolveRecipients(T42, 'contact')).toEqual([])
  })
})

describe('branding read failure', () => {
  it('hard-logs and sends unbranded rather than mis-branded', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockImplementation(async () => { throw new Error('sanity down') })
    const cfg = await resolveInternalEmailConfig(T42, 'en')
    expect(cfg).toEqual({ replyToSubmitter: true })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('t42')
  })
})

describe('describeScope', () => {
  it('reads well with and without a slug', () => {
    expect(describeScope(T42)).toBe('t42 (p-t42)')
    expect(describeScope({ projectId: 'p-x', projectSlug: null })).toBe('p-x')
  })
})
