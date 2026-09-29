/**
 * Resolve the Translate module for one project (ADR-023 §2). Server-side.
 *
 * Reads the Sanity `project` through the tenant-scoped client, so the lookup
 * is guarded by the same `$projectSlug` check as every website read.
 */

import { LOCALE_CODES, type SupportedLocale } from '@/lib/i18n/locales'
import { tenantClient } from '@/lib/sanity/client'
import { projectTranslateQuery } from '@/lib/sanity/queries'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { normaliseQuota } from './quota'
import { isTranslationProviderId, type TranslationProviderId } from './types'

export const TRANSLATE_MODULE_ID = 'translate'
export const DEFAULT_TRANSLATION_PROVIDER: TranslationProviderId = 'google'

export type ProjectTranslateRecord = {
  /** Supabase projects.id (uuid). */
  projectId?: string | null
  /** The enabled `translate` installation's config, or null when not installed / disabled. */
  translate?: { config?: Record<string, unknown> | null } | null
  /** siteConfig.supportedLocales, default first. */
  supportedLocales?: string[] | null
} | null

export type ResolvedTranslateConfig = {
  projectId: string | null
  enabled: boolean
  provider: TranslationProviderId
  quota: number | null
  /** The site's languages (platform locales only), default first. Empty = unknown. */
  supportedLocales: SupportedLocale[]
}

/** Pure shaping of the query result — tested without Sanity. */
export function resolveTranslateConfig(record: ProjectTranslateRecord): ResolvedTranslateConfig | null {
  if (!record) return null
  const config = record.translate?.config ?? {}
  const provider = isTranslationProviderId(config.provider) ? config.provider : DEFAULT_TRANSLATION_PROVIDER
  return {
    projectId: typeof record.projectId === 'string' && record.projectId ? record.projectId : null,
    enabled: Boolean(record.translate),
    provider,
    quota: normaliseQuota(config.monthlyCharacterQuota),
    supportedLocales: (record.supportedLocales ?? []).filter((c): c is SupportedLocale =>
      (LOCALE_CODES as string[]).includes(c)
    ),
  }
}

export async function loadTranslateConfig(projectSlug: string): Promise<ResolvedTranslateConfig | null> {
  const record = await tenantClient(asProjectSlug(projectSlug)).fetchForTenant<ProjectTranslateRecord>(
    projectTranslateQuery
  )
  return resolveTranslateConfig(record)
}
