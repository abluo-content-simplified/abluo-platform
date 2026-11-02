// ── Catalogue pack history — reader (contracts C7.5, C7.6 D3, C10-6 R1) ──────
//
// Pure. Reads `cataloguePackHistory` (`catalogue-packs.<projectSlug>`), and —
// until data step D3 converts it — the legacy installation record
// `appliedPreset {id, version, appliedAt}` as a VIRTUAL entry `<id>@<version>`
// (tmz: `bookshop@1`). D3 then only makes that entry permanent, so Setup sees
// the same history before and after the migration.
//
// ⚠️ Installation history. Only Setup (and this folder) may import this file —
// enforced by applied-preset-guard.test.ts. The item editor may read whether
// setup was completed (setup-state.ts), never which pack was applied.

import { SLUG_PART_PATTERN } from '@/lib/taxonomy/ids'
import type { AppliedPackAdded, AppliedPackRecord, PackHistoryEntry } from './types'

export const PACK_HISTORY_TYPE = 'cataloguePackHistory'
export const PACK_HISTORY_ID_PREFIX = 'catalogue-packs.'

/** Deterministic id of a project's history document. Throws on an invalid slug. */
export function packHistoryId(projectSlug: string): string {
  if (!SLUG_PART_PATTERN.test(projectSlug ?? '')) throw new Error(`packHistoryId: invalid projectSlug "${projectSlug}"`)
  return `${PACK_HISTORY_ID_PREFIX}${projectSlug}`
}

/** Both sources in one project-scoped read (Setup). */
export const PACK_HISTORY_QUERY = /* groq */ `{
  "applied": *[_type == "${PACK_HISTORY_TYPE}" && _id == "${PACK_HISTORY_ID_PREFIX}" + $projectSlug && projectSlug == $projectSlug][0].applied,
  "appliedPreset": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "catalogue"][0].appliedPreset
}`

/**
 * The config keys each legacy starter preset wrote (D3: "the preset's config keys,
 * never currency"). Read from the presets as they were: bookshop set the segment and
 * the default profile; restaurant also created its two channels.
 */
const LEGACY_PRESET_ADDED: Record<string, Partial<AppliedPackAdded>> = {
  bookshop: { settings: ['publicSegment', 'defaultItemProfile'] },
  restaurant: { settings: ['publicSegment', 'defaultItemProfile'], channels: ['dine-in', 'takeaway'] },
}

const emptyAdded = (): AppliedPackAdded => ({ categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: [] })
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function readAdded(v: unknown): AppliedPackAdded {
  const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out = emptyAdded()
  for (const k of Object.keys(out) as (keyof AppliedPackAdded)[]) out[k] = strings(a[k])
  return out
}

/** Stored `mapped` rows ({from, to}) or a plain map → record. */
function readMapped(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(v)) {
    for (const row of v) {
      const r = row as { from?: unknown; to?: unknown } | null
      if (typeof r?.from === 'string' && r.from && typeof r.to === 'string' && r.to) out[r.from] = r.to
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('_') && typeof x === 'string' && x) out[k] = x
  }
  return out
}

function readRecord(row: unknown): AppliedPackRecord | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  const version = typeof r.version === 'number' && Number.isInteger(r.version) && r.version > 0 ? r.version : null
  if (!PACK_ID.test(id) || version === null) return null
  return {
    _key: `${id}@${version}`,
    id: id as AppliedPackRecord['id'],
    version,
    appliedAt: typeof r.appliedAt === 'string' ? r.appliedAt : '',
    appliedBy: typeof r.appliedBy === 'string' ? r.appliedBy : '',
    added: readAdded(r.added),
    mapped: readMapped(r.mapped),
    skipped: strings(r.skipped),
  }
}

/** The legacy record as the virtual history entry D3 will write (`appliedBy: 'migration'`). */
export function legacyPresetRecord(appliedPreset: unknown): AppliedPackRecord | null {
  if (!appliedPreset || typeof appliedPreset !== 'object') return null
  const p = appliedPreset as { id?: unknown; version?: unknown; appliedAt?: unknown }
  const base = readRecord({ id: p.id, version: p.version, appliedAt: p.appliedAt, appliedBy: 'migration' })
  if (!base) return null
  return { ...base, added: { ...emptyAdded(), ...(LEGACY_PRESET_ADDED[base.id] ?? {}) } }
}

/**
 * The project's pack history, oldest first: every stored entry (first per `_key`), plus
 * the legacy `appliedPreset` as a virtual entry unless the history already holds that
 * `<id>@<version>` (D3 done). Tolerant: malformed entries are skipped, never thrown.
 */
export function readPackHistory(input: { applied?: unknown; appliedPreset?: unknown } | null | undefined): PackHistoryEntry[] {
  const out: PackHistoryEntry[] = []
  for (const row of Array.isArray(input?.applied) ? input!.applied : []) {
    const r = readRecord(row)
    if (r && !out.some((x) => x._key === r._key)) out.push({ ...r, source: 'history' })
  }
  const legacy = legacyPresetRecord(input?.appliedPreset)
  if (legacy && !out.some((x) => x._key === legacy._key)) out.unshift({ ...legacy, source: 'legacyPreset' })
  return out.sort((a, b) => (a.appliedAt && b.appliedAt && a.appliedAt !== b.appliedAt ? (a.appliedAt < b.appliedAt ? -1 : 1) : 0))
}

/** Highest applied version of a pack id, or null (Setup's update offer, C7.6). */
export function highestAppliedVersion(history: readonly AppliedPackRecord[], id: string): number | null {
  const versions = history.filter((h) => h.id === id).map((h) => h.version)
  return versions.length ? Math.max(...versions) : null
}
