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

/** `projects.status` for the given ids. On error, returns {} — nothing is hidden. */
export async function loadProjectStatuses(projectIds: readonly string[]): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {}
  const { data, error } = await createAdminClient()
    .from('projects')
    .select('id, status')
    .in('id', [...projectIds])
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const row of data as { id: string; status: string | null }[]) {
    if (row.status) out[row.id] = row.status
  }
  return out
}
