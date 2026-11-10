/**
 * Who Abluo can write to (ADR-050 D2/D3): every site with the people who have
 * ACTIVE access to it right now, built from the admin people directory (the
 * same data as Admin → Users). Pure: takes the directory, returns the picker's
 * data and the `projectId:userId` set the send action checks against.
 */
import type { AdminPerson } from '@/lib/admin/users-model'

export type DirectoryPerson = { userId: string; name: string; email: string; role: string }
export type DirectorySite = { id: string; name: string; people: DirectoryPerson[] }

export function buildMessageDirectory(people: readonly AdminPerson[], projects: readonly { id: string; name: string }[]): DirectorySite[] {
  const bySite = new Map<string, DirectoryPerson[]>()
  for (const p of people) {
    if (!p.userId) continue
    for (const a of p.access) {
      if (a.status !== 'active') continue
      for (const projectId of a.projectIds) {
        const list = bySite.get(projectId) ?? []
        if (!list.some((x) => x.userId === p.userId)) list.push({ userId: p.userId, name: p.name, email: p.email, role: a.role })
        bySite.set(projectId, list)
      }
    }
  }
  return projects
    .filter((s) => bySite.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, people: (bySite.get(s.id) ?? []).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) }))
}

export function allowedPairs(sites: readonly DirectorySite[]): Set<string> {
  return new Set(sites.flatMap((s) => s.people.map((p) => `${s.id}:${p.userId}`)))
}
