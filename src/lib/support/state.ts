/**
 * Support mode — the pure half (ADR-028 §8, docs/engineering/support-mode.md).
 * No I/O: session state, transitions and the permission filter. Fully
 * unit-tested in `__tests__/state.test.ts`.
 *
 * A support visit is one row of `support_sessions` (migration 038). Its
 * `status` is the visit's EDIT-ACCESS state; the visit itself is open until
 * the admin exits (`ended`) or it times out (SUPPORT_VISIT_MAX_MINUTES).
 *
 *   viewing ──request──▶ requested ──allow (client)──▶ allowed ──time──▶ expired
 *      ▲                     │                           │
 *      │                 decline (client)           revoke (client)
 *      │                     ▼                           ▼
 *      └──────────────── declined / expired / revoked ──request──▶ requested …
 *   any open state ──exit (admin)──▶ ended (terminal)
 *
 * Only `allowed` and not past `expires_at` lets anything be written.
 */
import { SUPPORT_VISIT_MAX_MINUTES, isSupportRole, type SupportRole } from './constants'

export type SupportStatus = 'viewing' | 'requested' | 'allowed' | 'declined' | 'expired' | 'revoked' | 'ended'
const STATUSES: readonly SupportStatus[] = ['viewing', 'requested', 'allowed', 'declined', 'expired', 'revoked', 'ended']

export type SupportSession = {
  id: string
  projectId: string
  adminUserId: string
  role: SupportRole
  status: SupportStatus
  startedAt: string
  requestedAt: string | null
  decidedAt: string | null
  decidedBy: string | null
  expiresAt: string | null
  revokedAt: string | null
  contactRequestsShownAt: string | null
  endedAt: string | null
}

/** Column list for selects — keep in step with `mapSupportRow`. */
export const SUPPORT_SESSION_COLUMNS =
  'id, project_id, admin_user_id, role, status, started_at, requested_at, decided_at, decided_by, expires_at, revoked_at, contact_requests_shown_at, ended_at'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** A database row → SupportSession, or null when it is not a valid row (fail closed). */
export function mapSupportRow(row: Record<string, unknown> | null | undefined): SupportSession | null {
  if (!row) return null
  const id = str(row.id)
  const projectId = str(row.project_id)
  const adminUserId = str(row.admin_user_id)
  const startedAt = str(row.started_at)
  const status = row.status as SupportStatus
  if (!id || !projectId || !adminUserId || !startedAt || !STATUSES.includes(status) || !isSupportRole(row.role)) return null
  return {
    id,
    projectId,
    adminUserId,
    role: row.role,
    status,
    startedAt,
    requestedAt: str(row.requested_at),
    decidedAt: str(row.decided_at),
    decidedBy: str(row.decided_by),
    expiresAt: str(row.expires_at),
    revokedAt: str(row.revoked_at),
    contactRequestsShownAt: str(row.contact_requests_shown_at),
    endedAt: str(row.ended_at),
  }
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN)

/** Is the visit still open at `now`? (Not exited, not timed out.) */
export function isVisitOpen(s: SupportSession, now: number = Date.now()): boolean {
  if (s.status === 'ended' || s.endedAt) return false
  const started = ms(s.startedAt)
  return Number.isFinite(started) && now < started + SUPPORT_VISIT_MAX_MINUTES * 60_000
}

/** The edit-access state at `now`: an `allowed` row past its expiry is `expired`; a closed visit is `ended`. */
export function effectiveStatus(s: SupportSession, now: number = Date.now()): SupportStatus {
  if (!isVisitOpen(s, now)) return 'ended'
  if (s.status === 'allowed') {
    const exp = ms(s.expiresAt)
    return Number.isFinite(exp) && now < exp ? 'allowed' : 'expired'
  }
  return s.status
}

/** May the admin write in this visit right now? Only `allowed` and unexpired. */
export function supportWritesAllowed(s: SupportSession | null | undefined, now: number = Date.now()): boolean {
  return Boolean(s) && effectiveStatus(s as SupportSession, now) === 'allowed'
}

