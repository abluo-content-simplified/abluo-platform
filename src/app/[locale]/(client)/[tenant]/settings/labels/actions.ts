'use server'

/**
 * Settings → Labels (Tom, 2026-11-11): saves this project's own names for a
 * few sections. Checks in `src/lib/nav-labels/service.ts`: `site.details.write`
 * on the project (Owner, Site admin), support visits only with edit access.
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import { saveNavLabels } from '@/lib/nav-labels/service'

export type NavLabelsActionResult = { ok: true } | { ok: false; error: 'unauthenticated' | 'forbidden' | 'invalid' | 'unavailable' | 'error' }

export async function saveNavLabelsAction(input: { projectSlug: string; labels: unknown }): Promise<NavLabelsActionResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await saveNavLabels(access.ctx, access.grant.projectId, input.labels)
    if (!r.ok) return { ok: false, error: r.reason }
    // Every page of this project's dashboard shows the sidebar.
    revalidatePath(`/[locale]/${access.grant.projectSlug}`, 'layout')
    return { ok: true }
  } catch (e) {
    console.error('[nav-labels] save failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'error' }
  }
}
