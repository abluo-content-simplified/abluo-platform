// ── Catalogue public name (contract C11, Tom's D-12) ─────────────────────────
//
// Pure. The tenant's own word for the catalogue on the WEBSITE (Menu, Books,
// Wine list…), stored as the localized module-config field `publicName`. The
// dashboard never shows it: the dashboard always says "Catalogue" (interface
// dictionary, K-2).
//
// R1 (C11 R-A1) ships the reader and the pure migration/validation functions
// only — there is NO public consumer yet (landing-title fallback and the
// llms.txt heading arrive with data step D4, C11 R-B), so website output is
// byte-identical.
//
// Fallback: locale → default locale → nothing. Never another locale (that
// would print Italian on the German site) and never the literal "Catalogue".

export type PublicNameSource = 'locale' | 'default_locale' | 'none'
export type PublicNames = Readonly<Record<string, string | undefined>>

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Non-empty trimmed values per locale; `_type`, `translationStatus` and blanks dropped. */
export function publicNameMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith('_') || k === 'translationStatus') continue
    const t = textOf(x)
    if (t) out[k] = t
  }
  return out
}

/** names[locale] → names[defaultLocale] → { text: null, source: 'none' }. */
export function resolvePublicName(
  names: PublicNames | null | undefined,
  ctx: { locale: string; defaultLocale: string },
): { text: string | null; source: PublicNameSource } {
  const n = publicNameMap(names)
  if (n[ctx.locale]) return { text: n[ctx.locale], source: 'locale' }
  if (n[ctx.defaultLocale]) return { text: n[ctx.defaultLocale], source: 'default_locale' }
  return { text: null, source: 'none' }
}

/** The reader over module config (Setup → Public website; later the C11 R-B consumers). */
export function publicNameOf(config: { publicName?: unknown } | null | undefined, ctx: { locale: string; defaultLocale: string }): string | null {
  return resolvePublicName(publicNameMap(config?.publicName), ctx).text
}

// ── data step D4 (C11.5) ─────────────────────────────────────────────────────

export type PublicNameMigrationPlan =
  | { action: 'none' }
  | { action: 'copy'; publicName: Record<string, string>; unset: ['navLabel'] }
  | { action: 'drop'; unset: ['navLabel']; discarded: Record<string, string> }

/**
 * K-2 exactly: a non-empty `navLabel` is copied (every non-empty locale, trimmed — also
 * locales the site does not enable) when `publicName` has no non-empty value; otherwise it
 * is dropped and its values recorded as discarded. A blank/absent `navLabel` is 'none'.
 */
export function planPublicNameMigration(config: { navLabel?: unknown; publicName?: unknown }): PublicNameMigrationPlan {
  const nav = publicNameMap(config?.navLabel)
  if (Object.keys(nav).length === 0) return { action: 'none' }
  if (Object.keys(publicNameMap(config?.publicName)).length === 0) return { action: 'copy', publicName: nav, unset: ['navLabel'] }
  return { action: 'drop', unset: ['navLabel'], discarded: nav }
}

// ── write validation (C11.2; readers stay tolerant) ──────────────────────────

export const PUBLIC_NAME_MAX = 40
export type PublicNameIssueCode = 'public_name_default_required' | 'public_name_too_long' | 'public_name_invalid' | 'public_name_locale_unknown'
export type PublicNameIssue = { code: PublicNameIssueCode; locale?: string }

const LEADING_OR_TRAILING_PUNCTUATION = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u

/** Save-time validation. An empty map is valid (= not set). */
export function publicNameIssues(names: unknown, ctx: { defaultLocale: string; locales: readonly string[] }): PublicNameIssue[] {
  const issues: PublicNameIssue[] = []
  const raw = names && typeof names === 'object' && !Array.isArray(names) ? (names as Record<string, unknown>) : {}
  const given = Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && k !== 'translationStatus' && textOf(v) !== '')
  if (given.length === 0) return issues
  if (!given.some(([k]) => k === ctx.defaultLocale)) issues.push({ code: 'public_name_default_required', locale: ctx.defaultLocale })
  for (const [locale, v] of given) {
    const t = textOf(v)
    if (!ctx.locales.includes(locale)) issues.push({ code: 'public_name_locale_unknown', locale })
    if (t.length > PUBLIC_NAME_MAX) issues.push({ code: 'public_name_too_long', locale })
    if (/[<>]/.test(t) || LEADING_OR_TRAILING_PUNCTUATION.test(t)) issues.push({ code: 'public_name_invalid', locale })
  }
  return issues
}
