// ── Module starter presets (ADR-033 Amendment D-1) ────────────────────────────
//
// A manifest may declare `platformContract.starterPresets`: named, versioned
// bundles of configuration offered ONCE, when the module is first enabled on a
// website. Selecting one is explicit; "No preset" is the default. Generic by
// design — the Modules pane knows no module, and a preset is only data that
// must pass the same field rules as an admin's own input (validated at build
// time by validate.ts Rule 14 and by test).
//
// Only the INSTALL FLOW reads `appliedPreset` (the record that makes applying
// idempotent). After installation, behaviour depends solely on configuration —
// enforced by applied-preset-guard.test.ts.
//
// Pure — no React, no Sanity, no project data.

import type {
  AppliedPreset,
  ModuleConfigFieldDef,
  ModuleConfigListEntry,
  ModuleStarterPreset,
} from './types'

// ── Declaration validation (build time) ───────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isLocalizedMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.keys(v).length > 0 && Object.values(v).every((s) => typeof s === 'string')

/**
 * Why `value` is not acceptable for `field`, or null. The same shape rules the
 * Modules pane enforces on an admin's input (types, select options, localized
 * list shape, declared regex). Named validators (segment clashes) need project
 * data and run at apply time instead (config-validators.presetValidatorErrors).
 */
export function presetValueError(field: ModuleConfigFieldDef, value: unknown): string | null {
  if (field.hidden) return 'is module-written and cannot be set by a preset'
  switch (field.type) {
    case 'string':
    case 'text':
      if (typeof value !== 'string' || value.trim() === '') return 'must be a non-empty string'
      if (field.validation && !new RegExp(field.validation.regex).test(value)) return field.validation.message
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number'
    case 'select':
      return typeof value === 'string' && (field.options ?? []).some((o) => o.value === value)
        ? null
        : `must be one of: ${(field.options ?? []).map((o) => o.value).join(', ')}`
    case 'localizedString':
      return isLocalizedMap(value) ? null : 'must be a map of locale to string'
    case 'stringList':
      return Array.isArray(value) && value.every((s) => typeof s === 'string') ? null : 'must be a list of strings'
    case 'localizedStringList': {
      if (!Array.isArray(value)) return 'must be a list of entries'
      const seen = new Set<string>()
      for (const e of value) {
        if (!isRecord(e) || typeof e.value !== 'string' || e.value.trim() === '' || !isLocalizedMap(e.label)) {
          return 'entries need a non-empty value and a label map of locale to string'
        }
        if (seen.has(e.value)) return `repeats the entry value "${e.value}"`
        seen.add(e.value)
      }
      return null
    }
    case 'reference':
      return 'is a reference; presets cannot set references'
  }
}

/** Every problem with one preset against the module's configSchema. */
export function presetDeclarationErrors(
  preset: ModuleStarterPreset,
  schema: readonly ModuleConfigFieldDef[],
): string[] {
  const errors: string[] = []
  if (!preset.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.id)) errors.push('id must be non-empty lowercase kebab-case')
  if (!Number.isInteger(preset.version) || preset.version < 1) errors.push('version must be a positive integer')
  if (!preset.label || preset.label.trim() === '') errors.push('label must not be empty')
  if (!isRecord(preset.config) || Object.keys(preset.config).length === 0) {
    errors.push('config must set at least one field')
    return errors
  }
  for (const [key, value] of Object.entries(preset.config)) {
    const field = schema.find((f) => f.id === key)
    if (!field) {
      errors.push(`config key "${key}" is not a field in configSchema`)
      continue
    }
    const why = presetValueError(field, value)
    if (why) errors.push(`config.${key} ${why}`)
  }
  return errors
}

// ── Applying (install flow) ───────────────────────────────────────────────────

const restrict = (map: Record<string, string>, locales: readonly string[]): Record<string, string> =>
  locales.length === 0 ? { ...map } : Object.fromEntries(Object.entries(map).filter(([l]) => locales.includes(l)))

/**
 * The preset's config as it will be written: localized labels restricted to the
 * website's locales (all kept when locales are unknown), list entries given
 * deterministic keys.
 */
export function presetValues(
  preset: ModuleStarterPreset,
  schema: readonly ModuleConfigFieldDef[],
  locales: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(preset.config)) {
    const field = schema.find((f) => f.id === key)
    if (field?.type === 'localizedString') {
      out[key] = restrict(value as Record<string, string>, locales)
    } else if (field?.type === 'localizedStringList') {
      out[key] = (value as { value: string; label: Record<string, string>; color?: string }[]).map(
        (e): ModuleConfigListEntry => ({
          _key: `preset-${e.value}`,
          value: e.value,
          label: restrict(e.label, locales),
          ...(e.color ? { color: e.color } : {}),
        }),
      )
    } else {
      out[key] = Array.isArray(value) ? [...value] : value
    }
  }
  return out
}

export type PresetPreviewRow = {
  fieldId: string
  label: string
  /** What will be written, human-readable. */
  to: string
  /** What the form holds now, when it differs (will be replaced). */
  from: string | null
}

const isEmptyValue = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isRecord(v) && Object.keys(v).length === 0)

export function displayValue(field: ModuleConfigFieldDef, value: unknown): string {
  if (isEmptyValue(value)) return 'empty'
  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'select':
      return (field.options ?? []).find((o) => o.value === value)?.label ?? String(value)
    case 'localizedString':
      return Object.entries(value as Record<string, string>)
        .map(([l, s]) => `${l.toUpperCase()}: ${s}`)
        .join(' · ')
    case 'localizedStringList':
      return (value as ModuleConfigListEntry[])
        .map((e) => `${e.value} (${Object.values(e.label).join(' / ')})`)
        .join(', ')
    case 'stringList':
      return (value as string[]).join(', ')
    default:
      return String(value)
  }
}

/** Exactly what applying the preset would write, against the form's current values. */
export function previewPreset(
  preset: ModuleStarterPreset,
  schema: readonly ModuleConfigFieldDef[],
  current: Record<string, unknown>,
  locales: readonly string[],
): PresetPreviewRow[] {
  const written = presetValues(preset, schema, locales)
  return Object.entries(written).map(([fieldId, to]) => {
    const field = schema.find((f) => f.id === fieldId)!
    const before = current[fieldId]
    const same = JSON.stringify(before) === JSON.stringify(to)
    return {
      fieldId,
      label: field.label,
      to: displayValue(field, to),
      from: isEmptyValue(before) || same ? null : displayValue(field, before),
    }
  })
}

export type PresetApplication = {
  values: Record<string, unknown>
  /** The record to store on the installation; unchanged when nothing was applied. */
  appliedPreset: AppliedPreset | undefined
  applied: boolean
}

/**
 * Apply `preset` at install. Idempotent and once-only: an installation that
 * already records an applied preset is returned untouched (same id+version on a
 * retry, anything else on a later save or upgrade).
 */
export function applyPreset(
  preset: ModuleStarterPreset,
  schema: readonly ModuleConfigFieldDef[],
  values: Record<string, unknown>,
  locales: readonly string[],
  existing: AppliedPreset | undefined,
  now: () => string = () => new Date().toISOString(),
): PresetApplication {
  if (existing) return { values, appliedPreset: existing, applied: false }
  return {
    values: { ...values, ...presetValues(preset, schema, locales) },
    appliedPreset: { id: preset.id, version: preset.version, appliedAt: now() },
    applied: true,
  }
}
