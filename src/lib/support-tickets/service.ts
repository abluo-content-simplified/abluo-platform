// Server-only: uses the service role. Never import from a client component.
/**
 * Support tickets — every read and write (ADR-039). Two doors:
 *
 *   client functions take a `TicketAccess` (./access.ts) built from the
 *   request's authorization context and enforce D3 on every call;
 *   admin functions take the actor id of a caller that has ALREADY passed
 *   `requireAbluoAdmin()` (Super Admin + two-factor).
 *
 * The tables are service-role only (migration 046); this file is the only
 * place that touches them besides ./notifications.ts. Internal notes, severity,
 * context and internal events are read ONLY by the admin functions — the
 * client query paths never select them (D7, tested in __tests__/service.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { getAppEnvironment } from '@/lib/notifications/environment'
import { safeAvatarUrl } from '@/lib/people/service'
import { canSeeTicket, type TicketAccess } from './access'
import { buildTicketContext } from './context'
import { stripMetadata } from './image'
import {
  ATTACHMENT_BUCKET,
  TICKET_LIMITS,
  failureFromDbError,
  formatTicketNumber,
  isTicketSeverity,
  isTicketStatus,
  validateBody,
  validateTitle,
  type TicketAttachmentView,
  type TicketContext,
  type TicketDetail,
  type TicketEventKind,
  type TicketPerson,
  type TicketResult,
  type TicketSeverity,
  type TicketStatus,
  type TicketSummary,
  type ThreadEntry,
} from './model'
import { scheduleTicketNotifications } from './notify'
import { clientReplyOutcome, isUnread } from './state'
import { maskRanges, type RedactionRange } from './redaction'

type Db = SupabaseClient

function withDb<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return runAsTrustedSystemOperation(`support tickets (ADR-039): ${reason}`, fn)
}

function fail<T = undefined>(error: { code?: string | null; message?: string | null } | null): TicketResult<T> {
  return { ok: false, reason: failureFromDbError(error) }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

type TicketRow = {
  id: string
  number: number
  project_id: string
  created_by: string | null
  title: string
  status: TicketStatus
  severity: TicketSeverity
  context: TicketContext
  created_at: string
  updated_at: string
  last_activity_at: string
  last_public_activity_at: string
  resolved_at: string | null
}
/** Columns a CLIENT path may read. No severity, no context. */
const CLIENT_TICKET_COLUMNS = 'id, number, project_id, created_by, title, status, created_at, last_public_activity_at, resolved_at'
const ADMIN_TICKET_COLUMNS = 'id, number, project_id, created_by, title, status, severity, context, created_at, updated_at, last_activity_at, last_public_activity_at, resolved_at'

type MessageRow = { id: string; ticket_id: string; author_id: string | null; author_kind: 'client' | 'support'; body: string; created_at: string; redacted_at: string | null }
type NoteRow = { id: string; ticket_id: string; author_id: string | null; body: string; created_at: string }
type EventRow = { id: string; ticket_id: string; actor_id: string | null; kind: TicketEventKind; from_value: string | null; to_value: string | null; visibility: 'public' | 'internal'; created_at: string }
type AttachmentRow = { id: string; ticket_id: string; message_id: string | null; storage_path: string; mime: string; bytes: number; width: number | null; height: number | null; deleted_reason: TicketAttachmentView['deleted']; uploaded_by?: string | null }

// ── People ───────────────────────────────────────────────────────────────────

async function loadPeople(db: Db, ids: Array<string | null>, withEmail: boolean): Promise<Map<string, TicketPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const map = new Map<string, TicketPerson>()
  if (!unique.length) return map
  const { data } = await db.from('profiles').select('id, full_name, avatar_url').in('id', unique)
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>) {
    map.set(p.id, { id: p.id, name: (p.full_name ?? '').trim(), avatarUrl: safeAvatarUrl(p.avatar_url) })
  }
  if (withEmail) {
    await Promise.all(unique.map(async (id) => {
      const { data: u } = await db.auth.admin.getUserById(id).catch(() => ({ data: { user: null } }))
      const user = u?.user
      const prev = map.get(id) ?? { id, name: '' }
      const metaName = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''
      map.set(id, { ...prev, name: prev.name || metaName, email: user?.email ?? undefined })
    }))
  }
  return map
}
const person = (map: Map<string, TicketPerson>, id: string | null): TicketPerson => (id ? map.get(id) ?? { id, name: '' } : { id: null, name: '' })

/** Which side a read mark belongs to (migration 047): a person who is both a client and an Abluo admin keeps two. */
type ReadSide = 'client' | 'support'

