/**
 * Interface translation report — what the admin Translations page shows and
 * what the warning test prints. Pure: give it the message bundles and the
 * status file, get one row per English key with each language's state.
 *
 * States, worst first (a row's language shows the first that applies):
 *   missing  — no text in that language (the dashboard falls back to English)
 *   outdated — the English changed after this translation was made
 *   machine  — filled in by scripts/i18n-translate.mjs, not checked by a person
 *   ok       — written or checked by a person, English unchanged since
 *
 * Interface text only (messages/*.json, ADR "Content Localization ≠ Interface
 * Localization"); website content has its own Translate module (ADR-023).
 */
import { flattenMessages, hashText, parseStatus } from './translation-core.mjs'

export const TRANSLATION_STATES = ['missing', 'outdated', 'machine', 'ok'] as const
export type TranslationState = (typeof TRANSLATION_STATES)[number]

export type TranslationStatusEntry = { s: 'machine' | 'original'; h: string }
/** src/lib/i18n/interface-translation-status.json: locale → key → "machine:<hash>" | "original:<hash>". */
export type TranslationStatusFile = Record<string, Record<string, string>>

export type TranslationCell = { text: string | null; state: TranslationState }

export type TranslationRow = {
  key: string
  /** First key segment — the part of the product ("clientDashboard", "admin", …). */
  area: string
  en: string
  cells: Record<string, TranslationCell>
}

export type LanguageSummary = { locale: string; total: number } & Record<TranslationState, number>

export type TranslationReport = {
  /** The languages other than English, in INTERFACE_LOCALES order. */
  locales: string[]
  rows: TranslationRow[]
  summary: LanguageSummary[]
}

type Tree = Record<string, unknown>

export function cellState(text: string | null | undefined, en: string, status: TranslationStatusEntry | undefined): TranslationState {
  if (text == null || text === '') return 'missing'
  if (status && status.h !== hashText(en)) return 'outdated'
  if (status?.s === 'machine') return 'machine'
  return 'ok'
}

export function buildTranslationReport(
  bundles: Record<string, Tree>,
  status: TranslationStatusFile,
  sourceLocale = 'en',
): TranslationReport {
  const en = flattenMessages(bundles[sourceLocale] ?? {})
  const locales = Object.keys(bundles).filter((l) => l !== sourceLocale)
  const flat = Object.fromEntries(locales.map((l) => [l, flattenMessages(bundles[l] ?? {})]))
  const summary: LanguageSummary[] = locales.map((locale) => ({ locale, total: 0, missing: 0, outdated: 0, machine: 0, ok: 0 }))

  const rows: TranslationRow[] = Object.entries(en).map(([key, text]) => {
    const cells: Record<string, TranslationCell> = {}
    locales.forEach((l, n) => {
      const value = flat[l][key] ?? null
      const state = cellState(value, text, parseStatus(status[l]?.[key]) ?? undefined)
      cells[l] = { text: value, state }
      summary[n].total++
      summary[n][state]++
    })
    return { key, area: key.split('.')[0], en: text, cells }
  })
  return { locales, rows, summary }
}

/** Rows that need a look in at least one language (anything but ok). */
export function needsAttention(row: TranslationRow, locale?: string): boolean {
  const cells = locale ? [row.cells[locale]] : Object.values(row.cells)
  return cells.some((c) => c && c.state !== 'ok')
}
