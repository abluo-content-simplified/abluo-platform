/**
 * Notification Center — shared vocabulary (ADR-050 D9). Pure and client-safe.
 *
 * A notification is a kind + a few params + a link, one row per recipient. It
 * never carries message text, a ticket title or a screenshot; the sentence is
 * worded when it is shown, in the reader's language
 * (`app.notifications.kinds.<kind>`).
 */
export const NOTIFICATION_KINDS = [
  'message.received',
  'message.replied',
  'ticket.created',
  'ticket.client_replied',
  'ticket.support_replied',
  'ticket.waiting_for_user',
  'ticket.resolved',
  'announcement.ack_requested',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export type NotificationSide = 'client' | 'abluo'
export type NotificationSourceType = 'conversation' | 'ticket' | 'notice'

export const NOTIFICATION_LIMITS = {
  /** Rows the panel shows. */
  panel: 20,
  /** D11: a digest only for rows unread this long … */
  digestAfterMinutes: 30,
  /** … and at most one digest per person in this window. */
  digestEveryHours: 4,
} as const

/** Kinds the email digest covers (D11). Tickets keep their own immediate emails. */
export const DIGEST_KINDS: readonly NotificationKind[] = ['message.received', 'message.replied']

/** What a producer hands to `notify()`. */
export type NotificationInput = {
  userId: string
  side: NotificationSide
  projectId: string | null
  kind: NotificationKind
  sourceType: NotificationSourceType
  sourceId: string
  href: string
  /** Small, content-free values for the sentence: a subject line, a reference, a first name. */
  params?: Record<string, string | number>
}

/** Params that may be stored: short strings and numbers only. */
export function cleanParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 140)
  }
  return out
}

/** Only an in-app path: starts with one "/", no scheme, no protocol-relative "//". */
export function isSafeHref(href: unknown): href is string {
  return typeof href === 'string' && href.length <= 300 && /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]*$/.test(href)
}

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(v)
}

/** One row of the panel, as the browser receives it (worded there). */
export type NotificationItem = {
  id: string
  kind: NotificationKind
  href: string
  params: Record<string, string | number>
  count: number
  createdAt: string
  read: boolean
  /** Site name, for people on several sites (client side), or the client's site (Abluo side). */
  projectName: string | null
}

/**
 * Collapsing (D9): a new event for a source that already has an unread row
 * updates that row instead of adding one. Pure: given the existing unread row
 * (or none), what to write.
 */
export function collapse(
  existing: { id: string; count: number } | null,
  input: NotificationInput,
  now: string,
): { op: 'insert'; row: Record<string, unknown> } | { op: 'update'; id: string; patch: Record<string, unknown> } {
  const base = { kind: input.kind, href: input.href, params: cleanParams(input.params), created_at: now, emailed_at: null }
  if (existing) return { op: 'update', id: existing.id, patch: { ...base, count: existing.count + 1 } }
  return {
    op: 'insert',
    row: {
      ...base,
      user_id: input.userId,
      side: input.side,
      project_id: input.projectId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      count: 1,
    },
  }
}

export type DigestCandidate = { id: string; userId: string; side: NotificationSide; createdAt: string; projectId: string | null }

/**
 * D11 — who gets a digest now, and which rows it covers. A row qualifies when
 * it has been unread for 30 minutes and the person has not opened a dashboard
 * since it arrived; a person qualifies when no digest went out in the last 4
 * hours. Pure (the service reads, this decides).
 */
export function planDigest(
  rows: readonly DigestCandidate[],
  lastSeen: ReadonlyMap<string, string | null>,
  lastDigest: ReadonlyMap<string, string>,
  now: number,
): Map<string, DigestCandidate[]> {
  const out = new Map<string, DigestCandidate[]>()
  const quiet = now - NOTIFICATION_LIMITS.digestAfterMinutes * 60_000
  const throttle = now - NOTIFICATION_LIMITS.digestEveryHours * 3_600_000
  for (const row of rows) {
    const created = Date.parse(row.createdAt)
    if (!(created <= quiet)) continue
    const seen = lastSeen.get(row.userId)
    if (seen && Date.parse(seen) >= created) continue
    const last = lastDigest.get(row.userId)
    if (last && Date.parse(last) > throttle) continue
    out.set(row.userId, [...(out.get(row.userId) ?? []), row])
  }
  return out
}
