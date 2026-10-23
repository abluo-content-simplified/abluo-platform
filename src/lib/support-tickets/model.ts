/**
 * Support tickets — shared vocabulary (ADR-039). Pure and client-safe: no I/O,
 * no server imports. The database (migration 046) is the authority for every
 * rule here; these constants mirror it for the UI and the tests.
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_for_user', 'resolved'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/** Internal only — never sent to a client screen or an email (ADR-039 D5). */
export const TICKET_SEVERITIES = ['low', 'normal', 'high'] as const
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number]

export type AuthorKind = 'client' | 'support'

export const TICKET_LIMITS = {
  titleMax: 120,
  bodyMax: 10_000,
  attachmentsMax: 3,
  attachmentBytesMax: 5 * 1024 * 1024,
  /** Client replies may reopen a resolved ticket for this many days (D4). */
  reopenDays: 14,
  /** Screenshots are deleted this many days after the ticket is resolved (D11). */
  retentionDays: 90,
  ticketsPerHour: 5,
  repliesPerHour: 30,
  /** Signed screenshot links live this long (D10). */
  signedUrlSeconds: 300,
} as const

export const ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number]

export const ATTACHMENT_BUCKET = 'support-attachments'

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

export function isTicketSeverity(value: unknown): value is TicketSeverity {
  return typeof value === 'string' && (TICKET_SEVERITIES as readonly string[]).includes(value)
}

/** 124 → "ABL-000124". Numbers above 999999 keep all their digits. */
export function formatTicketNumber(n: number | string): string {
  return `ABL-${String(n).padStart(6, '0')}`
}

/** "ABL-000124" / "abl-124" / "124" → 124; anything else → null. */
export function parseTicketNumber(value: string): number | null {
  const m = /^(?:abl-)?0*(\d{1,12})$/i.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** What the person typed, checked before it reaches the database. */
export type TicketInputError = 'titleRequired' | 'titleTooLong' | 'bodyRequired' | 'bodyTooLong'

export function validateTitle(title: string): TicketInputError | null {
  const t = title.trim()
  if (!t) return 'titleRequired'
  if (t.length > TICKET_LIMITS.titleMax) return 'titleTooLong'
  return null
}

export function validateBody(body: string): TicketInputError | null {
  if (!body.trim()) return 'bodyRequired'
  if (body.length > TICKET_LIMITS.bodyMax) return 'bodyTooLong'
  return null
}

/**
 * Stable failure reasons the service returns. The UI maps each to a message
 * in its own namespace; never shown raw.
 */
export type TicketFailure =
  | 'unavailable' // migration 046 not applied yet
  | 'forbidden'
  | 'notFound'
  | 'supportMode' // an Abluo admin in "View as client" (D15)
  | 'rateLimited'
  | 'closed' // resolved more than 14 days ago — open a new request (D4)
  | 'invalid'
  | 'attachmentType'
  | 'attachmentTooLarge'
  | 'tooManyAttachments'
  | 'error'

export type TicketResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: TicketFailure; field?: TicketInputError }

/** Maps a Postgres / PostgREST error to a failure reason. */
export function failureFromDbError(error: { code?: string | null; message?: string | null } | null | undefined): TicketFailure {
  if (!error) return 'error'
  if (isMissingTicketTablesError(error)) return 'unavailable'
  const msg = error.message ?? ''
  if (msg.includes('support_ticket:rate_limited')) return 'rateLimited'
  if (msg.includes('support_ticket:closed')) return 'closed'
  if (msg.includes('support_ticket:not_found')) return 'notFound'
  if (msg.includes('support_ticket:invalid') || error.code === '23514') return 'invalid'
  return 'error'
}

/** 42P01 missing table, PGRST205 table not in schema cache, PGRST202 / 42883 missing function. */
export function isMissingTicketTablesError(error: { code?: string | null } | null | undefined): boolean {
  return !!error && ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error.code ?? '')
}

// ── Plain data the screens receive (client-safe) ─────────────────────────────

export type TicketPerson = { id: string | null; name: string; email?: string; avatarUrl?: string | null }

/** One row of a list. `severity` and `project` are filled only for the admin. */
export type TicketSummary = {
  id: string
  number: number
  reference: string // ABL-000124
  title: string
  status: TicketStatus
  createdAt: string
  lastActivityAt: string
  unread: boolean
  createdBy: TicketPerson
  severity?: TicketSeverity
  project?: { id: string; slug: string; name: string }
}

export type TicketAttachmentView = {
  id: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  /** Signed link (5 minutes). null once deleted. */
  url: string | null
  deleted: null | 'retention' | 'redacted' | 'project_deleted'
}

/** One entry of the thread, in time order. Notes only ever appear for the admin. */
export type ThreadEntry =
  | { kind: 'message'; id: string; authorKind: AuthorKind; author: TicketPerson; body: string; redacted: boolean; createdAt: string; attachments: TicketAttachmentView[] }
  | { kind: 'note'; id: string; author: TicketPerson; body: string; createdAt: string }
  | { kind: 'event'; id: string; event: TicketEventKind; from: string | null; to: string | null; createdAt: string; actor: TicketPerson | null }

export type TicketEventKind =
  | 'created'
  | 'status_changed'
  | 'severity_changed'
  | 'reopened_by_reply'
  | 'message_redacted'
  | 'attachment_deleted'
  | 'support_visit_started'

/** Admin-only facts recorded at creation (ADR-039 D2/D9). */
export type TicketContext = {
  page?: string
  platformVersion?: string
  userAgent?: string
  viewport?: string
  interfaceLocale?: string
  role?: string
  relatedTo?: string // ABL-000123 when opened from a closed ticket
}

export type TicketDetail = TicketSummary & {
  resolvedAt: string | null
  /** Client screens: can the person still reply? 'closed' → offer a new request. */
  reply: 'allowed' | 'closed' | 'forbidden'
  thread: ThreadEntry[]
  context?: TicketContext // admin only
  /** Client side: the dashboard page the request was sent from (never the rest of the context). */
  reportedFrom?: string
}
