/**
 * Support mode — pure logic (ADR-028 §8): session state, transitions, and the
 * permission filter + context that make writes impossible unless the client's
 * approval is live.
 */
import { describe, expect, it } from 'vitest'
import { can } from '@/lib/authz/check'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { SUPPORT_EDIT_MINUTES, SUPPORT_VISIT_MAX_MINUTES } from '../constants'
import { buildSupportAuthorizationContext } from '../context'
import {
  decisionTransition,
  effectiveStatus,
  isVisitOpen,
  isWritePermission,
  mapSupportRow,
  needsExpiry,
  requestTransition,
  supportPermissions,
  supportRefuses,
  supportWritesAllowed,
  type SupportSession,
  type SupportStatus,
} from '../state'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString()
const ADMIN = '00000000-0000-4000-8000-00000000000a'
const OWNER = '00000000-0000-4000-8000-00000000000b'
const PROJECT = '00000000-0000-4000-8000-000000000101'

function session(over: Partial<SupportSession> = {}): SupportSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: PROJECT,
    adminUserId: ADMIN,
    role: 'owner',
    status: 'viewing',
    startedAt: iso(-10),
    requestedAt: null,
    decidedAt: null,
    decidedBy: null,
    expiresAt: null,
    revokedAt: null,
    contactRequestsShownAt: null,
    endedAt: null,
    ...over,
  }
}

describe('mapSupportRow', () => {
  it('maps a valid row and refuses an invalid one (fail closed)', () => {
    const row = {
      id: 's1',
      project_id: 'p',
      admin_user_id: 'a',
      role: 'admin',
      status: 'requested',
      started_at: iso(0),
      requested_at: iso(0),
    }
    expect(mapSupportRow(row)).toMatchObject({ id: 's1', role: 'admin', status: 'requested', expiresAt: null })
    expect(mapSupportRow({ ...row, status: 'live' })).toBeNull()
    expect(mapSupportRow({ ...row, role: 'member' })).toBeNull()
    expect(mapSupportRow({ ...row, admin_user_id: null })).toBeNull()
    expect(mapSupportRow(null)).toBeNull()
  })
})

describe('visit lifetime and effective status', () => {
  it('an open visit times out after SUPPORT_VISIT_MAX_MINUTES', () => {
    expect(isVisitOpen(session(), NOW)).toBe(true)
    expect(isVisitOpen(session({ startedAt: iso(-SUPPORT_VISIT_MAX_MINUTES - 1) }), NOW)).toBe(false)
    expect(effectiveStatus(session({ startedAt: iso(-SUPPORT_VISIT_MAX_MINUTES - 1) }), NOW)).toBe('ended')
  })
  it('an exited visit is ended', () => {
    expect(effectiveStatus(session({ status: 'ended', endedAt: iso(-1) }), NOW)).toBe('ended')
  })
  it('allowed before expiry, expired after — and only then needs recording', () => {
    const allowed = session({ status: 'allowed', requestedAt: iso(-5), decidedAt: iso(-4), decidedBy: OWNER, expiresAt: iso(30) })
    expect(effectiveStatus(allowed, NOW)).toBe('allowed')
    expect(needsExpiry(allowed, NOW)).toBe(false)
    const past = { ...allowed, expiresAt: iso(-1) }
    expect(effectiveStatus(past, NOW)).toBe('expired')
    expect(needsExpiry(past, NOW)).toBe(true)
    expect(effectiveStatus({ ...allowed, expiresAt: null }, NOW)).toBe('expired') // malformed → not allowed
  })
  it('writes are allowed only while allowed and unexpired', () => {
    const cases: [Partial<SupportSession>, boolean][] = [
      [{ status: 'viewing' }, false],
      [{ status: 'requested', requestedAt: iso(-1) }, false],
      [{ status: 'allowed', expiresAt: iso(10) }, true],
      [{ status: 'allowed', expiresAt: iso(-10) }, false],
      [{ status: 'declined' }, false],
      [{ status: 'expired' }, false],
      [{ status: 'revoked', revokedAt: iso(-1) }, false],
      [{ status: 'allowed', expiresAt: iso(10), endedAt: iso(-1) }, false],
    ]
    for (const [over, expected] of cases) expect(supportWritesAllowed(session(over), NOW), JSON.stringify(over)).toBe(expected)
    expect(supportWritesAllowed(null, NOW)).toBe(false)
  })
})