/** 42703 / PGRST204 / 42P10: migration 047 not applied yet — fall back to one mark per person (046). */
const isMissingSide = (e: { code?: string | null } | null) => !!e && ['42703', 'PGRST204', '42P10'].includes(e.code ?? '')

async function readMarks(db: Db, userId: string, ticketIds: string[], side: ReadSide): Promise<Map<string, string>> {
  const marks = new Map<string, string>()
  if (!ticketIds.length) return marks
  let res = await db.from('support_ticket_reads').select('ticket_id, last_read_at').eq('user_id', userId).eq('side', side).in('ticket_id', ticketIds)
  if (isMissingSide(res.error)) res = await db.from('support_ticket_reads').select('ticket_id, last_read_at').eq('user_id', userId).in('ticket_id', ticketIds)
  for (const r of (res.data ?? []) as Array<{ ticket_id: string; last_read_at: string }>) marks.set(r.ticket_id, r.last_read_at)
  return marks
}

async function markRead(db: Db, ticketId: string, userId: string, side: ReadSide): Promise<void> {
  const at = new Date().toISOString()
  const res = await db.from('support_ticket_reads').upsert({ ticket_id: ticketId, user_id: userId, side, last_read_at: at }, { onConflict: 'ticket_id,user_id,side' })
  if (isMissingSide(res.error)) await db.from('support_ticket_reads').upsert({ ticket_id: ticketId, user_id: userId, last_read_at: at }, { onConflict: 'ticket_id,user_id' })
}

/** Uploads prepared screenshots and links them to a message. A failed upload is logged and skipped, never fatal. */
async function storeAttachments(db: Db, projectId: string, ticketId: string, messageId: string | null, images: ReturnType<typeof stripMetadata>[], uploadedBy: string): Promise<void> {
  for (const img of images) {
    if (!img) continue
    const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg'
    const path = `${projectId}/${ticketId}/${crypto.randomUUID()}.${ext}`
    const up = await db.storage.from(ATTACHMENT_BUCKET).upload(path, img.bytes, { contentType: img.mime, upsert: false })
    if (up.error) { console.error('[support-tickets] screenshot upload failed', up.error.message); continue }
    const ins = await db.from('support_ticket_attachments').insert({
      ticket_id: ticketId, message_id: messageId, storage_path: path,
      mime: img.mime, bytes: img.bytes.length, width: img.width, height: img.height, uploaded_by: uploadedBy,
    })
    if (ins.error) { console.error('[support-tickets] screenshot row failed', ins.error.message); await db.storage.from(ATTACHMENT_BUCKET).remove([path]) }
  }
}

async function attachmentViews(db: Db, rows: AttachmentRow[], deletableBy?: string | null): Promise<Map<string, TicketAttachmentView[]>> {
  const live = rows.filter((r) => !r.deleted_reason)
  const urls = new Map<string, string>()
  if (live.length) {
    const { data } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrls(live.map((r) => r.storage_path), TICKET_LIMITS.signedUrlSeconds)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  const byMessage = new Map<string, TicketAttachmentView[]>()
  for (const r of rows) {
    const key = r.message_id ?? ''
    const list = byMessage.get(key) ?? []
    list.push({ id: r.id, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, url: r.deleted_reason ? null : urls.get(r.storage_path) ?? null, deleted: r.deleted_reason, ...(deletableBy !== undefined ? { canDelete: !r.deleted_reason && !!deletableBy && r.uploaded_by === deletableBy } : {}) })
    byMessage.set(key, list)
  }
  return byMessage
}

function summary(row: Pick<TicketRow, 'id' | 'number' | 'title' | 'status' | 'created_at' | 'created_by'>, activity: string, unread: boolean, createdBy: TicketPerson): TicketSummary {
  return {
    id: row.id,
    number: Number(row.number),
    reference: formatTicketNumber(row.number),
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    lastActivityAt: activity,
    unread,
    createdBy,
  }
}

// ══ Client side ═════════════════════════════════════════════════════════════

/** The project's tickets the person may see, newest activity first. */
export async function listClientTickets(access: TicketAccess): Promise<TicketResult<TicketSummary[]>> {
  return withDb('list a client project’s tickets after the D3 check', async (db) => {
    let query = db.from('support_tickets').select(CLIENT_TICKET_COLUMNS).eq('project_id', access.projectId)
    if (!access.canReadAll) query = query.eq('created_by', access.userId)
    const { data, error } = await query.order('last_public_activity_at', { ascending: false }).limit(500)
    if (error) return fail(error)
    const rows = (data ?? []) as TicketRow[]
    const ids = rows.map((r) => r.id)
    const [marks, people, lastReply] = await Promise.all([
      readMarks(db, access.userId, ids, 'client'),
      loadPeople(db, rows.map((r) => r.created_by), false),
      lastSupportReplies(db, ids),
    ])
    return {
      ok: true,
      value: rows.map((r) => {
        // Round 4 (Tom): only what asks something of the client counts — an unread
        // reply from Abluo Support, or a ticket waiting for their reply. A status
        // change alone (e.g. Resolved) is visible in the ticket and emailed.
        const reply = lastReply.get(r.id)
        const unread = reply ? isUnread(reply, marks.get(r.id)) : false
        return { ...summary(r, r.last_public_activity_at, unread, person(people, r.created_by)), needsReply: r.status === 'waiting_for_user' }
      }),
    }
  })
}

/** Newest Abluo Support reply per ticket. */
async function lastSupportReplies(db: Db, ticketIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!ticketIds.length) return map
  const { data } = await db.from('support_ticket_messages').select('ticket_id, created_at').in('ticket_id', ticketIds).eq('author_kind', 'support').order('created_at', { ascending: false }).limit(5000)
  for (const m of (data ?? []) as Array<{ ticket_id: string; created_at: string }>) if (!map.has(m.ticket_id)) map.set(m.ticket_id, m.created_at)
  return map
}

