/**
 * The autosave `send` of every editor whose published document is edited
 * through a draft (Testimonials, Digital Cards, People, Courses, FAQ,
 * Catalogue): the first change opens the draft (an exact copy of the
 * published version), then the change is saved against the draft's revision.
 *
 * Why it is shared (Digital Cards, 2026-11-09 — false "Edited elsewhere"):
 * each editor had its own copy that, when the save right after opening the
 * draft did not go through (refused value, server hiccup, lost connection),
 * returned the refusal WITHOUT the revision it had just opened. The engine
 * kept the revision it held before — after a publish, the revision of the
 * draft that publishing deleted — and, the draft now being marked open, sent
 * the retry (or the next change) with that stale revision: the server's
 * revision guard refused it as "changed elsewhere" although nobody else had
 * touched the card. Here a failed save after an open always reports the
 * opened revision (SendResult.rev), so the engine continues from it.
 */
import type { SendResult } from './engine'
import type { PendingSet } from './journal'

type OpenResult = { ok: true; rev: string } | { ok: false; error: string }
type SaveResult = { ok: true; rev: string } | { ok: false; error: string }

export async function openThenSave(
  input: { rev: string; set: PendingSet },
  draft: {
    /** The draft exists (as far as this editor knows). */
    hasDraft: () => boolean
    /** The draft was opened: remember it. */
    markDraft: () => void
    /** Opens the draft (creates it from the published version, or returns the existing one) and answers its revision. */
    open: () => Promise<OpenResult>
    save: (rev: string, set: PendingSet) => Promise<SaveResult>
  }
): Promise<SendResult> {
  let rev = input.rev
  let opened: string | null = null
  if (!draft.hasDraft() || !rev) {
    const o = await draft.open()
    if (!o.ok) return { ok: false, error: o.error }
    rev = o.rev
    opened = o.rev
    draft.markDraft()
  }
  let r: SaveResult
  try {
    r = await draft.save(rev, input.set)
  } catch (error) {
    // A network failure after the draft was opened: retry against the opened draft.
    if (opened) return { ok: false, error: 'network', rev: opened }
    throw error
  }
  if (r.ok) return { ok: true, rev: r.rev }
  return opened ? { ok: false, error: r.error, rev: opened } : { ok: false, error: r.error }
}
