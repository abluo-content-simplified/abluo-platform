/**
 * Provider-agnostic AI layer — shared types (ADR-026).
 *
 * SERVER-ONLY. Nothing under `src/lib/ai/` may be imported from a 'use client'
 * module (guarded by `__tests__/server-boundary.test.ts`): the providers read
 * API keys from the environment.
 *
 * Call sites depend on `AiProvider` only. Which vendor and which model answer
 * is configuration (`AI_PROVIDER`, `AI_MODEL`), resolved in `registry.ts`.
 */

export type AiMessage = { role: 'user' | 'assistant'; content: string }

export type AiGenerateInput = {
  /** System prompt: role, rules, the site's tone of voice. */
  system: string
  /** Either a conversation… */
  messages?: AiMessage[]
  /** …or a single user turn (shorthand for `[{ role: 'user', content: prompt }]`). */
  prompt?: string
  /** Hard cap on the reply length, in provider tokens. */
  maxTokens: number
  /** Optional; omitted from the request when undefined (some models ignore or reject it). */
  temperature?: number
}

export type AiGenerateResult = {
  text: string
  /** Informational only — the provider/model that answered. */
  provider: string
  model: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface AiProvider {
  readonly id: string
  readonly model: string
  /** True when the provider has everything it needs (key, model). Never reveals the key. */
  isConfigured(): boolean
  generate(input: AiGenerateInput): Promise<AiGenerateResult>
}

/**
 * Every failure a provider reports. Codes, not sentences: callers map them to
 * their own small set (e.g. post-ai → 'ai_unavailable'). `detail` is for the
 * server log only and never contains a key.
 */
export type AiErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'network_error'
  | 'provider_error'
  | 'refused'
  | 'truncated'
  | 'invalid_response'

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'AiError'
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Normalise `prompt | messages` into a message list. */
export function toMessages(input: AiGenerateInput): AiMessage[] {
  if (input.messages?.length) return input.messages
  if (typeof input.prompt === 'string' && input.prompt) return [{ role: 'user', content: input.prompt }]
  throw new AiError('invalid_response', 'generate() needs `messages` or `prompt`')
}

/** Throws when evaluated in a browser — a second line behind the import guard test. */
export function assertServerSide(): void {
  if (typeof window !== 'undefined') {
    throw new Error('src/lib/ai is server-only and must never run in the browser')
  }
}
