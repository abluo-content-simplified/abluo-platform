/**
 * Slice S2 — pure helpers for the client's request screens (ADR-039).
 * No I/O, client-safe: failure → message key, form validation, upload budget.
 */
import { TICKET_LIMITS, validateBody, validateTitle, type TicketFailure, type TicketInputError } from './model'

/**
 * What one Server Action call may carry. Next's `serverActions.bodySizeLimit`
 * is 4 MB today (next.config.ts), so the screen refuses more than this BEFORE
 * sending. Raise it together with the config (3 × 5 MB needs ~16 MB).
 */
export const CLIENT_UPLOAD_BUDGET_BYTES = Math.floor(3.8 * 1024 * 1024)

/** Keys under `clientDashboard.supportTickets.errors`. */
export function ticketErrorKey(reason: TicketFailure, field?: TicketInputError): string {
  if (reason === 'invalid' && field) return field
  switch (reason) {
    case 'unavailable':
    case 'forbidden':
    case 'notFound':
    case 'supportMode':
    case 'rateLimited':
    case 'closed':
    case 'invalid':
    case 'attachmentType':
    case 'attachmentTooLarge':
    case 'tooManyAttachments':
      return reason
    default:
      return 'error'
  }
}

export type NewRequestErrors = { title?: TicketInputError; body?: TicketInputError; files?: 'tooMany' | 'tooLarge' }

/** Checks the new-request form before anything is sent. Empty object = fine. */
export function validateNewRequest(input: { title: string; body: string; files: { size: number }[] }): NewRequestErrors {
  const errors: NewRequestErrors = {}
  const t = validateTitle(input.title)
  if (t) errors.title = t
  const b = validateBody(input.body)
  if (b) errors.body = b
  if (input.files.length > TICKET_LIMITS.attachmentsMax) errors.files = 'tooMany'
  else if (input.files.some((f) => f.size > TICKET_LIMITS.attachmentBytesMax)) errors.files = 'tooLarge'
  return errors
}

/** `?relatedTo=` must look like a ticket reference, else it is dropped. */
export function cleanRelatedTo(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v && /^ABL-\d{1,12}$/i.test(v.trim()) ? v.trim().toUpperCase() : undefined
}

/**
 * `?title=` / `?body=` prefill the new-request form (e.g. "Tell me more" on
 * More You Can Add). Plain text only: control characters are dropped, the value
 * is cut to the field's limit, and React renders it as text, never as HTML.
 */
export function cleanPrefill(value: string | string[] | undefined, max: number): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
  return cleaned || undefined
}

/** `?from=` must be a path on this site; anything else is dropped. */
export function cleanFrom(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && v.length <= 300 ? v : undefined
}

/**
 * Re-encode steps the browser tries, in order, when the screenshots together
 * exceed CLIENT_UPLOAD_BUDGET_BYTES (see src/lib/client/ticket-upload.ts).
 */
export function planScreenshotShrink(): Array<{ maxEdge: number; quality: number; skipBelowBytes: number }> {
  return [
    { maxEdge: 2048, quality: 0.85, skipBelowBytes: 600 * 1024 },
    { maxEdge: 1600, quality: 0.8, skipBelowBytes: 400 * 1024 },
    { maxEdge: 1280, quality: 0.72, skipBelowBytes: 0 },
  ]
}