describe('transitions', () => {
  it('the admin may ask from view-only states, not while waiting or allowed or closed', () => {
    const ok: SupportStatus[] = ['viewing', 'declined', 'expired', 'revoked']
    for (const status of ok) expect(requestTransition(session({ status }), NOW)).toEqual({ ok: true })
    expect(requestTransition(session({ status: 'requested', requestedAt: iso(-1) }), NOW)).toEqual({ ok: false, error: 'already_requested' })
    expect(requestTransition(session({ status: 'allowed', expiresAt: iso(5) }), NOW)).toEqual({ ok: false, error: 'already_allowed' })
    // allowed but expired → asking again is fine
    expect(requestTransition(session({ status: 'allowed', expiresAt: iso(-5) }), NOW)).toEqual({ ok: true })
    expect(requestTransition(session({ status: 'ended', endedAt: iso(-1) }), NOW)).toEqual({ ok: false, error: 'closed' })
  })
  it('the client allows or declines a pending request only', () => {
    const pending = session({ status: 'requested', requestedAt: iso(-1) })
    expect(decisionTransition(pending, 'allow', OWNER, NOW)).toEqual({ ok: true, next: 'allowed' })
    expect(decisionTransition(pending, 'decline', OWNER, NOW)).toEqual({ ok: true, next: 'declined' })
    expect(decisionTransition(pending, 'revoke', OWNER, NOW)).toEqual({ ok: false, error: 'nothing_to_end' })
    expect(decisionTransition(session(), 'allow', OWNER, NOW)).toEqual({ ok: false, error: 'nothing_to_decide' })
  })
  it('the client ends live access; not expired access', () => {
    expect(decisionTransition(session({ status: 'allowed', expiresAt: iso(5) }), 'revoke', OWNER, NOW)).toEqual({ ok: true, next: 'revoked' })
    expect(decisionTransition(session({ status: 'allowed', expiresAt: iso(-5) }), 'revoke', OWNER, NOW)).toEqual({ ok: false, error: 'nothing_to_end' })
  })
  it('the admin who asked can never decide (even if also an Owner)', () => {
    const pending = session({ status: 'requested', requestedAt: iso(-1) })
    expect(decisionTransition(pending, 'allow', ADMIN, NOW)).toEqual({ ok: false, error: 'self_decision' })
  })
  it('nothing can be decided on a closed visit', () => {
    expect(decisionTransition(session({ status: 'ended', endedAt: iso(-1) }), 'allow', OWNER, NOW)).toEqual({ ok: false, error: 'closed' })
  })
  it('the edit duration is one constant within the database bounds', () => {
    expect(SUPPORT_EDIT_MINUTES).toBeGreaterThanOrEqual(5)
    expect(SUPPORT_EDIT_MINUTES).toBeLessThanOrEqual(1440)
  })
})

describe('permission filter', () => {
  const owner = ['blog.post.read', 'blog.post.write', 'blog.published.delete', 'forms.submission.read', 'forms.submission.update', 'media.library.manage', 'users.invite', 'users.manage', 'modules.manage', 'analytics.read']

  it('only *.read permissions are reads', () => {
    expect(isWritePermission('blog.post.read')).toBe(false)
    expect(isWritePermission('analytics.read')).toBe(false)
    expect(isWritePermission('blog.post.write')).toBe(true)
    expect(isWritePermission('media.library.manage')).toBe(true)
    expect(isWritePermission('users.invite')).toBe(true)
  })
  it('render keeps the role view (minus hidden contact requests)', () => {
    expect(supportPermissions({ rolePermissions: owner, purpose: 'render', writesAllowed: false, contactRequestsShown: false }).sort()).toEqual(
      owner.filter((p) => !p.startsWith('forms.submission.')).sort(),
    )
    expect(supportPermissions({ rolePermissions: owner, purpose: 'render', writesAllowed: false, contactRequestsShown: true }).sort()).toEqual([...owner].sort())
  })
  it('view only: a mutation context carries reads only', () => {
    expect(supportPermissions({ rolePermissions: owner, purpose: 'mutation', writesAllowed: false, contactRequestsShown: true }).sort()).toEqual(
      ['analytics.read', 'blog.post.read', 'forms.submission.read'],
    )
  })
  it('allowed: writes come back, except people, modules and money', () => {
    const p = supportPermissions({ rolePermissions: owner, purpose: 'mutation', writesAllowed: true, contactRequestsShown: true })
    expect(p).toContain('blog.post.write')
    expect(p).toContain('media.library.manage')
    expect(p).not.toContain('users.invite')
    expect(p).not.toContain('users.manage')
    expect(p).not.toContain('modules.manage')
  })
  it('supportRefuses re-checks at the point of use', () => {
    expect(supportRefuses(undefined, 'blog.post.write')).toBe(false)
    expect(supportRefuses({ purpose: 'render', writesAllowed: false }, 'blog.post.write')).toBe(false)
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: false }, 'blog.post.read')).toBe(false)
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: false }, 'blog.post.write')).toBe(true)
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: true }, 'blog.post.write')).toBe(false)
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: true }, 'users.manage')).toBe(true)
  })
})

