import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Service-role client mock (never a real database) ────────────────────────
type Resp = { data: unknown; error: { code?: string; message?: string } | null }
const db = vi.hoisted(() => ({ responses: [] as Resp[], projects: { data: [], error: null } as Resp, calls: [] as { table: string; op: string; arg?: unknown }[] }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const next = (): Resp => (table === 'projects' ? db.projects : (db.responses.shift() ?? { data: null, error: null }))
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = self
      chain.insert = (arg: unknown) => (db.calls.push({ table, op: 'insert', arg }), chain)
      chain.update = (arg: unknown) => (db.calls.push({ table, op: 'update', arg }), chain)
      chain.delete = () => (db.calls.push({ table, op: 'delete' }), chain)
      chain.single = async () => next()
      chain.maybeSingle = async () => next()
      chain.then = (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej)
      return chain
    },
  }),
}))

const auth = vi.hoisted(() => ({ actor: null as null | { userId: string; platformRole: string } }))
vi.mock('@/lib/api/auth', () => ({ requireAbluoAdmin: async () => auth.actor }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import {
  DEFAULT_BACKLOG_FILTERS,
  applyBacklogFilters,
  compareBacklog,
  isDefaultBacklogFilters,
  isMissingTableError,
  isSafeLinkUrl,
  nextBacklogSort,
  normalizeLinks,
  rowToBacklogItem,
  validateBacklogInput,
  BACKLOG_AREAS,
  BACKLOG_PRIORITIES,
  BACKLOG_STATUSES,
  BACKLOG_TYPES,
  type BacklogItem,
} from '../backlog-model'
import { createBacklogItem, deleteBacklogItem, loadBacklog, setBacklogStatus, updateBacklogItem } from '../backlog'
import {
  createBacklogItemAction,
  deleteBacklogItemAction,
  setBacklogStatusAction,
  updateBacklogItemAction,
} from '@/app/[locale]/(admin)/backlog/actions'

const ADMIN = { userId: '00000000-0000-4000-8000-000000000001', platformRole: 'abluo_admin' as const }
const USER = { userId: '00000000-0000-4000-8000-000000000002', platformRole: 'user' as never }
const ID = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

const valid = { title: '  Fix   the hero  ', body: 'x\r\ny', area: 'platform', type: 'bug', priority: 'p1', status: 'inbox', projectId: '', moduleId: '', links: [] }

function item(over: Partial<BacklogItem>): BacklogItem {
  return {
    id: over.id ?? ID,
    title: 'T',
    body: '',
    area: 'platform',
    type: 'task',
    priority: 'p2',
    status: 'inbox',
    projectId: null,
    moduleId: null,
    links: [],
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    doneAt: null,
    sortOrder: 0,
    ...over,
  }
}

beforeEach(() => {
  db.responses = []
  db.projects = { data: [], error: null }
  db.calls = []
  auth.actor = null
})

describe('vocabularies match migration 034', () => {
  const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/034_admin_backlog.sql'), 'utf8')
  const list = (col: string) => {
    const m = sql.match(new RegExp(`check \\(${col} in \\(([^)]*)\\)\\)`))
    return m ? [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]) : null
  }
  it.each([
    ['area', BACKLOG_AREAS],
    ['type', BACKLOG_TYPES],
    ['priority', BACKLOG_PRIORITIES],
    ['status', BACKLOG_STATUSES],
  ])('%s', (col, values) => {
    expect(list(col)).toEqual([...values])
  })
  it('is server-only (RLS on, nothing granted to API roles, no policies)', () => {
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/revoke all on table public\.admin_backlog_items from anon, authenticated/)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated)/i)
  })
})

describe('validateBacklogInput', () => {
  it('normalises a valid input', () => {
    const r = validateBacklogInput({ ...valid, moduleId: ' Forms ', projectId: PROJECT })
    expect(r).toEqual({
      ok: true,
      value: { title: 'Fix the hero', body: 'x\ny', area: 'platform', type: 'bug', priority: 'p1', status: 'inbox', projectId: PROJECT, moduleId: 'forms', links: [] },
    })
  })
  it('requires a title and caps it at 200', () => {
    expect(validateBacklogInput({ ...valid, title: '   ' })).toMatchObject({ ok: false, errors: { title: 'required' } })
    expect(validateBacklogInput({ ...valid, title: 'a'.repeat(201) })).toMatchObject({ ok: false, errors: { title: 'tooLong' } })
    expect(validateBacklogInput({ ...valid, title: 'a'.repeat(200) }).ok).toBe(true)
  })
  it('refuses values outside the vocabularies', () => {
    const r = validateBacklogInput({ ...valid, area: 'x', type: 'epic', priority: 'p9', status: 'open' })
    expect(r).toMatchObject({ ok: false, errors: { area: 'invalid', type: 'invalid', priority: 'invalid', status: 'invalid' } })
  })
  it('refuses a malformed project id or module id', () => {
    expect(validateBacklogInput({ ...valid, projectId: 'livener' })).toMatchObject({ ok: false, errors: { projectId: 'invalid' } })
    expect(validateBacklogInput({ ...valid, moduleId: 'no spaces' })).toMatchObject({ ok: false, errors: { moduleId: 'invalid' } })
  })
  it('handles garbage input', () => {
    expect(validateBacklogInput(null).ok).toBe(false)
    expect(validateBacklogInput('x').ok).toBe(false)
  })
})

