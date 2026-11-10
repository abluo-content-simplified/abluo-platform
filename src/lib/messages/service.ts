// Server-only: uses the service role. Never import from a client component.
/**
 * Messages — every read and write (ADR-050). Two doors, like the tickets:
 *
 *   client functions take a `MessageAccess` (./access.ts) built from the
 *   session and check, on every call, that the person is a PARTICIPANT of the
 *   conversation and that it belongs to the project in the URL (D2);
 *   admin functions take the actor id of a caller that has ALREADY passed
 *   `requireAbluoAdmin()` (Super Admin + two-factor). The Abluo side is a
 *   team inbox (D1): every admin sees every conversation.
 *
 * The tables are service-role only (migration 069); this file is the only
 * place that touches them.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { safeAvatarUrl } from '@/lib/users/service'
import { abluoTeamIds, markSourceRead, notify } from '@/lib/notification-center/service'
import type { NotificationInput } from '@/lib/notification-center/model'
import { maskRanges, type RedactionRange } from '@/lib/support-tickets/redaction'
import type { ThreadEntry, TicketAttachmentView } from '@/lib/support-tickets/model'
import type { MessageAccess } from './access'
import { extensionOf, prepareMessageFiles, type IncomingFile, type PreparedFile } from './files'
import {
  MESSAGE_BUCKET,
  MESSAGE_LIMITS,
  cleanLinks,
  failureFromDbError,
  firstName,
  isConversationMode,
  isUnreadSince,
  linkHref,
  planConversations,
  retentionCutoff,
  validateBody,
  validateSubject,
  type ConversationDetail,
  type ConversationMode,
  type ConversationSummary,
  type MessagePerson,
  type MessageResult,
  type Recipient,
  type StoredLink,
} from './model'

type Db = SupabaseClient

function withDb<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return runAsTrustedSystemOperation(`messages (ADR-050): ${reason}`, fn)
}

function fail<T = undefined>(error: { code?: string | null; message?: string | null } | null): MessageResult<T> {
  return { ok: false, reason: failureFromDbError(error) }
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// ── Rows ─────────────────────────────────────────────────────────────────────

type ConvRow = { id: string; project_id: string; subject: string; mode: ConversationMode; created_by: string | null; created_at: string; last_activity_at: string; archived_at: string | null }
type PartRow = { conversation_id: string; user_id: string; side: 'client' | 'abluo'; added_at: string; last_read_at: string | null }
type MsgRow = { id: string; conversation_id: string; author_id: string | null; author_kind: 'client' | 'abluo'; body: string; links: StoredLink[] | null; created_at: string; redacted_at: string | null }
type AttRow = {
  id: string; conversation_id: string; message_id: string; storage_path: string; file_name: string; mime: string; bytes: number
  width: number | null; height: number | null; uploaded_by: string | null; deleted_reason: TicketAttachmentView['deleted']
}
type ProjectRow = { id: string; slug: string; name: string | null }

const CONV_COLUMNS = 'id, project_id, subject, mode, created_by, created_at, last_activity_at, archived_at'
const MSG_COLUMNS = 'id, conversation_id, author_id, author_kind, body, links, created_at, redacted_at'
const ATT_COLUMNS = 'id, conversation_id, message_id, storage_path, file_name, mime, bytes, width, height, uploaded_by, deleted_reason'

// ── People, projects, files ──────────────────────────────────────────────────

async function loadPeople(db: Db, ids: Array<string | null>, withEmail = false): Promise<Map<string, MessagePerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const map = new Map<string, MessagePerson>()
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
      map.set(id, { ...prev, name: prev.name || metaName || (user?.email ?? ''), email: user?.email ?? undefined })
    }))
  }
  return map
}
const personOf = (map: Map<string, MessagePerson>, id: string | null): MessagePerson => (id ? map.get(id) ?? { id, name: '' } : { id: null, name: '' })

async function loadProjects(db: Db, ids: string[]): Promise<Map<string, ProjectRow>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const { data } = await db.from('projects').select('id, slug, name').in('id', unique)
  return new Map(((data ?? []) as ProjectRow[]).map((p) => [p.id, p]))
}
const projectName = (p: ProjectRow | undefined) => (p ? (p.name ?? '').trim() || p.slug : '')

async function storeFiles(db: Db, conv: { id: string; project_id: string }, messageId: string, files: PreparedFile[], uploadedBy: string): Promise<void> {
  for (const f of files) {
    const path = `${conv.project_id}/${conv.id}/${crypto.randomUUID()}.${extensionOf(f.mime)}`
    const up = await db.storage.from(MESSAGE_BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false })
    if (up.error) { console.error('[messages] file upload failed', up.error.message); continue }
    const ins = await db.from('message_attachments').insert({
      conversation_id: conv.id, message_id: messageId, storage_path: path, file_name: f.name,
      mime: f.mime, bytes: f.bytes.length, width: f.width, height: f.height, uploaded_by: uploadedBy,
    })
    if (ins.error) { console.error('[messages] file row failed', ins.error.message); await db.storage.from(MESSAGE_BUCKET).remove([path]) }
  }
}

/** Signed links (5 minutes); PDFs download under their own name. `deletableBy`: who may delete their own files. */
async function fileViews(db: Db, rows: AttRow[], deletableBy: string | null): Promise<Map<string, TicketAttachmentView[]>> {
  const urls = new Map<string, string>()
  const live = rows.filter((r) => !r.deleted_reason)
  const images = live.filter((r) => r.mime !== 'application/pdf')
  if (images.length) {
    const { data } = await db.storage.from(MESSAGE_BUCKET).createSignedUrls(images.map((r) => r.storage_path), MESSAGE_LIMITS.signedUrlSeconds)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  await Promise.all(live.filter((r) => r.mime === 'application/pdf').map(async (r) => {
    const { data } = await db.storage.from(MESSAGE_BUCKET).createSignedUrl(r.storage_path, MESSAGE_LIMITS.signedUrlSeconds, { download: r.file_name || true })
    if (data?.signedUrl) urls.set(r.storage_path, data.signedUrl)
  }))
  const byMessage = new Map<string, TicketAttachmentView[]>()
  for (const r of rows) {
    const list = byMessage.get(r.message_id) ?? []
    list.push({
      id: r.id, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, name: r.file_name,
      url: r.deleted_reason ? null : urls.get(r.storage_path) ?? null,
      deleted: r.deleted_reason,
      canDelete: !r.deleted_reason && !!deletableBy && r.uploaded_by === deletableBy,
    })
    byMessage.set(r.message_id, list)
  }
  return byMessage
}

function buildThread(messages: MsgRow[], people: Map<string, MessagePerson>, files: Map<string, TicketAttachmentView[]>, projectSlug: string): ThreadEntry[] {
  return messages.map((m) => {
    const author = personOf(people, m.author_id)
    return {
      kind: 'message' as const,
      id: m.id,
      authorKind: m.author_kind === 'abluo' ? ('support' as const) : ('client' as const),
      // D4: an Abluo message carries its author's first name ("Tom · Abluo"); D1: "Anna · Abluo" later.
      author: m.author_kind === 'abluo' ? { ...author, name: firstName(author.name) } : author,
      body: m.redacted_at && !m.body ? '' : m.body,
      redacted: Boolean(m.redacted_at) && !m.body.trim(),
      createdAt: m.created_at,
      attachments: files.get(m.id) ?? [],
      links: (m.links ?? []).flatMap((l) => {
        const href = linkHref(projectSlug, l?.id)
        return href ? [{ id: l.id, href }] : []
      }),
    }
  })
}

function previewOf(m: MsgRow | undefined): string {
  if (!m || (m.redacted_at && !m.body.trim())) return ''
  return m.body.split('\n').find((l) => l.trim())?.trim().slice(0, 140) ?? ''
}

/** The newest message per conversation (and the newest from each side). */
async function latestMessages(db: Db, convIds: string[]): Promise<{ latest: Map<string, MsgRow>; latestBy: Map<string, { client?: string; abluo?: string }> }> {
  const latest = new Map<string, MsgRow>()
  const latestBy = new Map<string, { client?: string; abluo?: string }>()
  if (!convIds.length) return { latest, latestBy }
  const { data } = await db.from('messages').select(MSG_COLUMNS).in('conversation_id', convIds).order('created_at', { ascending: false }).limit(5000)
  for (const m of (data ?? []) as MsgRow[]) {
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m)
    const by = latestBy.get(m.conversation_id) ?? {}
    if (!by[m.author_kind]) by[m.author_kind] = m.created_at
    latestBy.set(m.conversation_id, by)
  }
  return { latest, latestBy }
}

