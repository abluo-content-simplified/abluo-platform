// ── publicId — the server-side hard check (ADR-038 D2) ───────────────────────
// Before a publicId is used as the link to a Supabase schedule, it must belong
// to exactly ONE Sanity document (a draft and its published version are one).
// The Studio validation (fields/public-id.ts) blocks the common case; this is
// the check the scheduling layer relies on.

import { publicIdOwners } from './fields/public-id'

type Fetch = (query: string, params: Record<string, unknown>) => Promise<unknown>

export class PublicIdError extends Error {
  constructor(readonly code: 'not_found' | 'ambiguous', message: string) {
    super(message)
    this.name = 'PublicIdError'
  }
}

/** Returns the one document (base id) that owns `publicId` in this project; throws otherwise. */
export async function assertSinglePublicIdOwner(fetch: Fetch, projectSlug: string, publicId: string): Promise<string> {
  const rows = await fetch(`*[publicId == $publicId]{ _id, projectSlug }`, { publicId })
  const list = Array.isArray(rows) ? (rows as { _id?: unknown; projectSlug?: unknown }[]) : []
  const owners = publicIdOwners(list.map((r) => (typeof r._id === 'string' ? r._id : '')).filter(Boolean))
  if (owners.length === 0) throw new PublicIdError('not_found', 'No document has this id.')
  // A publicId shared across projects is also ambiguous — never pick one.
  if (owners.length > 1 || list.some((r) => r.projectSlug !== projectSlug)) {
    throw new PublicIdError('ambiguous', 'This id belongs to more than one document.')
  }
  return owners[0]
}
