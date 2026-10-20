// ── Duplicate with a fresh publicId — pure part (ADR-038 D2) ─────────────────
// Sanity's built-in Duplicate copies every field, including the read-only
// `publicId`, which would give two documents the same permanent id. The copy
// keeps everything else exactly as the built-in action does (slugs included —
// unchanged behaviour), and gets a new publicId. Lifecycle stamps that describe
// the ORIGINAL's history are not copied.

const METADATA_KEYS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])

/** Lifecycle fields that belong to the original document's history, never to a copy. */
const HISTORY_KEYS = new Set(['_publishGuard', '_lifecycleGuard'])

export function duplicateDocumentBody(
  source: Record<string, unknown>,
  newPublicId: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    if (METADATA_KEYS.has(k) || HISTORY_KEYS.has(k)) continue
    out[k] = v
  }
  out.publicId = newPublicId
  return out
}

/** True when a schema type declares a top-level `publicId` field. */
export function hasPublicIdField(schemaType: unknown): boolean {
  const fields = (schemaType as { fields?: { name?: string }[] } | undefined)?.fields
  return Array.isArray(fields) && fields.some((f) => f?.name === 'publicId')
}