// ══ Client side ═════════════════════════════════════════════════════════════

async function clientConversations(db: Db, access: MessageAccess): Promise<MessageResult<{ convs: ConvRow[]; mine: Map<string, PartRow> }>> {
  const { data: parts, error } = await db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').eq('user_id', access.userId).eq('side', 'client')
  if (error) return fail(error)
  const mine = new Map(((parts ?? []) as PartRow[]).map((p) => [p.conversation_id, p]))
  if (!mine.size) return { ok: true, value: { convs: [], mine } }
  const { data, error: e2 } = await db.from('message_conversations').select(CONV_COLUMNS).in('id', [...mine.keys()]).eq('project_id', access.projectId).order('last_activity_at', { ascending: false }).limit(500)
  if (e2) return fail(e2)
  return { ok: true, value: { convs: (data ?? []) as ConvRow[], mine } }
}

/** The person's conversations on this project, newest activity first. Support mode sees none (D6). */
export async function listClientConversations(access: MessageAccess): Promise<MessageResult<ConversationSummary[]>> {
  if (access.supportMode) return { ok: true, value: [] }
  return withDb('list the signed-in person’s own conversations on one project', async (db) => {
    const base = await clientConversations(db, access)
    if (!base.ok) return base
    const { convs, mine } = base.value
    const ids = convs.map((c) => c.id)
    const [{ latest, latestBy }, others] = await Promise.all([
      latestMessages(db, ids),
      ids.length ? db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').in('conversation_id', ids).eq('side', 'client') : Promise.resolve({ data: [] as unknown[] }),
    ])
    const partRows = (others.data ?? []) as PartRow[]
    const people = await loadPeople(db, partRows.map((p) => p.user_id))
    return {
      ok: true,
      value: convs.map((c) => ({
        id: c.id,
        subject: c.subject,
        mode: c.mode,
        createdAt: c.created_at,
        lastActivityAt: c.last_activity_at,
        archived: false, // archiving is Abluo's list only; a client always sees their conversations
        preview: previewOf(latest.get(c.id)),
        unread: isUnreadSince(latestBy.get(c.id)?.abluo, mine.get(c.id)?.last_read_at),
        participants: c.mode === 'shared' ? partRows.filter((p) => p.conversation_id === c.id).map((p) => personOf(people, p.user_id)) : [],
      })),
    }
  })
}

