// ── Module config — named validators and change guards ────────────────────────
//
// A manifest field names a rule by id (`validator`, `changeGuard`, types.ts);
// this file is where an id resolves to code. The Modules pane (ModuleList.tsx)
// is the only consumer and knows no module: it loads the data a rule `needs`,
// asks the rule, and renders the answer. The next module that needs a
// project-aware rule adds one entry here and one id in its manifest.
//
// Pure apart from `loadConfigData`, which takes any `{ fetch }` (the Sanity
// client in the Studio, a stub in tests). Admin UI text is English (CLAUDE.md
// exception); the wording mirrors messages `catalogue.segment.*` / `.currency.*`.

import {
  CURRENCY_ITEM_PRICES_QUERY,
  CURRENCY_OPTION_DELTAS_QUERY,
  currencyChangeNeedsConfirmation,
  currencyChanged,
  currencyImpact,
  type ItemPriceRow,
  type OptionListRow,
} from './catalogue/validation'
import { applySegmentChange, validateSegment, type SegmentClash } from './catalogue/segment'
import { normalise } from './catalogue/slugs'
import { presetValues } from './presets'
import type { ModuleConfigFieldDef, ModuleStarterPreset } from './types'

// ── Project data a rule may need ──────────────────────────────────────────────

export type PageSlugRow = { _id?: string; slug?: unknown }

export type ConfigData = {
  pageSlugs?: PageSlugRow[]
  itemPrices?: ItemPriceRow[]
  optionDeltas?: OptionListRow[]
}
export type ConfigDataKey = keyof ConfigData

export const CONFIG_DATA_SOURCES: Readonly<Record<ConfigDataKey, { query: string }>> = {
  // Raw perspective in the Studio, so draft-only pages count too.
  pageSlugs: { query: `*[_type == "page" && projectSlug == $projectSlug]{ _id, slug }` },
  itemPrices: { query: CURRENCY_ITEM_PRICES_QUERY },
  optionDeltas: { query: CURRENCY_OPTION_DELTAS_QUERY },
}

export type ConfigFetcher = { fetch: <T>(query: string, params: Record<string, unknown>) => Promise<T> }

/** Fetches the requested sources, always scoped by `projectSlug`. */
export async function loadConfigData(
  client: ConfigFetcher,
  keys: Iterable<ConfigDataKey>,
  projectSlug: string,
): Promise<ConfigData> {
  const unique = [...new Set(keys)]
  const rows = await Promise.all(
    unique.map((k) => client.fetch<unknown[]>(CONFIG_DATA_SOURCES[k].query, { projectSlug })),
  )
  const out: Record<string, unknown> = {}
  unique.forEach((k, i) => (out[k] = rows[i] ?? []))
  return out as ConfigData
}

/** First path segment of every page slug, all locales (accepts `{ en: { current } }` or plain strings). */
export function pageFirstSegments(rows: readonly PageSlugRow[] | undefined): string[] {
  const out = new Set<string>()
  for (const row of rows ?? []) {
    const slug = row.slug
    const values: unknown[] =
      typeof slug === 'string' ? [slug] : slug && typeof slug === 'object' ? Object.values(slug as object) : []
    for (const v of values) {
      const current = typeof v === 'string' ? v : (v as { current?: unknown } | null)?.current
      if (typeof current !== 'string') continue
      const first = normalise(current).split('/')[0]
      if (first) out.add(first)
    }
  }
  return [...out]
}

// ── Field validators ──────────────────────────────────────────────────────────

export type FieldValidationContext = {
  field: ModuleConfigFieldDef
  value: unknown
  /** Every current form value (including hidden, module-written ones). */
  values: Record<string, unknown>
  /** The saved config, undefined before first install. */
  stored: Record<string, unknown> | undefined
  data: ConfigData
}

export type FieldValidationResult = { error: string | null; notice: string | null }

export type FieldValidator = {
  needs: readonly ConfigDataKey[]
  validate(ctx: FieldValidationContext): FieldValidationResult
  /** Extra config values written alongside this field on save (e.g. its history). */
  persist?(ctx: FieldValidationContext): Record<string, unknown>
}

const OK: FieldValidationResult = { error: null, notice: null }

export function segmentClashMessage(clash: SegmentClash): string {
  switch (clash.kind) {
    case 'empty':
      return 'Choose a web address for your catalogue.'
    case 'tooLong':
      return `That address is too long. Use ${clash.max} characters or fewer.`
    case 'invalidSyntax':
      return `"${clash.value}" is not a valid address. Use lowercase letters, numbers and single hyphens only.`
    case 'reserved':
      return `"${clash.value}" is already used by the website. Choose another word.`
    case 'pageSlug':
      return `"${clash.value}" is already the start of one of your pages. Choose another word or rename that page.`
  }
}

export const segmentRevertNotice = (value: string) =>
  `"${value}" was used before. Using it again stops its redirect.`

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The history field is declared by the manifest as `<field id>History`. */
const historyId = (fieldId: string) => `${fieldId}History`

