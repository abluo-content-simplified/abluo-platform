/**
 * Form notifications service (Settings, 2026-10-28): the ADR-028 permissions
 * matrix, checks before I/O, key-level patches on published + draft with
 * revision guards, the audit row, and the notice email from production only.
 * Sanity is an in-memory fake; audit and mail are injected.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAudit: vi.fn() }))
vi.mock('../resend', () => ({ sendEmail: vi.fn() }))

import { grantPermissions, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { supportPermissions } from '@/lib/support/state'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import {
  FormNotificationsError,
  changeFormRecipient,
  loadFormNotifications,
  recipientNoticeEmail,
  sendRecipientNotice,
  type FormNotificationsDeps,
} from '../form-recipients-service'

import type { AccessRole } from '@/lib/authz/roles'
const SLUG = 'cyce'
const PID = 'project-a'
const grant = (permissions: string[], role: AccessRole = 'owner'): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role,
  permissions,
  enabledModuleIds: ['forms'],
})
const ctxOf = (g: ProjectGrant, extra: Partial<TenantAuthorizationContext> = {}): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g], ...extra })
const roleCtx = (role: AccessRole) => ctxOf(grant(grantPermissions(role, ['forms']), role))

type Doc = { _id: string; _rev: string; projectName?: string; groups: Array<Record<string, unknown>> }

function fake(opts: { draft?: boolean; env?: 'production' | 'preview' } = {}) {
  const published: Doc = {
    _id: 'proj1',
    _rev: 'r1',
    projectName: 'CYCE',
    groups: [
      { _key: 'kc', topic: 'contact', emails: ['hr-cercle-de-yoga@ec.europa.eu'], enabled: true },
      { _key: 'kb', topic: 'book-recommendation', emails: ['thomas.zimmermann+cyce@gmail.com', 'b@x.it'], enabled: true },
      { _key: 'kp', topic: 'old', emails: ['p@x.it'], enabled: false },
      { topic: 'nokey', emails: ['n@x.it'] },
    ],
  }
  const draft: Doc | null = opts.draft ? { _id: 'drafts.proj1', _rev: 'd1', groups: [{ _key: 'kc', topic: 'contact', emails: ['hr-cercle-de-yoga@ec.europa.eu'] }] } : null
  const committed: Array<{ id: string; ops: Record<string, unknown> }> = []
  let commitError: unknown = null
  const fetch = vi.fn(async (q: string, params: Record<string, unknown>) => {
    if (q.startsWith('count(')) return 1
    if (q.includes('_type == "formDefinition"')) return [{ formId: 'contact', notificationTopic: null, title: { en: 'Contact', it: 'Contatto' } }]
    if (q.includes('_type == "siteConfig"')) return { siteName: 'Cercle Yoga', defaultLocale: 'en' }
    if (q.includes('_type == "project"')) {
      expect(params).toMatchObject({ projectSlug: SLUG, projectId: PID })
      return [structuredClone(published), ...(draft ? [structuredClone(draft)] : [])]
    }
    throw new Error(`unexpected query ${q}`)
  })
  const transaction = vi.fn(() => {
    const patches: Array<{ id: string; ops: Record<string, unknown> }> = []
    const tx = {
      patch: (id: string, ops: Record<string, unknown>) => (patches.push({ id, ops }), tx),
      commit: vi.fn(async () => {
        if (commitError) throw commitError
        for (const p of patches) {
          committed.push(p)
          const doc = p.id === published._id ? published : draft!
          if ((p.ops.ifRevisionID as string) !== doc._rev) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
          const [[path, value]] = Object.entries(p.ops.set as Record<string, unknown>)
          const key = /_key=="([^"]+)"/.exec(path)![1]
          doc.groups.find((g) => g._key === key)!.emails = value
          doc._rev = `${doc._rev}+`
        }
      }),
    }
    return tx
  })
  const audit = vi.fn(async () => {})
  const send = vi.fn(async () => ({ ok: true, id: 'm1' }))
  const deps = { client: { fetch, transaction }, audit, send, environment: () => opts.env ?? 'production' } as unknown as FormNotificationsDeps
  return { fetch, transaction, committed, audit, send, deps, published, draft, failCommit: (e: unknown) => (commitError = e) }
}

const add = (email: string, rev = 'r1', groupKey = 'kc') => ({ op: 'add' as const, rev, groupKey, email, locale: 'en' })
const remove = (email: string, rev = 'r1', groupKey = 'kc') => ({ op: 'remove' as const, rev, groupKey, email, locale: 'en' })

describe('permissions matrix (ADR-028)', () => {
  it.each([
    ['owner', true, true],
    ['admin', true, true],
    ['editor', true, false],
    ['viewer', false, false],
  ])('%s: read %s, write %s', async (role, canRead, canWrite) => {
    const f = fake()
    const ctx = roleCtx(role as AccessRole)
    if (canRead) expect((await loadFormNotifications(ctx, PID, { locale: 'en' }, f.deps))?.canWrite).toBe(canWrite)
    else await expect(loadFormNotifications(ctx, PID, { locale: 'en' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    if (canWrite) expect((await changeFormRecipient(ctx, PID, add('new@x.it'), f.deps)).view.groups[0].emails).toContain('new@x.it')
    else await expect(changeFormRecipient(ctx, PID, add('new@x.it'), f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
  })

  it('a support visit writes only once the client allowed it (mutation purpose strips write otherwise)', async () => {
    const owner = grantPermissions('owner', ['forms'])
    const blocked = ctxOf(grant(supportPermissions({ rolePermissions: owner, purpose: 'mutation', writesAllowed: false, contactRequestsShown: false })))
    const allowed = ctxOf(grant(supportPermissions({ rolePermissions: owner, purpose: 'mutation', writesAllowed: true, contactRequestsShown: false })), {
      support: { writesAllowed: true } as TenantAuthorizationContext['support'],
    })
    const f = fake()
    await expect(changeFormRecipient(blocked, PID, add('new@x.it'), f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.transaction).not.toHaveBeenCalled()
    await changeFormRecipient(allowed, PID, add('new@x.it'), f.deps)
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ by: 'support' }) }))
  })

  it('a project the caller has no grant on is refused before any read', async () => {
    const f = fake()
    await expect(loadFormNotifications(roleCtx('owner'), 'other-project', { locale: 'en' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('loadFormNotifications', () => {
  it('lists the configured groups with form titles; paused and key-less groups are read-only', async () => {
    const f = fake()
    const v = (await loadFormNotifications(roleCtx('owner'), PID, { locale: 'it' }, f.deps))!
    expect(v.rev).toBe('r1')
    expect(v.groups.map((g) => [g.topic, g.label, g.editable, g.paused])).toEqual([
      ['contact', 'Contatto', true, false],
      ['book-recommendation', 'Book recommendation', true, false],
      ['old', 'Old', false, true],
      ['nokey', 'Nokey', false, false],
    ])
  })
})

describe('changeFormRecipient', () => {
  it('patches only the group’s emails, key-level, with the revision guard', async () => {
    const f = fake()
    const r = await changeFormRecipient(roleCtx('owner'), PID, add(' New@X.it '), f.deps)
    expect(f.committed).toEqual([{ id: 'proj1', ops: { ifRevisionID: 'r1', set: { 'notifications.recipients[_key=="kc"].emails': ['hr-cercle-de-yoga@ec.europa.eu', 'new@x.it'] } } }])
    expect(r.view.rev).toBe('r1+')
  })

  it('applies the same change to a Studio draft holding the group', async () => {
    const f = fake({ draft: true })
    await changeFormRecipient(roleCtx('owner'), PID, add('new@x.it'), f.deps)
    expect(f.committed.map((c) => c.id)).toEqual(['proj1', 'drafts.proj1'])
    expect(f.draft!.groups[0].emails).toEqual(['hr-cercle-de-yoga@ec.europa.eu', 'new@x.it'])
  })

  it('validation: bad format, duplicate and the per-form max are refused; a bad format never reaches Sanity', async () => {
    const f = fake()
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('not an email'), f.deps)).rejects.toMatchObject({ code: 'invalid_email' })
    expect(f.fetch).not.toHaveBeenCalled()
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('HR-cercle-de-yoga@ec.europa.eu'), f.deps)).rejects.toMatchObject({ code: 'duplicate' })
    let rev = 'r1'
    for (const e of ['a@x.it', 'b@x.it', 'c@x.it', 'd@x.it']) rev = (await changeFormRecipient(roleCtx('owner'), PID, add(e, rev), f.deps)).view.rev
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('f@x.it', rev), f.deps)).rejects.toMatchObject({ code: 'too_many' })
  })

  it('removing the last address is allowed (empty list = no email); the page warns first', async () => {
    const f = fake()
    const r = await changeFormRecipient(roleCtx('owner'), PID, remove('hr-cercle-de-yoga@ec.europa.eu'), f.deps)
    expect(r.view.groups[0].emails).toEqual([])
    expect(r.notice).toBe('none')
    expect(f.send).not.toHaveBeenCalled()
  })

  it('a stale revision is conflict; unknown, paused or key-less groups are refused', async () => {
    const f = fake()
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('n@x.it', 'old'), f.deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('n@x.it', 'r1', 'zz'), f.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('n@x.it', 'r1', 'kp'), f.deps)).rejects.toMatchObject({ code: 'not_editable' })
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('n@x.it', 'r1', 'k"] | *[0'), f.deps)).rejects.toMatchObject({ code: 'not_found' })
    f.failCommit(Object.assign(new Error('Document has unexpected revision ID'), { statusCode: 409 }))
    await expect(changeFormRecipient(roleCtx('owner'), PID, add('n@x.it'), f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.audit).not.toHaveBeenCalled()
  })

  it('audits every change: who, what, which project', async () => {
    const f = fake()
    const r1 = await changeFormRecipient(roleCtx('owner'), PID, add('new@x.it'), f.deps)
    await changeFormRecipient(roleCtx('owner'), PID, remove('new@x.it', r1.view.rev), f.deps)
    expect(f.audit.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { actorId: 'u1', action: 'notifications.recipient.add', projectId: PID, detail: { topic: 'contact', groupKey: 'kc', email: 'new@x.it', count: 2, by: 'client' } },
      { actorId: 'u1', action: 'notifications.recipient.remove', projectId: PID, detail: { topic: 'contact', groupKey: 'kc', email: 'new@x.it', count: 1, by: 'client' } },
    ])
  })
})

describe('the notice email', () => {
  it('is sent to the added address in production, naming the site and the form', async () => {
    const f = fake({ env: 'production' })
    const r = await changeFormRecipient(roleCtx('owner'), PID, add('new@x.it'), f.deps)
    expect(r.notice).toBe('sent')
    expect(f.send).toHaveBeenCalledTimes(1)
    const mail = (f.send.mock.calls[0] as unknown[])[0] as { to: string[]; subject: string; text: string; fromName: string }
    expect(mail.to).toEqual(['new@x.it'])
    expect(mail.fromName).toBe('Cercle Yoga')
    expect(mail.text).toContain('You\'ll now receive messages from the Cercle Yoga website\'s “Contact” form.')
  })

  it.each(['preview', 'development'] as const)('is never sent from %s', async (env) => {
    const f = fake({ env: env as 'preview' })
    const r = await changeFormRecipient(roleCtx('owner'), PID, add('new@x.it'), f.deps)
    expect(r.notice).toBe('not_production')
    expect(f.send).not.toHaveBeenCalled()
    expect(await sendRecipientNotice({ to: 'a@x.it', siteName: 'S', formLabel: null, locale: 'en' }, { send: f.send, environment: () => env })).toBe('not_production')
  })

  it('a failed send never fails the change', async () => {
    const f = fake()
    f.send.mockResolvedValueOnce({ ok: false, error: 'resend 500' } as never)
    const r = await changeFormRecipient(roleCtx('owner'), PID, add('new@x.it'), f.deps)
    expect(r.notice).toBe('failed')
    expect(r.view.groups[0].emails).toContain('new@x.it')
  })

  it('is written in the site language, escaped, with an every-form variant', () => {
    expect(recipientNoticeEmail({ siteName: 'Studio', formLabel: 'Kontakt', locale: 'de' }).text).toContain('Sie erhalten ab jetzt die Nachrichten aus dem Formular „Kontakt“ der Website Studio.')
    expect(recipientNoticeEmail({ siteName: 'Studio', formLabel: null, locale: 'it' }).text).toContain('tutti i moduli del sito Studio')
    expect(recipientNoticeEmail({ siteName: '<b>X</b>', formLabel: null, locale: 'fr' }).html).toContain('&lt;b&gt;X&lt;/b&gt;')
  })
})

it('FormNotificationsError carries an opaque code', () => {
  expect(new FormNotificationsError('conflict').code).toBe('conflict')
})
