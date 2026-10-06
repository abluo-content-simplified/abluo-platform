/**
 * Lazy draft creation (Tom, gallery redo): "+ Add content" opens a wizard with
 * NO document. Only the first real content — a title, story text, or the first
 * photo — creates the draft; closing before that leaves nothing behind.
 * Everything else changed before then (a topic, the wizard position) is held
 * locally and sent together with that first content.
 */
import type { PendingSet } from './autosave/journal'

/** Patch paths that count as real content, per wizard. */
export const POST_CONTENT = /^(title|subtitle|body)\./
export const GALLERY_CONTENT = /^(title\.|description\.|tags$|items$)/

function filled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined
}

/** True when the patch carries real content (a non-empty value on a content path). */
export function isContentPatch(set: PendingSet, content: RegExp): boolean {
  return Object.entries(set).some(([path, value]) => content.test(path) && filled(value))
}

/**
 * Splits a change while no draft exists: hold it (no content yet) or send it
 * together with everything held so far. Pure; the caller keeps `held`.
 */
export function routePreDraft(
  held: PendingSet,
  set: PendingSet,
  content: RegExp
): { send: PendingSet | null; held: PendingSet } {
  const merged = { ...held, ...set }
  return isContentPatch(set, content) ? { send: merged, held: {} } : { send: null, held: merged }
}
