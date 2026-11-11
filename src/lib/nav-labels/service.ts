// Server-only: service role. Callers pass an authorised context; the checks are here too.
/**
 * Navigation labels storage (migration 071). Reads never fail a page: no
 * table, an error or nothing set → {} (the defaults). Writes need
 * `site.details.write` on the project (Owner, Site admin) and, in a support
 * visit, the client's permission to edit.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { can } from '@/lib/authz/check'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { isCustomLabelId, isInterfaceLocale, planNavLabels, type NavLabelMap } from './model'

export const NAV_LABELS_WRITE = 'site.details.write'

type Row = { nav_id: string; locale: string; label: string }

export async function loadNavLabels(projectId: string): Promise<NavLabelMap> {
  try {
    return await runAsTrustedSystemOperation('navigation labels: read one project', async (db: SupabaseClient) => {
      const { data, error } = await db.from('project_nav_labels').select('nav_id, locale, label').eq('project_id', projectId)
      if (error) return {}
      const out: NavLabelMap = {}
      for (const r of (data ?? []) as Row[]) {
        if (!isInterfaceLocale(r.locale) || !isCustomLabelId(r.nav_id)) continue
        out[r.locale] = { ...(out[r.locale] ?? {}), [r.nav_id]: r.label }
      }
      return out
    })
  } catch {
    return {}
  }
}

export type SaveNavLabelsResult = { ok: true } | { ok: false; reason: 'forbidden' | 'invalid' | 'unavailable' | 'error' }

export async function saveNavLabels(ctx: TenantAuthorizationContext, projectId: string, input: unknown): Promise<SaveNavLabelsResult> {
  if (!can(ctx, NAV_LABELS_WRITE, { kind: 'project', projectId })) return { ok: false, reason: 'forbidden' }
  const plan = planNavLabels(input)
  if (!plan.ok) return { ok: false, reason: 'invalid' }
  return runAsTrustedSystemOperation('navigation labels: a tenant administrator saves them', async (db: SupabaseClient): Promise<SaveNavLabelsResult> => {
    if (plan.set.length) {
      const now = new Date().toISOString()
      const up = await db
        .from('project_nav_labels')
        .upsert(plan.set.map((r) => ({ project_id: projectId, nav_id: r.navId, locale: r.locale, label: r.label, updated_by: ctx.userId, updated_at: now })), { onConflict: 'project_id,nav_id,locale' })
      if (up.error) return { ok: false, reason: ['42P01', 'PGRST205'].includes(up.error.code ?? '') ? 'unavailable' : 'error' }
    }
    for (const c of plan.clear) {
      const del = await db.from('project_nav_labels').delete().eq('project_id', projectId).eq('nav_id', c.navId).eq('locale', c.locale)
      if (del.error) return { ok: false, reason: ['42P01', 'PGRST205'].includes(del.error.code ?? '') ? 'unavailable' : 'error' }
    }
    return { ok: true }
  })
}
