/**
 * Admin Support Tickets screens — the pure parts (ADR-039, slice S3): the list's
 * filters as URL search params, and the wording of the thread's event lines.
 * No I/O; client-safe.
 */
import { isTicketSeverity, isTicketStatus, TICKET_STATUSES, type TicketEventKind, type TicketSeverity, type TicketStatus, type TicketSummary } from './model'

export type StatusFilter = 'active' | 'all' | TicketStatus

export type AdminTicketView = {
  /** Project slug, '' = all projects. */
  project: string
  status: StatusFilter
  severity: TicketSeverity | ''
}

export const DEFAULT_ADMIN_VIEW: AdminTicketView = { project: '', status: 'active', severity: '' }

export const STATUS_FILTERS: readonly StatusFilter[] = ['active', ...TICKET_STATUSES, 'all']

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function first(params: Params, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? ''
  const v = params[key]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/** Reads the list's filters from the URL. Anything unknown falls back to the default. */
export function parseAdminView(params: Params): AdminTicketView {
  const status = first(params, 'status')
  const severity = first(params, 'severity')
  return {
    project: first(params, 'project').trim().slice(0, 100),
    status: status === 'all' || status === 'active' || isTicketStatus(status) ? (status as StatusFilter) : 'active',
    severity: isTicketSeverity(severity) ? severity : '',
  }
}

/** Only non-default values go into the URL, so the plain /support stays clean. */
export function adminViewQuery(view: AdminTicketView): string {
  const q = new URLSearchParams()
  if (view.project) q.set('project', view.project)
  if (view.status !== 'active') q.set('status', view.status)
  if (view.severity) q.set('severity', view.severity)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function isDefaultAdminView(view: AdminTicketView): boolean {
  return !view.project && view.status === 'active' && !view.severity
}

/** Applies the filters to the full list and sorts by last activity, newest first. */
export function applyAdminView(tickets: TicketSummary[], view: AdminTicketView): TicketSummary[] {
  return tickets
    .filter((t) => (!view.project || t.project?.slug === view.project) && (!view.severity || t.severity === view.severity))
    .filter((t) => (view.status === 'all' ? true : view.status === 'active' ? t.status !== 'resolved' : t.status === view.status))
    .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
}

/** The projects that have tickets, for the project filter. */
export function projectOptions(tickets: TicketSummary[]): Array<{ slug: string; name: string }> {
  const map = new Map<string, string>()
  for (const t of tickets) if (t.project?.slug) map.set(t.project.slug, t.project.name || t.project.slug)
  return [...map].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export type EventLine = { key: string; values?: Record<string, string> }

/**
 * Which message key and values an event line uses (`admin.supportTickets.events.*`).
 * The caller translates `status` / `severity` values itself via the returned `statusKey`/`severityKey`.
 */
export function eventLine(event: TicketEventKind, to: string | null): EventLine | null {
  switch (event) {
    case 'status_changed':
      return isTicketStatus(to) ? { key: 'statusChanged', values: { status: to } } : null
    case 'severity_changed':
      return isTicketSeverity(to) ? { key: 'severityChanged', values: { severity: to } } : null
    case 'reopened_by_reply':
      return { key: 'reopenedByReply' }
    case 'message_redacted':
      return { key: 'messageRedacted' }
    case 'attachment_deleted':
      return { key: 'attachmentDeleted' }
    case 'support_visit_started':
      return { key: 'supportVisitStarted' }
    default:
      return null // 'created' is the first message itself
  }
}