/** The client's sidebar number: tickets waiting for their reply + unread Abluo replies. */
export async function countClientUnread(access: TicketAccess): Promise<number> {
  const list = await listClientTickets(access)
  return list.ok ? list.value.filter((t) => t.needsReply || t.unread).length : 0
}

/** When a ticket last changed for the client — screens poll this to refresh themselves (round 4). */
export async function clientTicketActivity(access: TicketAccess, ticketId: string): Promise<string | null> {
  if (!isUuid(ticketId)) return null
  return withDb('client screen checks whether a ticket changed', async (db) => {
    const { data } = await db.from('support_tickets').select('project_id, created_by, last_public_activity_at').eq('id', ticketId).maybeSingle()
    const t = data as { project_id: string; created_by: string | null; last_public_activity_at: string } | null
    return t && canSeeTicket(access, t) ? t.last_public_activity_at : null
  })
}

/** One ticket as the client sees it: messages, public status lines, screenshots. Marks it read. */
export async function getClientTicket(access: TicketAccess, ticketId: string, options: { markRead?: boolean } = {}): Promise<TicketResult<TicketDetail>> {
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  return withDb('read one client ticket after the D3 check', async (db) => {
    const { data, error } = await db.from('support_tickets').select(CLIENT_TICKET_COLUMNS).eq('id', ticketId).maybeSingle()
    if (error) return fail(error)
    const t = data as TicketRow | null
    if (!t || !canSeeTicket(access, t)) return { ok: false, reason: 'notFound' }
    const [msgs, events, atts] = await Promise.all([
      db.from('support_ticket_messages').select('id, ticket_id, author_id, author_kind, body, created_at, redacted_at').eq('ticket_id', t.id).order('created_at'),
      db.from('support_ticket_events').select('id, ticket_id, actor_id, kind, from_value, to_value, visibility, created_at').eq('ticket_id', t.id).eq('visibility', 'public').order('created_at'),
      db.from('support_ticket_attachments').select('id, ticket_id, message_id, storage_path, mime, bytes, width, height, deleted_reason, uploaded_by').eq('ticket_id', t.id).order('created_at'),
    ])
    const messages = (msgs.data ?? []) as MessageRow[]
    // Only client authors are named; Abluo replies show as "Abluo Support" (the UI's label).
    const people = await loadPeople(db, messages.filter((m) => m.author_kind === 'client').map((m) => m.author_id), false)
    const byMessage = await attachmentViews(db, (atts.data ?? []) as AttachmentRow[], access.canWrite && !access.supportMode ? access.userId : null)
    const thread = buildThread({
      messages, notes: [], events: (events.data ?? []) as EventRow[], people, byMessage,
      firstMessageId: messages[0]?.id ?? null, hideSupportNames: true,
    })
    // Only the page path from the admin-only context: it is the client's own dashboard page.
    const fromRow = await db.from('support_tickets').select('page:context->>page').eq('id', t.id).maybeSingle()
    const reported = (fromRow.data as { page: string | null } | null)?.page ?? undefined
    if (options.markRead !== false) await markRead(db, t.id, access.userId, 'client')
    const outcome = clientReplyOutcome(t.status, t.resolved_at)
    return {
      ok: true,
      value: {
        ...summary(t, t.last_public_activity_at, false, person(people, t.created_by)),
        resolvedAt: t.resolved_at,
        reply: !access.canWrite ? 'forbidden' : outcome.allowed ? 'allowed' : 'closed',
        thread,
        reportedFrom: reported,
      },
    }
  })
}

