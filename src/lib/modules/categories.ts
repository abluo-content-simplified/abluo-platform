// ── Category resolution ───────────────────────────────────────────────────────
// ADR-020 Amendment B.
//
// Content stores stable category KEYS; the labels and colours live in the
// owning module's per-website configuration. This file is the one place that
// turns keys into something renderable.
//
// Why keys rather than labels on the document: an admin renaming "Dental
// Health", or translating it into German, must not touch the ten posts filed
// under it. The key is the join; everything else is presentation.
//
// Pure — no I/O, no React. Callers pass the module config they already fetched
// (projectModuleConfigQuery), so this adds no queries.

import { getModuleConfig, type ProjectModuleConfig } from './config'
import type { ModuleConfigListEntry } from './types'

/** A category ready to render. */
export type ResolvedCategory = {
  /** The stable key stored on the content. */
  key: string
  /** Label in the requested locale, with fallbacks applied. */
  title: string
  /** Optional badge colour. */
  color?: string
}

/** Reading the raw config array off a module. */
function configuredCategories(
  modules: ProjectModuleConfig,
  moduleId: string
): ModuleConfigListEntry[] {
  const raw = getModuleConfig(modules, moduleId)?.categories
  return Array.isArray(raw) ? (raw as ModuleConfigListEntry[]) : []
}

/**
 * Localized label for one entry.
 *
 * Same fallback chain GROQ applies to every other localized field —
 * requested locale → website default → English → any populated value — so a
 * category with only an Italian label still renders on the English site rather
 * than showing a raw key.
 */
function label(entry: ModuleConfigListEntry, locale: string, defaultLocale: string): string {
  const l = entry.label ?? {}
  return (
    l[locale] ??
    l[defaultLocale] ??
    l.en ??
    Object.values(l).find((v) => typeof v === 'string' && v.trim() !== '') ??
    entry.value
  )
}

/**
 * Resolves the categories on one piece of content.
 *
 * Order follows the module's configured order, not the order stored on the
 * document, so badges read consistently across a listing however individual
 * posts were tagged.
 *
 * A key with no matching definition is DROPPED rather than rendered raw: it
 * means an admin deleted the category, and showing `dental_health` to a visitor
 * would be worse than showing nothing. The Studio picker surfaces the same
 * situation to the admin, where it can actually be fixed.
 */
export function resolveCategories(
  keys: string[] | null | undefined,
  modules: ProjectModuleConfig,
  moduleId: string,
  locale: string,
  defaultLocale = 'en'
): ResolvedCategory[] {
  if (!keys || keys.length === 0) return []
  const selected = new Set(keys)

  // Matching is on the stable key or the English label — see categoryKeysOf()
  // for why both can arrive here while blogCategory documents still exist.
  return configuredCategories(modules, moduleId)
    .filter((entry) => selected.has(entry.value) || selected.has(entry.label?.en ?? '\u0000'))
    .map((entry) => ({
      key: entry.value,
      title: label(entry, locale, defaultLocale),
      color: entry.color,
    }))
}

// ── Reading the two category shapes ───────────────────────────────────────────

/** What GROQ returns for `categories` — a stable key, or a reference object. */
export type RawCategoryEntry = string | { _ref?: string; _type?: string } | null

/** A content document as projected: the raw array plus resolved titles. */
export interface CategorySource {
  categoryKeys?: RawCategoryEntry[] | null
  categoryTitles?: (string | null)[] | null
}

/**
 * Collapse the two category shapes into one list of match tokens.
 *
 * Content migrated to module-config categories stores a stable key
 * ("dental-health"). Content not yet migrated stores a reference to a
 * blogCategory document, for which GROQ resolves the English title
 * ("Dental Health") into the parallel `categoryTitles` array.
 *
 * The merge lives here rather than in GROQ because GROQ cannot express it:
 * `categories[]{ ... }` object-projects over the array, which yields [null]
 * when the elements are plain strings rather than objects. An earlier attempt
 * did exactly that and silently blanked every badge the moment the data was
 * migrated — it had only ever been tested against the reference shape. Two
 * plain projections plus this function are testable against both.
 *
 * Positional: `categoryTitles` is projected from the same array, so index i of
 * one corresponds to index i of the other.
 */
export function categoryKeysOf(source: CategorySource | null | undefined): string[] {
  const raw = source?.categoryKeys ?? []
  const titles = source?.categoryTitles ?? []

  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i]
    if (typeof entry === 'string' && entry !== '') {
      out.push(entry)
      continue
    }
    // A reference: fall back to the title GROQ resolved at the same index.
    const title = titles[i]
    if (typeof title === 'string' && title !== '') out.push(title)
  }
  return out
}

/** resolveCategories() applied directly to a projected document. */
export function resolveCategoriesFor(
  source: CategorySource | null | undefined,
  modules: ProjectModuleConfig,
  moduleId: string,
  locale: string,
  defaultLocale = 'en'
): ResolvedCategory[] {
  return resolveCategories(categoryKeysOf(source), modules, moduleId, locale, defaultLocale)
}

// ── Reading time ──────────────────────────────────────────────────────────────

/** Average adult reading speed for prose, in words per minute. */
export const DEFAULT_READING_SPEED_WPM = 200

/**
 * Average characters per word, including the trailing space.
 *
 * GROQ can measure characters but not words, so reading time is computed from a
 * character count divided by this constant. ~5.7 is the standard figure for
 * English and Italian prose; it is an estimate either way, and the reader only
 * ever sees a rounded minute count.
 */
const AVERAGE_CHARS_PER_WORD = 5.7

/** The website's configured reading speed, or the default. */
export function readingSpeed(modules: ProjectModuleConfig, moduleId: string): number {
  const configured = getModuleConfig(modules, moduleId)?.readingSpeed
  return typeof configured === 'number' && configured > 0
    ? configured
    : DEFAULT_READING_SPEED_WPM
}

/**
 * Characters per minute, for the `$charsPerMinute` GROQ parameter.
 *
 * Reading time is computed in the query rather than the component so every
 * surface — listing card, detail page, dashboard — derives it identically from
 * one number.
 */
export function charsPerMinute(modules: ProjectModuleConfig, moduleId: string): number {
  return Math.round(readingSpeed(modules, moduleId) * AVERAGE_CHARS_PER_WORD)
}

/** Characters per minute at the default speed, for callers with no module config. */
export const DEFAULT_CHARS_PER_MINUTE = Math.round(
  DEFAULT_READING_SPEED_WPM * AVERAGE_CHARS_PER_WORD
)