describe('support authorization context', () => {
  const actor = { userId: ADMIN, platformRole: 'abluo_admin' as const }
  const project = { id: PROJECT, slug: asSupabaseProjectSlug('studio'), name: 'Studio' }
  const build = (over: Partial<SupportSession>, purpose: 'render' | 'mutation') =>
    buildSupportAuthorizationContext({ actor, session: session(over), project, enabledModuleIds: ['blog', 'forms', 'gallery'], purpose, now: NOW })
  const P = { kind: 'project' as const, projectId: PROJECT }

  it('holds exactly the visited project, no tenants, and the ADMIN as user', () => {
    const ctx = build({}, 'render')
    expect(ctx.userId).toBe(ADMIN)
    expect(ctx.projects.map((g) => g.projectId)).toEqual([PROJECT])
    expect(ctx.projects[0].membershipId).toMatch(/^support:/)
    expect(ctx.tenants).toEqual([])
    expect(ctx.support).toMatchObject({ projectId: PROJECT, role: 'owner', status: 'viewing', writesAllowed: false, purpose: 'render' })
  })

  it('view only: can() and assertModuleAction refuse every write; reads pass', () => {
    const ctx = build({}, 'mutation')
    expect(can(ctx, 'blog.post.read', P)).toBe(true)
    for (const w of ['blog.post.write', 'gallery.gallery.write', 'gallery.gallery.delete', 'media.library.manage', 'users.invite', 'users.manage']) {
      expect(can(ctx, w, P), w).toBe(false)
    }
    expect(() => assertModuleAction(ctx, PROJECT, 'blog.post.write')).toThrow(TenantAuthorizationError)
    expect(() => assertModuleAction(ctx, PROJECT, 'blog.post.read')).not.toThrow()
  })

  it('a pending request is still view only', () => {
    const ctx = build({ status: 'requested', requestedAt: iso(-1) }, 'mutation')
    expect(can(ctx, 'blog.post.write', P)).toBe(false)
  })

  it('allowed and unexpired: content writes pass, people never do', () => {
    const ctx = build({ status: 'allowed', requestedAt: iso(-2), decidedAt: iso(-1), decidedBy: OWNER, expiresAt: iso(30) }, 'mutation')
    expect(ctx.support?.writesAllowed).toBe(true)
    expect(can(ctx, 'blog.post.write', P)).toBe(true)
    expect(can(ctx, 'media.library.manage', P)).toBe(true)
    expect(() => assertModuleAction(ctx, PROJECT, 'gallery.gallery.write')).not.toThrow()
    expect(can(ctx, 'users.invite', P)).toBe(false)
    expect(can(ctx, 'users.manage', P)).toBe(false)
  })

  it('allowed but expired: refused again', () => {
    const ctx = build({ status: 'allowed', requestedAt: iso(-62), decidedAt: iso(-61), decidedBy: OWNER, expiresAt: iso(-1) }, 'mutation')
    expect(ctx.support?.status).toBe('expired')
    expect(can(ctx, 'blog.post.write', P)).toBe(false)
    expect(() => assertModuleAction(ctx, PROJECT, 'blog.post.write')).toThrow(TenantAuthorizationError)
  })

  it('declined / revoked: refused', () => {
    expect(can(build({ status: 'declined', requestedAt: iso(-2), decidedAt: iso(-1), decidedBy: OWNER }, 'mutation'), 'blog.post.write', P)).toBe(false)
    expect(can(build({ status: 'revoked', revokedAt: iso(-1), expiresAt: iso(-1) }, 'mutation'), 'blog.post.write', P)).toBe(false)
  })

  it('contact requests are hidden until shown, even for an Owner', () => {
    expect(can(build({}, 'mutation'), 'forms.submission.read', P)).toBe(false)
    expect(build({}, 'render').projects[0].permissions).not.toContain('forms.submission.read')
    expect(can(build({ contactRequestsShownAt: iso(-1) }, 'mutation'), 'forms.submission.read', P)).toBe(true)
  })

  it('the role perspective shapes the view: an Editor sees no People or contact requests', () => {
    const ctx = buildSupportAuthorizationContext({
      actor,
      session: session({ role: 'editor', contactRequestsShownAt: iso(-1) }),
      project,
      enabledModuleIds: ['blog', 'forms'],
      purpose: 'render',
      now: NOW,
    })
    expect(ctx.projects[0].permissions).toContain('blog.post.write') // render view
    expect(ctx.projects[0].permissions).not.toContain('users.invite')
    expect(ctx.projects[0].permissions).not.toContain('forms.submission.read')
  })

  it('a render context never reaches another project', () => {
    const ctx = build({}, 'render')
    expect(can(ctx, 'blog.post.read', { kind: 'project', projectId: 'other' })).toBe(false)
  })
})