/** The Messages nav entry and its number: null when the person has no conversation here (the entry stays hidden, D12). */
export async function clientMessagesNav(access: MessageAccess): Promise<{ unread: number } | null> {
  const list = await listClientConversations(access)
  if (!list.ok || list.value.length === 0) return null
  return { unread: list.value.filter((c) => c.unread).length }
}

async function clientConversationRow(db: Db, access: MessageAccess, id: string): Promise<{ conv: ConvRow; me: PartRow } | null> {
  if (!isUuid(id)) return null
  const [{ data: conv }, { data: me }] = await Promise.all([
    db.from('message_conversations').select(CONV_COLUMNS).eq('id', id).maybeSingle(),
    db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').eq('conversation_id', id).eq('user_id', access.userId).eq('side', 'client').maybeSingle(),
  ])
  const c = conv as ConvRow | null
  if (!c || !me || c.project_id !== access.projectId) return null
  return { conv: c, me: me as PartRow }
}

/** When a conversation last changed (the open page polls it to refresh itself). */
export async function clientConversationActivity(access: MessageAccess, id: string): Promise<string | null> {
  if (access.supportMode) return null
  try {
    return await withDb('a client screen checks whether a conversation changed', async (db) => (await clientConversationRow(db, access, id))?.conv.last_activity_at ?? null)
  } catch {
    return null
  }
}

