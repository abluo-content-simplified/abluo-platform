/**
 * Reading more than 1000 rows from Supabase.
 *
 * PostgREST answers at most `max_rows` rows per request (1000 on Supabase by
 * default) WHATEVER `.limit()` asks for — `.limit(50000)` silently returns
 * 1000. Any total computed in JS from such a read is wrong past that point.
 *
 * Prefer, in order:
 *   1. a head count — `.select('id', { count: 'exact', head: true })` — when
 *      only the number is needed (no rows transferred);
 *   2. `readAllRows` below when the rows themselves are needed: it pages with
 *      `.range()` until a short page. The query MUST be ordered by a unique key
 *      (or end its ORDER BY with one, e.g. `id`), or pages can overlap or skip.
 */

/** Rows per request — Supabase's default `max_rows`. */
export const SUPABASE_PAGE_SIZE = 1000

export type ReadError = { message: string; code?: string }

type PageResult<T> = PromiseLike<{ data: T[] | null; error: ReadError | null }>

export type ReadAllResult<T> = {
  rows: T[]
  /** Set when a page failed (PostgREST's error, code included); `rows` holds what was read before it. */
  error: ReadError | null
  /** True when `maxRows` stopped the read before the data ran out. */
  capped: boolean
}

/**
 * Reads every row a query matches, page by page. `page(from, to)` runs the
 * query with `.range(from, to)` (inclusive bounds). Stops at a short page, an
 * error, or `maxRows` (a safety net, never a silent truncation: `capped` says so).
 */
export async function readAllRows<T>(
  page: (from: number, to: number) => PageResult<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<ReadAllResult<T>> {
  const size = Math.max(1, opts.pageSize ?? SUPABASE_PAGE_SIZE)
  const max = opts.maxRows ?? Number.POSITIVE_INFINITY
  const rows: T[] = []
  for (let from = 0; from < max; from += size) {
    const to = Math.min(from + size, max) - 1
    const { data, error } = await page(from, to)
    if (error) return { rows, error, capped: false }
    const got = data ?? []
    rows.push(...got)
    // A short page is the last one. (A server whose max_rows is below
    // `size` also returns short pages — the caller then gets fewer rows, so
    // keep `size` at or under the project's max_rows.)
    if (got.length < to - from + 1) return { rows, error: null, capped: false }
  }
  return { rows, error: null, capped: true }
}

/** Like readAllRows, but throws on a failed page (for callers that settle() or throw anyway). */
export async function readAllRowsOrThrow<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const r = await readAllRows(page, opts)
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.rows
}
