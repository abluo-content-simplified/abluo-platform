/**
 * Keeping the added-tags lists complete (Tom, 2026-10-24): once a tag exists
 * it stays until someone deletes it in Categories & Tags — whether it was
 * created with "Add a tag" or typed onto a photo or gallery. So every write
 * that sets or adds tags on a `mediaAsset` / `gallery` also puts those names
 * on the project's `internalTagList` for that scope.
 *
 * - Only names not already there (tagMatchKey: case, accents, spacing) are
 *   appended; removing a tag from an item never touches the list (only the
 *   Categories & Tags rename / merge / delete do — tags/service.ts).
 * - The list ops are `createIfNotExists` + `setIfMissing` + an `insert` at the
 *   end, with NO revision guard: they cannot conflict, so adding them to the
 *   item's own transaction never fails the user's save. (A concurrent append
 *   could at worst add a same-key spelling twice; the manager shows it once.)
 * - Reaching INTERNAL_TAG_LIST_MAX never fails the save: the list just isn't
 *   extended and a warning is logged. A failed list read or write is logged
 *   too and skipped — the backfill script repairs any gap.
 *
 * Server-only (callers pass their Sanity client).
 */
import { INTERNAL_TAG_LIST_MAX, INTERNAL_TAG_LIST_TYPE, internalTagListId, tagMatchKey, type InternalTagScope } from './internal-tags'

/** The list's tags, by deterministic id AND project slug. */
export const LIST_TAGS_QUERY = `*[_type == "${INTERNAL_TAG_LIST_TYPE}" && _id == $listId && projectSlug == $projectSlug][0].tags`

export type ListTx = {
  createIfNotExists(doc: { _id: string; _type: string } & Record<string, unknown>): unknown
  patch(id: string, ops: Record<string, unknown>): unknown
}
type Fetch = (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>
export type ListSyncLog = { warn: (message: string, details?: Record<string, unknown>) => void }

const defaultLog: ListSyncLog = { warn: (m, d) => console.warn(`[internal-tags] ${m}`, d ?? {}) }

/**
 * Which of `names` to append to a list that holds `listed`: new keys only, in
 * the order given, until the list would pass `max` (then `capped`).
 */
export function planListAdditions(listed: readonly string[], names: readonly unknown[], max: number = INTERNAL_TAG_LIST_MAX): { add: string[]; capped: boolean } {
  const seen = new Set(listed.map(tagMatchKey))
  const add: string[] = []
  let capped = false
  for (const raw of names) {
    if (typeof raw !== 'string') continue
    const name = raw.trim()
    const key = tagMatchKey(name)
    if (!key || seen.has(key)) continue
    if (listed.length + add.length >= max) {
      capped = true
      break
    }
    seen.add(key)
    add.push(name)
  }
  return { add, capped }
}

/** Appends `add` to the scope's list inside `tx` (creating the list if it is missing). No-op for nothing to add. */
export function appendListOps<T extends ListTx>(tx: T, projectSlug: string, scope: InternalTagScope, add: readonly string[]): T {
  if (!add.length) return tx
  const id = internalTagListId(projectSlug, scope)
  let t = tx.createIfNotExists({ _id: id, _type: INTERNAL_TAG_LIST_TYPE, projectSlug, scope, tags: [] }) as T
  t = t.patch(id, { setIfMissing: { tags: [] } }) as T
  t = t.patch(id, { insert: { after: 'tags[-1]', items: [...add] } }) as T
  return t
}

/**
 * Reads the list and returns the names to append. Never throws: a failed read
 * or a full list is logged and yields nothing to add.
 */
export async function planTagListSync(fetch: Fetch, projectSlug: string, scope: InternalTagScope, names: readonly unknown[], log: ListSyncLog = defaultLog): Promise<string[]> {
  if (!names.some((n) => typeof n === 'string' && tagMatchKey(n))) return []
  try {
    const listId = internalTagListId(projectSlug, scope)
    const tags = await fetch(LIST_TAGS_QUERY, { listId, projectSlug }, { perspective: 'raw' })
    const listed = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
    const { add, capped } = planListAdditions(listed, names)
    if (capped) log.warn('Tag list is full; new tags were saved on the item but not added to the list.', { projectSlug, scope, max: INTERNAL_TAG_LIST_MAX })
    return add
  } catch (error) {
    log.warn('Could not read the tag list; skipped.', { projectSlug, scope, error: String(error) })
    return []
  }
}

/**
 * The write paths that cannot share a transaction (a single patch, an upload,
 * a per-gallery loop): run right AFTER the item write, best effort — never
 * throws, so the user's save stands whatever happens here.
 */
export async function ensureInternalTagList(
  client: { fetch: Fetch; transaction?: () => ListTx & { commit(): Promise<unknown> } },
  projectSlug: string,
  scope: InternalTagScope,
  names: readonly unknown[],
  log: ListSyncLog = defaultLog
): Promise<string[]> {
  try {
    const add = await planTagListSync(client.fetch.bind(client), projectSlug, scope, names, log)
    if (!add.length || typeof client.transaction !== 'function') return []
    await appendListOps(client.transaction(), projectSlug, scope, add).commit()
    return add
  } catch (error) {
    log.warn('Could not extend the tag list; skipped.', { projectSlug, scope, error: String(error) })
    return []
  }
}
