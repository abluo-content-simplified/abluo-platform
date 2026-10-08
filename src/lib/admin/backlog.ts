// Server-only: imports the service-role client; never import from a client component.
// Client components import the pure half, `./backlog-model`.
import type { AuthenticatedActor } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isBacklogStatus,
  isMissingTableError,
  isUuid,
  rowToBacklogItem,
  validateBacklogInput,
  type BacklogField,
  type BacklogFieldError,
  type BacklogItem,
  type BacklogProjectOption,
  type BacklogStatus,
} from './backlog-model'

export * from './backlog-model'

/**
 * Admin backlog data layer (ADR-030 §5.5, migration 034). Service role on a
 * server-only table (RLS on, no policies). Every function takes the
 * `AuthenticatedActor` that `requireAbluoAdmin()` returned and refuses anything
 * but an `abluo_admin` — callers (server actions, the page) MUST have called
 * `requireAbluoAdmin()` first; this is the second check, not the first.
 *
 * Results are small codes the screen maps to localized text.
 */
const TABLE = 'admin_backlog_items'

export type BacklogError = 'forbidden' | 'not_set_up' | 'not_found' | 'invalid' | 'failed'
export type BacklogResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: BacklogError; fields?: Partial<Record<BacklogField, BacklogFieldError>> }

export type BacklogLoad =
  | { state: 'ready'; items: BacklogItem[]; projects: BacklogProjectOption[] }
  | { state: 'not_set_up'; projects: BacklogProjectOption[] }
  | { state: 'error'; message: string; projects: BacklogProjectOption[] }

const isAdmin = (actor: AuthenticatedActor | null | undefined): actor is AuthenticatedActor => actor?.platformRole === 'abluo_admin'

type DbError = { code?: string | null; message?: string | null } | null

function fail(error: DbError, context: string): { ok: false; error: BacklogError } {
  if (isMissingTableError(error)) return { ok: false, error: 'not_set_up' }
  console.warn(`admin backlog: ${context} failed: ${error?.message ?? 'unknown error'}`)
  return { ok: false, error: 'failed' }
}

async function projectOptions(db: ReturnType<typeof createAdminClient>): Promise<BacklogProjectOption[]> {
  const { data, error } = await db.from('projects').select('id, name, slug').order('name', { ascending: true })
  if (error || !data) return []
  return (data as BacklogProjectOption[]).map((p) => ({ id: p.id, name: p.name, slug: p.slug }))
}

/** The whole backlog (it is small: one team's list) plus the project picker options. */
export async function loadBacklog(actor: AuthenticatedActor | null): Promise<BacklogLoad> {
  if (!isAdmin(actor)) return { state: 'error', message: 'forbidden', projects: [] }
  const db = createAdminClient()
  const [items, projects] = await Promise.all([
    db.from(TABLE).select('*').order('updated_at', { ascending: false }).limit(2000),
    projectOptions(db),
  ])
  if (items.error) {
    if (isMissingTableError(items.error)) return { state: 'not_set_up', projects }
    return { state: 'error', message: items.error.message, projects }
  }
  return { state: 'ready', items: (items.data ?? []).map((r) => rowToBacklogItem(r as Record<string, unknown>)), projects }
}

/** Next sort_order at the end of a status column. */
async function endOfStatus(db: ReturnType<typeof createAdminClient>, status: BacklogStatus): Promise<number> {
  const { data } = await db.from(TABLE).select('sort_order').eq('status', status).order('sort_order', { ascending: false }).limit(1)
  const top = Number((data?.[0] as { sort_order?: unknown } | undefined)?.sort_order ?? 0)
  return (Number.isFinite(top) ? top : 0) + 1
}

function toRow(v: ReturnType<typeof validateBacklogInput> & { ok: true }) {
  const x = v.value
  return {
    title: x.title,
    body: x.body,
    area: x.area,
    type: x.type,
    priority: x.priority,
    status: x.status,
    project_id: x.projectId,
    module_id: x.moduleId,
    links: x.links,
  }
}

export async function createBacklogItem(actor: AuthenticatedActor | null, raw: unknown): Promise<BacklogResult<{ item: BacklogItem }>> {
  if (!isAdmin(actor)) return { ok: false, error: 'forbidden' }
  const v = validateBacklogInput(raw)
  if (!v.ok) return { ok: false, error: 'invalid', fields: v.errors }
  const db = createAdminClient()
  const sortOrder = await endOfStatus(db, v.value.status)
  const { data, error } = await db
    .from(TABLE)
    .insert({ ...toRow(v), sort_order: sortOrder, created_by: actor.userId, updated_by: actor.userId })
    .select('*')
    .single()
  if (error || !data) return fail(error, 'create')
  return { ok: true, item: rowToBacklogItem(data as Record<string, unknown>) }
}

export async function updateBacklogItem(actor: AuthenticatedActor | null, id: unknown, raw: unknown): Promise<BacklogResult<{ item: BacklogItem }>> {
  if (!isAdmin(actor)) return { ok: false, error: 'forbidden' }
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const v = validateBacklogInput(raw)
  if (!v.ok) return { ok: false, error: 'invalid', fields: v.errors }
  const db = createAdminClient()
  const current = await db.from(TABLE).select('status').eq('id', id).maybeSingle()
  if (current.error) return fail(current.error, 'update')
  if (!current.data) return { ok: false, error: 'not_found' }
  const moved = (current.data as { status: string }).status !== v.value.status
  const patch: Record<string, unknown> = { ...toRow(v), updated_by: actor.userId }
  if (moved) patch.sort_order = await endOfStatus(db, v.value.status)
  const { data, error } = await db.from(TABLE).update(patch).eq('id', id).select('*').maybeSingle()
  if (error) return fail(error, 'update')
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, item: rowToBacklogItem(data as Record<string, unknown>) }
}

export async function setBacklogStatus(actor: AuthenticatedActor | null, id: unknown, status: unknown): Promise<BacklogResult<{ item: BacklogItem }>> {
  if (!isAdmin(actor)) return { ok: false, error: 'forbidden' }
  if (!isUuid(id) || !isBacklogStatus(status)) return { ok: false, error: 'invalid' }
  const db = createAdminClient()
  const sortOrder = await endOfStatus(db, status)
  const { data, error } = await db
    .from(TABLE)
    .update({ status, sort_order: sortOrder, updated_by: actor.userId })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return fail(error, 'status')
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, item: rowToBacklogItem(data as Record<string, unknown>) }
}

export async function deleteBacklogItem(actor: AuthenticatedActor | null, id: unknown): Promise<BacklogResult<object>> {
  if (!isAdmin(actor)) return { ok: false, error: 'forbidden' }
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const { data, error } = await createAdminClient().from(TABLE).delete().eq('id', id).select('id')
  if (error) return fail(error, 'delete')
  if (!data?.length) return { ok: false, error: 'not_found' }
  return { ok: true }
}