/** One conversation as its client participant sees it. Marks it read (and its bell entry). */
export async function getClientConversation(access: MessageAccess, id: string, options: { markRead?: boolean } = {}): Promise<MessageResult<ConversationDetail>> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  return withDb('read one conversation the signed-in person takes part in', async (db) => {
    const found = await clientConversationRow(db, access, id)
    if (!found) return { ok: false, reason: 'notFound' }
    const { conv, me } = found
    const [msgs, atts, parts] = await Promise.all([
      db.from('messages').select(MSG_COLUMNS).eq('conversation_id', conv.id).order('created_at'),
      db.from('message_attachments').select(ATT_COLUMNS).eq('conversation_id', conv.id).order('created_at'),
      db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').eq('conversation_id', conv.id),
    ])
    if (msgs.error) return fail(msgs.error)
    const messages = (msgs.data ?? []) as MsgRow[]
    const partRows = (parts.data ?? []) as PartRow[]
    const people = await loadPeople(db, [...messages.map((m) => m.author_id), ...partRows.map((p) => p.user_id)])
    const files = await fileViews(db, (atts.data ?? []) as AttRow[], access.userId)
    const abluoRead = partRows.filter((p) => p.side === 'abluo').map((p) => p.last_read_at).filter((v): v is string => Boolean(v)).sort().pop() ?? null
    const lastClient = [...messages].reverse().find((m) => m.author_kind === 'client')?.created_at
    if (options.markRead !== false) {
      await db.from('message_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conv.id).eq('user_id', access.userId).eq('side', 'client')
      await markSourceRead(access.userId, 'client', 'conversation', conv.id)
    }
    return {
      ok: true,
      value: {
        id: conv.id,
        subject: conv.subject,
        mode: conv.mode,
        createdAt: conv.created_at,
        lastActivityAt: conv.last_activity_at,
        archived: false,
        preview: previewOf(messages[messages.length - 1]),
        unread: isUnreadSince([...messages].reverse().find((m) => m.author_kind === 'abluo')?.created_at, me.last_read_at),
        participants: conv.mode === 'shared' ? partRows.filter((p) => p.side === 'client').map((p) => personOf(people, p.user_id)) : [],
        thread: buildThread(messages, people, files, access.projectSlug),
        canReply: true,
        // "Seen": someone at Abluo read it after the person's latest message.
        receipts: [{ person: { id: null, name: '' }, readAt: lastClient && abluoRead && abluoRead >= lastClient ? abluoRead : null }],
      },
    }
  })
}

async function notifyTeam(db: Db, conv: ConvRow, author: string, kind: 'message.replied'): Promise<void> {
  const [team, projects, people] = await Promise.all([abluoTeamIds(), loadProjects(db, [conv.project_id]), loadPeople(db, [author])])
  const inputs: NotificationInput[] = team.map((userId) => ({
    userId, side: 'abluo', projectId: conv.project_id, kind, sourceType: 'conversation', sourceId: conv.id,
    href: `/messages/${conv.id}`,
    params: { subject: conv.subject, name: personOf(people, author).name, project: projectName(projects.get(conv.project_id)) },
  }))
  await notify(inputs)
}

async function notifyRecipients(db: Db, conv: ConvRow, author: string, projectSlug: string): Promise<void> {
  const [{ data: parts }, people] = await Promise.all([
    db.from('message_participants').select('user_id').eq('conversation_id', conv.id).eq('side', 'client'),
    loadPeople(db, [author]),
  ])
  const inputs: NotificationInput[] = ((parts ?? []) as { user_id: string }[]).map((p) => ({
    userId: p.user_id, side: 'client', projectId: conv.project_id, kind: 'message.received', sourceType: 'conversation', sourceId: conv.id,
    href: `/${projectSlug}/messages/${conv.id}`,
    params: { subject: conv.subject, name: firstName(personOf(people, author).name) },
  }))
  await notify(inputs)
}

