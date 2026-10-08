// Server-only: reads cookies/headers and uses the service-role client. Never import from a client component.
/**
 * Support mode — the I/O half (ADR-028 §8, docs/engineering/support-mode.md).
 *
 *   Admin side (service role; every caller has passed requireAbluoAdmin()):
 *     startSupportVisit · requestSupportEdit · exitSupportVisit · showContactRequests
 *   Request side (used by getTenantAuthorizationContext):
 *     readSupportCookie · loadOpenVisit · auditSupportAction
 *   Client side (the client's own RLS session; the database decides):
 *     listSupportNotices · decideSupportVisit
 *
 * Every state change and every server action inside a visit is written to the
 * admin audit log (`recordAdminAudit`, migration 033) with the project id.
 * A missing table (migration 038 not applied) reads as "no support visit".
 */
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { recordAdminAudit } from '@/lib/admin/audit'
import { SUPPORT_COOKIE, SUPPORT_EDIT_MINUTES, SUPPORT_VISIT_MAX_MINUTES, type SupportRole } from './constants'
import {
  SUPPORT_SESSION_COLUMNS,
  decisionTransition,
  effectiveStatus,
  isVisitOpen,
  mapSupportRow,
  needsExpiry,
  requestTransition,
  type ClientDecision,
  type SupportSession,
  type SupportStatus,
  type TransitionError,
} from './state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** "Table missing" from PostgREST / Postgres — migration 038 not applied yet. */
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /support_sessions/.test(m) && /does not exist|schema cache/.test(m)
}

export type SupportProject = { id: string; slug: string; name: string }
export type OpenVisit = { session: SupportSession; project: SupportProject }

// ── Cookie ──────────────────────────────────────────────────────────────────

export async function readSupportCookie(): Promise<string | null> {
  try {
    const v = (await cookies()).get(SUPPORT_COOKIE)?.value
    return isUuid(v) ? v : null
  } catch {
    return null // outside a request (tests, build)
  }
}

async function setSupportCookie(sessionId: string): Promise<void> {
  ;(await cookies()).set(SUPPORT_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SUPPORT_VISIT_MAX_MINUTES * 60,
  })
}