/** Did an `allowed` row just run out (so the app records `expired` once)? */
export function needsExpiry(s: SupportSession, now: number = Date.now()): boolean {
  return s.status === 'allowed' && isVisitOpen(s, now) && effectiveStatus(s, now) === 'expired'
}

// ── Transitions ─────────────────────────────────────────────────────────────

export type TransitionError = 'closed' | 'already_requested' | 'already_allowed' | 'nothing_to_decide' | 'nothing_to_end' | 'self_decision'

/** Admin asks for edit access. Allowed from any open state except a pending request or live access. */
export function requestTransition(s: SupportSession, now: number = Date.now()): { ok: true } | { ok: false; error: TransitionError } {
  const st = effectiveStatus(s, now)
  if (st === 'ended') return { ok: false, error: 'closed' }
  if (st === 'requested') return { ok: false, error: 'already_requested' }
  if (st === 'allowed') return { ok: false, error: 'already_allowed' }
  return { ok: true }
}

export type ClientDecision = 'allow' | 'decline' | 'revoke'

/**
 * The client's decision — mirrors `public.support_session_decide()` (migration
 * 038), which is the enforcement. Used to decide which buttons the client sees
 * and to answer early with a precise error.
 */
export function decisionTransition(
  s: SupportSession,
  decision: ClientDecision,
  deciderUserId: string,
  now: number = Date.now(),
): { ok: true; next: SupportStatus } | { ok: false; error: TransitionError } {
  if (deciderUserId === s.adminUserId) return { ok: false, error: 'self_decision' }
  const st = effectiveStatus(s, now)
  if (st === 'ended') return { ok: false, error: 'closed' }
  if (decision === 'revoke') return st === 'allowed' ? { ok: true, next: 'revoked' } : { ok: false, error: 'nothing_to_end' }
  if (st !== 'requested') return { ok: false, error: 'nothing_to_decide' }
  return { ok: true, next: decision === 'allow' ? 'allowed' : 'declined' }
}

// ── Permissions in support mode ─────────────────────────────────────────────

/**
 * What a support context may be used for:
 *   render    — building a page. Carries the perspective role's permissions so
 *               the admin sees the dashboard exactly as the client does
 *               (navigation, People, Media …). Pages never write.
 *   mutation  — everything else: server actions, route handlers, any new
 *               caller. Write permissions are removed unless the client has
 *               allowed edit access and it has not expired. This is the
 *               DEFAULT, so a caller that forgets to say is refused writes.
 */
export type SupportPurpose = 'render' | 'mutation'

/** Never writable in support mode, even with the client's approval: people, money, modules. */
export const SUPPORT_NEVER_WRITES: readonly string[] = ['users.invite', 'users.manage', 'modules.manage', 'billing.manage']

/** A permission that changes data. Only `*.read` permissions are reads (ADR-028 §2 vocabulary). */
export function isWritePermission(id: string): boolean {
  return !id.endsWith('.read')
}

/** Contact requests stay hidden in support mode until the admin explicitly shows them (ADR-028 §8). */
export function isContactRequestPermission(id: string): boolean {
  return id.startsWith('forms.submission.')
}

export function supportPermissions(params: {
  rolePermissions: readonly string[]
  purpose: SupportPurpose
  writesAllowed: boolean
  contactRequestsShown: boolean
}): string[] {
  let perms = [...params.rolePermissions]
  if (!params.contactRequestsShown) perms = perms.filter((id) => !isContactRequestPermission(id))
  if (params.purpose === 'render') return perms
  return perms.filter((id) => !isWritePermission(id) || (params.writesAllowed && !SUPPORT_NEVER_WRITES.includes(id)))
}

/**
 * Belt and braces for `can()` and `assertModuleAction()`: even if a support
 * grant somehow carried a write permission, a `mutation` context refuses it
 * unless the client's approval is live (and never for people/money/modules).
 * The permission filter above is the primary enforcement; this re-checks at
 * the point of use.
 */
export function supportRefuses(
  support: { purpose: SupportPurpose; writesAllowed: boolean } | null | undefined,
  permission: string,
): boolean {
  if (!support || support.purpose !== 'mutation' || !isWritePermission(permission)) return false
  return !support.writesAllowed || SUPPORT_NEVER_WRITES.includes(permission)
}
