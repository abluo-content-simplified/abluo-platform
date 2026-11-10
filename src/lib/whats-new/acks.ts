/**
 * Who should acknowledge an announcement, and who did (ADR-050 D8). Pure.
 * "Expected" is known for specific audiences (named people + everyone with
 * active access to the named sites) and for "everyone" (every person with
 * active access anywhere). For a module audience the platform cannot tell from
 * here which sites use the module, so only who acknowledged is listed.
 */
import type { DirectorySite } from '@/lib/messages/directory'
import { noticeAudience } from './notices'

export type AckPerson = { userId: string; name: string; email: string; projectId: string | null }
export type AckReport = { acknowledged: (AckPerson & { at: string })[]; pending: AckPerson[] | null }

/** The people a notice is aimed at, each with one of their sites (for the bell link); null when not knowable. */
export function expectedPeople(audience: unknown, sites: readonly DirectorySite[]): AckPerson[] | null {
  const a = noticeAudience(audience)
  const out = new Map<string, AckPerson>()
  const add = (userId: string, projectId: string | null) => {
    if (out.has(userId)) return
    const site = sites.find((s) => (projectId ? s.id === projectId : s.people.some((p) => p.userId === userId)))
    const p = site?.people.find((x) => x.userId === userId)
    out.set(userId, { userId, name: p?.name ?? '', email: p?.email ?? '', projectId: site?.id ?? null })
  }
  if (a.projects.length || a.users.length) {
    for (const s of sites) if (a.projects.includes(s.id)) for (const p of s.people) add(p.userId, s.id)
    for (const u of a.users) add(u, null)
    return [...out.values()]
  }
  if (a.modules.length) return null
  for (const s of sites) for (const p of s.people) add(p.userId, s.id)
  return [...out.values()]
}

export function ackReport(audience: unknown, acks: readonly { user_id: string; acknowledged_at: string }[], sites: readonly DirectorySite[]): AckReport {
  const expected = expectedPeople(audience, sites)
  const lookup = (userId: string): AckPerson => {
    for (const s of sites) {
      const p = s.people.find((x) => x.userId === userId)
      if (p) return { userId, name: p.name, email: p.email, projectId: s.id }
    }
    return { userId, name: '', email: '', projectId: null }
  }
  const done = new Set(acks.map((a) => a.user_id))
  return {
    acknowledged: acks.map((a) => ({ ...lookup(a.user_id), at: a.acknowledged_at })).sort((x, y) => y.at.localeCompare(x.at)),
    pending: expected ? expected.filter((p) => !done.has(p.userId)) : null,
  }
}
