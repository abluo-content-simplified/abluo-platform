/**
 * Commit options for editor autosaves and "open for edit" draft copies.
 *
 * `visibility: 'async'` — Sanity acknowledges the mutation once it is durably
 * committed to the transaction log, without waiting for the query index
 * (GROQ) to catch up. The client default (`sync`) waited ~1.1 s per save on
 * every autosave (measured 16 Oct 2026: sync p50 1163 ms, async p50 123 ms).
 *
 * Why this is safe for draft saves — every guarantee stays where it was:
 *  - Durability: an async ack is still a committed transaction; "Saved" means
 *    the write was accepted, not queued.
 *  - Lost updates: every autosave carries `ifRevisionId`, checked by Sanity
 *    on the write itself, so a stale or out-of-order save is refused (409).
 *  - Read-after-write: the editors, publish and the lifecycle read the
 *    document back with `getDocument` (doc endpoint), which is consistent
 *    immediately — verified 15/15 on the live dataset.
 *  - What may lag (≈0.05–0.8 s): GROQ reads of the just-saved draft — dashboard
 *    lists, cross-document slug/reference checks. Publish re-validates through
 *    getDocument, so nothing reaches the website from a stale read.
 *
 * Use ONLY for draft autosaves and draft copies. Publish, discard, lifecycle,
 * create and anything followed by a GROQ read of the same document keep the
 * default (`sync`).
 */
export const DRAFT_SAVE = { visibility: 'async' } as const