/** A client participant replies (always allowed for participants, D2 — except in support mode). */
export async function replyAsClient(access: MessageAccess, id: string, body: string, files?: IncomingFile[]): Promise<MessageResult> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  const bodyError = validateBody(body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  const prepared = prepareMessageFiles(files)
  if (!prepared.ok) return prepared
  return withDb('a participant replies in their own conversation', async (db): Promise<MessageResult> => {
    const found = await clientConversationRow(db, access, id)
    if (!found) return { ok: false, reason: 'notFound' }
    const { conv } = found
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recent = await db.from('messages').select('id', { count: 'exact', head: true }).eq('author_id', access.userId).gte('created_at', hourAgo)
    if ((recent.count ?? 0) >= MESSAGE_LIMITS.repliesPerHour) return { ok: false, reason: 'rateLimited' }
    const now = new Date().toISOString()
    const ins = await db.from('messages').insert({ conversation_id: conv.id, author_id: access.userId, author_kind: 'client', body: body.trim() }).select('id').single()
    if (ins.error) return fail(ins.error)
    await storeFiles(db, conv, (ins.data as { id: string }).id, prepared.value, access.userId)
    await db.from('message_conversations').update({ last_activity_at: now, archived_at: null }).eq('id', conv.id)
    if (conv.archived_at) await db.from('message_events').insert({ conversation_id: conv.id, actor_id: access.userId, kind: 'unarchived', detail: { by: 'reply' } })
    await db.from('message_participants').update({ last_read_at: now }).eq('conversation_id', conv.id).eq('user_id', access.userId).eq('side', 'client')
    await notifyTeam(db, conv, access.userId, 'message.replied')
    return { ok: true, value: undefined }
  })
}

/** A client deletes a file THEY uploaded. */
export async function deleteOwnMessageFile(access: MessageAccess, attachmentId: string): Promise<MessageResult> {
  if (access.supportMode) return { ok: false, reason: 'supportMode' }
  if (!isUuid(attachmentId)) return { ok: false, reason: 'notFound' }
  return withDb('a participant deletes a file they uploaded', async (db): Promise<MessageResult> => {
    const { data } = await db.from('message_attachments').select('id, conversation_id, storage_path, uploaded_by, deleted_at').eq('id', attachmentId).maybeSingle()
    const row = data as { id: string; conversation_id: string; storage_path: string; uploaded_by: string | null; deleted_at: string | null } | null
    if (!row || row.uploaded_by !== access.userId) return { ok: false, reason: 'notFound' }
    if (!(await clientConversationRow(db, access, row.conversation_id))) return { ok: false, reason: 'notFound' }
    if (row.deleted_at) return { ok: true, value: undefined }
    return removeFile(db, row, 'removed_by_client', access.userId)
  })
}

async function removeFile(db: Db, row: { id: string; conversation_id: string; storage_path: string }, reason: 'removed_by_client' | 'redacted' | 'retention', actorId: string | null): Promise<MessageResult> {
  const rm = await db.storage.from(MESSAGE_BUCKET).remove([row.storage_path])
  if (rm.error) return { ok: false, reason: 'error' }
  const upd = await db.from('message_attachments').update({ deleted_at: new Date().toISOString(), deleted_reason: reason }).eq('id', row.id)
  if (upd.error) return fail(upd.error)
  await db.from('message_events').insert({ conversation_id: row.conversation_id, actor_id: actorId, kind: 'attachment_deleted', detail: { reason } })
  return { ok: true, value: undefined }
}

// ══ Admin side — callers have passed requireAbluoAdmin() ════════════════════

export type AdminConversationFilters = { archived?: boolean }

