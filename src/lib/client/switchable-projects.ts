import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Which of the caller's projects the project switcher offers, and where the
 * bare dashboard entry lands.
 *
 * An `inactive` project (e.g. the T42 isolation fixture) stays a valid grant —
 * its URL still works for whoever holds it — but it is not offered in the
 * switcher and is never the default landing. The project currently open is
 * always kept, so the switcher can show it.
 *
 * Status is read only for project ids the caller is already granted; this
 * never widens access.
 */
type Grantish = { projectId: string; projectSlug: string }

export function filterSwitchableProjects<T extends Grantish>(
  grants: readonly T[],
  statusByProjectId: Readonly<Record<string, string | null | undefined>>,
  activeSlug?: string | null,
): T[] {
  return grants.filter(
    (g) => statusByProjectId[g.projectId] !== 'inactive' || g.projectSlug === activeSlug,
  )
}

/** What the switcher shows for a project: its name and domain, plus its status. */
export type ProjectSummary = { status: string | null; name: string | null; domain: string | null }

/**
 * Name, domain and status for the given project ids (one query). On error,
 * returns {} — nothing is hidden and the switcher falls back to slugs.
 */
export async function loadProjectSummaries(projectIds: readonly string[]): Promise<Record<string, ProjectSummary>> {
  if (projectIds.length === 0) return {}
  const { data, error } = await createAdminClient()
    .from('projects')
    .select('id, status, name, custom_domain')
    .in('id', [...projectIds])
  if (error || !data) return {}
  const out: Record<string, ProjectSummary> = {}
  for (const row of data as { id: string; status: string | null; name: string | null; custom_domain: string | null }[]) {
    out[row.id] = { status: row.status, name: row.name, domain: row.custom_domain }
  }
  return out
}

/** Status only, from summaries — the shape `filterSwitchableProjects` reads. */
export function statusesOf(summaries: Readonly<Record<string, ProjectSummary>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, s] of Object.entries(summaries)) if (s.status) out[id] = s.status
  return out
}

/** `projects.status` for the given ids. On error, returns {} — nothing is hidden. */
export async function loadProjectStatuses(projectIds: readonly string[]): Promise<Record<string, string>> {
  return statusesOf(await loadProjectSummaries(projectIds))
}
