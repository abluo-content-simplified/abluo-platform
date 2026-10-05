/**
 * AI feature flag (ADR-026 §D6). One server-side switch:
 *
 *   AI_FEATURES   unset / '' / 'off' / 'none'  → every AI feature OFF (default)
 *                 'all'                         → every feature ON
 *                 'improve,translate'           → just those (comma/space separated)
 *
 * Read on the server only. Pages pass the resulting booleans to client
 * components as props; server actions re-check it (defence in depth), so a
 * feature that is off refuses with 'ai_unavailable' whatever keys are set.
 * Pure — no I/O — so both states are unit-tested without a provider.
 */

export const AI_FEATURE_IDS = ['improve', 'translate'] as const
export type AiFeatureId = (typeof AI_FEATURE_IDS)[number]
export type AiFeatureFlags = Record<AiFeatureId, boolean>

type Env = Record<string, string | undefined>

export function parseAiFeatures(raw: string | undefined | null): AiFeatureFlags {
  const tokens = new Set(
    (raw ?? '')
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
  )
  const all = tokens.has('all')
  return Object.fromEntries(AI_FEATURE_IDS.map((id) => [id, all || tokens.has(id)])) as AiFeatureFlags
}

export function getAiFeatureFlags(env: Env = process.env): AiFeatureFlags {
  return parseAiFeatures(env.AI_FEATURES)
}

export function isAiFeatureEnabled(feature: AiFeatureId, env: Env = process.env): boolean {
  return getAiFeatureFlags(env)[feature]
}