const publicSegmentValidator: FieldValidator = {
  needs: ['pageSlugs'],
  validate({ field, value, stored, data }) {
    const next = str(value).trim()
    // An empty value is `required`'s business, and an unchanged saved value is
    // never re-litigated: a page created later cannot trap the admin in
    // unrelated saves (the page side is guarded by pageSlugShadowsSegment).
    if (!next) return OK
    if (stored && normalise(str(stored[field.id])) === normalise(next)) return OK
    const history = strList(stored?.[historyId(field.id)])
    const r = validateSegment(next, { pageFirstSegments: pageFirstSegments(data.pageSlugs), history })
    if (!r.ok) return { error: segmentClashMessage(r.clash), notice: null }
    return { error: null, notice: r.revert ? segmentRevertNotice(r.segment) : null }
  },
  persist({ field, value, stored }) {
    const r = applySegmentChange(
      str(stored?.[field.id]),
      strList(stored?.[historyId(field.id)]),
      str(value),
    )
    return { [field.id]: r.segment, [historyId(field.id)]: r.history }
  },
}

export const FIELD_VALIDATORS: Readonly<Record<string, FieldValidator>> = {
  'catalogue.publicSegment': publicSegmentValidator,
}

export function resolveFieldValidator(id: string | undefined): FieldValidator | null {
  return id ? (FIELD_VALIDATORS[id] ?? null) : null
}

// ── Change guards ─────────────────────────────────────────────────────────────

export type ChangeGuardResult = {
  /** Shown to the admin before the change is saved. */
  lines: string[]
  confirmLabel: string
}

export type ChangeGuard = {
  needs: readonly ConfigDataKey[]
  /** null = the change is harmless, no confirmation. Never converts anything. */
  evaluate(ctx: { from: unknown; to: unknown; data: ConfigData }): ChangeGuardResult | null
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`

const currencyChangeGuard: ChangeGuard = {
  needs: ['itemPrices', 'optionDeltas'],
  evaluate({ from, to, data }) {
    if (!currencyChanged(str(from), str(to))) return null
    const impact = currencyImpact(data.itemPrices ?? [], data.optionDeltas ?? [])
    if (!currencyChangeNeedsConfirmation(impact)) return null
    const lines = [
      `${plural(impact.prices, 'price', 'prices')} across ${plural(impact.items, 'item', 'items')} will be read as ${str(to).toUpperCase()}. No amounts are converted.`,
    ]
    if (impact.optionDeltas > 0) {
      lines.push(`Also ${plural(impact.optionDeltas, 'option price change', 'option price changes')}.`)
    }
    return { lines, confirmLabel: 'Change currency' }
  },
}

export const CHANGE_GUARDS: Readonly<Record<string, ChangeGuard>> = {
  'catalogue.currencyChange': currencyChangeGuard,
}

export function resolveChangeGuard(id: string | undefined): ChangeGuard | null {
  return id ? (CHANGE_GUARDS[id] ?? null) : null
}

export type PendingGuard = {
  fieldId: string
  /** Identity of this exact change; a confirmation only covers the change it was given for. */
  key: string
  result: ChangeGuardResult
}

/**
 * Guards a save would trip. Only a field that already has a saved value and now
 * differs from it is guarded: first configuration changes nothing that exists.
 */
export function pendingGuards(
  schema: readonly ModuleConfigFieldDef[],
  values: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  data: ConfigData,
): PendingGuard[] {
  const out: PendingGuard[] = []
  if (!stored) return out
  for (const field of schema) {
    const guard = resolveChangeGuard(field.changeGuard)
    if (!guard) continue
    const from = stored[field.id]
    const to = values[field.id]
    if (from === undefined || from === null || from === '' || from === to) continue
    const result = guard.evaluate({ from, to, data })
    if (result) out.push({ fieldId: field.id, key: `${field.id}:${String(from)}>${String(to)}`, result })
  }
  return out
}

/** Data keys the manifest's validators and guards need. */
export function configDataNeeds(schema: readonly ModuleConfigFieldDef[], opts: { guards: boolean }): ConfigDataKey[] {
  const keys = new Set<ConfigDataKey>()
  for (const f of schema) {
    resolveFieldValidator(f.validator)?.needs.forEach((k) => keys.add(k))
    if (opts.guards) resolveChangeGuard(f.changeGuard)?.needs.forEach((k) => keys.add(k))
  }
  return [...keys]
}

/** Extra values validators persist alongside their fields (segment history, …). */
export function persistedExtras(
  schema: readonly ModuleConfigFieldDef[],
  values: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  data: ConfigData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema) {
    const v = resolveFieldValidator(field.validator)
    if (!v?.persist) continue
    Object.assign(out, v.persist({ field, value: values[field.id], values, stored, data }))
  }
  return out
}

// ── Starter presets × named validators ───────────────────────────────────────

/**
 * Errors the manifest's named validators raise for the values a preset would
 * write (e.g. a publicSegment that clashes with a page or a reserved word).
 * A non-empty result blocks applying the preset. `current` is the form's values.
 */
export function presetValidatorErrors(
  preset: ModuleStarterPreset,
  schema: readonly ModuleConfigFieldDef[],
  current: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  data: ConfigData,
  locales: readonly string[],
): { fieldId: string; error: string }[] {
  const written = presetValues(preset, schema, locales)
  const values = { ...current, ...written }
  const out: { fieldId: string; error: string }[] = []
  for (const [fieldId, value] of Object.entries(written)) {
    const field = schema.find((f) => f.id === fieldId)
    const validator = resolveFieldValidator(field?.validator)
    if (!field || !validator) continue
    const r = validator.validate({ field, value, values, stored, data })
    if (r.error) out.push({ fieldId, error: r.error })
  }
  return out
}
