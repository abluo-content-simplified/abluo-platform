/**
 * Admin backlog (ADR-030 §5.5, migration 034) — the pure part: vocabularies,
 * types, input validation, list filtering and sorting. No I/O, safe to import
 * from client components. The service-role data layer is `./backlog.ts`.
 *
 * The vocabularies mirror the CHECK constraints in
 * `supabase/migrations/034_admin_backlog.sql`; change both together.
 */

export const BACKLOG_AREAS = ['client_dashboard', 'admin', 'module', 'website', 'platform', 'infrastructure', 'other'] as const
export const BACKLOG_TYPES = ['bug', 'improvement', 'idea', 'task'] as const
export const BACKLOG_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const
export const BACKLOG_STATUSES = ['inbox', 'planned', 'in_progress', 'blocked', 'done', 'wont_do'] as const

export type BacklogArea = (typeof BACKLOG_AREAS)[number]
export type BacklogType = (typeof BACKLOG_TYPES)[number]
export type BacklogPriority = (typeof BACKLOG_PRIORITIES)[number]
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number]

/** Closed statuses: hidden by the default filter. */
export const CLOSED_STATUSES: readonly BacklogStatus[] = ['done', 'wont_do']

export const TITLE_MAX = 200
export const BODY_MAX = 20000
export const LINKS_MAX = 20
export const LINK_LABEL_MAX = 120
export const LINK_URL_MAX = 2000
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BacklogLink = { label: string; url: string }

export type BacklogItem = {
  id: string
  title: string
  body: string
  area: BacklogArea
  type: BacklogType
  priority: BacklogPriority
  status: BacklogStatus
  projectId: string | null
  moduleId: string | null
  links: BacklogLink[]
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
  sortOrder: number
}

/** A project the item can be about (the picker). */
export type BacklogProjectOption = { id: string; name: string; slug: string }

/** What the form edits (everything the admin chooses). */
export type BacklogInput = {
  title: string
  body: string
  area: BacklogArea
  type: BacklogType
  priority: BacklogPriority
  status: BacklogStatus
  projectId: string | null
  moduleId: string | null
  links: BacklogLink[]
}

export const EMPTY_BACKLOG_INPUT: BacklogInput = {
  title: '',
  body: '',
  area: 'platform',
  type: 'task',
  priority: 'p2',
  status: 'inbox',
  projectId: null,
  moduleId: null,
  links: [],
}

export type BacklogField = 'title' | 'body' | 'area' | 'type' | 'priority' | 'status' | 'projectId' | 'moduleId' | 'links'
/** Error codes the screen maps to localized text (`admin.backlog.errors.<code>`). */
export type BacklogFieldError = 'required' | 'tooLong' | 'invalid' | 'invalidUrl' | 'tooMany'
export type BacklogValidation =
  | { ok: true; value: BacklogInput }
  | { ok: false; errors: Partial<Record<BacklogField, BacklogFieldError>> }

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Only absolute http(s) URLs: the links open from the admin, never `javascript:` etc. */
export function isSafeLinkUrl(url: string): boolean {
  if (!url || url.length > LINK_URL_MAX) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Trims, drops fully empty link rows, defaults a missing label to the URL. Pure. */
export function normalizeLinks(raw: unknown): { links: BacklogLink[]; error?: BacklogFieldError } {
  if (raw == null) return { links: [] }
  if (!Array.isArray(raw)) return { links: [], error: 'invalid' }
  const links: BacklogLink[] = []
  for (const r of raw) {
    const rec = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const label = str(rec.label).trim()
    const url = str(rec.url).trim()
    if (!label && !url) continue
    if (!isSafeLinkUrl(url)) return { links, error: 'invalidUrl' }
    if (label.length > LINK_LABEL_MAX) return { links, error: 'tooLong' }
    links.push({ label: label || url, url })
  }
  if (links.length > LINKS_MAX) return { links, error: 'tooMany' }
  return { links }
}

/**
 * Validates and normalises untrusted input (a server action argument). Every
 * write goes through this; the database CHECKs are the second line.
 */
export function validateBacklogInput(raw: unknown): BacklogValidation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Partial<Record<BacklogField, BacklogFieldError>> = {}

  const title = str(r.title).replace(/\s+/g, ' ').trim()
  if (!title) errors.title = 'required'
  else if (title.length > TITLE_MAX) errors.title = 'tooLong'

  const body = str(r.body).replace(/\r\n/g, '\n').trim()
  if (body.length > BODY_MAX) errors.body = 'tooLong'

  if (!oneOf(BACKLOG_AREAS, r.area)) errors.area = 'invalid'
  if (!oneOf(BACKLOG_TYPES, r.type)) errors.type = 'invalid'
  if (!oneOf(BACKLOG_PRIORITIES, r.priority)) errors.priority = 'invalid'
  if (!oneOf(BACKLOG_STATUSES, r.status)) errors.status = 'invalid'

  const projectRaw = str(r.projectId).trim()
  const projectId = projectRaw || null
  if (projectId && !UUID.test(projectId)) errors.projectId = 'invalid'

  const moduleRaw = str(r.moduleId).trim().toLowerCase()
  const moduleId = moduleRaw || null
  if (moduleId && !MODULE_ID_PATTERN.test(moduleId)) errors.moduleId = 'invalid'

  const { links, error: linksError } = normalizeLinks(r.links)
  if (linksError) errors.links = linksError

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      title,
      body,
      area: r.area as BacklogArea,
      type: r.type as BacklogType,
      priority: r.priority as BacklogPriority,
      status: r.status as BacklogStatus,
      projectId,
      moduleId,
      links,
    },
  }
}

