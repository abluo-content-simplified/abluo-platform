/**
 * People list filters and sort (client-side, on the loaded list) — the same
 * shape as posts-filter.ts. Pure, so it is unit-tested.
 */
import type { Person, PersonStatus } from '@/lib/users/service'

export type UsersStatusFilter = 'current' | 'active' | 'invited' | 'archived' | 'all'
export type UsersSortColumn = 'name' | 'status' | 'invited' | 'joined' | 'lastActive'
export type UsersFilters = {
  q: string
  role: '' | Person['role']
  status: UsersStatusFilter
  sort: { column: UsersSortColumn; dir: 'asc' | 'desc' }
}

export const DEFAULT_USERS_FILTERS: UsersFilters = { q: '', role: '', status: 'current', sort: { column: 'name', dir: 'asc' } }

const STATUS_ORDER: Record<PersonStatus, number> = { active: 0, invited: 1, expired: 2, archived: 3 }

export function statusMatches(status: PersonStatus, filter: UsersStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return status !== 'archived'
  if (filter === 'invited') return status === 'invited' || status === 'expired'
  return status === filter
}

export const displayName = (p: Pick<Person, 'name' | 'email'>) => p.name || p.email

export function applyUsersFilters(people: Person[], f: UsersFilters): Person[] {
  const q = f.q.trim().toLowerCase()
  const rows = people.filter(
    (p) =>
      statusMatches(p.status, f.status) &&
      (!f.role || p.role === f.role) &&
      (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  )
  const dir = f.sort.dir === 'asc' ? 1 : -1
  const date = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)
  const key = (p: Person): number | string => {
    switch (f.sort.column) {
      case 'status':
        return STATUS_ORDER[p.status]
      case 'invited':
        return date(p.invitedAt)
      case 'joined':
        return date(p.joinedAt)
      case 'lastActive':
        return date(p.lastActiveAt)
      default:
        return displayName(p).toLowerCase()
    }
  }
  return [...rows].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka !== kb) return (ka < kb ? -1 : 1) * dir
    return displayName(a).localeCompare(displayName(b))
  })
}

export function isDefaultUsersFilters(f: UsersFilters): boolean {
  return !f.q && !f.role && f.status === DEFAULT_USERS_FILTERS.status
}

export function nextUsersSort(column: UsersSortColumn, current: UsersFilters['sort']): UsersFilters['sort'] {
  if (current.column !== column) return { column, dir: column === 'name' || column === 'status' ? 'asc' : 'desc' }
  return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
