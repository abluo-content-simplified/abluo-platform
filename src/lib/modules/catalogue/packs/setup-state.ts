// ── Catalogue setup state (contract C7.9, Tom's D-14) ───────────────────────
//
// `setupCompletedAt` and `setupSource` live in Catalogue MODULE CONFIG, stored
// separately from pack history. Starting empty, applying any pack or marking
// setup complete each satisfy completion.
//
// Until data step D3 runs, a project set up with a legacy starter preset (the
// installation's preset record, e.g. tmz) has no `setupCompletedAt` yet. A
// VALID legacy record (`legacyPresetRecord`) counts as completed with source
// 'pack' — so such a project never sees the "not set up" / food-setup flow.
// Runtime code only learns THAT setup is complete, never which pack.
//
// `isSetupComplete` is the ONLY export of `catalogue/packs/` that code outside
// Setup (e.g. the item editor, "food setup never completed") may import — it
// reads completion only, never the source and never which pack.
// `readSetupState` is for Setup. Both enforced by applied-preset-guard.test.ts.

import { legacyPresetRecord } from './history'

export type SetupSource = 'empty' | 'pack' | 'manual'
const SOURCES: readonly SetupSource[] = ['empty', 'pack', 'manual']

type ConfigLike = { setupCompletedAt?: unknown; setupSource?: unknown } | null | undefined

/**
 * GROQ projection (inside the Catalogue installation object) of the legacy preset record, read by
 * Setup's settings reader under the neutral name `legacySetup`; pass the value as `legacy` below.
 */
export const LEGACY_SETUP_PROJECTION = /* groq */ `"legacySetup": appliedPreset`

/** Shown for a legacy record without a usable date (completion is what matters, D-14). */
const LEGACY_WITHOUT_DATE = '1970-01-01T00:00:00.000Z'

const validDate = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v))

const completedAt = (config: ConfigLike, legacy: unknown): { at: string; legacy: boolean } | null => {
  const v = config?.setupCompletedAt
  if (validDate(v)) return { at: v, legacy: false }
  const rec = legacyPresetRecord(legacy)
  if (!rec) return null
  return { at: validDate(rec.appliedAt) ? rec.appliedAt : LEGACY_WITHOUT_DATE, legacy: true }
}

/** True when Catalogue setup was completed (any way, a valid legacy preset record included). */
export function isSetupComplete(config: ConfigLike, legacy?: unknown): boolean {
  return completedAt(config, legacy) !== null
}

/** Setup only: when and how setup was completed (a legacy preset record reads as source 'pack'). */
export function readSetupState(config: ConfigLike, legacy?: unknown): { completedAt: string | null; source: SetupSource | null } {
  const c = completedAt(config, legacy)
  if (!c) return { completedAt: null, source: null }
  if (c.legacy) return { completedAt: c.at, source: 'pack' }
  const s = config?.setupSource
  return { completedAt: c.at, source: (SOURCES as readonly unknown[]).includes(s) ? (s as SetupSource) : null }
}
