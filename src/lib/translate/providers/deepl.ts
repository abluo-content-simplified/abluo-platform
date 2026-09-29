/**
 * DeepL adapter (ADR-023 §3).
 *
 * A key ending in `:fx` is a DeepL API Free key and must use api-free.deepl.com.
 * (API Free is no longer sold to new customers, but existing keys still work.)
 * DeepL reports its own billed characters when asked (`show_billed_characters`).
 */

import { TranslateError } from '../types'
import { assertSameLength, postJson } from './http'
import { countCharacters, type FetchLike, type TranslationProvider } from './types'

/** DeepL wants a regional variant for English and Portuguese TARGETS only. */
const DEEPL_TARGET: Record<string, string> = {
  en: 'EN-GB', pt: 'PT-PT', it: 'IT', de: 'DE', fr: 'FR', es: 'ES', nl: 'NL',
}
const DEEPL_SOURCE: Record<string, string> = {
  en: 'EN', pt: 'PT', it: 'IT', de: 'DE', fr: 'FR', es: 'ES', nl: 'NL',
}

type DeepLResponse = { translations?: { text?: string; billed_characters?: number }[] }

export function deeplEndpoint(apiKey: string): string {
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate'
}

export function createDeepLProvider(opts: {
  apiKey?: string
  fetchImpl?: FetchLike
} = {}): TranslationProvider {
  const apiKey = () => opts.apiKey ?? process.env.DEEPL_API_KEY
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init))

  return {
    id: 'deepl',
    isConfigured: () => Boolean(apiKey()),
    async translate({ texts, source, target, format }) {
      const key = apiKey()
      if (!key) throw new TranslateError('provider_not_configured', 'DEEPL_API_KEY missing')
      if (texts.length === 0) return { texts: [], billedCharacters: 0 }
      const body = await postJson<DeepLResponse>(
        fetchImpl,
        'deepl',
        deeplEndpoint(key),
        { Authorization: `DeepL-Auth-Key ${key}` },
        {
          text: texts,
          source_lang: DEEPL_SOURCE[source] ?? source.toUpperCase(),
          target_lang: DEEPL_TARGET[target] ?? target.toUpperCase(),
          show_billed_characters: true,
          ...(format === 'html' ? { tag_handling: 'html' } : {}),
        }
      )
      const items = body.translations ?? []
      assertSameLength('deepl', texts.length, items)
      const billed = items.every((t) => typeof t.billed_characters === 'number')
        ? items.reduce((s, t) => s + (t.billed_characters ?? 0), 0)
        : countCharacters(texts)
      return { texts: items.map((t) => t.text ?? ''), billedCharacters: billed }
    },
  }
}
