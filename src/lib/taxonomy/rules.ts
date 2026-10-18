// ── Taxonomy rules ────────────────────────────────────────────────────────────
// ADR-033 Amendment J (J-4). Pure — no React, no I/O. The dashboard service
// (slice 3) calls these before every write; the Studio schema reuses the key
// and id rules.

import { slugifySubjectValue } from '@/lib/modules/whatsapp/form-sync'
import { isValidTermKey, isTermKind, TERM_KEY_MAX_LENGTH, type TermKind } from './ids'

export const MAX_LABEL_LENGTH = 80
export const MAX_TERMS_PER_KIND = 200
/** Order values are spaced so a reorder can insert without renumbering. */
export const ORDER_STEP = 1000

/** The slice of a manifest `taxonomies` entry the rules need. */
export type TaxonomyDeclarationLike = { kind: TermKind }

/**
 * Modules whose category terms are public pages (blog: /category/<key>). Only
 * these show description / redirectFrom / noindex. News has no category pages
 * (its listing filters in place), so its terms carry label and colour only.
 * Replaced by the manifest's `routable` flag when modules opt in.
 */
export const ROUTABLE_TERM_MODULES: readonly string[] = ['blog']

export function termIsRoutable(module: string, kind: TermKind): boolean {
  return kind === 'category' && ROUTABLE_TERM_MODULES.includes(module)
}

export function isKindDeclared(declarations: readonly TaxonomyDeclarationLike[] | undefined, kind: unknown): boolean {
  return isTermKind(kind) && (declarations ?? []).some((d) => d.kind === kind)
}

export type Labels = Record<string, string | undefined>

function hasLatinContent(label: string): boolean {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') !== ''
}

/**
 * Key for a new term, from its DEFAULT-language label. Reuses the vocabulary
 * slugifier, so a key derived here is identical to the one the Modules pane
 * would have produced. A collision with `existingKeys` gets a numeric suffix
 * (`_2`, `_3`, …). A label with no latin letters or digits falls back to "term".
 * The result is always a valid term key.
 */
export function deriveTermKey(defaultLabel: string, existingKeys: readonly string[] = []): string {
  const text = hasLatinContent(defaultLabel) ? defaultLabel : 'term'
  // Reserve room for a collision suffix so the key never exceeds the limit.
  const key = slugifySubjectValue(text, [...existingKeys])
  return key.length <= TERM_KEY_MAX_LENGTH ? key : key.slice(0, TERM_KEY_MAX_LENGTH).replace(/[_-]+$/, '')
}

/**
 * Key for a new term of a module whose terms are public pages (blog categories:
 * /category/<key>). Same derivation, but words are joined with "-" like every
 * URL on the old site (`prendersi-cura-di-se`), not "_". Collisions are checked
 * in both spellings; the suffix is `-2`, `-3`, …. Always a valid term key.
 */
export function deriveRoutableTermKey(defaultLabel: string, existingKeys: readonly string[] = []): string {
  const underscored = existingKeys.map((k) => k.replace(/-/g, '_'))
  return deriveTermKey(defaultLabel, underscored).replace(/_/g, '-')
}

export type RuleIssue = { code: string; message: string }

/** Keys never change once set — renaming a label must not move references. */
export function keyChangeIssue(existingKey: string, nextKey: string | undefined): RuleIssue | null {
  if (nextKey === undefined || nextKey === existingKey) return null
  return { code: 'key-immutable', message: 'A term key cannot be changed after the term is created.' }
}

/** The default-language label is required; every label is trimmed-length bounded. */
export function labelIssues(labels: Labels | undefined, defaultLocale: string): RuleIssue[] {
  const issues: RuleIssue[] = []
  const l = labels ?? {}
  if (!(l[defaultLocale] ?? '').trim()) {
    issues.push({ code: 'label-required', message: `A label in the default language (${defaultLocale}) is required.` })
  }
  for (const [locale, value] of Object.entries(l)) {
    if (typeof value === 'string' && value.trim().length > MAX_LABEL_LENGTH) {
      issues.push({ code: 'label-too-long', message: `The ${locale} label is longer than ${MAX_LABEL_LENGTH} characters.` })
    }
  }
  return issues
}

export function termLimitIssue(currentCountOfKind: number): RuleIssue | null {
  return currentCountOfKind >= MAX_TERMS_PER_KIND
    ? { code: 'too-many-terms', message: `A module can have at most ${MAX_TERMS_PER_KIND} terms of one kind.` }
    : null
}

export function keyIssue(key: unknown): RuleIssue | null {
  return isValidTermKey(key) ? null : { code: 'key-invalid', message: 'The key must be lowercase letters, digits, "_" or "-".' }
}

/** Order for a term appended after the current maximum (gaps of ORDER_STEP). */
export function nextOrder(existingOrders: readonly number[]): number {
  const finite = existingOrders.filter((n) => Number.isFinite(n))
  return finite.length === 0 ? ORDER_STEP : Math.max(...finite) + ORDER_STEP
}