export async function clearSupportCookie(): Promise<void> {
  try {
    ;(await cookies()).delete(SUPPORT_COOKIE)
  } catch {
    /* not in a mutable request — nothing to clear */
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function readSession(db: SupabaseClient, sessionId: string): Promise<SupportSession | null> {
  const { data, error } = await db.from('support_sessions').select(SUPPORT_SESSION_COLUMNS).eq('id', sessionId).maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.warn(`support: could not read visit ${sessionId}: ${error.message}`)
    return null
  }
  return mapSupportRow(data as Record<string, unknown> | null)
}

async function readProject(db: SupabaseClient, projectId: string): Promise<SupportProject | null> {
  const { data, error } = await db.from('projects').select('id, slug, name').eq('id', projectId).maybeSingle()
  if (error || !data) return null
  const row = data as { id?: unknown; slug?: unknown; name?: unknown }
  if (typeof row.id !== 'string' || typeof row.slug !== 'string') return null
  return { id: row.id, slug: row.slug, name: typeof row.name === 'string' && row.name.trim() ? row.name : row.slug }
}

/**
 * The admin's open visit for `sessionId`, or null. Requires the row to belong
 * to THIS admin and to be open (not exited, not timed out). An `allowed` row
 * past its expiry is recorded as `expired` here, once (conditional update),
 * and logged. Cached per request so a page that resolves its context several
 * times reads it once.
 */
export const loadOpenVisit = cache(async (sessionId: string, adminUserId: string): Promise<OpenVisit | null> => {
  if (!isUuid(sessionId) || !isUuid(adminUserId)) return null
  const db = createAdminClient()
  const session = await readSession(db, sessionId)
  if (!session || session.adminUserId !== adminUserId || !isVisitOpen(session)) return null
  const project = await readProject(db, session.projectId)
  if (!project) return null
  if (needsExpiry(session)) {
    const { data } = await db
      .from('support_sessions')
      .update({ status: 'expired' })
      .eq('id', session.id)
      .eq('status', 'allowed')
      .lte('expires_at', new Date().toISOString())
      .select('id')
    if (data && data.length) {
      await recordAdminAudit({ actorId: adminUserId, action: 'support.edit.expired', projectId: project.id, detail: { sessionId: session.id } })
    }
    return { session: { ...session, status: 'expired' }, project }
  }
  return { session, project }
})

/**
 * One audit row per server action / route handler run inside a visit (cached
 * per request, so a handler that resolves its context twice logs once). This
 * is the "every write done under support mode" trail: it records the action
 * id, the page it came from and whether writes were allowed at that moment.
 */
export const auditSupportAction = cache(
  async (adminUserId: string, sessionId: string, projectId: string, writesAllowed: boolean, role: SupportRole): Promise<void> => {
    let nextAction: string | null = null
    let referer: string | null = null
    try {
      const h = await headers()
      nextAction = h.get('next-action')
      const ref = h.get('referer')
      referer = ref ? new URL(ref).pathname : null
    } catch {
      /* no request headers */
    }
    await recordAdminAudit({
      actorId: adminUserId,
      action: 'support.action',
      projectId,
      detail: { sessionId, supportMode: true, writesAllowed, role, nextAction, path: referer },
    })
  },
)

// ── Admin side ──────────────────────────────────────────────────────────────

export type SupportError = TransitionError | 'unavailable' | 'not_found' | 'failed'
export type SupportResult<T = object> = ({ ok: true } & T) | { ok: false; error: SupportError }

/**
 * Opens a visit: closes this admin's other open visits (one at a time), writes
 * the new row, sets the httpOnly cookie, logs `support.visit.start`.
 * Call ONLY after requireAbluoAdmin().
 */
export async function startSupportVisit(
  actor: { userId: string },
  projectId: string,
  role: SupportRole,
): Promise<SupportResult<{ project: SupportProject; sessionId: string }>> {
  if (!isUuid(projectId)) return { ok: false, error: 'not_found' }
  const db = createAdminClient()
  const project = await readProject(db, projectId)
  if (!project) return { ok: false, error: 'not_found' }

  const now = new Date().toISOString()
  const { data: closed, error: closeError } = await db
    .from('support_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('admin_user_id', actor.userId)
    .is('ended_at', null)
    .select('id, project_id')
  if (closeError) return { ok: false, error: isMissingTable(closeError) ? 'unavailable' : 'failed' }
  for (const row of (closed ?? []) as { id: string; project_id: string }[]) {
    await recordAdminAudit({ actorId: actor.userId, action: 'support.visit.exit', projectId: row.project_id, detail: { sessionId: row.id, reason: 'replaced' } })
  }

  const { data, error } = await db
    .from('support_sessions')
    .insert({ project_id: project.id, admin_user_id: actor.userId, role })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: isMissingTable(error) ? 'unavailable' : 'failed' }
  const sessionId = (data as { id: string }).id
  await setSupportCookie(sessionId)
  await recordAdminAudit({ actorId: actor.userId, action: 'support.visit.start', projectId: project.id, detail: { sessionId, role, slug: project.slug } })
  return { ok: true, project, sessionId }
}

/** The admin asks the client for edit access. Logged as `support.edit.request`. */
export async function requestSupportEdit(actor: { userId: string }, sessionId: string): Promise<SupportResult> {
  const visit = await loadOpenVisit(sessionId, actor.userId)
  if (!visit) return { ok: false, error: 'closed' }
  const t = requestTransition(visit.session)
  if (!t.ok) return t
  const { data, error } = await createAdminClient()
    .from('support_sessions')
    .update({ status: 'requested', requested_at: new Date().toISOString(), decided_at: null, decided_by: null, expires_at: null })
    .eq('id', sessionId)
    .eq('admin_user_id', actor.userId)
    .eq('status', visit.session.status) // nobody changed it in between
    .is('ended_at', null)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'failed' }
  await recordAdminAudit({ actorId: actor.userId, action: 'support.edit.request', projectId: visit.project.id, detail: { sessionId } })
  return { ok: true }
}

