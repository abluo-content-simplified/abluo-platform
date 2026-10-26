// ── Reading status of a book (pure) ──────────────────────────────────────────
//
// Where a book stands for the site owner: reading it now, read it, or on the
// list of books they want to read. One value per book, optional, not localized.
// It is not a category (genre, the filter bar) nor a tag (what the book is
// about): it changes over time, so it is a field of its own (Tom, 2026-10-24).
// Browser-safe: used by the Studio schema, the dashboard, the server and the
// website.

export const READING_STATUSES = ['reading', 'read', 'wantToRead'] as const
export type ReadingStatus = (typeof READING_STATUSES)[number]

export const isReadingStatus = (v: unknown): v is ReadingStatus => typeof v === 'string' && (READING_STATUSES as readonly string[]).includes(v)

/** Editor order: what most books will be first. */
export const READING_STATUS_EDIT_ORDER: readonly ReadingStatus[] = ['read', 'reading', 'wantToRead']

export type Shelf<T> = { status: ReadingStatus | null; items: T[] }

/**
 * The website's shelves: "Reading now", then "Read", then "Want to read"; items without a status
 * come last. Stored order is kept inside a shelf. Empty shelves are left out. A list with no status
 * at all is one shelf with `status: null` — the caller then renders it exactly as before.
 */
export function shelvesOf<T>(items: readonly T[], statusOf: (item: T) => ReadingStatus | null): Shelf<T>[] {
  const order: (ReadingStatus | null)[] = [...READING_STATUSES, null]
  return order
    .map((status) => ({ status, items: items.filter((i) => statusOf(i) === status) }))
    .filter((s) => s.items.length > 0)
}
