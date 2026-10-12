// ── GET /api/v1/events — framework-free core (ADR-031 D3, D4, D8) ────────────
//
// Order of checks, every request, fail closed:
//   1. Bearer token → Connection grant (access.ts): token live, Connection
//      active, app approved.
//   2. Per-Connection rate limit.
//   3. The grant holds `event` read on ITS project (connectionCan).
//   4. The project exists, is live (active/preview) and has the Events module
//      installed — a paused tenant or an uninstalled module returns nothing.
//   5. Data: published events of THAT project only (projectSlug from the
//      Connection's project row, never from the request), only granted fields,
//      plus removals (tombstones + events made unlisted / website-only).
// Every call is metered in api_usage. Errors are RFC 9457 problem details.

import { createHash } from 'node:crypto'
import { authenticateConnectionRequest } from '../access'
import { createRateLimiter } from '../rate-limit'
import { connectionCan, projectFields } from '../resources'
import type { ConnectionsStore } from '../store'
import type { ConnectionGrant } from '../types'
import { partnerRemovalReason, toEventV1, type EventRemovedV1, type EventV1 } from './event-contract'
import type { EventsSource } from './events-source'

export const API_ENDPOINT = '/api/v1/events'
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
/** Items newer than this are left for the next poll (write → read visibility lag). */
export const SETTLE_MS = 5000
export const CONNECTION_LIMIT_PER_MINUTE = 120

const LIVE_PROJECT_STATUSES = new Set(['active', 'preview'])
const EPOCH = '1970-01-01T00:00:00.000Z'
/** Sorts after every UUID: "nothing more at this instant". */
const AFTER_ALL = '~'

export interface ApiRequest {
  method: string
  url: string
  headers: Record<string, string | undefined>
}
export interface ApiResponse {
  status: number
  headers: Record<string, string>
  body: string | null
}

export interface EventsDeps {
  store: ConnectionsStore
  source: EventsSource
  clock?: () => Date
  limiter?: ReturnType<typeof createRateLimiter>
}

const defaultLimiter = createRateLimiter(CONNECTION_LIMIT_PER_MINUTE, 60_000)

// ── RFC 9457 problem details ────────────────────────────────────────────────
export const PROBLEM_BASE = 'https://abluo.app/developers/problems/'

export function problem(status: number, slug: string, title: string, detail?: string, extra: Record<string, string> = {}): ApiResponse {
  return {
    status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...extra },
    body: JSON.stringify({ type: PROBLEM_BASE + slug, title, status, ...(detail ? { detail } : {}) }),
  }
}

// ── Cursor ──────────────────────────────────────────────────────────────────
export interface Cursor {
  t: string
  id: string
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, t: c.t, id: c.id })).toString('base64url')
}

export function decodeCursor(token: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(token)) return null
  try {
    const o = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { v?: unknown; t?: unknown; id?: unknown }
    if (o.v !== 1 || typeof o.t !== 'string' || typeof o.id !== 'string') return null
    if (Number.isNaN(Date.parse(o.t))) return null
    // '' (start of an instant), '~' (end of an instant) or a public id (UUID).
    if (o.id !== '' && o.id !== AFTER_ALL && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(o.id)) return null
    return { t: new Date(o.t).toISOString(), id: o.id }
  } catch {
    return null
  }
}