/** Every conversation (team inbox, D1), newest activity first, with this admin's unread state. */
export async function listAdminConversations(adminId: string, filters: AdminConversationFilters = {}): Promise<MessageResult<ConversationSummary[]>> {
  return withDb('Abluo admin lists every conversation (team inbox)', async (db) => {
    let q = db.from('message_conversations').select(CONV_COLUMNS)
    q = filters.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
    const { data, error } = await q.order('last_activity_at', { ascending: false }).limit(1000)
    if (error) return fail(error)
    const convs = (data ?? []) as ConvRow[]
    const ids = convs.map((c) => c.id)
    const [{ latest, latestBy }, parts, projects] = await Promise.all([
      latestMessages(db, ids),
      ids.length ? db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').in('conversation_id', ids) : Promise.resolve({ data: [] as unknown[] }),
      loadProjects(db, convs.map((c) => c.project_id)),
    ])
    const partRows = (parts.data ?? []) as PartRow[]
    const people = await loadPeople(db, partRows.filter((p) => p.side === 'client').map((p) => p.user_id), true)
    return {
      ok: true,
      value: convs.map((c) => {
        const mine = partRows.find((p) => p.conversation_id === c.id && p.side === 'abluo' && p.user_id === adminId)
        const p = projects.get(c.project_id)
        return {
          id: c.id,
          subject: c.subject,
          mode: c.mode,
          createdAt: c.created_at,
          lastActivityAt: c.last_activity_at,
          archived: c.archived_at !== null,
          preview: previewOf(latest.get(c.id)),
          unread: isUnreadSince(latestBy.get(c.id)?.client, mine?.last_read_at),
          participants: partRows.filter((x) => x.conversation_id === c.id && x.side === 'client').map((x) => personOf(people, x.user_id)),
          project: { id: c.project_id, slug: p?.slug ?? '', name: projectName(p) },
        }
      }),
    }
  })
}

/** The admin's Messages number: conversations with a client reply this admin hasn't read. */
export async function countAdminUnreadMessages(adminId: string): Promise<number> {
  try {
    const list = await listAdminConversations(adminId)
    return list.ok ? list.value.filter((c) => c.unread).length : 0
  } catch {
    return 0
  }
}

/** When a conversation last changed (admin screen poll). */
export async function adminConversationActivity(id: string): Promise<string | null> {
  if (!isUuid(id)) return null
  try {
    return await withDb('Abluo admin screen checks whether a conversation changed', async (db) => {
      const { data } = await db.from('message_conversations').select('last_activity_at').eq('id', id).maybeSingle()
      return (data as { last_activity_at: string } | null)?.last_activity_at ?? null
    })
  } catch {
    return null
  }
}

/** One conversation for Abluo: thread, recipients and when each last read it (D6). Marks it read for this admin. */
export async function getAdminConversation(adminId: string, id: string): Promise<MessageResult<ConversationDetail>> {
  if (!isUuid(id)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin reads one conversation', async (db) => {
    const { data, error } = await db.from('message_conversations').select(CONV_COLUMNS).eq('id', id).maybeSingle()
    if (error) return fail(error)
    const conv = data as ConvRow | null
    if (!conv) return { ok: false, reason: 'notFound' }
    const [msgs, atts, parts, projects] = await Promise.all([
      db.from('messages').select(MSG_COLUMNS).eq('conversation_id', conv.id).order('created_at'),
      db.from('message_attachments').select(ATT_COLUMNS).eq('conversation_id', conv.id).order('created_at'),
      db.from('message_participants').select('conversation_id, user_id, side, added_at, last_read_at').eq('conversation_id', conv.id),
      loadProjects(db, [conv.project_id]),
    ])
    const messages = (msgs.data ?? []) as MsgRow[]
    const partRows = (parts.data ?? []) as PartRow[]
    const clients = partRows.filter((p) => p.side === 'client')
    const people = await loadPeople(db, [...messages.map((m) => m.author_id), ...clients.map((p) => p.user_id)], true)
    const files = await fileViews(db, (atts.data ?? []) as AttRow[], null)
    const project = projects.get(conv.project_id)
    const mine = partRows.find((p) => p.side === 'abluo' && p.user_id === adminId)
    const now = new Date().toISOString()
    await db.from('message_participants').upsert({ conversation_id: conv.id, user_id: adminId, side: 'abluo', last_read_at: now }, { onConflict: 'conversation_id,user_id,side' })
    await markSourceRead(adminId, 'abluo', 'conversation', conv.id)
    return {
      ok: true,
      value: {
        id: conv.id,
        subject: conv.subject,
        mode: conv.mode,
        createdAt: conv.created_at,
        lastActivityAt: conv.last_activity_at,
        archived: conv.archived_at !== null,
        preview: previewOf(messages[messages.length - 1]),
        unread: isUnreadSince([...messages].reverse().find((m) => m.author_kind === 'client')?.created_at, mine?.last_read_at),
        participants: clients.map((p) => personOf(people, p.user_id)),
        project: { id: conv.project_id, slug: project?.slug ?? '', name: projectName(project) },
        thread: buildThread(messages, people, files, project?.slug ?? ''),
        canReply: true,
        receipts: clients.map((p) => ({ person: personOf(people, p.user_id), readAt: p.last_read_at })),
      },
    }
  })
}

