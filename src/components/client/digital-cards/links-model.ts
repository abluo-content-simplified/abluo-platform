/**
 * Digital Card links in the editor (round 4, Tom 2026-11-09): what each link
 * looks like in the list (label as visitors see it, one-liner, a small
 * type · target hint) and the reorder moves (drag and the grip's arrow keys).
 * Pure, so it is unit-tested with the real data shapes.
 */
import type { DigitalCardLinkValue, DigitalCardSnapshot, DigitalCardTargetOption } from '@/lib/api/digital-cards'
import { dropIndex, type DragOver } from '@/components/app/ui/use-pointer-drag'
import { matchCandidate } from '@/components/app/ui/search-match'
import type { DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { cardLinkTargetId } from '@/lib/modules/digital-cards/model'
import { cardModuleLabel, cardSectionLabel, linkDefaultLabel } from '@/lib/modules/digital-cards/website'

/** Moves one item from → to (unchanged when either is out of range). */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || to < 0 || to >= next.length || from === to) return next
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** A drop of `key` before / after `over` (usePointerDrag) → the new order, or null when nothing moves. */
export function dropLink(links: readonly DigitalCardLinkValue[], key: string, over: DragOver): DigitalCardLinkValue[] | null {
  const keys = links.map((l) => l.key)
  const at = dropIndex(keys, key, over)
  return at === null ? null : moveIndex(links, keys.indexOf(key), at)
}

export type LinkTargets = { pages: DigitalCardSnapshot['pages']; files: DigitalCardSnapshot['files'] }

/** The picker id of a page / form / booking link's target (a page link may also hold a section or module page — Amendment B). */
export function linkTargetIdOf(l: DigitalCardLinkValue): string | null {
  if (l.kind === 'page') return cardLinkTargetId(l)
  return l.kind === 'form' || l.kind === 'booking' ? l.page : null
}

/** The chosen target's title: the picker option's, else (a section / module page no longer offered) its standard name. */
function targetTitle(l: DigitalCardLinkValue, t: LinkTargets, siteMessages?: DigitalCardSiteMessages): string | null {
  const id = linkTargetIdOf(l)
  const hit = id ? t.pages.find((p) => p.id === id)?.title : null
  if (hit) return hit
  if (l.kind !== 'page' || l.page || !siteMessages) return null
  return cardSectionLabel(l.internalPage, siteMessages) ?? cardModuleLabel(l.moduleId, siteMessages)
}

/** The page / file / address / number the link opens, as text ('' while not chosen). */
export function linkTargetText(l: DigitalCardLinkValue, t: LinkTargets, siteMessages?: DigitalCardSiteMessages): string {
  switch (l.kind) {
    case 'url':
      return l.url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
    case 'page':
    case 'form':
    case 'booking':
      return targetTitle(l, t, siteMessages) || ''
    case 'file':
      return (l.file && t.files[l.file]?.title) || ''
    default:
      return l.value.trim()
  }
}

/** The label the card shows when none is typed: the target's / file's title, else the standard label (same as the website). */
export function linkFallbackLabel(l: DigitalCardLinkValue, t: LinkTargets, siteMessages: DigitalCardSiteMessages): string {
  const pageTitle = targetTitle(l, t, siteMessages)
  const fileTitle = l.file ? t.files[l.file]?.title : null
  return linkDefaultLabel(l.kind, { pageTitle, fileTitle }, siteMessages)
}

export type TargetGroup = NonNullable<DigitalCardTargetOption['group']>
const GROUP_ORDER: readonly TargetGroup[] = ['pages', 'catalogue', 'sections']

/**
 * The page picker's list (Amendment B): the options grouped Pages → Catalogue
 * → Sections, filtered by the search (word-prefix match on the title and the
 * path, accents and case ignored). `pagesOnly` for form / booking links,
 * which point at a page.
 */
export function targetGroups(options: readonly DigitalCardTargetOption[], query: string, pagesOnly = false): Array<{ group: TargetGroup; options: DigitalCardTargetOption[] }> {
  const q = query.trim()
  const out: Array<{ group: TargetGroup; options: DigitalCardTargetOption[] }> = []
  for (const group of pagesOnly ? (['pages'] as const) : GROUP_ORDER) {
    const list = options.filter((o) => (o.group ?? 'pages') === group && (!q || matchCandidate(q, { label: o.title, synonyms: o.path ? [o.path] : [] })))
    if (list.length) out.push({ group, options: list })
  }
  return out
}

/**
 * One link as the list shows it, in the language being edited: the label
 * visitors see (typed in this language, else in the default language, else
 * the fallback — `isDefault` says it is not typed), the one-liner (same
 * fallback, never invented), and the target.
 */
export function linkDisplay(l: DigitalCardLinkValue, lang: string, defaultLocale: string, t: LinkTargets, siteMessages: DigitalCardSiteMessages) {
  const typed = l.label[lang]?.trim() || l.label[defaultLocale]?.trim() || ''
  const description = l.description[lang]?.trim() || l.description[defaultLocale]?.trim() || ''
  return { label: typed || linkFallbackLabel(l, t, siteMessages), isDefault: !typed, description, target: linkTargetText(l, t, siteMessages) }
}
