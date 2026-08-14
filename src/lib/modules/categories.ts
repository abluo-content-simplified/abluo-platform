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

  // Dual-read while the legacy blogCategory documents are retired. Content that
  // has been migrated stores the stable key ("dental-health"); content that has
  // not still stores a reference, which GROQ resolves to the category's English
  // title ("Dental Health"). Matching on either means a badge never blanks out
  // because a deploy and a data migration happened seconds apart — the failure
  // mode that took both sites down on 2026-08-14, in the opposite direction.
  //
  // Drop the label comparison once no content references a blogCategory.
  return configuredCategories(modules, moduleId)
    .filter((entry) => selected.has(entry.value) || selected.has(entry.label?.en ?? '\u0000'))
    .map((entry) => ({
      key: entry.value,
      title: label(entry, locale, defaultLocale),
      color: entry.color,
    }))
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