export type NewMessageInput = {
  mode: unknown
  recipients: Recipient[]
  subject: string
  body: string
  links?: unknown
  files?: IncomingFile[]
}

/**
 * "New Message" (D3, D4). `allowed` is the set of `projectId:userId` pairs
 * that have active access right now (from the admin people directory): a
 * recipient outside it is refused, never silently dropped.
 */
export async function sendNewMessage(adminId: string, input: NewMessageInput, allowed: ReadonlySet<string>): Promise<MessageResult<{ ids: string[] }>> {
  const mode: ConversationMode = isConversationMode(input.mode) ? input.mode : 'individual'
  const subjectError = validateSubject(input.subject)
  if (subjectError) return { ok: false, reason: 'invalid', field: subjectError }
  const bodyError = validateBody(input.body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  const plan = planConversations(mode, input.recipients)
  if (!plan.ok) return { ok: false, reason: 'invalid', field: plan.error }
  for (const c of plan.conversations) for (const u of c.userIds) if (!allowed.has(`${c.projectId}:${u}`)) return { ok: false, reason: 'invalid', field: 'recipientNotMember' }
  const prepared = prepareMessageFiles(input.files)
  if (!prepared.ok) return prepared
  const links = cleanLinks(input.links)

  return withDb('Abluo admin sends a new message', async (db): Promise<MessageResult<{ ids: string[] }>> => {
    const projects = await loadProjects(db, plan.conversations.map((c) => c.projectId))
    const ids: string[] = []
    for (const c of plan.conversations) {
      const now = new Date().toISOString()
      const conv = await db
        .from('message_conversations')
        .insert({ project_id: c.projectId, subject: input.subject.trim(), mode: c.userIds.length > 1 ? 'shared' : 'individual', created_by: adminId, last_activity_at: now })
        .select(CONV_COLUMNS)
        .single()
      if (conv.error) return fail(conv.error)
      const row = conv.data as ConvRow
      const parts = await db.from('message_participants').insert([
        ...c.userIds.map((userId) => ({ conversation_id: row.id, user_id: userId, side: 'client' })),
        { conversation_id: row.id, user_id: adminId, side: 'abluo', last_read_at: now },
      ])
      if (parts.error) {
        await db.from('message_conversations').delete().eq('id', row.id)
        return fail(parts.error)
      }
      const msg = await db.from('messages').insert({ conversation_id: row.id, author_id: adminId, author_kind: 'abluo', body: input.body.trim(), links }).select('id').single()
      if (msg.error) {
        await db.from('message_conversations').delete().eq('id', row.id)
        return fail(msg.error)
      }
      await storeFiles(db, row, (msg.data as { id: string }).id, prepared.value, adminId)
      await db.from('message_events').insert({ conversation_id: row.id, actor_id: adminId, kind: 'created', detail: { mode: row.mode, recipients: c.userIds.length } })
      await notifyRecipients(db, row, adminId, projects.get(c.projectId)?.slug ?? '')
      ids.push(row.id)
    }
    return { ok: true, value: { ids } }
  })
}

/** Someone at Abluo replies (any admin, D1). Un-archives the conversation. */
export async function replyAsAbluo(adminId: string, id: string, body: string, files?: IncomingFile[], linksInput?: unknown): Promise<MessageResult> {
  if (!isUuid(id)) return { ok: false, reason: 'notFound' }
  const bodyError = validateBody(body)
  if (bodyError) return { ok: false, reason: 'invalid', field: bodyError }
  const prepared = prepareMessageFiles(files)
  if (!prepared.ok) return prepared
  const links = cleanLinks(linksInput)
  return withDb('Abluo admin replies in a conversation', async (db): Promise<MessageResult> => {
    const { data } = await db.from('message_conversations').select(CONV_COLUMNS).eq('id', id).maybeSingle()
    const conv = data as ConvRow | null
    if (!conv) return { ok: false, reason: 'notFound' }
    const now = new Date().toISOString()
    const ins = await db.from('messages').insert({ conversation_id: conv.id, author_id: adminId, author_kind: 'abluo', body: body.trim(), links }).select('id').single()
    if (ins.error) return fail(ins.error)
    await storeFiles(db, conv, (ins.data as { id: string }).id, prepared.value, adminId)
    await db.from('message_conversations').update({ last_activity_at: now, archived_at: null }).eq('id', conv.id)
    if (conv.archived_at) await db.from('message_events').insert({ conversation_id: conv.id, actor_id: adminId, kind: 'unarchived', detail: { by: 'reply' } })
    await db.from('message_participants').upsert({ conversation_id: conv.id, user_id: adminId, side: 'abluo', last_read_at: now }, { onConflict: 'conversation_id,user_id,side' })
    const projects = await loadProjects(db, [conv.project_id])
    await notifyRecipients(db, conv, adminId, projects.get(conv.project_id)?.slug ?? '')
    return { ok: true, value: undefined }
  })
}

export async function setConversationArchived(adminId: string, id: string, archived: boolean): Promise<MessageResult> {
  if (!isUuid(id)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin archives or restores a conversation', async (db): Promise<MessageResult> => {
    const upd = await db.from('message_conversations').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id')
    if (upd.error) return fail(upd.error)
    if (!upd.data?.length) return { ok: false, reason: 'notFound' }
    await db.from('message_events').insert({ conversation_id: id, actor_id: adminId, kind: archived ? 'archived' : 'unarchived', detail: {} })
    return { ok: true, value: undefined }
  })
}

