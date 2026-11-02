// ── Catalogue packs — history types (contract C7.2 / C7.5) ───────────────────
// R1 ships the history READER only; declarations, planning and application
// (C7.2–C7.8) arrive with Setup (R2). Pack identity is installation history:
// only Setup may read it (C7.9 guard, applied-preset-guard.test.ts).

export type PackId = 'pizzeria' | 'traditional-restaurant' | 'fine-dining' | 'cafe-and-bar' | 'wine-bar' | 'empty' | 'bookshop'

/**
 * Ids that exist only in legacy `appliedPreset` records (D-1 starter presets):
 * the history reader surfaces them unchanged so nothing is lost; no pack carries them.
 */
export type LegacyPresetId = 'restaurant'

export type AppliedPackAdded = {
  categories: string[]
  tags: string[]
  collections: string[]
  sections: string[]
  optionGroups: string[]
  channels: string[]
  formats: string[]
  settings: string[]
}

export type AppliedPackRecord = {
  /** `${id}@${version}` — one entry per pack version. */
  _key: string
  id: PackId | LegacyPresetId
  version: number
  appliedAt: string
  /** User id, or 'migration' for a converted legacy record. */
  appliedBy: string
  /** Keys only. */
  added: AppliedPackAdded
  /** packKey -> existing key chosen by the person ("category:dolci": "desserts"). */
  mapped: Record<string, string>
  /** "<area>:<key>" unticked or not applicable. */
  skipped: string[]
}

/** A record as the reader returns it: stored, or the legacy `appliedPreset` read virtually (until D3 converts it). */
export type PackHistoryEntry = AppliedPackRecord & { source: 'history' | 'legacyPreset' }
