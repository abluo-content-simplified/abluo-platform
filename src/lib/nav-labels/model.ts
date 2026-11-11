/**
 * Navigation labels (Tom, 2026-11-11): a project may rename a few dashboard
 * sections — only those an organisation really calls something else (People
 * → "Teachers", Testimonials → "Reviews"). One label per section and interface
 * language; empty = the default name in that language. The label is used in
 * the sidebar and as the section's page title — nothing else (no singular /
 * plural forms, never the public website). Pure; client-safe.
 */
import { INTERFACE_LOCALES, type InterfaceLocale } from '@/lib/i18n/locales'

/** The sections that can be renamed, in sidebar order. Media, Analytics, Settings, Digital Cards… keep their names. */
export const CUSTOM_LABEL_IDS = ['blog', 'events', 'courses', 'documents', 'testimonials', 'people'] as const
export type CustomLabelId = (typeof CUSTOM_LABEL_IDS)[number]
export const NAV_LABEL_MAX = 30

export const isCustomLabelId = (v: unknown): v is CustomLabelId => typeof v === 'string' && (CUSTOM_LABEL_IDS as readonly string[]).includes(v)
export const isInterfaceLocale = (v: unknown): v is InterfaceLocale => typeof v === 'string' && (INTERFACE_LOCALES as readonly string[]).includes(v)

/** Labels of one project: locale → section → label (only the ones set). */
export type NavLabelMap = Partial<Record<InterfaceLocale, Partial<Record<CustomLabelId, string>>>>

/** One line, collapsed spaces, at most 30 characters; '' = back to the default. null = not usable. */
export function cleanNavLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length <= NAV_LABEL_MAX ? s : null
}

/** Pure: the form's input → the rows to keep (set) and the ones to clear. Unknown sections / languages are dropped. */
export function planNavLabels(input: unknown): { ok: true; set: { navId: CustomLabelId; locale: InterfaceLocale; label: string }[]; clear: { navId: CustomLabelId; locale: InterfaceLocale }[] } | { ok: false } {
  if (!input || typeof input !== 'object') return { ok: false }
  const set: { navId: CustomLabelId; locale: InterfaceLocale; label: string }[] = []
  const clear: { navId: CustomLabelId; locale: InterfaceLocale }[] = []
  for (const [locale, byId] of Object.entries(input as Record<string, unknown>)) {
    if (!isInterfaceLocale(locale) || !byId || typeof byId !== 'object') continue
    for (const [navId, raw] of Object.entries(byId as Record<string, unknown>)) {
      if (!isCustomLabelId(navId)) continue
      const label = cleanNavLabel(raw)
      if (label === null) return { ok: false }
      if (label) set.push({ navId, locale, label })
      else clear.push({ navId, locale })
    }
  }
  return { ok: true, set, clear }
}

/** The labels for one interface language: section → custom label (only those set). */
export function labelsFor(map: NavLabelMap, locale: string): Partial<Record<CustomLabelId, string>> {
  return isInterfaceLocale(locale) ? { ...(map[locale] ?? {}) } : {}
}
