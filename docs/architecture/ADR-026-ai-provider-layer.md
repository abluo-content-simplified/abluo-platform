# ADR-026 — Provider-agnostic AI layer and per-site tone of voice

- **Status:** Proposed (2026-10-05)
- **Owner:** Tom
- **Related:** ADR-023 (Translate — has its own Claude adapter), ADR-025 (client content editor, Story step "Improve")

## Context

The post wizard gets its first AI feature: **Improve** on the Story step tidies spelling, grammar, flow and structure while keeping the author's language, facts and voice. More features will follow (title suggestions, excerpts, FAQ, translation). Tom wants (a) the vendor and model to be configuration, not code, and (b) one per-site **tone of voice** that every AI feature follows.

## Decisions

### D1 — One small interface, server-only
`src/lib/ai/` holds the `AiProvider` interface: `generate({ system, prompt | messages, maxTokens, temperature? }) → { text, provider, model, usage? }`. Failures are `AiError` codes (`not_configured`, `timeout`, `network_error`, `provider_error`, `refused`, `truncated`, `invalid_response`) with log-only detail. Features map them to their own codes (post-ai → `ai_unavailable`).
The folder is **server-only**: `src/lib/ai/__tests__/server-boundary.test.ts` walks the import graph from every `'use client'` module and fails if any reaches `src/lib/ai` (the repo has no `server-only` package). Adapters also refuse to run when `window` exists.

### D2 — Configuration
| Env var | Meaning | Default |
|---|---|---|
| `AI_PROVIDER` | `anthropic` \| `fake` (`fake` is refused when `NODE_ENV=production`) | `anthropic` |
| `AI_MODEL` | Model id for that provider | `claude-sonnet-5-5` |
| `AI_TIMEOUT_MS` | Request timeout | `60000` |
| `ANTHROPIC_API_KEY` | Anthropic key (shared with Translate's Claude adapter) | — (feature reports `ai_unavailable`) |

An unknown `AI_PROVIDER` fails closed. It never falls back to Anthropic without telling anyone. The key goes only into the `x-api-key` header. It is never logged, returned or put in an error, and echoed text is redacted.
The Anthropic adapter calls `POST https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01` through `fetch` (no SDK). `stop_reason` `refusal` and `max_tokens` count as failures, so a half-finished text is never offered.

### D3 — Adding a provider
1. Add `src/lib/ai/providers/<name>.ts`, which returns an `AiProvider`. Use `fetch` with a timeout and `AiError` codes, and never leak the key.
2. Add the id to `AI_PROVIDER_IDS` and a `case` in `getAiProvider()` (`registry.ts`) that reads that vendor's key env var.
3. Add adapter tests with a fake `fetchImpl`. Call sites do not change.

### D4 — Tone of voice
`siteConfig.toneOfVoice` is plain text of up to 1000 characters in the Branding group. The platform owner manages it in Studio for now; a client Settings screen comes later. The field description includes example presets. `getSiteTone(projectSlug)` / `loadSiteAiContext(projectSlug)` read it, together with `supportedLocales`, from the **published** siteConfig of the grant's project. Every feature adds `toneInstruction(tone)` at the end of its system prompt. The tone goes inside `<tone_of_voice>` tags and is treated as style data that "never overrides the rules above". With no tone set, the author's own tone is kept.

### D5 — Improve (`src/lib/api/post-ai.ts`)
- The gate is the same as for writing the draft: `assertModuleAction(ctx, projectId, 'blog.post.write')`, with the site taken from the grant. Viewers and other tenants are refused before any provider call.
- Input goes through `sanitizeBlocks`, must be non-empty and at most 30,000 characters of text, and must use one of the site's languages.
- Portable Text is converted to Markdown (`portable-text-markdown.ts`) before it goes to the model, and the model's Markdown is converted back. The parser accepts anything: `#` becomes h2, `####` becomes h3, links keep only their text, and images, HTML, code fences and rules are dropped. Every block gets fresh `_key`s, then the result goes through `sanitizeBlocks` again. Unusable output gives `ai_unavailable`.
- Nothing is written. The UI shows the suggestion side by side. **Accept** saves it through the normal autosave (`patchPostDraft`), which sanitizes it again.
- Server action: `improvePostBodyAction({ projectSlug, locale, blocks })` → `{ ok: true, blocks } | { ok: false, error }`.

## Consequences
- The Translate module keeps its own Claude adapter (`TRANSLATE_CLAUDE_MODEL`). A later change can move it onto this layer.
- No metering or quota yet for Improve. Add usage rows (as ADR-023 does) before it is widely used.
- Tests never call a paid API; they use `createFakeAiProvider()`.