export type NewTicketFile = { name: string; type: string; bytes: Uint8Array }

export type NewTicketInput = {
  title: string
  body: string
  files?: NewTicketFile[]
  submitToken?: string | null
  from?: unknown
  userAgent?: unknown
  viewport?: unknown
  interfaceLocale?: unknown
  relatedTo?: unknown
}

/** Checks the screenshots before anything is written. Pure; exported for tests. */
export function prepareAttachments(files: NewTicketFile[] | undefined): TicketResult<ReturnType<typeof stripMetadata>[]> {
  const list = (files ?? []).filter((f) => f.bytes.length > 0)
  if (list.length > TICKET_LIMITS.attachmentsMax) return { ok: false, reason: 'tooManyAttachments' }
  const out: ReturnType<typeof stripMetadata>[] = []
  for (const f of list) {
    if (f.bytes.length > TICKET_LIMITS.attachmentBytesMax) return { ok: false, reason: 'attachmentTooLarge' }
    const clean = stripMetadata(f.bytes)
    if (!clean) return { ok: false, reason: 'attachmentType' }
    out.push(clean)
  }
  return { ok: true, value: out }
}

/** Create a request (+ screenshots). Idempotent per submit token (D14). */
export async function createTicket(access: TicketAccess, input: NewTicketInput): Promise<TicketResult<{ id: string; number: number; reference: string }>> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  if (!access.canWrite) return { ok: false, reason: 'forbidden' }
  const titleError = validateTitle(input.title)
  if (titleError) return { ok: false, reason: 'invalid', field: titleError }
  const bodyError = validateBody(input.body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  const prepared = prepareAttachments(input.files)
  if (!prepared.ok) return prepared
  const context = buildTicketContext({
    from: input.from,
    projectSlug: access.projectSlug,
    platformVersion: process.env.NEXT_PUBLIC_PLATFORM_VERSION,
    userAgent: input.userAgent,
    viewport: input.viewport,
    interfaceLocale: input.interfaceLocale,
    role: access.role,
    relatedTo: input.relatedTo,
  })
  const token = input.submitToken && isUuid(input.submitToken) ? input.submitToken : null

  const result = await withDb('create a support request for a client who holds support.tickets.write', async (db) => {
    const { data, error } = await db.rpc('support_ticket_create', {
      p_project_id: access.projectId,
      p_user_id: access.userId,
      p_title: input.title.trim(),
      p_body: input.body.trim(),
      p_context: context,
      p_submit_token: token,
      p_environment: getAppEnvironment(),
      p_max_per_hour: TICKET_LIMITS.ticketsPerHour,
    })
    if (error) return fail<{ id: string; number: number; reference: string; created: boolean }>(error)
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; number: number; created: boolean } | undefined
    if (!row) return { ok: false as const, reason: 'error' as const }
    if (row.created) {
      await markRead(db, row.id, access.userId, 'client')
      const firstMessage = await db.from('support_ticket_messages').select('id').eq('ticket_id', row.id).order('created_at').limit(1).maybeSingle()
      await storeAttachments(db, access.projectId, row.id, (firstMessage.data as { id: string } | null)?.id ?? null, prepared.value, access.userId)
    }
    return { ok: true as const, value: { id: row.id, number: Number(row.number), reference: formatTicketNumber(row.number), created: row.created } }
  })
  if (!result.ok) return result
  if (result.value.created) scheduleTicketNotifications()
  return { ok: true, value: { id: result.value.id, number: result.value.number, reference: result.value.reference } }
}

export async function replyAsClient(access: TicketAccess, ticketId: string, body: string, files?: NewTicketFile[]): Promise<TicketResult> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  if (!access.canWrite) return { ok: false, reason: 'forbidden' }
  const bodyError = validateBody(body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  const prepared = prepareAttachments(files)
  if (!prepared.ok) return prepared
  const result = await withDb('add a client reply after the D3 check', async (db): Promise<TicketResult> => {
    const { data, error } = await db.from('support_tickets').select('id, project_id, created_by').eq('id', ticketId).maybeSingle()
    if (error) return fail(error)
    if (!data || !canSeeTicket(access, data as { project_id: string; created_by: string | null })) return { ok: false, reason: 'notFound' }
    const rpc = await db.rpc('support_ticket_reply', {
      p_ticket_id: ticketId, p_author_id: access.userId, p_author_kind: 'client', p_body: body.trim(),
      p_environment: getAppEnvironment(), p_reopen_days: TICKET_LIMITS.reopenDays, p_max_per_hour: TICKET_LIMITS.repliesPerHour,
    })
    if (rpc.error) return fail(rpc.error)
    await storeAttachments(db, access.projectId, ticketId, (rpc.data as string | null) ?? null, prepared.value, access.userId)
    await markRead(db, ticketId, access.userId, 'client')
    return { ok: true, value: undefined }
  })
  if (result.ok) scheduleTicketNotifications()
  return result
}

