// Server-only: reads Supabase `projects` with the service role. Call ONLY after
// `requireAbluoAdmin()`; never import from a client component.
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { readAllRowsOrThrow } from '@/lib/supabase/read-all'
import { pickAdminProject, usableAdminProjects, type AdminMediaProject } from '@/lib/admin/media-context'

/**
 * Every project the admin Media screen can show (Supabase `projects`, slug
 * used by exactly one row), A–Z by name.
 */
export async function loadAdminMediaProjects(): Promise<AdminMediaProject[]> {
  return runAsTrustedSystemOperation('admin media: list projects for the cross-project Media Library', async (admin) => {
    const rows = await readAllRowsOrThrow<{ id: string; slug: string; name: string }>('admin media projects', (from, to) =>
      admin.from('projects').select('id, slug, name').order('id').range(from, to),
    )
    return usableAdminProjects(rows)
  })
}

/** The one Supabase project named `slug` (null when unknown or shared by several rows). */
export async function loadAdminMediaProject(slug: unknown): Promise<AdminMediaProject | null> {
  if (typeof slug !== 'string' || !slug.trim()) return null
  return runAsTrustedSystemOperation('admin media: verify the project an admin media action targets', async (admin) => {
    const { data, error } = await admin.from('projects').select('id, slug, name').eq('slug', slug)
    if (error) throw new Error(error.message)
    return pickAdminProject(usableAdminProjects(data ?? []), slug)
  })
}
