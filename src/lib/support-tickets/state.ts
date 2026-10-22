/**
 * Ticket status rules (ADR-039 D4) as pure functions. The database functions
 * in migration 046 enforce the same rules; this file lets screens show the
 * right controls and is the readable statement of them. Keep the two in step:
 * supabase/verify/hardening-046.verify.mjs tests the SQL, __tests__/state.test.ts this.
 */
import { TICKET_LIMITS, type TicketStatus } from './model'

const DAY_MS = 86_400_000

export type ClientReplyOutcome =
  | { allowed: true; nextStatus: TicketStatus; reopened: boolean }
  | { allowed: false; reason: 'closed' }

/** What a client reply does to a ticket's status. */
export function clientReplyOutcome(status: TicketStatus, resolvedAt: string | null, now: number = Date.now()): ClientReplyOutcome {
  switch (status) {
    case 'waiting_for_user':
      return { allowed: true, nextStatus: 'open', reopened: false }
    case 'resolved': {
      const resolved = resolvedAt ? Date.parse(resolvedAt) : NaN
      if (!Number.isFinite(resolved) || now - resolved > TICKET_LIMITS.reopenDays * DAY_MS) return { allowed: false, reason: 'closed' }
      return { allowed: true, nextStatus: 'open', reopened: true }
    }
    default:
      return { allowed: true, nextStatus: status, reopened: false }
  }
}

/** A support (Abluo) reply never changes the status; the admin sets it explicitly. */
export function supportReplyStatus(status: TicketStatus): TicketStatus {
  return status
}

/** The admin may move a ticket to any other status, including reopening. */
export function adminStatusTargets(current: TicketStatus): TicketStatus[] {
  return (['open', 'in_progress', 'waiting_for_user', 'resolved'] as const).filter((s) => s !== current)
}

/** When a resolved ticket's screenshots are deleted. */
export function attachmentExpiry(resolvedAt: string): string {
  return new Date(Date.parse(resolvedAt) + TICKET_LIMITS.retentionDays * DAY_MS).toISOString()
}

/** Unread = something the person may see happened after they last opened the ticket. */
export function isUnread(lastActivityAt: string, lastReadAt: string | null | undefined): boolean {
  if (!lastReadAt) return true
  return Date.parse(lastActivityAt) > Date.parse(lastReadAt)
}
