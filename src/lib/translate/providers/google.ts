/**
 * Google Cloud Translation — Basic (v2) adapter (ADR-023 §3).
 *
 * v2 accepts a plain API key, which keeps the secret to one env var
 * (GOOGLE_TRANSLATE_API_KEY). Billing: source characters per target language,
 * HTML markup included. 500k characters/month free per Google account.
 *
 * `format: 'text'` returns plain text (no HTML entity escaping); `html` keeps
 * tags and escapes text content, which is what the Portable Text path needs.
 */

import { TranslateError } from '../types'
import { assertSameLength, postJson } from './http'
import { countCharacters, type FetchLike, type TranslationProvider } from './types'

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'

/** Google takes ISO-639-1 for every platform locale — identity mapping, kept explicit. */
const GOOGLE_CODES: Record<string, string> = {
  en: 'en', it: 'it', de: 'de', fr: 'fr', es: 'es', pt: 'pt', nl: 'nl',
}

type GoogleResponse = { data?: { translations?: { translatedText?: string }[] } }

export function createGoogleProvider(opts: {
  apiKey?: string
  fetchImpl?: FetchLike
} = {}): TranslationProvider {
  const apiKey = () => opts.apiKey ?? process.env.GOOGLE_TRANSLATE_API_KEY
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init))

  return {
    id: 'google',
    isConfigured: () => Boolean(apiKey()),
    async translate({ texts, source, target, format }) {
      const key = apiKey()
      if (!key) throw new TranslateError('provider_not_configured', 'GOOGLE_TRANSLATE_API_KEY missing')
      if (texts.length === 0) return { texts: [], billedCharacters: 0 }
      const body = await postJson<GoogleResponse>(
        fetchImpl,
        'google',
        ENDPOINT,
        // Header rather than ?key= so the key never appears in a URL (logs, proxies).
        { 'X-Goog-Api-Key': key },
        { q: texts, source: GOOGLE_CODES[source] ?? source, target: GOOGLE_CODES[target] ?? target, format }
      )
      const out = body.data?.translations?.map((t) => t.translatedText ?? '') ?? []
      assertSameLength('google', texts.length, out)
      return { texts: out, billedCharacters: countCharacters(texts) }
    },
  }
}