type Item = { t: string; id: string; out: Partial<EventV1> | EventRemovedV1 }
const cmp = (a: { t: string; id: string }, b: { t: string; id: string }) => Date.parse(a.t) - Date.parse(b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export async function handleEventsRequest(req: ApiRequest, deps: EventsDeps): Promise<ApiResponse> {
  const started = Date.now()
  const clock = deps.clock ?? (() => new Date())
  let grant: ConnectionGrant | null = null
  const finish = async (res: ApiResponse) => {
    if (grant) {
      await deps.store
        .recordUsage({
          connection_id: grant.connectionId,
          method: 'GET',
          endpoint: API_ENDPOINT,
          status: res.status,
          duration_ms: Date.now() - started,
          request_id: req.headers['x-vercel-id']?.slice(0, 100) ?? null,
        })
        .catch(() => undefined)
    }
    return res
  }

  if (req.method !== 'GET') return problem(405, 'method-not-allowed', 'Method not allowed', 'Use GET.', { allow: 'GET' })

  // 1. Who is asking.
  const auth = await authenticateConnectionRequest(req.headers['authorization'], { store: deps.store, clock })
  if (!auth.ok) return problem(401, 'invalid-token', 'Invalid access token', 'The access token is missing, invalid, expired or revoked.', { 'www-authenticate': auth.wwwAuthenticate })
  grant = auth.grant

  // 2. How often.
  if ((deps.limiter ?? defaultLimiter).hit(`conn:${grant.connectionId}`)) {
    return finish(problem(429, 'rate-limited', 'Too many requests', `At most ${CONNECTION_LIMIT_PER_MINUTE} requests per minute per connection.`, { 'retry-after': '60' }))
  }

  // 3. May it read events — of its own project.
  if (!connectionCan(grant, 'event', 'read', grant.projectId)) {
    return finish(problem(403, 'insufficient-scope', 'Not shared', 'Events are not shared with this connection.'))
  }

  // Parameters.
  const url = new URL(req.url, 'https://api.invalid')
  for (const k of url.searchParams.keys()) {
    if (!['cursor', 'updated_since', 'limit'].includes(k)) return finish(problem(400, 'invalid-parameter', 'Unknown parameter', `Unknown parameter: ${k.slice(0, 40)}.`))
  }
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return finish(problem(400, 'invalid-parameter', 'Invalid limit', `limit must be 1–${MAX_LIMIT}.`))
  let after: Cursor = { t: EPOCH, id: '' }
  const cursorParam = url.searchParams.get('cursor')
  const since = url.searchParams.get('updated_since')
  if (cursorParam && since) return finish(problem(400, 'invalid-parameter', 'Conflicting parameters', 'Send either cursor or updated_since, not both.'))
  if (cursorParam) {
    const c = decodeCursor(cursorParam)
    if (!c) return finish(problem(400, 'invalid-cursor', 'Invalid cursor', 'Use the next_cursor value from a previous response.'))
    after = c
  } else if (since) {
    const t = Date.parse(since)
    if (Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}T/.test(since)) return finish(problem(400, 'invalid-parameter', 'Invalid updated_since', 'Use an ISO 8601 date-time, e.g. 2026-10-01T00:00:00Z.'))
    after = { t: new Date(t).toISOString(), id: '' }
  }

  // 4. The project and its module, checked now (fail closed, D8.5).
  const project = await deps.store.getProject(grant.projectId)
  if (!project?.slug || !LIVE_PROJECT_STATUSES.has(project.status)) {
    return finish(problem(403, 'unavailable', 'Website unavailable', 'This website is not available to connected apps right now.'))
  }
  if (!(await deps.source.enabledModules(project.slug)).includes('events')) {
    return finish(problem(403, 'unavailable', 'Events unavailable', 'This website does not publish events right now.'))
  }
  const site = await deps.source.site(project.slug, project.customDomain)
  if (!site) return finish(problem(503, 'not-configured', 'Website not configured', 'The website has no languages configured yet.'))

  // 5. Data: events and removals, merged in one ordered stream.
  const upTo = new Date(clock().getTime() - SETTLE_MS).toISOString()
  if (Date.parse(after.t) > Date.parse(upTo)) after = { t: upTo, id: AFTER_ALL }
  const [rows, removed] = await Promise.all([
    deps.source.page({ projectSlug: project.slug, after, upTo, limit: limit + 1 }),
    deps.store.listTombstones({ projectId: project.id, resource: 'event', after, upTo, limit: limit + 1 }),
  ])

  const items: Item[] = []
  for (const row of rows) {
    if (!row.publicId || !row._updatedAt) continue
    const t = new Date(row._updatedAt).toISOString()
    const reason = partnerRemovalReason(row)
    if (reason) {
      items.push({ t, id: row.publicId, out: { id: row.publicId, deleted: true, reason, updatedAt: t } })
      continue
    }
    const ev = toEventV1(row, site)
    if (ev) items.push({ t, id: ev.id, out: projectFields(grant, 'event', ev as unknown as Record<string, unknown>) as Partial<EventV1> })
  }
  for (const r of removed) items.push({ t: r.removed_at, id: r.public_id, out: { id: r.public_id, deleted: true, reason: r.reason, updatedAt: r.removed_at } })
  items.sort(cmp)

  const hasMore = items.length > limit
  const page = items.slice(0, limit)
  const last = page.at(-1)
  const next: Cursor = hasMore && last ? { t: last.t, id: last.id } : { t: upTo, id: AFTER_ALL }
  // Never move the cursor backwards.
  const nextCursor = encodeCursor(cmp(next, after) < 0 ? after : next)

  const body = JSON.stringify({ data: page.map((i) => i.out), has_more: hasMore, next_cursor: nextCursor })
  // The ETag covers the content, not the cursor (which moves with time): an
  // unchanged answer is 304 and the partner simply keeps its current cursor.
  const content = JSON.stringify({ data: page.map((i) => i.out), has_more: hasMore })
  const etag = `W/"${createHash('sha256').update(content).digest('base64url').slice(0, 32)}"`
  const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-cache', etag, vary: 'Authorization' }
  if (req.headers['if-none-match'] === etag) return finish({ status: 304, headers, body: null })
  return finish({ status: 200, headers, body })
}
