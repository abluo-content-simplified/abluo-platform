/**
 * AI assistance for the client dashboard's post wizard (ADR-026).
 *
 * `improvePostBody` — the Story step's "Improve" button: tidies spelling,
 * grammar, flow and structure of ONE language's body, in that language, in the
 * site's tone of voice. It never writes anything: it returns suggested blocks
 * and the UI shows them side by side (Accept → the normal autosave path,
 * `patchPostDraft`, which sanitizes again).
 *
 * Enforcement, in order — every refusal happens BEFORE the provider is called:
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` — same gate as
 *      writing the draft (owner/editor with Blog installed; never viewer).
 *      The site is the GRANT's projectSlug, never the caller's.
 *   2. Input rebuilt through `sanitizeBlocks` (allowed shape only), non-empty,
 *      ≤ IMPROVE_LIMITS.inputChars of text.
 *   3. `locale` must be one of the site's languages.
 *   4. Provider output → Markdown parser → fresh `_key`s → `sanitizeBlocks`.
 *      Anything the model produces outside the allowed shape is normalised or
 *      dropped; if the result is still unusable the call fails 'ai_unavailable'.
 */

import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { BLOG_POST_WRITE_PERMISSION, PostDraftError, sanitizeBlocks } from '@/lib/api/post-drafts'
import { getAiProvider } from '@/lib/ai/registry'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { loadSiteAiContext, type SiteAiContext } from '@/lib/ai/tone'
import { buildImproveSystemPrompt, buildImproveUserPrompt } from '@/lib/ai/prompts'
import {
  blocksPlainTextLength,
  blocksToMarkdown,
  defaultKey,
  markdownToBlocks,
  type KeyFn,
} from '@/lib/ai/portable-text-markdown'

export type PostAiErrorCode = 'forbidden' | 'invalid_value' | 'too_large' | 'ai_unavailable'

export class PostAiError extends Error {
  constructor(
    readonly code: PostAiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PostAiError'
  }
}

export const IMPROVE_LIMITS = {
  /** Characters of span text accepted in one request. */
  inputChars: 30_000,
  /** Ceiling on the reply, in tokens. */
  maxOutputTokens: 16_000,
} as const

export type PostAiDeps = {
  provider?: AiProvider
  loadSite?: (projectSlug: string) => Promise<SiteAiContext>
  key?: KeyFn
  logError?: (message: string) => void
}

/** Roughly the input's size back, plus headroom for headings. */
export function improveMaxTokens(inputChars: number): number {
  return Math.min(IMPROVE_LIMITS.maxOutputTokens, Math.ceil(inputChars / 2.5) + 1024)
}

export async function improvePostBody(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { locale: string; blocks: unknown },
  deps: PostAiDeps = {}
): Promise<{ blocks: unknown[] }> {
  // 1. Gate — throws TenantAuthorizationError (→ 'forbidden' in the action).
  assertModuleAction(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!

  // 2. Input shape and size.
  if (typeof input?.locale !== 'string' || !input.locale) {
    throw new PostAiError('invalid_value', 'Missing language.')
  }
  if (Array.isArray(input.blocks) && blocksPlainTextLength(input.blocks) > IMPROVE_LIMITS.inputChars) {
    throw new PostAiError('too_large', 'This text is too long to improve in one go.')
  }
  let clean: unknown[]
  try {
    clean = sanitizeBlocks(input.blocks)
  } catch (err) {
    if (err instanceof PostDraftError) throw new PostAiError('invalid_value', err.message)
    throw err
  }
  const chars = blocksPlainTextLength(clean)
  if (!clean.length || !blocksToMarkdown(clean).trim()) {
    throw new PostAiError('invalid_value', 'Nothing to improve yet.')
  }

  // 3. The site's languages and tone (published siteConfig of the GRANT's site).
  const site = await (deps.loadSite ?? loadSiteAiContext)(grant.projectSlug)
  if (!site.locales.includes(input.locale)) {
    throw new PostAiError('invalid_value', 'Unknown language for this site.')
  }

  // 4. Provider.
  const log = deps.logError ?? ((m: string) => console.error(m))
  let text: string
  try {
    const provider = deps.provider ?? getAiProvider()
    if (!provider.isConfigured()) throw new AiError('not_configured', `${provider.id}: missing credentials`)
    const result = await provider.generate({
      system: buildImproveSystemPrompt({ locale: input.locale, tone: site.tone }),
      prompt: buildImproveUserPrompt(blocksToMarkdown(clean)),
      maxTokens: improveMaxTokens(chars),
    })
    text = result.text
  } catch (err) {
    log(`[post-ai] improve failed: ${err instanceof AiError ? err.message : err instanceof Error ? err.name : 'unknown'}`)
    throw new PostAiError('ai_unavailable', 'The assistant is not available right now.')
  }

  // 5. Back to the allowed shape.
  try {
    const blocks = sanitizeBlocks(markdownToBlocks(text, deps.key ?? defaultKey))
    if (!blocks.length) throw new Error('empty result')
    return { blocks }
  } catch (err) {
    log(`[post-ai] improve output unusable: ${err instanceof Error ? err.message : 'unknown'}`)
    throw new PostAiError('ai_unavailable', 'The assistant returned something we could not use.')
  }
}
