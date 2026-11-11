/**
 * Admin Support Tickets screens — the pure parts (ADR-039, slice S3): the list's
 * filters as URL search params, and the wording of the thread's event lines.
 * No I/O; client-safe.
 */
import { isTicketSeverity, isTicketStatus, TICKET_SEVERITIES, TICKET_STATUSES, type AuthorKind, type TicketEventKind, type TicketNext, type TicketSeverity, type TicketStatus, type TicketSummary } from './model'

export type StatusFilter = 'active' | 'all' | TicketStatus

/** "Next step" filter: '' = any. */
export type NextFilter = '' | 'yourTurn' | 'waiting'
export const NEXT_FILTERS: readonly NextFilter[] = ['', 'yourTurn', 'waiting']

/** Sortable columns of the list. */
export const SORT_KEYS = ['activity', 'next', 'reference', 'status', 'severity'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

export type AdminTicketView = {
  /** Project slug, '' = all projects. */
  project: string
  status: StatusFilter
  severity: TicketSeverity | ''
  /** Only tickets with activity this admin has not seen yet. */
  unread: boolean
  /** '0' = never opened by this admin (new requests), '1' = opened before, '' = either. */
  seen: '' | '0' | '1'
  /** Whose turn it is (Tom, 2026-11-11). */
  next: NextFilter
  /** null = the view's own default order (see `effectiveSort`). */
  sort: { key: SortKey; dir: SortDir } | null
}

export const DEFAULT_ADMIN_VIEW: AdminTicketView = { project: '', status: 'active', severity: '', unread: false, seen: '', next: '', sort: null }

// ── Next step & last activity (Tom, 2026-11-11) ──────────────────────────────

/**
 * Pure. Whose turn it is, from the latest visible message: Abluo answered
 * last → waiting for the client (named: who wrote last on their side, else
 * the requester); the client wrote last, or nobody has → Abluo's turn.
 * A resolved ticket needs nothing. The status stays the admin's own choice.
 */
export function nextStepOf(input: {
  status: TicketStatus
  createdAt: string
  lastActivityAt: string
  lastMessage: { by: AuthorKind; at: string } | null | undefined
  /** First name of the client side's latest author, or the requester's. */
  clientName: string
}): TicketNext {
  if (input.status === 'resolved') return { kind: 'done', since: input.lastActivityAt }
  const m = input.lastMessage
  if (m && m.by === 'support') return { kind: 'waiting', since: m.at, on: input.clientName }
  return { kind: 'yourTurn', since: m?.at ?? input.createdAt }
}

/** The order a view uses unless a column was clicked: "Needs reply" = longest waiting first; anything else = latest activity first. */
export function effectiveSort(view: Pick<AdminTicketView, 'sort' | 'next'>): { key: SortKey; dir: SortDir } {
  if (view.sort) return view.sort
  return view.next === 'yourTurn' ? { key: 'next', dir: 'asc' } : { key: 'activity', dir: 'desc' }
}

/** Clicking a column header: the same column flips direction; another column starts at its natural direction. */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'activity' || key === 'severity' || key === 'reference' ? 'desc' : 'asc' }
}

const STATUS_ORDER: Record<TicketStatus, number> = { open: 0, in_progress: 1, waiting_for_user: 2, resolved: 3 }
const NEXT_ORDER: Record<TicketNext['kind'], number> = { yourTurn: 0, waiting: 1, done: 2 }
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

/** Pure: sorts a copy. "Next step" groups Abluo's turn first, then waiting, each oldest first (ascending). */
export function sortTickets(tickets: readonly TicketSummary[], sort: { key: SortKey; dir: SortDir }): TicketSummary[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const by = (a: TicketSummary, b: TicketSummary): number => {
    switch (sort.key) {
      case 'reference':
        return cmp(a.number, b.number)
      case 'status':
        return cmp(STATUS_ORDER[a.status], STATUS_ORDER[b.status])
      case 'severity':
        return cmp(TICKET_SEVERITIES.indexOf(a.severity ?? 'normal'), TICKET_SEVERITIES.indexOf(b.severity ?? 'normal'))
      case 'next': {
        const ka = a.next?.kind ?? 'yourTurn'
        const kb = b.next?.kind ?? 'yourTurn'
        return ka !== kb ? cmp(NEXT_ORDER[ka], NEXT_ORDER[kb]) : cmp(a.next?.since ?? a.lastActivityAt, b.next?.since ?? b.lastActivityAt)
      }
      default:
        return cmp(a.lastActivityAt, b.lastActivityAt)
    }
  }
  // Ties: latest activity first, so the order is stable and sensible.
  return [...tickets].sort((a, b) => sign * by(a, b) || cmp(b.lastActivityAt, a.lastActivityAt))
}

/** The four quick views above the list (Tom, 2026-11-11). */
export const QUICK_VIEWS = ['needsReply', 'waiting', 'open', 'closed'] as const
export type QuickView = (typeof QUICK_VIEWS)[number]

