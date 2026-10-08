/**
 * Admin Projects list — filters and sort (client-side, on the loaded list),
 * the same shape as the client's people-filter.ts. Pure, so it is unit-tested.
 *
 * Status filter default is `current`: everything except `inactive` projects
 * (retired sites stay reachable with "Inactive" or "All").
 */

export type ProjectStatus = 'active' | 'preview' | 'draft' | 'inactive'

/** The fields the list needs from a project (see `AdminProject` in the admin providers). */
export type ProjectListRow = {
  slug: string
  name: string
  /** A stored status the platform may add later stays a plain string. */
  status: ProjectStatus | (string & {})
  customDomain: string | null
  createdAt: string
  client: { name: string; slug: string } | null
  owners: { name: string; email: string }[]
}

export const PROJECT_STATUS_FILTERS = ['current', 'active', 'preview', 'draft', 'inactive', 'all'] as const
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number]
export type ProjectSortColumn = 'name' | 'status' | 'client' | 'created'

export type ProjectFilters = {
  q: string
  status: ProjectStatusFilter
  sort: { column: ProjectSortColumn; dir: 'asc' | 'desc' }
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = { q: '', status: 'current', sort: { column: 'name', dir: 'asc' } }

/** Lifecycle order for sorting by status: live first, retired last; unknown statuses after draft. */
const STATUS_ORDER: Record<string, number> = { active: 0, preview: 1, draft: 2, inactive: 4 }

export function isProjectStatusFilter(value: unknown): value is ProjectStatusFilter {
  return typeof value === 'string' && (PROJECT_STATUS_FILTERS as readonly string[]).includes(value)
}

export function projectStatusMatches(status: string, filter: ProjectStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return status !== 'inactive'
  return status === filter
}

/** Lower-case, accent-free (so "citta" finds "Città"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Everything the search box matches: name, slug, domain, client name and slug, owners. */
export function projectSearchText(p: ProjectListRow): string {
  return foldText(
    [p.name, p.slug, p.customDomain ?? '', p.client?.name ?? '', p.client?.slug ?? '', ...p.owners.flatMap((o) => [o.name, o.email])].join(' '),
  )
}

export function applyProjectFilters<T extends ProjectListRow>(projects: readonly T[], f: ProjectFilters): T[] {
  const terms = foldText(f.q).split(/\s+/).filter(Boolean)
  const rows = projects.filter((p) => {
    if (!projectStatusMatches(p.status, f.status)) return false
    if (!terms.length) return true
    const text = projectSearchText(p)
    return terms.every((t) => text.includes(t))
  })
  const dir = f.sort.dir === 'asc' ? 1 : -1
  const key = (p: T): number | string => {
    switch (f.sort.column) {
      case 'status':
        return STATUS_ORDER[p.status] ?? 3
      case 'client':
        return foldText(p.client?.name ?? '')
      case 'created':
        return Date.parse(p.createdAt) || 0
      default:
        return foldText(p.name)
    }
  }
  return [...rows].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka !== kb) return (ka < kb ? -1 : 1) * dir
    return foldText(a.name).localeCompare(foldText(b.name)) || a.slug.localeCompare(b.slug)
  })
}

export function isDefaultProjectFilters(f: ProjectFilters): boolean {
  return !f.q.trim() && f.status === DEFAULT_PROJECT_FILTERS.status
}

export function nextProjectSort(column: ProjectSortColumn, current: ProjectFilters['sort']): ProjectFilters['sort'] {
  if (current.column !== column) return { column, dir: column === 'created' ? 'desc' : 'asc' }
  return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/** Projects per status, for the status filter's counts and the Home tiles. */
export function countProjectsByStatus(projects: readonly Pick<ProjectListRow, 'status'>[]): Record<ProjectStatus, number> & { other: number } {
  const out = { active: 0, preview: 0, draft: 0, inactive: 0, other: 0 }
  for (const p of projects) {
    const s = p.status as string
    if (s === 'active' || s === 'preview' || s === 'draft' || s === 'inactive') out[s]++
    else out.other++
  }
  return out
}

/** `https://preview.abluo.app/<slug>` — the private preview address every project has. */
export function previewSiteUrl(slug: string): string {
  return `https://preview.abluo.app/${encodeURIComponent(slug)}`
}

/** The live site's URL from a stored custom domain, or null when there is no usable one. */
export function liveSiteUrl(customDomain: string | null | undefined): string | null {
  const d = (customDomain ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? `https://${d.toLowerCase()}` : null
}