export function isBacklogStatus(v: unknown): v is BacklogStatus {
  return oneOf(BACKLOG_STATUSES, v)
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** A DB row (snake_case) → BacklogItem. Tolerates a malformed `links` value. */
export function rowToBacklogItem(row: Record<string, unknown>): BacklogItem {
  const links = Array.isArray(row.links)
    ? (row.links as unknown[]).flatMap((l) => {
        const rec = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
        const url = str(rec.url)
        return isSafeLinkUrl(url) ? [{ label: str(rec.label) || url, url }] : []
      })
    : []
  return {
    id: String(row.id),
    title: str(row.title),
    body: str(row.body),
    area: oneOf(BACKLOG_AREAS, row.area) ? row.area : 'other',
    type: oneOf(BACKLOG_TYPES, row.type) ? row.type : 'task',
    priority: oneOf(BACKLOG_PRIORITIES, row.priority) ? row.priority : 'p2',
    status: oneOf(BACKLOG_STATUSES, row.status) ? row.status : 'inbox',
    projectId: (row.project_id as string | null) ?? null,
    moduleId: (row.module_id as string | null) ?? null,
    links,
    createdBy: (row.created_by as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    doneAt: (row.done_at as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0) || 0,
  }
}

// ── List filtering & sorting (client) ─────────────────────────────────────────

/** '' = any; status 'open' = everything but done / won't do (the default). */
export type BacklogStatusFilter = BacklogStatus | 'open' | 'all'
export type BacklogSortKey = 'priority' | 'status' | 'updated' | 'title'
export type BacklogFilters = {
  q: string
  status: BacklogStatusFilter
  area: BacklogArea | ''
  type: BacklogType | ''
  priority: BacklogPriority | ''
  /** A project id, '' = any, 'none' = not about a client. */
  project: string
  sort: { key: BacklogSortKey; dir: 'asc' | 'desc' }
}

export const DEFAULT_BACKLOG_FILTERS: BacklogFilters = {
  q: '',
  status: 'open',
  area: '',
  type: '',
  priority: '',
  project: '',
  sort: { key: 'priority', dir: 'asc' },
}

export function isDefaultBacklogFilters(f: BacklogFilters): boolean {
  const d = DEFAULT_BACKLOG_FILTERS
  return f.q.trim() === '' && f.status === d.status && f.area === d.area && f.type === d.type && f.priority === d.priority && f.project === d.project
}

function statusMatches(filter: BacklogStatusFilter, status: BacklogStatus): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return !CLOSED_STATUSES.includes(status)
  return filter === status
}

const rank = <T extends string>(list: readonly T[], v: T) => list.indexOf(v)

/**
 * The default order: priority (p0 first), then status in workflow order, then
 * manual sort_order, then most recently updated. Every other sort key falls
 * back to this one so ties are stable.
 */
export function compareBacklog(a: BacklogItem, b: BacklogItem, key: BacklogSortKey = 'priority', dir: 'asc' | 'desc' = 'asc'): number {
  const base = () =>
    rank(BACKLOG_PRIORITIES, a.priority) - rank(BACKLOG_PRIORITIES, b.priority) ||
    rank(BACKLOG_STATUSES, a.status) - rank(BACKLOG_STATUSES, b.status) ||
    a.sortOrder - b.sortOrder ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  let primary = 0
  if (key === 'status') primary = rank(BACKLOG_STATUSES, a.status) - rank(BACKLOG_STATUSES, b.status)
  else if (key === 'updated') primary = a.updatedAt.localeCompare(b.updatedAt)
  else if (key === 'title') primary = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  else primary = rank(BACKLOG_PRIORITIES, a.priority) - rank(BACKLOG_PRIORITIES, b.priority)
  if (primary !== 0) return dir === 'asc' ? primary : -primary
  return base()
}

/** Clicking a column header: same key flips direction; a new key starts in its natural order. */
export function nextBacklogSort(key: BacklogSortKey, current: BacklogFilters['sort']): BacklogFilters['sort'] {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'updated' ? 'desc' : 'asc' }
}

export function applyBacklogFilters(items: BacklogItem[], f: BacklogFilters, projectName?: (id: string) => string | undefined): BacklogItem[] {
  const q = f.q.trim().toLowerCase()
  return items
    .filter((i) => statusMatches(f.status, i.status))
    .filter((i) => !f.area || i.area === f.area)
    .filter((i) => !f.type || i.type === f.type)
    .filter((i) => !f.priority || i.priority === f.priority)
    .filter((i) => !f.project || (f.project === 'none' ? i.projectId === null : i.projectId === f.project))
    .filter((i) => {
      if (!q) return true
      const hay = [i.title, i.body, i.moduleId ?? '', i.projectId ? (projectName?.(i.projectId) ?? '') : '', ...i.links.map((l) => `${l.label} ${l.url}`)]
        .join('\n')
        .toLowerCase()
      return q.split(/\s+/).every((word) => hay.includes(word))
    })
    .sort((a, b) => compareBacklog(a, b, f.sort.key, f.sort.dir))
}

// ── Storage state ─────────────────────────────────────────────────────────────

/**
 * True when Supabase says the table does not exist — migration 034 is not
 * applied. Postgres: 42P01 (undefined_table); PostgREST: PGRST205 (table not in
 * the schema cache), older PostgREST: PGRST106/"relation … does not exist".
 */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /relation .* does not exist/i.test(m) || /could not find the table/i.test(m)
}