/** What the client Home's "Needs your attention" shows (round 2): requests waiting for them first, then unread news. */
export type TicketAttentionItem = { kind: 'waiting' | 'update'; ticket: TicketSummary }

export async function clientTicketAttention(access: TicketAccess): Promise<TicketAttentionItem[]> {
  const list = await listClientTickets(access)
  if (!list.ok) return []
  const waiting = list.value.filter((t) => t.status === 'waiting_for_user').map((ticket) => ({ kind: 'waiting' as const, ticket }))
  // 'update' = an unread reply from Abluo Support (round 4).
  const updates = list.value.filter((t) => t.status !== 'waiting_for_user' && t.unread).map((ticket) => ({ kind: 'update' as const, ticket }))
  return [...waiting, ...updates]
}

// ══ Admin side — callers have passed requireAbluoAdmin() ════════════════════

export type AdminTicketFilters = {
  projectId?: string
  status?: TicketStatus | 'active' | 'all' // 'active' (default) = not resolved
  severity?: TicketSeverity
}

export async function listAdminTickets(adminUserId: string, filters: AdminTicketFilters = {}): Promise<TicketResult<TicketSummary[]>> {
  return withDb('Abluo admin lists support tickets across projects', async (db) => {
    let query = db.from('support_tickets').select(ADMIN_TICKET_COLUMNS)
    if (filters.projectId && isUuid(filters.projectId)) query = query.eq('project_id', filters.projectId)
    const status = filters.status ?? 'active'
    if (status === 'active') query = query.neq('status', 'resolved')
    else if (isTicketStatus(status)) query = query.eq('status', status)
    if (filters.severity && isTicketSeverity(filters.severity)) query = query.eq('severity', filters.severity)
    const { data, error } = await query.order('last_activity_at', { ascending: false }).limit(1000)
    if (error) return fail(error)
    const rows = (data ?? []) as TicketRow[]
    const projectIds = [...new Set(rows.map((r) => r.project_id))]
    const [marks, people, projects] = await Promise.all([
      readMarks(db, adminUserId, rows.map((r) => r.id), 'support'),
      loadPeople(db, rows.map((r) => r.created_by), false),
      projectIds.length ? db.from('projects').select('id, slug, name').in('id', projectIds) : Promise.resolve({ data: [] as unknown[] }),
    ])
    const byProject = new Map(((projects.data ?? []) as Array<{ id: string; slug: string; name: string }>).map((p) => [p.id, p]))
    return {
      ok: true,
      value: rows.map((r) => ({
        ...summary(r, r.last_activity_at, isUnread(r.last_activity_at, marks.get(r.id)), person(people, r.created_by)),
        seen: marks.has(r.id),
        severity: r.severity,
        project: byProject.get(r.project_id) ?? { id: r.project_id, slug: '', name: '' },
      })),
    }
  })
}

/** The admin sidebar number: tickets still active with something this admin hasn't seen (= New Requests + Client Replied on the card). */
export async function countAdminUnread(adminUserId: string): Promise<number> {
  const list = await listAdminTickets(adminUserId, { status: 'active' })
  return list.ok ? list.value.filter((t) => t.unread).length : 0
}

