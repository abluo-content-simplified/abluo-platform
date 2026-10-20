// ── publicId — uniqueness (ADR-031 D3, ADR-038 D2) ───────────────────────────
//
// `publicId` is the permanent UUID that connected apps see and, from Events 2.0,
// the key that links a Sanity event to its Supabase schedule. It is useless as a
// key unless exactly ONE document carries it. A document and its draft
// (`drafts.<id>`, or a release version `versions.<release>.<id>`) are the same
// document and legitimately share it.
//
// Pure helpers + the Studio validation. No server imports: this file is loaded
// by the Studio bundle (schema) as well as by server code.

/** The document a Sanity id belongs to: `drafts.x` / `versions.r.x` → `x`. */
export function baseDocumentId(id: string): string {
  if (id.startsWith('drafts.')) return id.slice('drafts.'.length)
  if (id.startsWith('versions.')) {
    const rest = id.slice('versions.'.length)
    const dot = rest.indexOf('.')
    return dot === -1 ? rest : rest.slice(dot + 1)
  }
  return id
}

/** The distinct documents (base ids, sorted) among Sanity ids that carry one publicId. */
export function publicIdOwners(ids: readonly string[]): string[] {
  return [...new Set(ids.map(baseDocumentId))].sort()
}

/** Groups `{ _id, publicId }` rows into publicIds owned by more than one document. */
export function duplicatePublicIds(rows: readonly { _id: string; publicId?: unknown }[]): Map<string, string[]> {
  const byId = new Map<string, string[]>()
  for (const r of rows) {
    if (typeof r.publicId !== 'string' || !r.publicId) continue
    const list = byId.get(r.publicId) ?? []
    list.push(r._id)
    byId.set(r.publicId, list)
  }
  const out = new Map<string, string[]>()
  for (const [publicId, ids] of byId) {
    const owners = publicIdOwners(ids)
    if (owners.length > 1) out.set(publicId, owners)
  }
  return out
}

export const PUBLIC_ID_DUPLICATE_MESSAGE =
  'Another document already uses this Public ID (usually a copy made with Duplicate). Create the copy again with Duplicate, or ask Abluo to issue a new id.'

/**
 * Studio validation: the publicId must belong to this document only. Blocks
 * publishing a copy that still carries its original's id. Fails open (true)
 * when Studio cannot query — the server-side guard is the hard check.
 */
export async function validateUniquePublicId(value: unknown, context: unknown): Promise<true | string> {
  if (typeof value !== 'string' || !value) return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = context as any
  const id: unknown = ctx?.document?._id
  if (typeof id !== 'string' || typeof ctx?.getClient !== 'function') return true
  const ids: unknown = await ctx
    .getClient({ apiVersion: '2026-05-21' })
    .fetch(`*[publicId == $publicId]._id`, { publicId: value }, { perspective: 'raw' })
  if (!Array.isArray(ids)) return true
  const others = publicIdOwners(ids.filter((x): x is string => typeof x === 'string')).filter((b) => b !== baseDocumentId(id))
  return others.length === 0 ? true : PUBLIC_ID_DUPLICATE_MESSAGE
}
