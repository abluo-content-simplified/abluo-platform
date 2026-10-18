// Pure rules for saving ONE module installation from the Studio Modules pane
// (ModuleList.tsx) — kept free of Studio imports so they are unit-testable.
//
// Why this exists: the pane used to save with
// `insert('replace', moduleInstallations[moduleId=="x"], [wholeEntry])` and no
// revision guard. The client dashboard now also writes into a module's config
// (e.g. the Catalogue's affiliate disclosure, Settings page). With a whole-entry
// replace, pressing Save in an old pane silently restored the dashboard's old
// value (and the reverse). Two protections, both here:
//   1. key-level patches: only the fields that actually changed are set/unset,
//      addressed by the entry's `_key`, so untouched config keys keep whatever
//      someone else wrote meanwhile;
//   2. the caller commits with `ifRevisionId` of the project document it
//      loaded, so a concurrent write fails (409) instead of being overwritten,
//      and the pane tells the admin to reload.

export type InstallationLike = {
  _key?: string
  moduleId: string
  version?: string
  enabled?: boolean
  installedAt?: string
  provenance?: string
  appliedPreset?: unknown
  config?: Record<string, unknown>
}

export type InstallationPatch = {
  /** Replace the whole entry (it does not exist yet, or has no usable config object). */
  append?: InstallationLike
  set: Record<string, unknown>
  unset: string[]
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Sanity path of one entry of `moduleInstallations`: by `_key` when it has one, else by module id. */
export function installationSelector(entry: Pick<InstallationLike, '_key' | 'moduleId'>): string {
  return entry._key ? `moduleInstallations[_key=="${entry._key}"]` : `moduleInstallations[moduleId=="${entry.moduleId}"]`
}

const TOP_LEVEL = ['enabled', 'version', 'installedAt', 'provenance', 'appliedPreset'] as const

/**
 * What to write so that `before` becomes `after`, touching nothing else.
 * `before` is the entry as the pane loaded it (undefined = not installed yet).
 */
export function buildInstallationPatch(before: InstallationLike | undefined, after: InstallationLike): InstallationPatch {
  if (!before) return { append: after, set: {}, unset: [] }
  const base = installationSelector(before)
  const set: Record<string, unknown> = {}
  const unset: string[] = []

  for (const k of TOP_LEVEL) {
    if (same(before[k], after[k])) continue
    if (after[k] === undefined) unset.push(`${base}.${k}`)
    else set[`${base}.${k}`] = after[k]
  }

  if (!before.config || typeof before.config !== 'object') {
    if (after.config) set[`${base}.config`] = after.config
  } else {
    const next = after.config ?? {}
    for (const [k, v] of Object.entries(next)) {
      if (!same(before.config[k], v)) set[`${base}.config.${k}`] = v
    }
    for (const k of Object.keys(before.config)) {
      if (!(k in next) || next[k] === undefined) unset.push(`${base}.config.${k}`)
    }
  }
  return { set, unset }
}

/** True when nothing needs writing. */
export const isEmptyPatch = (p: InstallationPatch): boolean => !p.append && Object.keys(p.set).length === 0 && p.unset.length === 0

/** A Sanity "document was changed" failure (revision mismatch). */
export function isRevisionConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return e?.statusCode === 409 || e?.response?.statusCode === 409 || /revision/i.test(String(e?.message ?? ''))
}

export const CONFLICT_MESSAGE = 'This was changed elsewhere. Reload the pane to see the latest, then make your change again.'
