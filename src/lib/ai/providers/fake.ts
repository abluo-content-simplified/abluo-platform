/**
 * Deterministic provider for tests and offline dev (AI_PROVIDER=fake, never in
 * production). Records every call; replies with a fixed string, a function of
 * the input, or throws.
 */

import { AiError, type AiGenerateInput, type AiProvider } from '../types'

export type FakeReply = string | ((input: AiGenerateInput) => string | Promise<string>)

export type FakeAiProvider = AiProvider & { calls: AiGenerateInput[] }

/** Default reply: echo the last user message (an "improvement" that changes nothing). */
const echo: FakeReply = (input) =>
  input.prompt ?? input.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? ''

export function createFakeAiProvider(reply: FakeReply = echo, opts: { configured?: boolean } = {}): FakeAiProvider {
  const calls: AiGenerateInput[] = []
  return {
    id: 'fake',
    model: 'fake-model',
    calls,
    isConfigured: () => opts.configured ?? true,
    async generate(input) {
      calls.push(input)
      if (opts.configured === false) throw new AiError('not_configured', 'fake: not configured')
      const text = typeof reply === 'function' ? await reply(input) : reply
      return { text, provider: 'fake', model: 'fake-model' }
    },
  }
}