export function quickViewFilters(q: QuickView): Partial<AdminTicketView> {
  switch (q) {
    case 'needsReply':
      return { status: 'active', next: 'yourTurn', unread: false, seen: '', sort: null }
    case 'waiting':
      return { status: 'active', next: 'waiting', unread: false, seen: '', sort: null }
    case 'open':
      return { status: 'active', next: '', unread: false, seen: '', sort: null }
    default:
      return { status: 'resolved', next: '', unread: false, seen: '', sort: null }
  }
}

/** Which quick view the current filters are (project and severity may be anything), or null. */
export function activeQuickView(view: AdminTicketView): QuickView | null {
  if (view.unread || view.seen) return null
  if (view.status === 'resolved' && !view.next) return 'closed'
  if (view.status !== 'active') return null
  return view.next === 'yourTurn' ? 'needsReply' : view.next === 'waiting' ? 'waiting' : 'open'
}

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
    unread: first(params, 'unread') === '1',
    seen: first(params, 'seen') === '0' ? '0' : first(params, 'seen') === '1' ? '1' : '',
    next: first(params, 'next') === 'yourTurn' ? 'yourTurn' : first(params, 'next') === 'waiting' ? 'waiting' : '',
    sort: parseSort(first(params, 'sort')),
  }
}

function parseSort(raw: string): AdminTicketView['sort'] {
  const [key, dir] = raw.split('-')
  return (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : null
}

/** Only non-default values go into the URL, so the plain /support stays clean. */
export function adminViewQuery(view: AdminTicketView): string {
  const q = new URLSearchParams()
  if (view.project) q.set('project', view.project)
  if (view.status !== 'active') q.set('status', view.status)
  if (view.severity) q.set('severity', view.severity)
  if (view.unread) q.set('unread', '1')
  if (view.seen) q.set('seen', view.seen)
  if (view.next) q.set('next', view.next)
  if (view.sort) q.set('sort', `${view.sort.key}-${view.sort.dir}`)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function isDefaultAdminView(view: AdminTicketView): boolean {
  return !view.project && view.status === 'active' && !view.severity && !view.unread && !view.seen && !view.next && !view.sort
}

/** Applies the filters to the full list and sorts it (`effectiveSort`: latest activity first unless a column was clicked). */
export function applyAdminView(tickets: TicketSummary[], view: AdminTicketView): TicketSummary[] {
  const filtered = tickets
    .filter((t) => (!view.project || t.project?.slug === view.project) && (!view.severity || t.severity === view.severity) && (!view.unread || t.unread) && (!view.seen || (view.seen === '1' ? !!t.seen : !t.seen)))
    .filter((t) => (view.status === 'all' ? true : view.status === 'active' ? t.status !== 'resolved' : t.status === view.status))
    .filter((t) => !view.next || t.next?.kind === view.next)
  return sortTickets(filtered, effectiveSort(view))
}

/** Pure: counts for the quick views' badges, from the full list (filters other than project ignored). */
export function quickViewCounts(tickets: readonly TicketSummary[], project = ''): Record<QuickView, number> {
  const rows = tickets.filter((t) => !project || t.project?.slug === project)
  const active = rows.filter((t) => t.status !== 'resolved')
  return {
    needsReply: active.filter((t) => t.next?.kind === 'yourTurn').length,
    waiting: active.filter((t) => t.next?.kind === 'waiting').length,
    open: active.length,
    closed: rows.filter((t) => t.status === 'resolved').length,
  }
}

/** The projects that have tickets, for the project filter. */
export function projectOptions(tickets: TicketSummary[]): Array<{ slug: string; name: string }> {
  const map = new Map<string, string>()
  for (const t of tickets) if (t.project?.slug) map.set(t.project.slug, t.project.name || t.project.slug)
  return [...map].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The four Support card numbers on the admin home, each as the list filter behind it. */
export const SUPPORT_CARD_LINKS = {
  /** Never opened by this admin (matches `newCount`). */
  new: '/support?seen=0',
  /** Opened before, with a client reply since (matches `repliedCount`). */
  replied: '/support?seen=1&unread=1',
  waiting: '/support?status=waiting_for_user',
  high: '/support?severity=high',
} as const

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
    case 'message_redacted': {
      // Partial hiding records 'partial:<characters>' (migration 048).
      const count = to?.startsWith('partial:') ? Number(to.slice('partial:'.length)) : NaN
      return Number.isFinite(count) ? { key: 'messageRedactedPartial', values: { count: String(count) } } : { key: 'messageRedacted' }
    }
    case 'attachment_deleted':
      return to === 'removed_by_client' ? { key: 'attachmentRemovedByClient' } : { key: 'attachmentDeleted' }
    case 'support_visit_started':
      return { key: 'supportVisitStarted' }
    default:
      return null // 'created' is the first message itself
  }
}