/** Everything about one ticket, including notes, internal events and context. Marks it read for this admin. */
export async function getAdminTicket(adminUserId: string, ticketId: string, options: { markRead?: boolean } = {}): Promise<TicketResult<TicketDetail>> {
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin reads one support ticket in full', async (db) => {
    const { data, error } = await db.from('support_tickets').select(ADMIN_TICKET_COLUMNS).eq('id', ticketId).maybeSingle()
    if (error) return fail(error)
    const t = data as TicketRow | null
    if (!t) return { ok: false, reason: 'notFound' }
    const [msgs, notes, events, atts, project] = await Promise.all([
      db.from('support_ticket_messages').select('id, ticket_id, author_id, author_kind, body, created_at, redacted_at').eq('ticket_id', t.id).order('created_at'),
      db.from('support_ticket_notes').select('id, ticket_id, author_id, body, created_at').eq('ticket_id', t.id).order('created_at'),
      db.from('support_ticket_events').select('id, ticket_id, actor_id, kind, from_value, to_value, visibility, created_at').eq('ticket_id', t.id).order('created_at'),
      db.from('support_ticket_attachments').select('id, ticket_id, message_id, storage_path, mime, bytes, width, height, deleted_reason').eq('ticket_id', t.id).order('created_at'),
      db.from('projects').select('id, slug, name').eq('id', t.project_id).maybeSingle(),
    ])
    const messages = (msgs.data ?? []) as MessageRow[]
    const noteRows = (notes.data ?? []) as NoteRow[]
    const eventRows = (events.data ?? []) as EventRow[]
    const people = await loadPeople(db, [t.created_by, ...messages.map((m) => m.author_id), ...noteRows.map((n) => n.author_id), ...eventRows.map((e) => e.actor_id)], true)
    const byMessage = await attachmentViews(db, (atts.data ?? []) as AttachmentRow[])
    if (options.markRead !== false) await markRead(db, t.id, adminUserId, 'support')
    return {
      ok: true,
      value: {
        ...summary(t, t.last_activity_at, false, person(people, t.created_by)),
        severity: t.severity,
        project: (project.data as { id: string; slug: string; name: string } | null) ?? { id: t.project_id, slug: '', name: '' },
        resolvedAt: t.resolved_at,
        reply: 'allowed',
        context: t.context ?? {},
        thread: buildThread({ messages, notes: noteRows, events: eventRows, people, byMessage, firstMessageId: messages[0]?.id ?? null, hideSupportNames: false }),
      },
    }
  })
}

export async function replyAsSupport(adminUserId: string, ticketId: string, body: string, files?: NewTicketFile[]): Promise<TicketResult> {
  const bodyError = validateBody(body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  const prepared = prepareAttachments(files)
  if (!prepared.ok) return prepared
  const result = await withDb('Abluo admin replies to a client on a ticket', async (db): Promise<TicketResult> => {
    const { data: t } = await db.from('support_tickets').select('project_id').eq('id', ticketId).maybeSingle()
    if (!t) return { ok: false, reason: 'notFound' }
    const rpc = await db.rpc('support_ticket_reply', {
      p_ticket_id: ticketId, p_author_id: adminUserId, p_author_kind: 'support', p_body: body.trim(),
      p_environment: getAppEnvironment(), p_reopen_days: TICKET_LIMITS.reopenDays, p_max_per_hour: TICKET_LIMITS.repliesPerHour,
    })
    if (rpc.error) return fail(rpc.error)
    await storeAttachments(db, (t as { project_id: string }).project_id, ticketId, (rpc.data as string | null) ?? null, prepared.value, adminUserId)
    await markRead(db, ticketId, adminUserId, 'support')
    return { ok: true, value: undefined }
  })
  if (result.ok) scheduleTicketNotifications()
  return result
}

/** The admin dashboard's Support card (round 2, split in round 4). */
export type AdminSupportOverview = {
  /** Never opened by this admin. */
  newCount: number
  /** Opened before, with activity this admin hasn't seen (e.g. the client replied). */
  repliedCount: number
  waitingCount: number
  highOpenCount: number
  /** Most recently active, not resolved, newest first. */
  recent: TicketSummary[]
}

/** Pure: the Support card's numbers from the active admin ticket list (so a page can fetch the list once). */
export function summariseAdminTickets(rows: readonly TicketSummary[], recentLimit = 5): AdminSupportOverview {
  return {
    newCount: rows.filter((t) => !t.seen).length,
    repliedCount: rows.filter((t) => t.seen && t.unread).length,
    waitingCount: rows.filter((t) => t.status === 'waiting_for_user').length,
    highOpenCount: rows.filter((t) => t.severity === 'high').length,
    recent: rows.slice(0, recentLimit),
  }
}

export async function adminSupportOverview(adminUserId: string, recentLimit = 5): Promise<TicketResult<AdminSupportOverview>> {
  const list = await listAdminTickets(adminUserId, { status: 'active' })
  if (!list.ok) return list
  return { ok: true, value: summariseAdminTickets(list.value, recentLimit) }
}

/** When a ticket last changed for the admin (incl. notes) — the admin page polls this (round 4). */
export async function adminTicketActivity(ticketId: string): Promise<string | null> {
  if (!isUuid(ticketId)) return null
  return withDb('admin screen checks whether a ticket changed', async (db) => {
    const { data } = await db.from('support_tickets').select('last_activity_at').eq('id', ticketId).maybeSingle()
    return (data as { last_activity_at: string } | null)?.last_activity_at ?? null
  })
}

/** Internal note — never visible to the client, never emailed (D7). */
export async function addNote(adminUserId: string, ticketId: string, body: string): Promise<TicketResult> {
  const bodyError = validateBody(body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin adds an internal note to a ticket', async (db) => {
    const ins = await db.from('support_ticket_notes').insert({ ticket_id: ticketId, author_id: adminUserId, body: body.trim() })
    if (ins.error) return fail(ins.error)
    await db.from('support_tickets').update({ last_activity_at: new Date().toISOString() }).eq('id', ticketId)
    await markRead(db, ticketId, adminUserId, 'support')
    return { ok: true, value: undefined }
  })
}