describe('links', () => {
  it('accepts only http(s) URLs', () => {
    expect(isSafeLinkUrl('https://github.com/x')).toBe(true)
    expect(isSafeLinkUrl('http://localhost:3000')).toBe(true)
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('/docs/adr')).toBe(false)
    expect(isSafeLinkUrl('')).toBe(false)
  })
  it('drops empty rows, defaults the label, refuses bad URLs and too many', () => {
    expect(normalizeLinks([{ label: '', url: '' }, { label: '', url: ' https://a.b/c ' }])).toEqual({ links: [{ label: 'https://a.b/c', url: 'https://a.b/c' }] })
    expect(normalizeLinks([{ label: 'ADR', url: 'data:text/html,x' }]).error).toBe('invalidUrl')
    expect(normalizeLinks(Array.from({ length: 21 }, () => ({ label: 'a', url: 'https://a.b' }))).error).toBe('tooMany')
    expect(normalizeLinks('nope').error).toBe('invalid')
  })
  it('rowToBacklogItem drops unsafe stored links and unknown enum values', () => {
    const i = rowToBacklogItem({ id: ID, title: 'x', area: 'mars', links: [{ label: 'a', url: 'javascript:1' }, { url: 'https://ok.io' }], sort_order: '2.5' })
    expect(i.area).toBe('other')
    expect(i.links).toEqual([{ label: 'https://ok.io', url: 'https://ok.io' }])
    expect(i.sortOrder).toBe(2.5)
  })
})

describe('filtering and sorting', () => {
  const items = [
    item({ id: 'a', title: 'Gallery lightbox', priority: 'p2', status: 'planned', area: 'module', moduleId: 'gallery' }),
    item({ id: 'b', title: 'Login loop', priority: 'p0', status: 'in_progress', type: 'bug' }),
    item({ id: 'c', title: 'Old thing', priority: 'p0', status: 'done' }),
    item({ id: 'd', title: 'Hoffmann FAQ', priority: 'p1', status: 'inbox', projectId: PROJECT, links: [{ label: 'ADR-030', url: 'https://x.y' }] }),
  ]
  it('hides done / won’t do by default and orders by priority', () => {
    expect(applyBacklogFilters(items, DEFAULT_BACKLOG_FILTERS).map((i) => i.id)).toEqual(['b', 'd', 'a'])
  })
  it('status all / specific', () => {
    expect(applyBacklogFilters(items, { ...DEFAULT_BACKLOG_FILTERS, status: 'all' }).map((i) => i.id)).toEqual(['b', 'c', 'd', 'a'])
    expect(applyBacklogFilters(items, { ...DEFAULT_BACKLOG_FILTERS, status: 'done' }).map((i) => i.id)).toEqual(['c'])
  })
  it('project filter, including "none"', () => {
    expect(applyBacklogFilters(items, { ...DEFAULT_BACKLOG_FILTERS, project: PROJECT }).map((i) => i.id)).toEqual(['d'])
    expect(applyBacklogFilters(items, { ...DEFAULT_BACKLOG_FILTERS, project: 'none' }).map((i) => i.id)).toEqual(['b', 'a'])
  })
  it('search matches title, module, links and project name (every word)', () => {
    const f = (q: string) => applyBacklogFilters(items, { ...DEFAULT_BACKLOG_FILTERS, q }, (id) => (id === PROJECT ? 'Claudia Hoffmann' : undefined)).map((i) => i.id)
    expect(f('gallery')).toEqual(['a'])
    expect(f('adr-030')).toEqual(['d'])
    expect(f('claudia faq')).toEqual(['d'])
    expect(f('claudia lightbox')).toEqual([])
  })
  it('sort keys and direction', () => {
    expect(compareBacklog(items[0], items[1], 'title')).toBeLessThan(0)
    expect(compareBacklog(items[0], items[1], 'title', 'desc')).toBeGreaterThan(0)
    expect(nextBacklogSort('priority', { key: 'priority', dir: 'asc' })).toEqual({ key: 'priority', dir: 'desc' })
    expect(nextBacklogSort('updated', { key: 'priority', dir: 'asc' })).toEqual({ key: 'updated', dir: 'desc' })
  })
  it('isDefaultBacklogFilters ignores sort', () => {
    expect(isDefaultBacklogFilters({ ...DEFAULT_BACKLOG_FILTERS, sort: { key: 'title', dir: 'desc' } })).toBe(true)
    expect(isDefaultBacklogFilters({ ...DEFAULT_BACKLOG_FILTERS, q: 'x' })).toBe(false)
  })
})

