/**
 * Messages — shared vocabulary (ADR-050). Pure and client-safe: no I/O, no
 * server imports. Migration 069 is the authority for every rule here; these
 * constants mirror it for the screens and the tests.
 *
 * Abluo starts a conversation (D1), always inside ONE project (D2); clients
 * reply. A message to several people is one private conversation per person
 * unless Abluo deliberately chooses one shared conversation (D3).
 */
import { TENANT_SURFACES } from '@/lib/client/surfaces'
import type { ThreadEntry, TicketAttachmentView } from '@/lib/support-tickets/model'

export const CONVERSATION_MODES = ['individual', 'shared'] as const
export type ConversationMode = (typeof CONVERSATION_MODES)[number]

export type MessageSide = 'client' | 'abluo'

export const MESSAGE_LIMITS = {
  subjectMax: 120,
  bodyMax: 10_000,
  attachmentsMax: 5,
  imageBytesMax: 5 * 1024 * 1024,
  /** One send is one server action (4 MB request cap); images shrink in the browser, PDFs cannot (D5). */
  pdfBytesMax: 4 * 1024 * 1024,
  linksMax: 3,
  /** Files are deleted this many days after the conversation's last activity (D7). */
  retentionDays: 90,
  /** People one "New Message" may reach. */
  recipientsMax: 50,
  repliesPerHour: 30,
  signedUrlSeconds: 300,
} as const

export const MESSAGE_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const
export type MessageFileType = (typeof MESSAGE_FILE_TYPES)[number]

export const MESSAGE_BUCKET = 'message-attachments'

export function isConversationMode(v: unknown): v is ConversationMode {
  return typeof v === 'string' && (CONVERSATION_MODES as readonly string[]).includes(v)
}

// ── Dashboard links (D4) ─────────────────────────────────────────────────────

/** Where an "Open in dashboard" card may point: Home or any client-dashboard destination. Never a free URL. */
export const DASHBOARD_LINK_TARGETS: readonly { id: string; segment: string }[] = [
  { id: 'home', segment: 'home' },
  ...TENANT_SURFACES.flatMap((s) => (s.kind === 'nav' ? [{ id: s.id, segment: s.segment }] : [])),
]

/** What is stored per link: only the destination id. */
export type StoredLink = { id: string }

export function linkTarget(id: unknown): { id: string; segment: string } | null {
  return typeof id === 'string' ? DASHBOARD_LINK_TARGETS.find((t) => t.id === id) ?? null : null
}

/** The dashboard path of a link on one project, or null for an unknown destination. */
export function linkHref(projectSlug: string, id: unknown): string | null {
  const target = linkTarget(id)
  return target ? `/${projectSlug}/${target.segment}` : null
}

/** Unknown ids are dropped, duplicates removed, at most `linksMax`. */
export function cleanLinks(input: unknown): StoredLink[] {
  if (!Array.isArray(input)) return []
  const ids: string[] = []
  for (const raw of input) {
    const id = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : null
    if (linkTarget(id) && !ids.includes(id as string)) ids.push(id as string)
  }
  return ids.slice(0, MESSAGE_LIMITS.linksMax).map((id) => ({ id }))
}

// ── Input checks ─────────────────────────────────────────────────────────────

export type MessageInputError =
  | 'subjectRequired'
  | 'subjectTooLong'
  | 'bodyRequired'
  | 'bodyTooLong'
  | 'recipientsRequired'
  | 'tooManyRecipients'
  | 'sharedNeedsOneSite'
  | 'recipientNotMember'

export function validateSubject(subject: string): MessageInputError | null {
  const s = subject.trim()
  if (!s) return 'subjectRequired'
  if (s.length > MESSAGE_LIMITS.subjectMax) return 'subjectTooLong'
  return null
}

export function validateBody(body: string): MessageInputError | null {
  if (!body.trim()) return 'bodyRequired'
  if (body.length > MESSAGE_LIMITS.bodyMax) return 'bodyTooLong'
  return null
}

export type Recipient = { projectId: string; userId: string }

/**
 * D3 — what one "Send" creates. Separate (default): one conversation per
 * person, each on that person's site. Shared: one conversation for everyone,
 * allowed only when everyone is on the same site. Duplicates are removed.
 */
