// Server-only: service-role reads, the Sanity write token and the Google service account. Never import from a client component.
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { recordAdminAudit } from '@/lib/admin/audit'
import { refreshProjectAnalytics } from '@/lib/analytics/snapshot'
import { analyticsIdsFrom } from '@/lib/analytics/config'
import { setupAnalytics } from '@/lib/google/analytics-setup'
import { connectSearchConsole } from '@/lib/google/search-console-setup'
import { loadGoogleSanityState, SanityStateError, type SanityPort } from '@/lib/google/sanity-config'
import { googleCardState, googleSetupEnv, type GoogleCardState } from '@/lib/google/state'
import type { SetupOutcome } from '@/lib/google/errors'

/**
 * "Connect Google" on the admin project page (docs/engineering/analytics-setup.md
 * → Automatic setup). Every function calls requireAbluoAdmin() first and
 * returns null when refused.
 */

type ProjectRow = { id: string; slug: string; name: string; custom_domain: string | null }

/** Sanity, as the setup modules use it: raw perspective reads (drafts visible) + write-token transactions. */
export const sanityGooglePort: SanityPort = {
  fetch: (query, params) => sanityWriteClient.fetch(query, params, { perspective: 'raw' }),
  mutate: async (mutations) => {
    await sanityWriteClient.mutate(mutations as never, { visibility: 'sync' })
  },
}

async function projectRow(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await createAdminClient().from('projects').select('id, slug, name, custom_domain').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`projects read failed: ${error.message}`)
  return (data as ProjectRow | null) ?? null
}

export type AdminGoogleCard = {
  card: GoogleCardState
  env: ReturnType<typeof googleSetupEnv>
  hasDomain: boolean
  /** False when the Sanity documents could not be read (the card shows "couldn't load"). */
  loaded: boolean
}

/** The card's resting state for one project (no Google call). */
export async function getAdminGoogleCard(projectId: string): Promise<AdminGoogleCard | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const project = await projectRow(projectId)
  if (!project) return null
  const env = googleSetupEnv()
  const hasDomain = Boolean(project.custom_domain?.trim())
  try {
    const s = await loadGoogleSanityState(sanityGooglePort, project.slug)
    return { card: googleCardState(s.project.published.integrationConfigs, s.siteConfig.published.googleSiteVerification), env, hasDomain, loaded: true }
  } catch (e) {
    if (!(e instanceof SanityStateError)) console.warn(`[admin/google] card read: ${e instanceof Error ? e.message : String(e)}`)
    return { card: googleCardState(null, null), env, hasDomain, loaded: false }
  }
}

export type GoogleSetupWhich = 'analytics' | 'search_console' | 'both'

export type GoogleSetupRun = {
  analytics?: SetupOutcome
  searchConsole?: SetupOutcome
  /** The per-site analytics refresh ran after a connected outcome (best-effort). */
  refreshed: boolean
}

function auditDetail(o: SetupOutcome): Record<string, unknown> {
  return o.state === 'connected'
    ? { state: o.state, values: o.values, changed: o.changed }
    : { state: o.state, code: o.code, message: o.message.slice(0, 500), changed: o.changed }
}

/**
 * Runs the requested setup (Analytics first — it is quick; Search Console may
 * wait up to ~90 s for the site), records each in the admin audit log, then
 * refreshes the site's analytics snapshot when anything is connected.
 */
export async function runGoogleSetup(projectId: string, which: GoogleSetupWhich): Promise<GoogleSetupRun | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const project = await projectRow(projectId)
  if (!project) return null
  const run: GoogleSetupRun = { refreshed: false }

  if (which === 'analytics' || which === 'both') {
    run.analytics = await setupAnalytics({ slug: project.slug, name: project.name, customDomain: project.custom_domain }, { sanity: sanityGooglePort })
    await recordAdminAudit({ actorId: actor.userId, action: 'google.analytics.setup', projectId: project.id, detail: auditDetail(run.analytics) })
  }
  if (which === 'search_console' || which === 'both') {
    run.searchConsole = await connectSearchConsole({ slug: project.slug, customDomain: project.custom_domain }, { sanity: sanityGooglePort })
    await recordAdminAudit({ actorId: actor.userId, action: 'google.search_console.connect', projectId: project.id, detail: auditDetail(run.searchConsole) })
  }

  if (run.analytics?.state === 'connected' || run.searchConsole?.state === 'connected') {
    try {
      const s = await loadGoogleSanityState(sanityGooglePort, project.slug)
      const ids = analyticsIdsFrom(s.project.published.integrationConfigs as Parameters<typeof analyticsIdsFrom>[0])
      await refreshProjectAnalytics({ projectId: project.id, slug: project.slug, ...ids })
      run.refreshed = true
    } catch (e) {
      console.warn(`[admin/google] analytics refresh after setup: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return run
}