describe('isMissingTableError', () => {
  it.each([
    [{ code: '42P01', message: '' }, true],
    [{ code: 'PGRST205', message: "Could not find the table 'public.admin_backlog_items' in the schema cache" }, true],
    [{ code: undefined, message: 'relation "public.admin_backlog_items" does not exist' }, true],
    [{ code: '23514', message: 'violates check constraint' }, false],
    [null, false],
  ])('%j → %s', (e, expected) => {
    expect(isMissingTableError(e)).toBe(expected)
  })
})

describe('data layer refuses non-admins before touching the database', () => {
  it.each([
    ['load', () => loadBacklog(USER)],
    ['create', () => createBacklogItem(USER, valid)],
    ['update', () => updateBacklogItem(USER, ID, valid)],
    ['status', () => setBacklogStatus(USER, ID, 'done')],
    ['delete', () => deleteBacklogItem(null, ID)],
  ])('%s', async (_, run) => {
    const r = (await run()) as { ok?: boolean; error?: string; state?: string; message?: string }
    expect(r.ok === false ? r.error : r.message).toBe('forbidden')
    expect(db.calls).toEqual([])
  })
})

describe('data layer', () => {
  it('loadBacklog reports not_set_up when the table is missing', async () => {
    db.responses = [{ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }]
    expect(await loadBacklog(ADMIN)).toEqual({ state: 'not_set_up', projects: [] })
  })
  it('loadBacklog maps rows and projects', async () => {
    db.responses = [
      { data: [{ id: ID, title: 'A', status: 'planned', priority: 'p1', area: 'admin', type: 'idea', links: [] }], error: null },
    ]
    db.projects = { data: [{ id: PROJECT, name: 'Hoffmann', slug: 'hoffmann', extra: 1 }], error: null }
    const r = await loadBacklog(ADMIN)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') {
      expect(r.items[0]).toMatchObject({ id: ID, title: 'A', status: 'planned' })
      expect(r.projects).toEqual([{ id: PROJECT, name: 'Hoffmann', slug: 'hoffmann' }])
    }
  })
  it('create validates first and never writes invalid input', async () => {
    const r = await createBacklogItem(ADMIN, { ...valid, title: '' })
    expect(r).toMatchObject({ ok: false, error: 'invalid', fields: { title: 'required' } })
    expect(db.calls).toEqual([])
  })
  it('create stamps the actor and places the item at the end of its status', async () => {
    db.responses = [{ data: [{ sort_order: 4 }], error: null }, { data: { id: ID, title: 'Fix the hero', status: 'inbox' }, error: null }]
    const r = await createBacklogItem(ADMIN, valid)
    expect(r.ok).toBe(true)
    expect(db.calls[0]).toMatchObject({ op: 'insert', arg: { title: 'Fix the hero', sort_order: 5, created_by: ADMIN.userId, updated_by: ADMIN.userId, project_id: null } })
  })
  it('create maps a missing table to not_set_up', async () => {
    db.responses = [{ data: [], error: null }, { data: null, error: { code: '42P01', message: 'relation does not exist' } }]
    expect(await createBacklogItem(ADMIN, valid)).toEqual({ ok: false, error: 'not_set_up' })
  })
  it('update of an unknown id is not_found', async () => {
    db.responses = [{ data: null, error: null }]
    expect(await updateBacklogItem(ADMIN, ID, valid)).toEqual({ ok: false, error: 'not_found' })
  })
  it('status refuses an unknown status or a bad id without writing', async () => {
    expect(await setBacklogStatus(ADMIN, ID, 'shipped')).toEqual({ ok: false, error: 'invalid' })
    expect(await setBacklogStatus(ADMIN, 'nope', 'done')).toEqual({ ok: false, error: 'invalid' })
    expect(db.calls).toEqual([])
  })
  it('delete reports not_found when nothing was deleted', async () => {
    db.responses = [{ data: [], error: null }]
    expect(await deleteBacklogItem(ADMIN, ID)).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('server actions call requireAbluoAdmin first', () => {
  it.each([
    ['create', () => createBacklogItemAction(valid)],
    ['update', () => updateBacklogItemAction(ID, valid)],
    ['status', () => setBacklogStatusAction(ID, 'done')],
    ['delete', () => deleteBacklogItemAction(ID)],
  ])('%s refuses without an admin session', async (_, run) => {
    auth.actor = null
    expect(await run()).toEqual({ ok: false, error: 'forbidden' })
    expect(db.calls).toEqual([])
  })
  it('passes through when the gate allows', async () => {
    auth.actor = ADMIN
    db.responses = [{ data: [{ id: ID }], error: null }]
    expect(await deleteBacklogItemAction(ID)).toEqual({ ok: true })
  })
})
