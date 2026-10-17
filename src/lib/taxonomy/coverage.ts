// ── Translation coverage ──────────────────────────────────────────────────────
// ADR-033 Amendment J (J-6). Pure. Derived, never stored: adding a language
// needs no data change — existing terms simply show it as missing.

export type LocaleCoverage = { locale: string; complete: boolean }

export type TranslationCoverage = {
  perLocale: LocaleCoverage[]
  missing: string[]
  completeCount: number
  total: number
  /** True when every enabled locale has a label. */
  isComplete: boolean
}

/**
 * For each enabled locale, is the label present (non-blank)? The default
 * locale is listed first; duplicate locale codes are collapsed. Labels in
 * locales that are not enabled are ignored (kept in the data, not counted).
 */
export function translationCoverage(
  labels: Record<string, string | undefined> | undefined | null,
  enabledLocales: readonly string[],
  defaultLocale: string,
): TranslationCoverage {
  const ordered = [defaultLocale, ...enabledLocales.filter((l) => l !== defaultLocale)]
  const unique = Array.from(new Set(ordered.filter(Boolean)))
  const l = labels ?? {}
  const perLocale = unique.map((locale) => ({ locale, complete: (l[locale] ?? '').trim().length > 0 }))
  const missing = perLocale.filter((p) => !p.complete).map((p) => p.locale)
  return {
    perLocale,
    missing,
    completeCount: perLocale.length - missing.length,
    total: perLocale.length,
    isComplete: missing.length === 0,
  }
}

/** Summary for a list of terms: "3 of 14 need a translation". */
export function summarizeCoverage(coverages: readonly TranslationCoverage[]): { needTranslation: number; total: number } {
  return { needTranslation: coverages.filter((c) => !c.isComplete).length, total: coverages.length }
}
