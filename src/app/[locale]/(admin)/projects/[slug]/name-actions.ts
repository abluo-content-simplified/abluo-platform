'use server'

/**
 * Rename a project (Tom, 2026-11-11): the name is how the project is listed
 * across both dashboards (Support Tickets, Messages, the project switcher).
 * A long site title ("Thomas Marco Zimmermann — Product Designer & …") made
 * the lists unreadable, so the name is managed here. The website's own title
 * lives in Sanity and is not touched.
 *
 * Admin-only: `requireAbluoAdmin()` (abluo_admin + two-factor) first; the
 * write uses the service role.
 */
import { revalidatePath } from 'next/cache'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { cleanProjectName } from '@/lib/admin/project-name'

export async function renameProjectAction(projectId: unknown, name: unknown): Promise<{ ok: true; name: string } | { ok: false; reason: 'forbidden' | 'invalid' | 'error' }> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, reason: 'forbidden' }
  const clean = cleanProjectName(name)
  if (typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId) || !clean) return { ok: false, reason: 'invalid' }
  try {
    const { data, error } = await createAdminClient().from('projects').update({ name: clean }).eq('id', projectId).select('id')
    if (error || !data?.length) return { ok: false, reason: 'error' }
    revalidatePath('/[locale]/projects', 'layout')
    revalidatePath('/[locale]/support', 'layout')
    revalidatePath('/[locale]/messages', 'layout')
    return { ok: true, name: clean }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
