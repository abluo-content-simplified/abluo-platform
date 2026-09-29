/**
 * Translation provider interface (ADR-023 §3). One interface, adapters behind it.
 * Adding a provider = one adapter + one select option in the module manifest +
 * one env var. Nothing else changes.
 */

import type { SupportedLocale } from '@/lib/i18n/locales'
import type { TranslateFormat, TranslationProviderId } from '../types'

export type ProviderTranslateRequest = {
  /** One batch; output order matches input order. */
  texts: string[]
  source: SupportedLocale
  target: SupportedLocale
  format: TranslateFormat
}

export type ProviderTranslateResult = {
  texts: string[]
  /**
   * The provider's own billed count when it reports one, otherwise the source
   * character count (what Google bills: source characters per target, markup
   * included).
   */
  billedCharacters: number
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface TranslationProvider {
  id: TranslationProviderId
  /** True when the provider's API key is present in this process's environment. */
  isConfigured(): boolean
  translate(req: ProviderTranslateRequest): Promise<ProviderTranslateResult>
}

/** Source characters as a provider counts them: Unicode code points, not UTF-16 units. */
export function countCharacters(texts: string[]): number {
  let n = 0
  for (const t of texts) n += Array.from(t).length
  return n
}
