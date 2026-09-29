/**
 * Claude (Anthropic Messages API) adapter (ADR-023 §3) — the "better tone"
 * alternative. Metered in source characters like the others so usage is
 * comparable across providers; tokens are not recorded in v1.
 *
 * Needs BOTH env vars: ANTHROPIC_API_KEY and TRANSLATE_CLAUDE_MODEL. The model
 * is deliberately not hard-coded: model ids are retired over time, and a stale
 * default would fail at click time rather than show as "not configured".
 *
 * The texts go in and come back as a JSON array so batch order is preserved
 * exactly; anything else in the reply is a provider_error.
 */

import { PLATFORM_LOCALES } from '@/lib/i18n/locales'
import { TranslateError } from '../types'
import { assertSameLength, postJson } from './http'
import { countCharacters, type FetchLike, type TranslationProvider } from './types'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

type ClaudeResponse = { content?: { type: string; text?: string }[] }

export function buildClaudeSystemPrompt(format: 'text' | 'html'): string {
  return [
    'You translate website content for small professional practices (clinics, studios, clubs).',
    'Translate faithfully and naturally, keeping the tone, register and formality of the source.',
    'Do not add, drop or explain anything. Keep names, brand names, URLs, e-mail addresses and numbers unchanged.',
    format === 'html'
      ? 'Each item is an HTML fragment: keep every tag and attribute exactly as it is, translate only the text between tags.'
      : 'Each item is plain text: keep line breaks and Markdown-style ** markers where they are.',
    'Input is a JSON array of strings. Reply with ONLY a JSON array of the translated strings, same length, same order.',
  ].join(' ')
}

/** Pull the first JSON array out of the model's reply. */
export function parseJsonArray(reply: string): string[] {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start === -1 || end <= start) throw new TranslateError('provider_error', 'claude: no JSON array in reply')
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch (err) {
    throw new TranslateError('provider_error', `claude: unparseable array (${String(err)})`)
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
    throw new TranslateError('provider_error', 'claude: reply is not an array of strings')
  }
  return parsed
}

export function createClaudeProvider(opts: {
  apiKey?: string
  model?: string
  fetchImpl?: FetchLike
} = {}): TranslationProvider {
  const apiKey = () => opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  const model = () => opts.model ?? process.env.TRANSLATE_CLAUDE_MODEL
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init))

  return {
    id: 'claude',
    isConfigured: () => Boolean(apiKey() && model()),
    async translate({ texts, source, target, format }) {
      const key = apiKey()
      const m = model()
      if (!key || !m) {
        throw new TranslateError('provider_not_configured', 'ANTHROPIC_API_KEY or TRANSLATE_CLAUDE_MODEL missing')
      }
      if (texts.length === 0) return { texts: [], billedCharacters: 0 }
      const from = PLATFORM_LOCALES[source]?.name ?? source
      const to = PLATFORM_LOCALES[target]?.name ?? target
      const body = await postJson<ClaudeResponse>(
        fetchImpl,
        'claude',
        ENDPOINT,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model: m,
          max_tokens: 16000,
          system: buildClaudeSystemPrompt(format),
          messages: [
            {
              role: 'user',
              content: `Translate from ${from} to ${to}.\n\n${JSON.stringify(texts)}`,
            },
          ],
        }
      )
      const reply = (body.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
      const out = parseJsonArray(reply)
      assertSameLength('claude', texts.length, out)
      return { texts: out, billedCharacters: countCharacters(texts) }
    },
  }
}
