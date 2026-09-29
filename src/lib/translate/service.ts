/**
 * Translate service — the server path of ADR-023 §6, with every I/O edge
 * injected so the whole flow is unit-testable without Sanity, Supabase or a
 * provider.
 */

import type { SupportedLocale } from '@/lib/i18n/locales'
import type { ResolvedTranslateConfig } from './config'
import type { TranslationProvider } from './providers/types'
import { isQuotaReached, wouldExceedQuota } from './quota'
import type { UsageRow } from './usage'
import type { ValidTranslateRequest } from './validate'
import {
  TranslateError,
  type TranslateStatusBody,
  type TranslateUsageSummary,
  type TranslationProviderId,
} from './types'

export type TranslateDeps = {
  loadConfig: (projectSlug: string) => Promise<ResolvedTranslateConfig | null>
  getProvider: (id: TranslationProviderId) => TranslationProvider
  getMonthToDate: (projectId: string) => Promise<number>
  /** Supabase projects row exists, so usage can be recorded. */
  projectIsMeterable: (projectId: string) => Promise<boolean>
  recordUsage: (rows: UsageRow[]) => Promise<void>
  environment: string
  logError: (message: string, err?: unknown) => void
}

export type TranslateOutcome = {
  provider: TranslationProviderId
  translations: Partial<Record<SupportedLocale, string[]>>
  usage: TranslateUsageSummary
}

async function resolveEnabled(deps: TranslateDeps, projectSlug: string) {
  const config = await deps.loadConfig(projectSlug)
  if (!config) throw new TranslateError('project_not_found', projectSlug)
  if (!config.enabled) throw new TranslateError('module_disabled', projectSlug)
  if (!config.projectId) {
    // Without the Supabase project id usage cannot be recorded; metering is
    // not optional (ADR-023 decision 3), so refuse.
    throw new TranslateError('usage_unavailable', `${projectSlug} has no projectId`)
  }
  return config as ResolvedTranslateConfig & { projectId: string }
}

export async function runTranslate(
  req: ValidTranslateRequest,
  actorId: string | null,
  deps: TranslateDeps
): Promise<TranslateOutcome> {
  const config = await resolveEnabled(deps, req.projectSlug)
  // Targets must be languages the site actually offers — never spend credit on
  // a language nobody will see (and never trust the client's list).
  const offered = new Set<string>(config.supportedLocales)
  if (
    offered.size === 0 ||
    !offered.has(req.sourceLocale) ||
    !req.targetLocales.every((l) => offered.has(l))
  ) {
    throw new TranslateError('invalid_request', 'locale not offered by this site')
  }
  const provider = deps.getProvider(config.provider)
  if (!provider.isConfigured()) throw new TranslateError('provider_not_configured', config.provider)

  // Metering is not optional: never spend provider credit for a project whose
  // usage row could not be inserted (translation_usage.project_id is a FK).
  let meterable = false
  try {
    meterable = await deps.projectIsMeterable(config.projectId)
  } catch (err) {
    deps.logError('[translate] meterability check failed — refusing', err)
  }
  if (!meterable) throw new TranslateError('usage_unavailable', `project ${config.projectId} not meterable`)

  // Quota — fails CLOSED when a limit is set and usage cannot be read.
  // Soft limit: two simultaneous clicks can each pass the check and together
  // overshoot by one request (ADR-023 §8). Acceptable for a billing signal.
  let used = 0
  if (config.quota !== null) {
    try {
      used = await deps.getMonthToDate(config.projectId)
    } catch (err) {
      deps.logError('[translate] usage read failed with a quota set — refusing', err)
      throw new TranslateError('usage_unavailable', String(err))
    }
    if (wouldExceedQuota(config.quota, used, req.requestedCharacters)) {
      throw new TranslateError('quota_reached', `${used}+${req.requestedCharacters}>${config.quota}`)
    }
  }

  const translations: Partial<Record<SupportedLocale, string[]>> = {}
  const rows: UsageRow[] = []
  let billed = 0
  for (const target of req.targetLocales) {
    const result = await provider.translate({
      texts: req.texts,
      source: req.sourceLocale,
      target,
      format: req.format,
    })
    translations[target] = result.texts
    billed += result.billedCharacters
    rows.push({
      project_id: config.projectId,
      provider: provider.id,
      source_locale: req.sourceLocale,
      target_locale: target,
      characters: result.billedCharacters,
      text_count: req.texts.length,
      format: req.format,
      sanity_document_id: req.documentId,
      actor_id: actorId,
      environment: deps.environment,
    })
  }

  // The provider has already charged: a metering failure must not throw the
  // translation away. Logged at error level so it is visible in the log drain.
  try {
    await deps.recordUsage(rows)
  } catch (err) {
    deps.logError(`[translate] USAGE NOT RECORDED project=${config.projectId} characters=${billed}`, err)
  }

  let monthToDate = used + billed
  if (config.quota === null) {
    try {
      monthToDate = await deps.getMonthToDate(config.projectId)
    } catch {
      monthToDate = billed
    }
  }

  return {
    provider: provider.id,
    translations,
    usage: { charactersThisRequest: billed, monthToDate, quota: config.quota },
  }
}

/** Everything the Studio needs to show, disable or explain the button. */
export async function getTranslateStatus(
  projectSlug: string,
  deps: Pick<TranslateDeps, 'loadConfig' | 'getProvider' | 'getMonthToDate' | 'logError'>
): Promise<Extract<TranslateStatusBody, { ok: true }>> {
  const config = await deps.loadConfig(projectSlug)
  if (!config) throw new TranslateError('project_not_found', projectSlug)
  if (!config.enabled) {
    return {
      ok: true, enabled: false, provider: null, providerConfigured: false,
      quota: null, monthToDate: null, quotaReached: false, supportedLocales: [],
    }
  }
  const providerConfigured = deps.getProvider(config.provider).isConfigured()
  let monthToDate: number | null = null
  if (config.projectId) {
    try {
      monthToDate = await deps.getMonthToDate(config.projectId)
    } catch (err) {
      deps.logError('[translate] status: usage read failed', err)
    }
  }
  return {
    ok: true,
    enabled: true,
    provider: config.provider,
    providerConfigured,
    quota: config.quota,
    monthToDate,
    supportedLocales: config.supportedLocales,
    // Unknown usage with a quota set is reported as reached — same fail-closed
    // rule as the translate path, so the button never promises what it refuses.
    quotaReached:
      config.quota !== null && (monthToDate === null || isQuotaReached(config.quota, monthToDate)),
  }
}
