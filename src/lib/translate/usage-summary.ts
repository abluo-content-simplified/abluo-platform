/**
 * Translation usage for one project, or for every project (admin). Server-side.
 *
 * Reads the Translate module config through the tenant-scoped Sanity client
 * (loadTranslateConfig) and the month-to-date total through the SQL sum
 * (getMonthToDateCharacters, migration 027) — the same two sources the
 * Translate button uses, so the numbers shown and the numbers enforced never
 * disagree.
 *
 * Callers authorize first: the tenant Settings page checks the person's grant,
 * the admin Projects page is behind requireAbluoAdmin.
 */

import { loadTranslateConfig } from './config'
import { getMonthToDateCharacters } from './usage'
import { translationUsageView, type TranslationUsageSummary, type TranslationUsageView } from './usage-view'

export type { TranslationUsageSummary } from './usage-view'

/**
 * null = the Translate module is not on for this project (nothing to show).
 * Throws when the usage cannot be read, so a caller can say "unavailable"
 * instead of showing 0.
 */
export async function loadTranslationUsage(projectSlug: string, fallbackProjectId?: string | null, now: Date = new Date()): Promise<TranslationUsageView | null> {
  const config = await loadTranslateConfig(projectSlug)
  if (!config || !config.enabled) return null
  const projectId = config.projectId ?? fallbackProjectId ?? null
  if (!projectId) return translationUsageView(0, config.quota, now)
  const used = await getMonthToDateCharacters(projectId, now)
  return translationUsageView(used, config.quota, now)
}

/** Every listed project, in parallel. One project's failure never hides the others. */
export async function loadTranslationUsageSummaries(projects: readonly { id: string; slug: string }[], now: Date = new Date()): Promise<Map<string, TranslationUsageSummary>> {
  const entries = await Promise.all(
    projects.map(async (p): Promise<[string, TranslationUsageSummary]> => {
      try {
        const view = await loadTranslationUsage(p.slug, p.id, now)
        return [p.id, view ? { kind: 'usage', ...view } : { kind: 'off' }]
      } catch (e) {
        console.error(`[translate] usage summary failed for ${p.slug}`, e)
        return [p.id, { kind: 'unavailable' }]
      }
    }),
  )
  return new Map(entries)
}