export function planConversations(
  mode: ConversationMode,
  recipients: readonly Recipient[],
): { ok: true; conversations: { projectId: string; userIds: string[] }[] } | { ok: false; error: MessageInputError } {
  const seen = new Set<string>()
  const list = recipients.filter((r) => {
    const key = `${r.projectId}:${r.userId}`
    if (!r.projectId || !r.userId || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (list.length === 0) return { ok: false, error: 'recipientsRequired' }
  if (list.length > MESSAGE_LIMITS.recipientsMax) return { ok: false, error: 'tooManyRecipients' }
  if (mode === 'shared') {
    const projects = new Set(list.map((r) => r.projectId))
    if (projects.size !== 1) return { ok: false, error: 'sharedNeedsOneSite' }
    if (list.length === 1) return { ok: true, conversations: [{ projectId: list[0].projectId, userIds: [list[0].userId] }] }
    return { ok: true, conversations: [{ projectId: list[0].projectId, userIds: list.map((r) => r.userId) }] }
  }
  return { ok: true, conversations: list.map((r) => ({ projectId: r.projectId, userIds: [r.userId] })) }
}

/** "Tom Zimmermann" → "Tom". Empty stays empty (the screen then shows just "Abluo"). */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** Was there anything newer than my read mark? No mark = unread. */
export function isUnreadSince(latest: string | null | undefined, readAt: string | null | undefined): boolean {
  if (!latest) return false
  if (!readAt) return true
  return Date.parse(latest) > Date.parse(readAt)
}

/** Files are deleted after this date (D7): last activity + 90 days. */
export function retentionCutoff(now: number): string {
  return new Date(now - MESSAGE_LIMITS.retentionDays * 86_400_000).toISOString()
}

// ── Failures ─────────────────────────────────────────────────────────────────

export type MessageFailure =
  | 'unavailable' // migration 069 not applied yet
  | 'forbidden'
  | 'notFound'
  | 'supportMode'
  | 'rateLimited'
  | 'invalid'
  | 'attachmentType'
  | 'attachmentTooLarge'
  | 'tooManyAttachments'
  | 'error'

export type MessageResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: MessageFailure; field?: MessageInputError }

/** 42P01 missing table, PGRST205 not in schema cache, 42883 / PGRST202 missing function, 42703 / PGRST204 missing column. */
export function isMissingSchemaError(error: { code?: string | null } | null | undefined): boolean {
  return !!error && ['42P01', 'PGRST205', 'PGRST202', '42883', '42703', 'PGRST204'].includes(error.code ?? '')
}

export function failureFromDbError(error: { code?: string | null; message?: string | null } | null | undefined): MessageFailure {
  if (!error) return 'error'
  if (isMissingSchemaError(error)) return 'unavailable'
  if (error.code === '23514') return 'invalid'
  return 'error'
}

/** The words key of a failure (`…errors.<key>`), the field's when there is one. */
export function messageErrorKey(reason: MessageFailure, field?: MessageInputError): string {
  return field ?? reason
}

// ── Plain data the screens receive (client-safe) ─────────────────────────────

export type MessagePerson = { id: string | null; name: string; email?: string; avatarUrl?: string | null }

export type ConversationSummary = {
  id: string
  subject: string
  mode: ConversationMode
  createdAt: string
  lastActivityAt: string
  archived: boolean
  /** The newest message's first line (plain text, may be empty when removed). */
  preview: string
  /** Something from the other side this viewer hasn't read. */
  unread: boolean
  /** Client recipients (admin: all; client: everyone in a shared conversation). */
  participants: MessagePerson[]
  /** Admin side only. */
  project?: { id: string; slug: string; name: string }
}

export type LinkView = { id: string; href: string }

/** A thread entry with what messages add to the ticket thread: link cards and the Abluo author's first name. */
export type MessageEntry = ThreadEntry

export type ReadReceipt = { person: MessagePerson; readAt: string | null }

export type ConversationDetail = ConversationSummary & {
  thread: ThreadEntry[]
  /** Client: may reply (false in support mode). */
  canReply: boolean
  /**
   * Admin: per client recipient, when they last read (D6).
   * Client: when someone at Abluo last read it (one entry, person empty) — "Seen".
   */
  receipts: ReadReceipt[]
}

export type { TicketAttachmentView as MessageAttachmentView }