export async function setTicketStatus(adminUserId: string, ticketId: string, status: TicketStatus): Promise<TicketResult> {
  if (!isTicketStatus(status)) return { ok: false, reason: 'invalid' }
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  const result = await withDb('Abluo admin changes a ticket status', async (db): Promise<TicketResult> => {
    const rpc = await db.rpc('support_ticket_set_status', {
      p_ticket_id: ticketId, p_actor_id: adminUserId, p_status: status, p_environment: getAppEnvironment(), p_retention_days: TICKET_LIMITS.retentionDays,
    })
    if (rpc.error) return fail(rpc.error)
    await markRead(db, ticketId, adminUserId, 'support')
    return { ok: true, value: undefined }
  })
  if (result.ok && (status === 'resolved' || status === 'waiting_for_user')) scheduleTicketNotifications()
  return result
}

export async function setTicketSeverity(adminUserId: string, ticketId: string, severity: TicketSeverity): Promise<TicketResult> {
  if (!isTicketSeverity(severity)) return { ok: false, reason: 'invalid' }
  if (!isUuid(ticketId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin changes a ticket severity', async (db) => {
    const rpc = await db.rpc('support_ticket_set_severity', { p_ticket_id: ticketId, p_actor_id: adminUserId, p_severity: severity })
    if (rpc.error) return fail(rpc.error)
    await markRead(db, ticketId, adminUserId, 'support')
    return { ok: true, value: undefined }
  })
}

/** Removes a message's text for good (patient data etc., D11). */
export async function redactMessage(adminUserId: string, messageId: string): Promise<TicketResult> {
  if (!isUuid(messageId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin redacts a ticket message', async (db) => {
    const rpc = await db.rpc('support_ticket_redact_message', { p_message_id: messageId, p_actor_id: adminUserId })
    if (rpc.error) return fail(rpc.error)
    return { ok: true, value: undefined }
  })
}

/** Hides chosen parts of a message for good (round 3). Ranges are [start, end) in the current text. */
export async function redactMessageParts(adminUserId: string, messageId: string, ranges: RedactionRange[]): Promise<TicketResult<{ removed: number }>> {
  if (!isUuid(messageId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin hides parts of a ticket message', async (db) => {
    const { data, error } = await db.from('support_ticket_messages').select('body, redacted_at').eq('id', messageId).maybeSingle()
    if (error) return fail(error)
    const row = data as { body: string; redacted_at: string | null } | null
    if (!row || row.redacted_at) return { ok: false, reason: 'notFound' }
    const masked = maskRanges(row.body, ranges)
    if (!masked.removed) return { ok: false, reason: 'invalid' }
    const rpc = await db.rpc('support_ticket_redact_parts', { p_message_id: messageId, p_actor_id: adminUserId, p_masked_body: masked.body })
    if (rpc.error) return fail(rpc.error)
    return { ok: true, value: { removed: Number(rpc.data ?? masked.removed) } }
  })
}

/** A client deletes a screenshot THEY uploaded (round 3). Public event so both sides see it. */
export async function deleteOwnAttachment(access: TicketAccess, attachmentId: string): Promise<TicketResult> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  if (!access.canWrite) return { ok: false, reason: 'forbidden' }
  if (!isUuid(attachmentId)) return { ok: false, reason: 'notFound' }
  return withDb('a client deletes a screenshot they uploaded', async (db) => {
    const { data, error } = await db.from('support_ticket_attachments').select('id, ticket_id, storage_path, uploaded_by, deleted_at').eq('id', attachmentId).maybeSingle()
    if (error) return fail(error)
    const row = data as { id: string; ticket_id: string; storage_path: string; uploaded_by: string | null; deleted_at: string | null } | null
    if (!row || row.uploaded_by !== access.userId) return { ok: false, reason: 'notFound' }
    const { data: t } = await db.from('support_tickets').select('project_id, created_by').eq('id', row.ticket_id).maybeSingle()
    if (!t || !canSeeTicket(access, t as { project_id: string; created_by: string | null })) return { ok: false, reason: 'notFound' }
    if (row.deleted_at) return { ok: true, value: undefined }
    const rm = await db.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path])
    if (rm.error) return { ok: false, reason: 'error' }
    const upd = await db.from('support_ticket_attachments').update({ deleted_at: new Date().toISOString(), deleted_reason: 'removed_by_client' }).eq('id', row.id)
    if (upd.error) return fail(upd.error)
    await db.from('support_ticket_events').insert({ ticket_id: row.ticket_id, actor_id: access.userId, kind: 'attachment_deleted', to_value: 'removed_by_client', visibility: 'public' })
    await db.from('support_tickets').update({ last_activity_at: new Date().toISOString() }).eq('id', row.ticket_id)
    return { ok: true, value: undefined }
  })
}