/** The admin leaves: closes the visit, clears the cookie, logs `support.visit.exit`. */
export async function exitSupportVisit(actor: { userId: string }, sessionId: string | null): Promise<SupportResult<{ projectSlug: string | null }>> {
  await clearSupportCookie()
  if (!sessionId) return { ok: true, projectSlug: null }
  const db = createAdminClient()
  const { data, error } = await db
    .from('support_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('admin_user_id', actor.userId)
    .is('ended_at', null)
    .select('project_id')
  if (error) return { ok: true, projectSlug: null } // cookie is gone; the visit times out on its own
  const projectId = (data?.[0] as { project_id?: string } | undefined)?.project_id ?? null
  if (projectId) await recordAdminAudit({ actorId: actor.userId, action: 'support.visit.exit', projectId, detail: { sessionId } })
  const project = projectId ? await readProject(db, projectId) : null
  return { ok: true, projectSlug: project?.slug ?? null }
}

/** Contact requests stay hidden until the admin shows them — a separate, logged event (ADR-028 §8). */
export async function showContactRequests(actor: { userId: string }, sessionId: string): Promise<SupportResult> {
  const visit = await loadOpenVisit(sessionId, actor.userId)
  if (!visit) return { ok: false, error: 'closed' }
  if (visit.session.contactRequestsShownAt) return { ok: true }
  const { error } = await createAdminClient()
    .from('support_sessions')
    .update({ contact_requests_shown_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('admin_user_id', actor.userId)
    .is('ended_at', null)
  if (error) return { ok: false, error: 'failed' }
  await recordAdminAudit({ actorId: actor.userId, action: 'support.contact_requests.show', projectId: visit.project.id, detail: { sessionId } })
  return { ok: true }
}

// ── Client side ─────────────────────────────────────────────────────────────

export type SupportNotice = {
  sessionId: string
  status: Extract<SupportStatus, 'requested' | 'allowed'>
  adminName: string
  requestedAt: string | null
  expiresAt: string | null
}

/**
 * Pending requests and live edit access on one project, for the client's
 * Owner / Site admin. Read with the CLIENT'S session: RLS (migration 038)
 * returns rows only to the people who decide. The admin's display name is
 * then looked up with the service role — only for rows RLS already returned.
 */
export async function listSupportNotices(projectId: string, viewerUserId: string): Promise<SupportNotice[]> {
  if (!isUuid(projectId)) return []
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('support_sessions')
      .select(SUPPORT_SESSION_COLUMNS)
      .eq('project_id', projectId)
      .is('ended_at', null)
      .in('status', ['requested', 'allowed'])
      .order('started_at', { ascending: false })
    if (error) {
      if (!isMissingTable(error)) console.warn(`support notices: ${error.message}`)
      return []
    }
    const live = (data ?? [])
      .map((r) => mapSupportRow(r as Record<string, unknown>))
      .filter((s): s is SupportSession => s !== null && s.adminUserId !== viewerUserId)
      .map((s) => ({ s, status: effectiveStatus(s) }))
      .filter((x): x is { s: SupportSession; status: 'requested' | 'allowed' } => x.status === 'requested' || x.status === 'allowed')
    if (!live.length) return []
    const names = new Map<string, string>()
    const { data: profiles } = await createAdminClient()
      .from('profiles')
      .select('id, full_name')
      .in('id', [...new Set(live.map((x) => x.s.adminUserId))])
    for (const p of (profiles ?? []) as { id: string; full_name?: string | null }[]) {
      names.set(p.id, p.full_name?.trim() || '')
    }
    return live.map(({ s, status }) => ({
      sessionId: s.id,
      status,
      adminName: names.get(s.adminUserId) ?? '',
      requestedAt: s.requestedAt,
      expiresAt: status === 'allowed' ? s.expiresAt : null,
    }))
  } catch (e) {
    console.warn(`support notices: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/**
 * The client's Owner / Site admin allows, declines or ends edit access. The
 * database (`support_session_decide`, SECURITY DEFINER) is the enforcement:
 * it re-checks that the caller manages the project, refuses the requesting
 * admin and validates the transition. Logged with the client as actor.
 */
export async function decideSupportVisit(
  decider: { userId: string },
  projectId: string,
  sessionId: string,
  decision: ClientDecision,
): Promise<SupportResult> {
  if (!isUuid(sessionId) || !isUuid(projectId)) return { ok: false, error: 'not_found' }
  const supabase = await createClient()
  // Early, precise answer from what the client can read; the RPC re-checks everything.
  const current = await readSession(supabase, sessionId)
  if (!current || current.projectId !== projectId) return { ok: false, error: 'not_found' }
  const t = decisionTransition(current, decision, decider.userId)
  if (!t.ok) return t
  const { data, error } = await supabase.rpc('support_session_decide', {
    p_session_id: sessionId,
    p_decision: decision,
    p_minutes: SUPPORT_EDIT_MINUTES,
  })
  if (error || !data) return { ok: false, error: error?.code === '42501' ? 'not_found' : 'failed' }
  const action = decision === 'allow' ? 'support.edit.allowed' : decision === 'decline' ? 'support.edit.declined' : 'support.edit.revoked'
  const row = mapSupportRow((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  await recordAdminAudit({
    actorId: decider.userId,
    action,
    projectId,
    detail: { sessionId, by: 'client', adminUserId: current.adminUserId, expiresAt: row?.expiresAt ?? null },
  })
  return { ok: true }
}