/** Hide parts of a message (D7, the ticket mechanism). Removal is real. */
export async function redactMessageParts(adminId: string, messageId: string, ranges: RedactionRange[]): Promise<MessageResult<{ removed: number }>> {
  if (!isUuid(messageId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin hides parts of a message', async (db) => {
    const { data, error } = await db.from('messages').select('id, conversation_id, body').eq('id', messageId).maybeSingle()
    if (error) return fail(error)
    const row = data as { id: string; conversation_id: string; body: string } | null
    if (!row) return { ok: false, reason: 'notFound' }
    const masked = maskRanges(row.body, ranges)
    if (!masked.removed) return { ok: false, reason: 'invalid' }
    const upd = await db.from('messages').update({ body: masked.body, redacted_at: new Date().toISOString() }).eq('id', row.id)
    if (upd.error) return fail(upd.error)
    await db.from('message_events').insert({ conversation_id: row.conversation_id, actor_id: adminId, kind: 'message_redacted', detail: { removed: masked.removed } })
    return { ok: true, value: { removed: masked.removed } }
  })
}

export async function deleteMessageFile(adminId: string, attachmentId: string): Promise<MessageResult> {
  if (!isUuid(attachmentId)) return { ok: false, reason: 'notFound' }
  return withDb('Abluo admin deletes a file in a conversation', async (db): Promise<MessageResult> => {
    const { data } = await db.from('message_attachments').select('id, conversation_id, storage_path, deleted_at').eq('id', attachmentId).maybeSingle()
    const row = data as { id: string; conversation_id: string; storage_path: string; deleted_at: string | null } | null
    if (!row) return { ok: false, reason: 'notFound' }
    if (row.deleted_at) return { ok: true, value: undefined }
    return removeFile(db, row, 'redacted', adminId)
  })
}

/** D7 — deletes files of conversations quiet for 90 days; keeps a tombstone. Returns how many. */
export async function sweepMessageFiles(now = Date.now()): Promise<number> {
  return withDb('daily retention: delete message files 90 days after the last activity', async (db) => {
    const { data: convs, error } = await db.from('message_conversations').select('id').lt('last_activity_at', retentionCutoff(now)).limit(500)
    if (error || !convs?.length) return 0
    const { data: atts } = await db.from('message_attachments').select('id, conversation_id, storage_path').in('conversation_id', convs.map((c) => (c as { id: string }).id)).is('deleted_at', null).limit(1000)
    let n = 0
    for (const a of (atts ?? []) as { id: string; conversation_id: string; storage_path: string }[]) {
      const r = await removeFile(db, a, 'retention', null)
      if (r.ok) n++
    }
    return n
  })
}
