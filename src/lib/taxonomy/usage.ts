// ── Where-used query ──────────────────────────────────────────────────────────
// ADR-033 Amendment J (J-5). Pure builder — the caller runs the query with a
// tenant-scoped client (which forces $projectSlug) and a perspective that
// includes drafts ('raw'), because a draft or archived item still holds the key.
//
// Content stores term KEYS, so "used by" means `$key in <field>`. Names the
// declaration (`usedBy: [{ type, field }]`) — nothing here knows about
// catalogue. $projectSlug is mandatory in every query this file builds.

export type UsedBy = { type: string; field: string }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

export type UsageQuery = {
  query: string
  /** Everything except $projectSlug, which the tenant-scoped client supplies. */
  params: { key: string }
  /** Documents of these types may be drafts: run with a perspective that includes them. */
  perspective: 'raw'
}

/**
 * Query returning `{ _id, _type, name }` of every document in the project whose
 * `field` array contains `$key`. Type and field names are interpolated (GROQ
 * cannot parameterise a field path), so each is validated as a plain identifier.
 */
export function buildUsageQuery(usedBy: readonly UsedBy[], key: string): UsageQuery {
  if (usedBy.length === 0) throw new Error('buildUsageQuery: usedBy must not be empty')
  const clauses = usedBy.map(({ type, field }) => {
    if (!IDENT.test(type) || !IDENT.test(field)) {
      throw new Error(`buildUsageQuery: invalid type/field "${type}.${field}"`)
    }
    return `(_type == "${type}" && $key in coalesce(${field}, []))`
  })
  return {
    query: `*[projectSlug == $projectSlug && (${clauses.join(' || ')})]{ _id, _type, "name": coalesce(name, title) }`,
    params: { key },
    perspective: 'raw',
  }
}

export type UsageRow = { _id: string; _type: string; name?: unknown }
export type UsedItem = { id: string; type: string; name?: unknown }

const DRAFT_PREFIX = 'drafts.'

/**
 * Collapses draft + published copies of one document into one logical item
 * (published and draft of the same id count once; archived items are ordinary
 * documents and count too). The draft's name wins when both exist — it is what
 * the editor shows. First-seen order is kept.
 */
export function toLogicalItems(rows: readonly UsageRow[]): UsedItem[] {
  const byId = new Map<string, UsedItem>()
  for (const row of rows) {
    const isDraft = row._id.startsWith(DRAFT_PREFIX)
    const id = isDraft ? row._id.slice(DRAFT_PREFIX.length) : row._id
    const existing = byId.get(id)
    if (!existing) byId.set(id, { id, type: row._type, name: row.name })
    else if (isDraft && row.name !== undefined) existing.name = row.name
    else if (existing.name === undefined) existing.name = row.name
  }
  return Array.from(byId.values())
}

export type TermUsage = { count: number; items: UsedItem[]; inUse: boolean }

export function summarizeUsage(rows: readonly UsageRow[]): TermUsage {
  const items = toLogicalItems(rows)
  return { count: items.length, items, inUse: items.length > 0 }
}

// ── Usage counts for a whole list ─────────────────────────────────────────────
// One query for every term of a module (the manager's "Used by N" column), as
// opposed to buildUsageQuery's one-key lookup used before a delete.

export type UsageCountRow = { _id: string; _type: string; keys?: unknown }

/**
 * Query returning `{ _id, _type, keys }` for every document of the declared
 * types in the project, where `keys` is the declared field's array (empty when
 * unset). Run with the draft-including ('raw') perspective. $projectSlug is
 * supplied by the tenant-scoped client.
 */
export function buildUsageCountsQuery(usedBy: readonly UsedBy[]): { query: string; perspective: 'raw' } {
  if (usedBy.length === 0) throw new Error('buildUsageCountsQuery: usedBy must not be empty')
  for (const { type, field } of usedBy) {
    if (!IDENT.test(type) || !IDENT.test(field)) throw new Error(`buildUsageCountsQuery: invalid type/field "${type}.${field}"`)
  }
  const types = usedBy.map((u) => `"${u.type}"`).join(', ')
  const keys = usedBy.map((u) => `_type == "${u.type}" => coalesce(${u.field}, [])`).join(', ')
  return {
    query: `*[projectSlug == $projectSlug && _type in [${types}]]{ _id, _type, "keys": select(${keys}, []) }`,
    perspective: 'raw',
  }
}

/**
 * Per-key number of logical documents holding the key. A draft and its
 * published copy count once (a key in EITHER copy counts); archived documents
 * are ordinary documents and count too.
 */
export function countUsageByKey(rows: readonly UsageCountRow[]): Map<string, number> {
  const keysByDoc = new Map<string, Set<string>>()
  for (const row of rows) {
    const id = row._id.startsWith(DRAFT_PREFIX) ? row._id.slice(DRAFT_PREFIX.length) : row._id
    const set = keysByDoc.get(id) ?? new Set<string>()
    if (Array.isArray(row.keys)) for (const k of row.keys) if (typeof k === 'string') set.add(k)
    keysByDoc.set(id, set)
  }
  const counts = new Map<string, number>()
  for (const set of keysByDoc.values()) for (const k of set) counts.set(k, (counts.get(k) ?? 0) + 1)
  return counts
}
