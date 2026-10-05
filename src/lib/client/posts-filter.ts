/**
 * Posts list filtering for the client dashboard. Pure functions, no React — so
 * the rules are unit-tested (src/lib/client/__tests__/posts-filter.test.ts) and
 * the component only wires them to the URL.
 *
 * Sites have tens of posts, not thousands, so everything runs in the browser
 * on the already-loaded list. If a site ever grows past a few hundred, move
 * search + paging to the server.
 */

export type PostStatus = 'published' | 'scheduled' | 'draft' | 'offline'
export type PostSort = 'newest' | 'oldest' | 'edited'

/** The minimum a row needs for filtering. */
export type FilterablePost = {
  _id: string
  status: PostStatus
  /** Pre-built, lower-cased, accent-free text: titles + subtitles, all languages. */
  searchText: string
  categoryKeys: string[]
  /** Site languages this post has a title in. */
  languages: string[]
  /** ISO — go-live date, or last edit for drafts. Drives date filter + sort. */
  primaryDate: string
  updatedAt: string
}

export type PostFilters = {
  q: string
  status: PostStatus | 'all'
  categories: string[]
  /** 'all' | 'month' | '3m' | 'year' | a four-digit year */
  when: string
  /** a language code the post must be MISSING, or '' */
  missing: string
  sort: PostSort
}

export const DEFAULT_FILTERS: PostFilters = {
  q: '',
  status: 'all',
  categories: [],
  when: 'all',
  missing: '',
  sort: 'newest',
}

const STATUSES: readonly string[] = ['published', 'scheduled', 'draft', 'offline']
const SORTS: readonly string[] = ['newest', 'oldest', 'edited']

/** Lower-case and strip accents so "perche" finds "perché". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseFilters(params: URLSearchParams): PostFilters {
  const status = params.get('status') ?? 'all'
  const sort = params.get('sort') ?? 'newest'
  const when = params.get('when') ?? 'all'
  return {
    q: params.get('q') ?? '',
    status: STATUSES.includes(status) ? (status as PostStatus) : 'all',
    categories: (params.get('cat') ?? '').split(',').filter(Boolean),
    when: ['all', 'month', '3m', 'year'].includes(when) || /^\d{4}$/.test(when) ? when : 'all',
    missing: params.get('missing') ?? '',
    sort: SORTS.includes(sort) ? (sort as PostSort) : 'newest',
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. */
export function filtersToParams(f: PostFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.categories.length) p.set('cat', f.categories.join(','))
  if (f.when !== 'all') p.set('when', f.when)
  if (f.missing) p.set('missing', f.missing)
  if (f.sort !== 'newest') p.set('sort', f.sort)
  return p
}

/** Number of active narrowing filters (search and sort excluded). */
export function activeFilterCount(f: PostFilters): number {
  return (f.status !== 'all' ? 1 : 0) + f.categories.length + (f.when !== 'all' ? 1 : 0) + (f.missing ? 1 : 0)
}

function matchesWhen(iso: string, when: string, now: Date): boolean {
  if (when === 'all') return true
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  if (/^\d{4}$/.test(when)) return d.getFullYear() === Number(when)
  if (when === 'year') return d.getFullYear() === now.getFullYear()
  if (when === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (when === '3m') {
    const from = new Date(now)
    from.setMonth(from.getMonth() - 3)
    return d >= from && d <= now
  }
  return true
}

/** Everything except the status filter — used for the status tab counts. */
function matchesAllButStatus<T extends FilterablePost>(p: T, f: PostFilters, q: string, now: Date) {
  if (q && !p.searchText.includes(q)) return false
  if (f.categories.length && !f.categories.some((c) => p.categoryKeys.includes(c))) return false
  if (!matchesWhen(p.primaryDate, f.when, now)) return false
  if (f.missing && p.languages.includes(f.missing)) return false
  return true
}

export function applyFilters<T extends FilterablePost>(posts: T[], f: PostFilters, now = new Date()): T[] {
  const q = normalizeSearch(f.q)
  const out = posts.filter(
    (p) => (f.status === 'all' || p.status === f.status) && matchesAllButStatus(p, f, q, now)
  )
  const key = (p: T) => Date.parse(f.sort === 'edited' ? p.updatedAt : p.primaryDate) || 0
  out.sort((a, b) => (f.sort === 'oldest' ? key(a) - key(b) : key(b) - key(a)))
  return out
}

/** Counts per status tab, respecting every other active filter. */
export function statusCounts<T extends FilterablePost>(posts: T[], f: PostFilters, now = new Date()) {
  const q = normalizeSearch(f.q)
  const counts: Record<PostStatus | 'all', number> = { all: 0, published: 0, scheduled: 0, draft: 0, offline: 0 }
  for (const p of posts) {
    if (!matchesAllButStatus(p, f, q, now)) continue
    counts.all++
    counts[p.status]++
  }
  return counts
}

/** Years that actually have posts, newest first. */
export function postYears(posts: FilterablePost[]): string[] {
  const years = new Set<string>()
  for (const p of posts) {
    const d = new Date(p.primaryDate)
    if (!Number.isNaN(d.getTime())) years.add(String(d.getFullYear()))
  }
  return [...years].sort().reverse()
}
