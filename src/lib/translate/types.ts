/**
 * Translate module — shared types (ADR-023).
 *
 * Client-safe: no server imports. The Studio input and the API route both
 * import from here, so the wire contract has one definition.
 */

import type { SupportedLocale } from '@/lib/i18n/locales'

/** Providers a project can select in module config (ADR-023 §2). */
export const TRANSLATION_PROVIDER_IDS = ['google', 'deepl', 'claude'] as const
export type TranslationProviderId = (typeof TRANSLATION_PROVIDER_IDS)[number]

export function isTranslationProviderId(value: unknown): value is TranslationProviderId {
  return typeof value === 'string' && (TRANSLATION_PROVIDER_IDS as readonly string[]).includes(value)
}

/** `text` = plain strings; `html` = markup must survive (Portable Text path). */
export type TranslateFormat = 'text' | 'html'

/**
 * Every failure the API can report. The API returns CODES, never sentences —
 * the caller renders them through getTranslateMessages(locale) (ADR-023 §9).
 */
export const TRANSLATE_ERROR_CODES = [
  'forbidden',
  'invalid_request',
  'too_large',
  'project_not_found',
  'module_disabled',
  'provider_not_configured',
  'quota_reached',
  'usage_unavailable',
  'provider_error',
  'network_error',
] as const
export type TranslateErrorCode = (typeof TRANSLATE_ERROR_CODES)[number]

export class TranslateError extends Error {
  constructor(
    public readonly code: TranslateErrorCode,
    /** Server-log detail only. Never sent to the client. */
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'TranslateError'
  }
}

/** HTTP status for each error code. */
export const TRANSLATE_ERROR_STATUS: Record<TranslateErrorCode, number> = {
  forbidden: 403,
  invalid_request: 400,
  too_large: 413,
  project_not_found: 404,
  module_disabled: 409,
  provider_not_configured: 503,
  quota_reached: 429,
  usage_unavailable: 503,
  provider_error: 502,
  network_error: 502,
}

// ── Wire contract ─────────────────────────────────────────────────────────────

export type TranslateRequestBody = {
  projectSlug: string
  sourceLocale: SupportedLocale
  targetLocales: SupportedLocale[]
  /** One field's text(s). A plain field sends one; Portable Text sends one per block. */
  texts: string[]
  format?: TranslateFormat
  /** For the usage record only. */
  documentId?: string
}

export type TranslateUsageSummary = {
  /** Characters billed by this request, all targets together. */
  charactersThisRequest: number
  /** Characters used this calendar month (UTC), this request included. */
  monthToDate: number
  /** Monthly limit, or null when there is none. */
  quota: number | null
}

export type TranslateResponseBody =
  | {
      ok: true
      provider: TranslationProviderId
      /** Keyed by target locale; same order and length as `texts`. */
      translations: Partial<Record<SupportedLocale, string[]>>
      usage: TranslateUsageSummary
    }
  | { ok: false; error: TranslateErrorCode }

export type TranslateStatusBody =
  | {
      ok: true
      enabled: boolean
      provider: TranslationProviderId | null
      providerConfigured: boolean
      quota: number | null
      monthToDate: number | null
      quotaReached: boolean
      /** The site's languages, default first — the only valid targets. */
      supportedLocales: SupportedLocale[]
    }
  | { ok: false; error: TranslateErrorCode }
