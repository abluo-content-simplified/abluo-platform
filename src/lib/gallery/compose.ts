import type { Gallery, GalleryItem, PhotoGallerySection } from '@/lib/sanity/types'

// ── Composing galleries (ADR-022 §1, §3) ──────────────────────────────────────
// A gallery is a small, focused, hand-ordered set. A placement composes one or
// more of them. Nothing here filters or excludes individual photos: if a page
// needs a different selection, that is a different gallery.

export interface GalleryGroup {
  key: string
  title: string | undefined
  items: GalleryItem[]
}

/**
 * The galleries a section shows. `galleries` wins when it has any; otherwise
 * the legacy single `gallery` reference — so every section authored before
 * ADR-022 renders exactly as before. Unresolvable references (deleted or
 * unpublished galleries) come back from GROQ as null and are dropped.
 */
export function galleriesOf(section: Pick<PhotoGallerySection, 'galleries' | 'gallery'>): Gallery[] {
  const many = (section.galleries ?? []).filter((g): g is Gallery => !!g)
  if (many.length > 0) return many
  return section.gallery ? [section.gallery] : []
}

export function toGroups(galleries: Gallery[]): GalleryGroup[] {
  return galleries.map((g) => ({
    key: g._id,
    title: g.title || undefined,
    items: (g.items ?? []).filter((i) => !!i?.mediaAsset),
  }))
}

/**
 * Every item of every group, in order, each photo once. The same Media Library
 * asset can sit in two galleries (the implantology photo in both "Treatments"
 * and "Room 2"); the combined view shows it the first time only.
 */
export function combineGroups(groups: GalleryGroup[]): GalleryItem[] {
  const seen = new Set<string>()
  const out: GalleryItem[] = []
  for (const group of groups) {
    for (const item of group.items) {
      const id = item.mediaAsset?._id ?? item._key
      if (seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
  }
  return out
}

export interface GalleryTab {
  id: string
  label: string
  items: GalleryItem[]
}

/**
 * The tab set for a placement, or a single untitled set when tabs do not apply.
 * Tabs need at least two galleries — one gallery in "tabs" mode is just a set.
 * The "All" tab comes first and is the tab selected on load (Tom, 2026-09-28).
 */
export function buildTabs(
  groups: GalleryGroup[],
  opts: { display?: 'combined' | 'tabs' | null; showAllTab?: boolean | null; allLabel: string; fallbackLabel: (index: number) => string }
): GalleryTab[] {
  const nonEmpty = groups.filter((g) => g.items.length > 0)
  if (opts.display !== 'tabs' || nonEmpty.length < 2) {
    return [{ id: 'all', label: opts.allLabel, items: combineGroups(nonEmpty) }]
  }
  const tabs: GalleryTab[] = nonEmpty.map((g, i) => ({
    id: g.key,
    label: g.title ?? opts.fallbackLabel(i),
    items: g.items,
  }))
  if (opts.showAllTab !== false) {
    tabs.unshift({ id: 'all', label: opts.allLabel, items: combineGroups(nonEmpty) })
  }
  return tabs
}
