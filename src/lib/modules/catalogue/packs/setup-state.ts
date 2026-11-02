// ── Catalogue setup state (contract C7.9, Tom's D-14) ───────────────────────
//
// `setupCompletedAt` and `setupSource` live in Catalogue MODULE CONFIG, stored
// separately from pack history. Starting empty, applying any pack or marking
// setup complete each satisfy completion.
//
// `isSetupComplete` is the ONLY export of `catalogue/packs/` that code outside
// Setup (e.g. the item editor, "food setup never completed") may import — it
// reads `setupCompletedAt` only, never the source and never which pack.
// `readSetupState` is for Setup. Both enforced by applied-preset-guard.test.ts.

export type SetupSource = 'empty' | 'pack' | 'manual'
const SOURCES: readonly SetupSource[] = ['empty', 'pack', 'manual']

type ConfigLike = { setupCompletedAt?: unknown; setupSource?: unknown } | null | undefined

const completedAt = (config: ConfigLike): string | null => {
  const v = config?.setupCompletedAt
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v)) ? v : null
}

/** True when Catalogue setup was completed (any way). Reads `setupCompletedAt` only. */
export function isSetupComplete(config: ConfigLike): boolean {
  return completedAt(config) !== null
}

/** Setup only: when and how setup was completed. */
export function readSetupState(config: ConfigLike): { completedAt: string | null; source: SetupSource | null } {
  const at = completedAt(config)
  const s = config?.setupSource
  return { completedAt: at, source: at && (SOURCES as readonly unknown[]).includes(s) ? (s as SetupSource) : null }
}
