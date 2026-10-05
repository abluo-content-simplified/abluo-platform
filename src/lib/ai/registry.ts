/**
 * Provider registry (ADR-026). The ONLY place that knows which vendors exist.
 *
 *   AI_PROVIDER   'anthropic' (default) | 'fake' (non-production only)
 *   AI_MODEL      model id for the selected provider (anthropic default: claude-sonnet-5-5)
 *   AI_TIMEOUT_MS request timeout, default 60000
 *   ANTHROPIC_API_KEY  key for the anthropic provider
 *
 * Adding a vendor = one adapter in ./providers + one case below. Call sites
 * keep calling `getAiProvider().generate(...)`.
 */

import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'
import { createFakeAiProvider } from './providers/fake'
import { AiError, type AiProvider, type FetchLike } from './types'

export const AI_PROVIDER_IDS = ['anthropic', 'fake'] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export const DEFAULT_AI_PROVIDER: AiProviderId = 'anthropic'

type Env = Record<string, string | undefined>

export type ResolvedAiConfig = {
  provider: AiProviderId
  model: string
  timeoutMs: number | undefined
}

/** Pure: env → config. Unknown provider names fail closed (not silently Anthropic). */
export function resolveAiConfig(env: Env = process.env): ResolvedAiConfig {
  const raw = (env.AI_PROVIDER ?? '').trim().toLowerCase() || DEFAULT_AI_PROVIDER
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(raw)) {
    throw new AiError('not_configured', `unknown AI_PROVIDER "${raw.slice(0, 40)}"`)
  }
  const provider = raw as AiProviderId
  if (provider === 'fake' && env.NODE_ENV === 'production') {
    throw new AiError('not_configured', 'AI_PROVIDER=fake is not allowed in production')
  }
  const timeout = Number(env.AI_TIMEOUT_MS)
  const model = (env.AI_MODEL ?? '').trim() || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : 'fake-model')
  return { provider, model, timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined }
}

export function getAiProvider(env: Env = process.env, opts: { fetchImpl?: FetchLike } = {}): AiProvider {
  const config = resolveAiConfig(env)
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
        model: config.model,
        timeoutMs: config.timeoutMs,
        fetchImpl: opts.fetchImpl,
      })
    case 'fake':
      return createFakeAiProvider()
  }
}