/** Deletes a screenshot's file for good and records it (D11). */
export async function deleteAttachment(adminUserId: string, attachmentId: string): Promise<TicketResult> {
  if (!isUuid(attachmentId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin deletes a ticket screenshot', async (db) => {
    const { data, error } = await db.from('support_ticket_attachments').select('id, ticket_id, storage_path, deleted_at').eq('id', attachmentId).maybeSingle()
    if (error) return fail(error)
    const row = data as { id: string; ticket_id: string; storage_path: string; deleted_at: string | null } | null
    if (!row) return { ok: false, reason: 'notFound' }
    if (row.deleted_at) return { ok: true, value: undefined }
    const rm = await db.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path])
    if (rm.error) return { ok: false, reason: 'error' }
    await db.from('support_ticket_attachments').update({ deleted_at: new Date().toISOString(), deleted_reason: 'redacted' }).eq('id', row.id)
    await db.from('support_ticket_events').insert({ ticket_id: row.ticket_id, actor_id: adminUserId, kind: 'attachment_deleted', to_value: 'redacted', visibility: 'internal' })
    return { ok: true, value: undefined }
  })
}

/** Logged when the admin opens "View as Client" from a ticket (D16). */
export async function recordSupportVisitFromTicket(adminUserId: string, ticketId: string): Promise<void> {
  if (!isUuid(ticketId)) return
  await withDb('log that the admin opened View as Client from a ticket', async (db) => {
    await db.from('support_ticket_events').insert({ ticket_id: ticketId, actor_id: adminUserId, kind: 'support_visit_started', visibility: 'internal' })
  })
}

/** The project a ticket belongs to (admin: for View as Client). */
export async function ticketProject(ticketId: string): Promise<{ id: string; slug: string; name: string } | null> {
  if (!isUuid(ticketId)) return null
  return withDb('find the project of a ticket for the admin', async (db) => {
    const { data } = await db.from('support_tickets').select('project_id').eq('id', ticketId).maybeSingle()
    const pid = (data as { project_id: string } | null)?.project_id
    if (!pid) return null
    const { data: p } = await db.from('projects').select('id, slug, name').eq('id', pid).maybeSingle()
    return (p as { id: string; slug: string; name: string } | null) ?? null
  })
}

// ── Thread assembly (pure; exported for tests) ──────────────────────────────

export function buildThread(input: {
  messages: MessageRow[]
  notes: NoteRow[]
  events: EventRow[]
  people: Map<string, TicketPerson>
  byMessage: Map<string, TicketAttachmentView[]>
  firstMessageId: string | null
  hideSupportNames: boolean
}): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  const unlinked = input.byMessage.get('') ?? []
  for (const m of input.messages) {
    const hide = input.hideSupportNames && m.author_kind === 'support'
    entries.push({
      kind: 'message',
      id: m.id,
      authorKind: m.author_kind,
      author: hide ? { id: null, name: '' } : person(input.people, m.author_id),
      body: m.redacted_at ? '' : m.body,
      redacted: Boolean(m.redacted_at),
      createdAt: m.created_at,
      attachments: [...(input.byMessage.get(m.id) ?? []), ...(m.id === input.firstMessageId ? unlinked : [])],
    })
  }
  for (const n of input.notes) entries.push({ kind: 'note', id: n.id, author: person(input.people, n.author_id), body: n.body, createdAt: n.created_at })
  for (const e of input.events) {
    if (e.kind === 'created') continue // the first message already says it
    entries.push({ kind: 'event', id: e.id, event: e.kind, from: e.from_value, to: e.to_value, createdAt: e.created_at, actor: input.hideSupportNames ? null : e.actor_id ? person(input.people, e.actor_id) : null })
  }
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
