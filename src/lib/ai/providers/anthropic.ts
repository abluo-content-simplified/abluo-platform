/**
 * Anthropic Messages API adapter (ADR-026). Plain `fetch`, no SDK.
 *
 * - Key: ANTHROPIC_API_KEY (shared with the Translate module's Claude adapter).
 * - Model: passed in by the registry (AI_MODEL, default DEFAULT_ANTHROPIC_MODEL).
 * - Timeout via AbortController; every failure becomes an AiError code.
 * - The key is only ever placed in the `x-api-key` request header: it is never
 *   logged, never put in an error message, never returned.
 */

import {
  AiError,
  assertServerSide,
  toMessages,
  type AiGenerateInput,
  type AiGenerateResult,
  type AiProvider,
  type FetchLike,
} from '../types'

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'
/** Balanced cost/quality for editorial tidy-ups. Override with AI_MODEL. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_TIMEOUT_MS = 60_000

type AnthropicResponse = {
  content?: { type: string; text?: string }[]
  stop_reason?: string | null
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function createAnthropicProvider(opts: {
  apiKey?: string
  model?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}): AiProvider {
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init))

  return {
    id: 'anthropic',
    model,
    isConfigured: () => Boolean(opts.apiKey),
    async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
      assertServerSide()
      const apiKey = opts.apiKey
      if (!apiKey) throw new AiError('not_configured', 'ANTHROPIC_API_KEY is not set')

      const body: Record<string, unknown> = {
        model,
        max_tokens: Math.max(1, Math.floor(input.maxTokens)),
        system: input.system,
        messages: toMessages(input),
      }
      if (typeof input.temperature === 'number') body.temperature = input.temperature

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await fetchImpl(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (err) {
        if (controller.signal.aborted) throw new AiError('timeout', `anthropic: no reply within ${timeoutMs}ms`)
        throw new AiError('network_error', `anthropic: ${errorName(err)}`)
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.text()).slice(0, 300)
        } catch {
          /* ignore */
        }
        throw new AiError('provider_error', `anthropic HTTP ${res.status} ${redact(detail, apiKey)}`)
      }

      let json: AnthropicResponse
      try {
        json = (await res.json()) as AnthropicResponse
      } catch {
        throw new AiError('invalid_response', 'anthropic: body is not JSON')
      }
      if (json.stop_reason === 'refusal') throw new AiError('refused', 'anthropic: model refused')
      if (json.stop_reason === 'max_tokens') throw new AiError('truncated', 'anthropic: reply hit max_tokens')
      const text = (json.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('')
      if (!text.trim()) throw new AiError('invalid_response', 'anthropic: empty reply')
      return {
        text,
        provider: 'anthropic',
        model: json.model ?? model,
        usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
      }
    },
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown error'
}

/** Belt and braces: never let the key into a log line, even if echoed back. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join('[redacted]') : text
}
